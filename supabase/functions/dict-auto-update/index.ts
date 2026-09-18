// supabase/functions/dict-auto-update/index.ts
// 役割: 店舗ごとの unknown_words を GPT で分類し、unknown_words と dict_rules を更新する
// 呼び出し例: POST /functions/v1/dict-auto-update
//   { "store_id": "kemuriya_namba2", "limit": 15, "dry_run": false }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
// 鍵の解決は ../_shared/keys.ts に集約（新方式 sb_secret_ / レガシー両対応）
import { logKeyMode, serviceKey, supabaseUrl } from "../_shared/keys.ts";

// ========= 環境変数ユーティリティ =========
function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ========= OpenAI 設定 =========

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// ★ 環境変数で上書き可能（なければ gpt-4.1）
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1";
// ★ 温度も env で調整可（なければ 0.1）
const OPENAI_TEMPERATURE = Number(Deno.env.get("OPENAI_TEMPERATURE") ?? "0.1");
// ★ 1 回あたりのバッチサイズ上限（body.limit がなければこれを使う）
const DEFAULT_BATCH_LIMIT = Number(Deno.env.get("DICT_UPDATE_BATCH_SIZE") ?? "15");

type UnknownWordRow = {
  id: string;
  surface: string;
  lemma: string | null;
  key_norm: string | null;
  freq_total: number;
  sample_sentence: string | null;
};

type GptWordResult = {
  surface: string;
  // ★ 料理・ドリンク・雰囲気・サービス・清潔さ・価格・その他
  category:
    | "food"          // 料理・食べ物・料理名・コース名
    | "drink"         // ドリンク・アルコール・ソフトドリンク
    | "atmosphere"    // 雰囲気・内装・音楽・客層など
    | "service"       // 接客・スタッフ対応・スピードなど
    | "cleanliness"   // 清潔さ・衛生・ニオイなど
    | "price"         // 値段・コスパ・量と価格のバランス
    | "other";        // 上記どれにも当てはまらない一般語

  is_food: boolean;        // 料理・食材・飲み物・メニュー名なら true
  is_stopword: boolean;    // 分析上あまり意味のない一般名詞なら true
  canonical_key_norm: string | null; // 正規化キー（代表語）
  sentiment:
    | "positive"
    | "negative"
    | "neutral"
    | "mixed"
    | "unknown";
  add_to_dict: boolean;    // 辞書に登録した方がよければ true
  notes?: string | null;
};

type GptResponse = {
  words: GptWordResult[];
};

// ========= GPT 呼び出し本体 =========

// GPT に unknown_words の配列を投げて分類結果を受け取る
async function classifyUnknownWordsWithGPT(
  apiKey: string,
  words: UnknownWordRow[],
): Promise<GptResponse> {
  // 📌 品質重視: ルールをかなり細かく明示
  const systemPrompt = `
あなたは「飲食店レビュー・美容サロンレビューの単語辞書」を整備するアシスタントです。
与えられた「未知語」候補について、次の6カテゴリ＋その他に分類し、
JSON 形式で以下の情報を判定してください。

【必ず使うカテゴリ（category）】
- "food"        : 料理名・食べ物・コース名・料理に強く関係する語（例: 餃子, 麻婆豆腐, 前菜, デザート, スイーツ）
- "drink"       : 飲み物・アルコール・ソフトドリンク（例: ビール, ハイボール, ワイン, お茶, コーヒー）
- "atmosphere"  : 雰囲気・内装・音楽・空間・客層（例: 落ち着いた, おしゃれ, にぎやか, 静か, 照明）
- "service"     : スタッフ・接客態度・提供スピード・気配り（例: 店員さん, 接客, 提供が早い, 愛想, 気遣い）
- "cleanliness" : 清潔さ・衛生・ニオイ・片付け（例: 清潔感, きれい, 汚い, 匂い, 油っぽい床）
- "price"       : 値段・コスパ・量と価格のバランス（例: 価格, コスパ, 高い, 安い, 量の割に）

上記どれにもはっきり当てはまらない一般語は "other" を使ってください。

【判定してほしい項目】
- category: 上記のいずれか1つ ("food" / "drink" / "atmosphere" / "service" / "cleanliness" / "price" / "other")
- is_food:
    - 料理名・料理ジャンル・食材・飲み物・メニュー名なら true
    - それ以外は false
- is_stopword:
    - 「感じ」「こと」「ところ」「部分」「利用」「訪問」など、
      分析にあまり役立たない一般的な名詞なら true
    - 店ごとの特徴や分析したい概念を表す語なら false
- canonical_key_norm:
    - 類似語を1つの代表語にまとめるための「正規化キー」
    - 例:
        - 「唐揚げ」「からあげ」「鶏のから揚げ」 → "唐揚げ"
        - 「ハイボール」「ハイボール濃いめ」 → "ハイボール"
        - 「生ビール」「ビール」 → "ビール"
    - 明確な代表語が思い当たらない場合や、ごく一般的な語の場合は null
- sentiment:
    - その語がレビュー文脈の中で「どう評価されがちか」の傾向
    - "positive" / "negative" / "neutral" / "mixed" / "unknown" のいずれか
    - 例:
        - 「唐揚げ」がおいしい・絶品・好評 → "positive"
        - 「唐揚げ」が油っぽい・冷めている → "negative"
        - 良いとも悪いとも言い切れない、混ざっている → "mixed"
- add_to_dict:
    - 店舗分析に役立つので辞書登録した方がよい語なら true
    - 一般的すぎる語・他の語で十分に表現できる語・ノイズなら false
- notes:
    - 必要であれば簡単な補足（任意）

【重要な方針】
- 出力は「必ず」有効な JSON のみとし、日本語の説明文は一切含めないでください。
- words 配列の順序は、入力された未知語の順序とおおむね対応させてください。
- 不明な場合は無理に予測せず、category は "other"、sentiment は "unknown" にして構いません。

【出力フォーマット（厳守）】
{
  "words": [
    {
      "surface": "...",
      "category": "food" | "drink" | "atmosphere" | "service" | "cleanliness" | "price" | "other",
      "is_food": true/false,
      "is_stopword": true/false,
      "canonical_key_norm": "..." または null,
      "sentiment": "positive" | "negative" | "neutral" | "mixed" | "unknown",
      "add_to_dict": true/false,
      "notes": "..." または null
    },
    ...
  ]
}
`;

  const userItems = words.map((w) => ({
    surface: w.surface,
    lemma: w.lemma,
    key_norm: w.key_norm,
    freq_total: w.freq_total,
    sample_sentence: w.sample_sentence,
  }));

  const userPrompt = `
以下は、辞書に未登録の「未知語」候補の一覧です。
各語について、前述のルールに従い JSON 形式で判定してください。

${JSON.stringify(userItems, null, 2)}
`.trim();

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: OPENAI_TEMPERATURE,
      max_tokens: 3000, // 品質重視: 余裕を持たせる
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("❌ OpenAI API error:", res.status, text);
    throw new Error(`OpenAI API error: ${res.status}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    console.error("❌ OpenAI response content missing:", JSON.stringify(json));
    throw new Error("OpenAI response content missing");
  }

  let parsed: GptResponse;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.error("❌ JSON parse error:", e, "content:", content);
    throw new Error("Failed to parse OpenAI JSON");
  }

  return parsed;
}

// ========= メイン =========

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  // CORS プレフライト
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // ヘルスチェック: GET /health
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "dict-auto-update alive",
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        default_batch_limit: DEFAULT_BATCH_LIMIT,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const store_id: string | undefined = body.store_id;
    const limitRaw: number | undefined = body.limit;
    const dry_run: boolean = body.dry_run ?? false;

    if (!store_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "store_id is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // limit は body > env > デフォルト の優先順
    const limit = Math.max(
      1,
      Number.isFinite(Number(limitRaw))
        ? Number(limitRaw)
        : DEFAULT_BATCH_LIMIT,
    );

    // 鍵は keys.ts 経由。見つからない場合は従来どおり getEnv が
    // `Missing env: ...` を投げる（エラー文言を変えないため）
    const SUPABASE_URL = supabaseUrl() ?? getEnv("SUPABASE_URL");
    const SERVICE_KEY = serviceKey() ?? getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = getEnv("OPENAI_API_KEY");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    logKeyMode("dict-auto-update");

    const unknownTable = `${store_id}_unknown_words`;
    const dictTable = `${store_id}_dict_rules`;

    // 1) 未処理の unknown_words を取得
    const { data: candidates, error: fetchError } = await supabase
      .from(unknownTable)
      .select("*")
      // 📌 GPT がまだ一度も触っていないレコードだけを対象にする
      .is("category_pred", null)
      .is("sentiment_pred", null)
      .order("freq_total", { ascending: false })
      .limit(limit);

    if (fetchError) {
      console.error("❌ unknown_words fetch error:", fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: fetchError.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "no candidates" }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const unknownRows: UnknownWordRow[] = candidates.map((row: any) => ({
      id: row.id,
      surface: row.surface,
      lemma: row.lemma ?? null,
      key_norm: row.key_norm ?? null,
      freq_total: row.freq_total ?? 0,
      sample_sentence: row.sample_sentence ?? null,
    }));

    // 2) GPT で分類
    const gptResult = await classifyUnknownWordsWithGPT(OPENAI_API_KEY, unknownRows);

    // surface をキーにマッピング
    const resultMap = new Map<string, GptWordResult>();
    for (const w of gptResult.words || []) {
      resultMap.set(w.surface, w);
    }

    // 3) unknown_words を更新 & dict_rules へ upsert 用の行を構築
    const unknownUpdates: any[] = [];
    const dictInserts: any[] = [];

    const nowIso = new Date().toISOString();

    for (const row of unknownRows) {
      const res = resultMap.get(row.surface);
      if (!res) continue;

      // unknown_words 側の更新データ
      unknownUpdates.push({
        id: row.id,
        category_pred: res.category,
        sentiment_pred: res.sentiment,
        canonical_suggestion: res.canonical_key_norm,
        add_to_dict: res.add_to_dict,
        last_seen: nowIso,
      });

      if (!res.add_to_dict) continue;

      // canonical / lemma / surface から代表 key を決定
      const baseKey = row.lemma ?? row.surface;
      const keyNorm = baseKey;
      const canonical = res.canonical_key_norm && res.canonical_key_norm.trim().length > 0
        ? res.canonical_key_norm.trim()
        : null;

      // is_food ルール
      if (res.is_food) {
        dictInserts.push({
          store_id,
          rule_type: "is_food",
          key_norm: canonical ?? keyNorm,
          canonical_key_norm: null,
          value_bool: true,
          enabled: true,
          source: "auto_unknown_words",
          note: `auto: category=${res.category}, sentiment=${res.sentiment}`,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      // stopword ルール
      if (res.is_stopword) {
        dictInserts.push({
          store_id,
          rule_type: "stopword",
          key_norm: keyNorm,
          canonical_key_norm: null,
          value_bool: null,
          enabled: true,
          source: "auto_unknown_words",
          note: res.notes ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      // alias ルール（canonical があり、baseKey と違う場合）
      if (canonical && canonical !== keyNorm) {
        dictInserts.push({
          store_id,
          rule_type: "alias",
          key_norm: keyNorm,
          canonical_key_norm: canonical,
          value_bool: null,
          enabled: true,
          source: "auto_unknown_words",
          note: res.notes ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    }

    if (dry_run) {
      // ドライラン: 何が起きるかだけ返す
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          processed: unknownRows.length,
          unknown_updates: unknownUpdates,
          dict_inserts: dictInserts,
        }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // 4) unknown_words を更新
    if (unknownUpdates.length > 0) {
      const { error: upErr } = await supabase
        .from(unknownTable)
        .upsert(unknownUpdates, { onConflict: "id" });
      if (upErr) {
        console.error("❌ unknown_words upsert error:", upErr);
        return new Response(
          JSON.stringify({ ok: false, error: upErr.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
        );
      }
    }

    // 5) dict_rules へ upsert
    if (dictInserts.length > 0) {
      const { error: dictErr } = await supabase
        .from(dictTable)
        .upsert(dictInserts, {
          // ⚠ ここは現在の unique index (rule_type, key_norm, store_key) に合わせる
          onConflict: "rule_type,key_norm,store_key",
        });
      if (dictErr) {
        console.error("❌ dict_rules upsert error:", dictErr);
        return new Response(
          JSON.stringify({ ok: false, error: dictErr.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: unknownRows.length,
        updated_unknown_words: unknownUpdates.length,
        upserted_dict_rules: dictInserts.length,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (e: any) {
    console.error("❌ unexpected error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
