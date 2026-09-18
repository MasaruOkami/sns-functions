// supabase/functions/generate-story-preview/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";
import { adminClient } from "./_shared/keys.ts";

const ENABLE_OPENAI = (Deno.env.get("ENABLE_OPENAI") ?? "false") === "true";

const DUMMY_IMAGE_URL =
  Deno.env.get("DUMMY_PREVIEW_IMAGE_URL") ??
  "https://placehold.co/600x800?text=Preview+Dummy";

const DUMMY_CAPTION =
  Deno.env.get("DUMMY_PREVIEW_CAPTION") ??
  "【テストモード】ここにキャプションが入ります。";

const DEFAULT_PLATFORM = Deno.env.get("DEFAULT_STORY_PLATFORM") ?? "instagram";

// status の許可値（DB制約に合わせる）
type AllowedStatus = "available" | "few" | "full" | "closed";

// DBはservice roleでOK（RLSバイパス）
// ※ただし store_id は guard で確定した値だけを使う
const supabaseAdmin = adminClient("generate-story-preview");

/* =========================
 * CORS
 * ========================= */
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

// guard が返す Response にも CORS を付ける（ブラウザ対策）
function withCors(res: Response, origin: string | null) {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

type GeneratePayload = {
  store_id?: unknown;
  storeId?: unknown;
  platform?: unknown;

  vacancy?: unknown;
  story_vacancy?: unknown;
  storyVacancy?: unknown;

  time_slot?: unknown;
  timeSlot?: unknown;

  time_text?: unknown;
  comment?: unknown;
  cta?: unknown;
  dry_run?: unknown;
  source?: unknown;
};

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

/**
 * UIの文言 -> DB許可 status(4値) へ正規化
 */
function normalizeVacancyToStatus(vacancyText: string | null): AllowedStatus {
  if (!vacancyText) return "available";
  const t = vacancyText.trim().toLowerCase();

  // 英語入力も許容
  if (t === "available" || t.includes("available")) return "available";
  if (t === "few" || t.includes("few")) return "few";
  if (t === "full" || t.includes("full")) return "full";
  if (t === "closed" || t.includes("closed")) return "closed";

  // 日本語・よくある表現
  if (t.includes("空席") && (t.includes("あり") || t.includes("有") || t.includes("◎") || t.includes("○")))
    return "available";
  if (t.includes("余裕") || t.includes("空いて")) return "available";

  if (t.includes("わずか") || t.includes("残り") || t.includes("△") || t.includes("少"))
    return "few";

  if (t.includes("満席") || t.includes("×") || t.includes("満"))
    return "full";

  if (t.includes("休業") || t.includes("定休") || t.includes("本日休") || t.includes("休み") || t.includes("閉店") || t.includes("クローズ"))
    return "closed";

  return "available";
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  // ✅ preflight は必ず 200
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405, origin);
    }

    // ✅ 先に guard（viewer は拒否）
    const g = await requireAuthPasswordOkAndStoreRole(req, {
      allowRoles: ["admin", "editor"],
      // store_id は body/query どちらでもOK（guardが拾う）
    }).catch((res) => res as Response);

    if (g instanceof Response) return withCors(g, origin);

    // body は vacancy などを読むために使う（store_id は信用しない）
    const body = (await req.json().catch(() => null)) as GeneratePayload | null;
    console.log("[generate-story-preview] body=", body);

    // ✅ store_id は guard で確定したものだけ採用
    const store_id = g.storeId;

    const platform = asString(body?.platform) ?? DEFAULT_PLATFORM;

    const vacancyText =
      asString(body?.vacancy) ??
      asString(body?.story_vacancy) ??
      asString(body?.storyVacancy) ??
      null;

    const status: AllowedStatus = normalizeVacancyToStatus(vacancyText);

    const time_slot = asString(body?.time_slot) ?? asString(body?.timeSlot) ?? null;

    // ──────────────────────────────
    // insert payload 共通部
    // ──────────────────────────────
    const insertRow: Record<string, unknown> = {
      store_id,
      platform,
      status,
      image_url: null,
      caption: null,
      openai_image_model: null,
      openai_caption_model: null,
    };
    if (time_slot) insertRow.time_slot = time_slot;

    // ──────────────────────────────
    // 1) SAFE MODE
    // ──────────────────────────────
    if (!ENABLE_OPENAI) {
      insertRow.image_url = DUMMY_IMAGE_URL;
      insertRow.caption = DUMMY_CAPTION;

      const { data, error } = await supabaseAdmin
        .from("store_story_previews")
        .insert(insertRow)
        .select()
        .single();

      if (error) {
        console.error("[SAFE MODE] insert error", error);
        return json({ error: "DB insert error", detail: error.message, code: error.code }, 500, origin);
      }

      return json(data, 200, origin);
    }

    // ──────────────────────────────
    // 2) OPENAI MODE（仮）
    // ──────────────────────────────
    const imageModel = "gpt-image-1";
    const captionModel = "gpt-4.1-mini";
    const imageUrl = "https://placehold.co/600x800?text=Real+Preview";
    const caption = "実際の OpenAI 生成結果がここに入ります。";

    insertRow.image_url = imageUrl;
    insertRow.caption = caption;
    insertRow.openai_image_model = imageModel;
    insertRow.openai_caption_model = captionModel;

    const { data, error } = await supabaseAdmin
      .from("store_story_previews")
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      console.error("[OPENAI MODE] insert error", error);
      return json({ error: "DB insert error", detail: error.message, code: error.code }, 500, origin);
    }

    return json(data, 200, origin);
  } catch (e) {
    console.error("generate-story-preview error", e);
    return json({ error: "Internal Server Error", detail: String(e) }, 500, origin);
  }
});
