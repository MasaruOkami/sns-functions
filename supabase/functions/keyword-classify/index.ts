// supabase/functions/keyword-classify/index.ts
// 役割：
//  - mode に応じて、単店 or 全店舗のキーワード分類を実行
//  - {store_id}_keyword から未分類レコードを取得
//  - OpenAI で canonical_key / category_pred / is_food を付与
//  - RPC apply_keyword_classification で id 指定の UPDATE（INSERT はしない）
//
// 【2026-09-23 修正】lemma_key を書かない。
//  以前は GPT の返す key_norm で lemma_key を上書きしていたが、同じ語がバッチごとに
//  「料理」「リョウリ」「食べ放題・飲み放題」のように別のキーになり、集計が割れていた。
//  lemma_key は DB の生成列（lemma_key_of(lemma)）が決める。lemma / surface / pos /
//  sentiment / review_id も GPT の値では書かない（lemma は衝突キーの一部）。
//  対象店舗は store_profiles.is_active（keyword_enabled は参照しない）。
//
// 【2026-08-22 修正】認証を追加。
//  これまで verify_jwt=false かつ関数内の認証も無く、**完全に無認証**だった。
//  URLを知る第三者が {"mode":"all"} を投げれば全店舗分の OpenAI(gpt-4.1) 呼び出しを起こせ、
//  課金と DB 負荷を任意に発生させられる状態だったため、x-cron-secret による認証を必須化する。
//  未設定時に素通りする fail-open は避け、未設定なら 500 で閉じる。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from "https://esm.sh/openai@4.24.3";
import { adminClient } from "../_shared/keys.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const KEYWORD_CRON_SECRET = Deno.env.get("KEYWORD_CRON_SECRET") ?? "";

const client = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = adminClient("keyword-classify");

type Sentiment = "positive" | "negative" | "neutral" | null;

interface KeywordRow {
  id: string;
  review_id: string | null;
  lemma: string;
  surface: string | null;
  pos: string | null;
  sentiment: Sentiment;
  context_sentence: string | null;
}

interface RequestBody {
  mode?: string;         // "single" | "all"
  store_id?: string;     // 単店モード用
  store_ids?: string[];  // 全店モードでも限定したいとき
  batch_size?: number;   // 1 店舗あたりの最大処理件数
}

interface KeywordOutput {
  id: string;
  lemma?: string;
  surface?: string;
  canonical_key?: string;
  category?: string;
  is_food?: boolean;
}

// ========================
// メインハンドラ
// ========================
Deno.serve(async (req) => {
  try {
    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-cron-secret",
        },
      });
    }

    // ── 認証（verify_jwt=false のため、ここが唯一の防御線。fail-closed）──
    if (!KEYWORD_CRON_SECRET) {
      console.error("[keyword-classify] KEYWORD_CRON_SECRET is not configured — refusing all requests");
      return jsonResponse({ error: "SERVER_MISCONFIG" }, 500);
    }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!headerSecret || headerSecret !== KEYWORD_CRON_SECRET) {
      return jsonResponse({ error: "UNAUTHORIZED" }, 401);
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;

    const mode = body.mode ?? (body.store_id ? "single" : "all");
    const batchSize = body.batch_size ?? 100;

    console.log("[keyword-classify] mode =", mode, "batchSize =", batchSize);

    // -------- single モード --------
    if (mode === "single") {
      const storeId = body.store_id;
      if (!storeId) {
        return jsonResponse({ error: "store_id is required for single mode" }, 400);
      }
      const result = await processStore(storeId, batchSize);
      return jsonResponse({ ok: true, mode: "single", store_id: storeId, result }, 200);
    }

    // -------- all モード --------
    if (mode === "all") {
      let storeIds: string[] = [];

      if (Array.isArray(body.store_ids) && body.store_ids.length > 0) {
        storeIds = body.store_ids;
      } else {
        // 稼働店舗（store_profiles.is_active = true）を自動取得。
        // ETL・未知語収集・健全性判定と同じ 1 つのフラグで揃える（2026-09-23）
        const { data, error } = await supabase
          .from("store_profiles")
          .select("store_id")
          .eq("is_active", true);

        if (error) {
          console.error("❌ store_profiles select error", error);
          return jsonResponse(
            { error: "failed to fetch store_profiles", detail: error.message },
            500,
          );
        }

        storeIds = (data ?? [])
          .map((row: Record<string, unknown>) => row.store_id as string)
          .filter((s) => !!s);
      }

      if (storeIds.length === 0) {
        return jsonResponse(
          { ok: true, mode: "all", target_stores: 0, message: "no target stores (is_active)" },
          200,
        );
      }

      console.log("[keyword-classify] target stores =", storeIds);

      const results: Record<string, unknown>[] = [];
      for (const storeId of storeIds) {
        try {
          const r = await processStore(storeId, batchSize);
          results.push({ store_id: storeId, ...r });
        } catch (e) {
          console.error(`❌ processStore error [${storeId}]`, e);
          results.push({
            store_id: storeId,
            error: String((e as Error)?.message ?? e),
          });
        }
      }

      return jsonResponse(
        {
          ok: true,
          mode: "all",
          target_stores: storeIds.length,
          results,
        },
        200,
      );
    }

    // mode が変な値
    return jsonResponse({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    console.error("❌ keyword-classify top-level error", e);
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

// ======================
// 1 店舗分を処理するメインロジック
// ======================
async function processStore(storeId: string, batchSize: number) {
  const table = `${storeId}_keyword`;
  console.log(`[processStore] table=${table}`);

  // 1) 未分類キーワードを取得（canonical_key or category_pred が null）
  const { data: rows, error: selectError } = await supabase
    .from(table)
    .select(
      `
      id,
      review_id,
      lemma,
      surface,
      pos,
      sentiment,
      context_sentence
    `,
    )
    .or("canonical_key.is.null,category_pred.is.null")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (selectError) {
    throw new Error(`select error on ${table}: ${selectError.message}`);
  }

  if (!rows || rows.length === 0) {
    return {
      processed_rows: 0,
      updated_rows: 0,
      message: "no pending keywords",
    };
  }

  const inputs: KeywordRow[] = rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    review_id: (r.review_id as string) ?? null,
    lemma: ((r.lemma as string) ?? "").trim(),
    surface: (r.surface as string) ?? null,
    pos: (r.pos as string) ?? null,
    sentiment: (r.sentiment as Sentiment) ?? null,
    context_sentence: (r.context_sentence as string) ?? null,
  }));

  const validInputs = inputs.filter((k) => k.lemma !== "");
  if (validInputs.length === 0) {
    return {
      processed_rows: 0,
      updated_rows: 0,
      message: "no valid lemma in pending rows",
    };
  }

  // id -> 元行 のマップ（review_id / lemma / surface / pos / sentiment などを保持）
  const baseMap: Record<string, KeywordRow> = {};
  for (const row of validInputs) {
    if (row.id) baseMap[row.id] = row;
  }

  // 2) GPT プロンプト
  const prompt = buildPrompt(storeId, validInputs);

  const completion = await client.chat.completions.create({
    model: "gpt-4.1",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a precise Japanese NLP classifier for restaurant reviews. Return strict JSON only.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0].message.content;
  if (!raw) {
    throw new Error("empty response from OpenAI");
  }

  let parsed: { items?: KeywordOutput[] };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON parse error", e, raw);
    throw new Error("failed to parse OpenAI response");
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error("invalid OpenAI response structure");
  }

  // 書くのは canonical_key / category_pred / is_food の 3 列だけ（RPC 側で normalized=true, updated_at=now()）。
  // lemma / surface / pos / sentiment / review_id / lemma_key は GPT の値で上書きしない。
  const updates = parsed.items
    .map((item) => {
      if (!item.id) return null;
      const base = baseMap[item.id];
      if (!base) {
        // GPT が変な id を返した場合はスキップ（UPDATE 専用 RPC なので INSERT は起きない）
        console.warn("[keyword-classify] skip unknown id", item.id);
        return null;
      }
      const canonical_key = (item.canonical_key ?? "").trim() || base.lemma;
      return {
        id: item.id,
        canonical_key,
        category_pred: normalizeCategory(item.category),
        is_food: Boolean(item.is_food),
      };
    })
    .filter((u): u is NonNullable<typeof u> => !!u);

  if (updates.length === 0) {
    return {
      processed_rows: validInputs.length,
      updated_rows: 0,
      message: "no valid updates (all skipped)",
    };
  }

  const { data: updatedCount, error: rpcError } = await supabase.rpc(
    "apply_keyword_classification",
    { _table: `public.${table}`, payload: updates },
  );

  if (rpcError) {
    throw new Error(`apply_keyword_classification error on ${table}: ${rpcError.message}`);
  }

  return {
    processed_rows: validInputs.length,
    updated_rows: typeof updatedCount === "number" ? updatedCount : updates.length,
  };
}

// ======================
// 補助関数
// ======================
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function buildPrompt(storeId: string, keywords: KeywordRow[]): string {
  return `
あなたは飲食店レビューを分析する専門AIです。
店舗ID: ${storeId}
以下のキーワードについて、マーケティング分析に使いやすい形に正規化してください。

各要素に対して以下を決めてください：

- id: 入力の id をそのまま返す（DB更新のために必須）
- canonical_key: 分析やレポートで見せる代表表記
  - 例: 「チャーハン」「炒飯」「ちゃーはん」→ "チャーハン"
- category: 次のいずれか
  - "料理" / "ドリンク" / "雰囲気" / "サービス" / "清潔さ" / "価格" / "その他"
- is_food: 料理・ドリンクそのものを指す単語なら true、それ以外は false

【重要ルール】
- 意味が似ている語は、できるだけ同じ canonical_key にまとめる
- 店名や人名など固有名詞は "その他" カテゴリでも良い
- 中華・ラーメン・焼肉などジャンル固有の料理名も「料理」
- 曖昧な場合は無理に「料理」にせず、「その他」にする

出力フォーマットは STRICT JSON で、次の形 **のみ** を返してください：

{
  "items": [
    {
      "id": "入力の id",
      "canonical_key": "代表表記",
      "category": "料理|ドリンク|雰囲気|サービス|清潔さ|価格|その他",
      "is_food": true
    }
  ]
}

対象キーワード一覧:
${JSON.stringify(keywords, null, 2)}
`;
}

function normalizeCategory(
  raw: unknown,
): "料理" | "ドリンク" | "雰囲気" | "サービス" | "清潔さ" | "価格" | "その他" {
  const s = String(raw ?? "").trim();
  const mapping: Record<string, "料理" | "ドリンク" | "雰囲気" | "サービス" | "清潔さ" | "価格" | "その他"> = {
    "料理": "料理",
    "フード": "料理",
    "食べ物": "料理",
    "ドリンク": "ドリンク",
    "飲み物": "ドリンク",
    "雰囲気": "雰囲気",
    "内装": "雰囲気",
    "サービス": "サービス",
    "接客": "サービス",
    "清潔さ": "清潔さ",
    "衛生": "清潔さ",
    "価格": "価格",
    "コスパ": "価格",
    "値段": "価格",
    "その他": "その他",
  };

  if (mapping[s]) return mapping[s];

  if (s.includes("料理") || s.includes("フード")) return "料理";
  if (s.includes("ドリンク") || s.includes("飲み物")) return "ドリンク";
  if (s.includes("雰囲気") || s.includes("内装")) return "雰囲気";
  if (s.includes("サービス") || s.includes("接客")) return "サービス";
  if (s.includes("清潔") || s.includes("衛生")) return "清潔さ";
  if (s.includes("価格") || s.includes("コスパ") || s.includes("値段")) return "価格";

  return "その他";
}
