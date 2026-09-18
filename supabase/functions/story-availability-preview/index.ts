// supabase/functions/story-availability-preview/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";
import { adminClient, serviceKey, supabaseUrl } from "./_shared/keys.ts";
// ✅ viewer許可（確定）
const ALLOW_ROLES = ["admin", "editor"] as const;

// === 環境変数 ===
const SUPABASE_URL = supabaseUrl() ?? "";
const SUPABASE_SERVICE_ROLE_KEY = serviceKey() ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const STORY_BUCKET = Deno.env.get("STORY_BUCKET") ?? "story_assets";


if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY");
}

// DBは service role（RLSバイパス）でOK。ただし store_id は guard で確定した値だけ使う
const supabase = adminClient("story-availability-preview");

const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",
  // "https://YOUR_PROD_DOMAIN.com",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const o = origin && allowedOrigins.has(origin) ? origin : "http://localhost:3000"; 
  // 本番は PROD_DOMAIN に固定推奨。最低でも "*" は避ける。

  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-store-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

// guard が返す Response にも CORS を付ける（ブラウザ対策）
function withCors(res: Response, origin: string | null) {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) headers.set(k, String(v));
  return new Response(res.body, { status: res.status, headers });
}

type PreviewRequest = {
  store_id?: string;
  status: "available" | "few" | "full" | "closed";
  time_slot?: string;
  note?: string;
  platform?: "instagram_story";
};

type ErrorResponse = { error: string; details?: string };

// ==================== メイン処理 ====================

serve(async (req) => {
  const origin = req.headers.get("origin");

  // --- CORS preflight (OPTIONS) ---
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  try {
    // bodyは後で使うが、store_idは信用しない（guardで確定する）
    const body = (await req.json().catch(() => null)) as PreviewRequest | null;
    console.log("[story-availability-preview] request body:", body);

    // ✅ guard（viewer を許可）
    const g = await requireAuthPasswordOkAndStoreRole(req, {
      allowRoles: [...ALLOW_ROLES],
    }).catch((res) => res as Response);

    console.log("[DEBUG] guard result =", g);


    if (g instanceof Response) return withCors(g, origin);

    console.log("[guard result]", g);

    // ✅ store_id は guard の値のみ採用（storeId / store_id どちらでも拾う）
    const store_id = (g as any)?.storeId ?? (g as any)?.store_id;

    if (!store_id) {
      console.error("[story-availability-preview] guard returned no store_id:", g);
      return json({ error: "STORE_ID_MISSING_FROM_GUARD" }, 403, origin);
    }


    const status = body?.status;
    const time_slot = body?.time_slot;
    const note = body?.note;
    const platform = body?.platform ?? "instagram_story";

    if (!status) {
      return json({ error: "status is required" }, 400, origin);
    }

    // ---------- 1. 店舗情報の取得 ----------
    const { data: storeProfile, error: storeErr } = await supabase
      .from("store_profiles")
      .select("store_name, region_code")
      .eq("store_id", store_id)
      .single();

    if (storeErr) console.warn("store_profiles fetch error:", storeErr);

    const storeName = (storeProfile as any)?.store_name ?? "こちらのお店";

    // ---------- 2. store_media_gen_profile からスタイル比率取得 ----------
    const { data: mediaRows, error: mediaErr } = await supabase
      .from("store_media_gen_profile")
      .select("style_photo_ratio, style_illustration_ratio")
      .eq("store_id", store_id)
      .limit(1);

    if (mediaErr) console.warn("store_media_gen_profile fetch error:", mediaErr);

    const mediaProfile = mediaRows && mediaRows.length > 0 ? mediaRows[0] : null;

    const stylePhotoRatioRaw = Number(mediaProfile?.style_photo_ratio ?? 70);
    const styleIllustrationRatioRaw = Number(mediaProfile?.style_illustration_ratio ?? 30);

    const stylePhotoRatio = Math.max(0, Math.min(100, Number.isNaN(stylePhotoRatioRaw) ? 70 : stylePhotoRatioRaw));
    const styleIllustrationRatio = Math.max(
      0,
      Math.min(100, Number.isNaN(styleIllustrationRatioRaw) ? 30 : styleIllustrationRatioRaw),
    );

    console.log("[story-availability-preview] style ratios:", {
      stylePhotoRatio,
      styleIllustrationRatio,
    });

    // ---------- 3. caption生成（GPT） ----------
    const caption = await generateCaption({
      storeName,
      status,
      time_slot,
      note,
    });

    // ---------- 4. 画像生成 ----------
    const { imageUrl, path } = await generateStoryImageInBucket({
      storeId: store_id,
      storeName,
      status,
      time_slot,
      note,
      stylePhotoRatio,
      styleIllustrationRatio,
    });

    // ---------- 5. previews テーブルに保存 ----------
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 2);

    const { data: previewRow, error: insertErr } = await supabase
      .from("store_story_previews")
      .insert({
        store_id,
        status,
        time_slot: time_slot ?? null,
        note: note ?? null,
        platform,
        caption,
        image_url: imageUrl,
        expires_at: expiresAt.toISOString(),
      })
      .select("preview_id, image_url, caption, created_at")
      .single();

    if (insertErr) {
      console.error("insert preview error:", insertErr);
      return json(
        { error: "failed to save preview", details: insertErr.message } as ErrorResponse,
        500,
        origin,
      );
    }

    return json(
      {
        preview_id: previewRow.preview_id,
        image_url: previewRow.image_url,
        caption: previewRow.caption,
        storage_path: path,
        created_at: previewRow.created_at,
      },
      200,
      origin,
    );
  } catch (e: any) {
    console.error("story-availability-preview error:", e);
    return json({ error: "internal error", details: String(e?.message ?? e) }, 500, origin);
  }
});

// ==================== キャプション生成 ====================

async function generateCaption(params: {
  storeName: string;
  status: string;
  time_slot?: string;
  note?: string;
}): Promise<string> {
  const { storeName, status, time_slot, note } = params;

  const statusJa =
    status === "available"
      ? "空きがあります"
      : status === "few"
        ? "残りわずかです"
        : status === "full"
          ? "満席です"
          : "本日クローズです";

  const timePart = time_slot ? `時間帯：${time_slot}` : "";
  const notePart = note ?? "";

  const systemPrompt = `
あなたは飲食店・美容サロン向けのSNSストーリー文面を考える日本語コピーライターです。
Instagramストーリー用に、短くてわかりやすいテキストを1〜2文で作成してください。

必須条件：
- 予約・問い合わせ方法（DMや電話など）を自然に誘導する
- 絵文字は1〜3個まで
- ハッシュタグは付けない
- 「本日」「今」などのニュアンスを入れてもOKです
`.trim();

  const userPrompt = `
店舗名：${storeName}
空き状況：${statusJa}
${timePart}
メモ：${notePart}

この内容をもとに、Instagramストーリー用の文面を日本語で1〜2文作成してください。
`.trim();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 120,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    console.error("OpenAI caption error:", res.status, await res.text());
    return `${storeName} 本日${statusJa}。${timePart} ご予約はDMからどうぞ。`;
  }

  const data = await res.json();
  return (
    data.choices?.[0]?.message?.content?.trim() ??
    `${storeName} 本日${statusJa}。${timePart} ご予約はDMからどうぞ。`
  );
}

// ==================== 画像生成（スタイル比率反映版） ====================

function buildStyleHint(stylePhotoRatio: number, styleIllustrationRatio: number): string {
  const diff = stylePhotoRatio - styleIllustrationRatio;

  if (diff >= 20) {
    return `
全体はリアルな写真風の質感で、実写に近いスタイルにしてください。
陰影や質感をしっかり表現しつつも、SNS向けに少しだけデザイン性を加えてください。
`.trim();
  } else if (diff <= -20) {
    return `
全体はイラスト・グラフィック寄りのスタイルにしてください。
日本語テキストが読みやすいように配色とコントラストを調整してください。
`.trim();
  } else {
    return `
写真風とイラスト風の中間くらいの質感で、ややデザイン性のあるビジュアルにしてください。
実写すぎず、完全なアニメ風にもならないようにバランスを取ってください。
`.trim();
  }
}

async function generateStoryImageInBucket(params: {
  storeId: string;
  storeName: string;
  status: string;
  time_slot?: string;
  note?: string;
  stylePhotoRatio: number;
  styleIllustrationRatio: number;
}): Promise<{ imageUrl: string; path: string }> {
  const { storeId, storeName, status, time_slot, note, stylePhotoRatio, styleIllustrationRatio } = params;

  const statusJa =
    status === "available"
      ? "空きあります"
      : status === "few"
        ? "残りわずか"
        : status === "full"
          ? "満席"
          : "クローズ";

  const styleHint = buildStyleHint(stylePhotoRatio, styleIllustrationRatio);

  const noteForPrompt = note
    ? `補足情報：${note}\nこの内容もトーンや雰囲気の参考にしてください。`
    : "";

  const prompt = `
縦長（9:16）のSNSストーリー用画像を生成してください（解像度は 1024x1536 程度でOK）。
${storeName} の店名ロゴは入れず、シンプルなテキスト「${statusJa}」「${time_slot ?? ""}」を中心に配置。
背景はお店の雰囲気に合う、温かみのある色合い。

${styleHint}

日本語テキストは読みやすい太めのフォントで。
テキストは中央〜やや上寄りにレイアウトし、下部には空きスペースを残して余白感を出してください。
${noteForPrompt}
`.trim();

  const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1536",
      n: 1,
    }),
  });

  if (!imgRes.ok) {
    console.error("OpenAI image error:", imgRes.status, await imgRes.text());
    throw new Error("failed to generate image");
  }

  const imgJson = await imgRes.json();
  const b64 = imgJson.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image b64_json returned");

  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fileName = `availability/${storeId}/${Date.now()}_story.png`;

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(STORY_BUCKET)
    .upload(fileName, binary, { contentType: "image/png", upsert: false });

  if (uploadErr) {
    console.error("upload to storage error:", uploadErr);
    throw new Error("failed to upload story image");
  }

  const { data: publicData } = supabase.storage.from(STORY_BUCKET).getPublicUrl(uploadData.path);
  return { imageUrl: publicData.publicUrl, path: uploadData.path };
}
