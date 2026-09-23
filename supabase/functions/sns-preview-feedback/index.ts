// supabase/functions/sns-preview-feedback/index.ts
import { requireAuthAndStoreRoleStrict } from "../_shared/guard.ts";
import { adminClient, serviceKey, supabaseUrl } from "../_shared/keys.ts";

/* ------------------------------------------------------------------ */
/* Utils */
/* ------------------------------------------------------------------ */
type Json = Record<string, any>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000", // 開発中だけ。運用は環境変数で許可Origin制御推奨
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-store-id",
};

function env(name: string, fallback?: string) {
  const v = Deno.env.get(name);
  if (v == null || v === "") return fallback;
  return v;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function nowIso() {
  return new Date().toISOString();
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(message: string, status = 400, extra: any = {}) {
  return jsonResponse({ ok: false, error: message, ...extra }, status);
}

function textResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

/* ------------------------------------------------------------------ */
/* Actions */
/* ------------------------------------------------------------------ */
const TEXT_ACTIONS = new Set([
  "shorter_text",
  "longer_text",
  "less_emoji",
  "more_emoji",
  "softer_tone",
  "more_formal",
  "more_friendly",
  "adjust_hashtags",
]);

const IMAGE_ACTIONS = new Set([
  "img_subject_food",
  "img_subject_drink",
  "img_subject_interior",
  "img_subject_staff",
  "img_shot_closeup",
  "img_shot_wide",
  "img_mood_bright",
  "img_mood_calm",
  "img_mood_luxury",
  "img_mood_trendy",
  "img_text_on",
  "img_text_off",
  "img_regen_variation",
]);

const SPECIAL_ACTIONS = new Set(["approve", "change_datetime"]);

/* ------------------------------------------------------------------ */
/* story_meta helpers */
/* ------------------------------------------------------------------ */
function defaultStoryMeta(): Json {
  return {
    version: 1,
    text_style: {
      caption_length_level: 3, // 1..5
      emoji_level: 2, // 0..3
      tone_level: 3, // 1..5
    },
    media_style: {
      subject_type: "food", // food/drink/interior/staff
      shot: "default", // default/closeup/wide
      mood: "default", // default/bright/calm/luxury/trendy
      text_overlay: false, // boolean
      variation_seed: 0, // integer
    },
  };
}

function mergeStoryMeta(existing: any): Json {
  const base = defaultStoryMeta();
  if (!existing || typeof existing !== "object") return base;

  const m = deepClone(base);

  if (typeof existing.version === "number") m.version = existing.version;

  if (existing.text_style && typeof existing.text_style === "object") {
    m.text_style.caption_length_level = clamp(
      Number(existing.text_style.caption_length_level ?? m.text_style.caption_length_level),
      1,
      5,
    );
    m.text_style.emoji_level = clamp(
      Number(existing.text_style.emoji_level ?? m.text_style.emoji_level),
      0,
      3,
    );
    m.text_style.tone_level = clamp(
      Number(existing.text_style.tone_level ?? m.text_style.tone_level),
      1,
      5,
    );
  }

  if (existing.media_style && typeof existing.media_style === "object") {
    const e = existing.media_style;
    if (typeof e.subject_type === "string") m.media_style.subject_type = e.subject_type;
    if (typeof e.shot === "string") m.media_style.shot = e.shot;
    if (typeof e.mood === "string") m.media_style.mood = e.mood;
    if (typeof e.text_overlay === "boolean") m.media_style.text_overlay = e.text_overlay;
    if (typeof e.variation_seed === "number") m.media_style.variation_seed = e.variation_seed;
  }

  return m;
}

function applyTextAction(meta: Json, action: string): Json {
  const next = deepClone(meta);
  const t = next.text_style;

  if (action === "shorter_text") t.caption_length_level = clamp(t.caption_length_level - 1, 1, 5);
  if (action === "longer_text") t.caption_length_level = clamp(t.caption_length_level + 1, 1, 5);
  if (action === "less_emoji") t.emoji_level = clamp(t.emoji_level - 1, 0, 3);
  if (action === "more_emoji") t.emoji_level = clamp(t.emoji_level + 1, 0, 3);

  // tone: 1 softer ... 5 formal
  if (action === "softer_tone") t.tone_level = clamp(t.tone_level - 1, 1, 5);
  if (action === "more_formal") t.tone_level = clamp(t.tone_level + 1, 1, 5);

  if (action === "more_friendly") {
    t.tone_level = clamp(t.tone_level - 1, 1, 5);
    t.emoji_level = clamp(t.emoji_level + 1, 0, 3);
  }

  return next;
}

function applyImageAction(meta: Json, action: string): Json {
  const next = deepClone(meta);
  const m = next.media_style;

  if (action === "img_subject_food") m.subject_type = "food";
  if (action === "img_subject_drink") m.subject_type = "drink";
  if (action === "img_subject_interior") m.subject_type = "interior";
  if (action === "img_subject_staff") m.subject_type = "staff";

  if (action === "img_shot_closeup") m.shot = "closeup";
  if (action === "img_shot_wide") m.shot = "wide";

  if (action === "img_mood_bright") m.mood = "bright";
  if (action === "img_mood_calm") m.mood = "calm";
  if (action === "img_mood_luxury") m.mood = "luxury";
  if (action === "img_mood_trendy") m.mood = "trendy";

  if (action === "img_text_on") m.text_overlay = true;
  if (action === "img_text_off") m.text_overlay = false;

  if (action === "img_regen_variation") m.variation_seed = (m.variation_seed ?? 0) + 1;

  return next;
}

/* ------------------------------------------------------------------ */
/* Snapshot for history */
/* ------------------------------------------------------------------ */
function planSnapshot(plan: any): Json {
  return {
    plan_id: plan?.plan_id ?? null,
    store_id: plan?.store_id ?? null,
    platform: plan?.platform ?? null,
    scheduled_at: plan?.scheduled_at ?? null,

    media_id: plan?.media_id ?? null,
    caption: plan?.caption ?? null,
    hashtags: plan?.hashtags ?? null,
    story_meta: plan?.story_meta ?? null,
    media_kind: plan?.media_kind ?? null,
    status: plan?.status ?? null,
    review_status: plan?.review_status ?? null,
    approve_status: plan?.approve_status ?? null,
    approved_at: plan?.approved_at ?? null,
    approved_by: plan?.approved_by ?? null,
    reviewed_at: plan?.reviewed_at ?? null,
    review_comment: plan?.review_comment ?? null,

    retry_count: plan?.retry_count ?? null,
    retry_max: plan?.retry_max ?? null,
    next_retry_at: plan?.next_retry_at ?? null,
    last_http_status: plan?.last_http_status ?? null,
    last_error_code: plan?.last_error_code ?? null,
    last_error_message: plan?.last_error_message ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Main */
/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  // ✅ preflight は最優先・即 return（204が無難）
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const guard = await requireAuthAndStoreRoleStrict(req, { allowRoles: ["admin", "editor"] })
    .catch((res) => res as Response);

  if (guard instanceof Response) {
    return new Response(await guard.text().catch(() => ""), {
      status: guard.status,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const userId = guard.userId;

  const SUPABASE_URL = supabaseUrl();
  const SUPABASE_SERVICE_ROLE_KEY = serviceKey();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", 500);
  }

  const supabase = adminClient("sns-preview-feedback");

  const body = await req.json().catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const plan_id = String(body?.plan_id ?? "").trim();
  const action = String(body?.action ?? "").trim();
  const comment = body?.comment != null ? String(body.comment) : null;
  const payload = body?.payload ?? null;
  const source = body?.source != null ? String(body.source) : "dashboard";
  const if_version = body?.if_version == null ? null : Number(body?.if_version);

  if (!plan_id) return errorResponse("plan_id is required", 400);
  if (!isUuidLike(plan_id)) return errorResponse("plan_id must be UUID", 400, { plan_id });
  if (!action) return errorResponse("action is required", 400);

  const isText = TEXT_ACTIONS.has(action);
  const isImage = IMAGE_ACTIONS.has(action);
  const isSpecial = SPECIAL_ACTIONS.has(action);

  if (!isText && !isImage && !isSpecial) {
    return errorResponse("Unsupported action", 400, { action });
  }

  // 1) Fetch plan
  const { data: plan, error: planErr } = await supabase
    .from("sns_post_plans")
    .select(
      [
        "plan_id",
        "store_id",
        "platform",
        "media_kind",
        "scheduled_at",
        "media_id",
        "caption",
        "hashtags",
        "story_meta",
        "status",
        "review_status",
        "approve_status",
        "approved_at",
        "approved_by",
        "reviewed_at",
        "review_comment",
        "retry_count",
        "retry_max",
        "next_retry_at",
        "last_http_status",
        "last_error_code",
        "last_error_message",
      ].join(","),
    )
    .eq("plan_id", plan_id)
    .maybeSingle();

  if (planErr) return errorResponse("Failed to fetch plan", 500, { detail: planErr.message });
  if (!plan) return errorResponse("Plan not found", 404, { plan_id });

  const storeId = String((plan as any).store_id ?? "");
  const platform = String((plan as any).platform ?? "");

  // ✅ 二重防御：guard で解決した storeId と一致しない場合は拒否
  if (guard.storeId !== storeId) {
    return errorResponse("Forbidden (store mismatch)", 403, {
      plan_id,
      store_id: storeId,
      guard_store_id: guard.storeId,
    });
  }

  const currentMeta = mergeStoryMeta((plan as any).story_meta);
  const currentVersion = Number(currentMeta.version ?? 1) || 1;

  // 2) optimistic lock
  if (if_version == null || !Number.isFinite(if_version)) {
    return errorResponse("if_version is required", 400, { plan_id });
  }
  if (if_version !== currentVersion) {
    return errorResponse("Version conflict", 409, {
      plan_id,
      current_version: currentVersion,
      if_version,
    });
  }

  const beforeSnap = planSnapshot(plan);

  /* =========================================================
   * A) approve
   * ========================================================= */
  if (action === "approve") {
    // story 48h constraint
    if ((plan as any).media_kind === "story" && (plan as any).scheduled_at) {
      const scheduledAt = new Date((plan as any).scheduled_at);
      const limit = new Date(Date.now() + 48 * 60 * 60 * 1000);
      if (scheduledAt.getTime() > limit.getTime()) {
        return errorResponse(
          "Story cannot be scheduled more than 48 hours ahead. Please adjust scheduled_at.",
          409,
          { plan_id, scheduled_at: (plan as any).scheduled_at },
        );
      }
    }

    const patch: Record<string, any> = {
      approve_status: "approved",
      approved_at: nowIso(),
      approved_by: String(userId),

      review_status: "approved",
      reviewed_at: nowIso(),

      status: "scheduled",
      next_retry_at: null,
      retry_count: 0,

      last_http_status: null,
      last_error_code: null,
      last_error_message: null,

      updated_at: nowIso(),
    };

    const { error: updErr } = await supabase.from("sns_post_plans").update(patch).eq("plan_id", plan_id);
    if (updErr) return errorResponse("Failed to approve plan", 500, { detail: updErr.message });

    const afterSnap = deepClone(beforeSnap);
    afterSnap.approve_status = patch.approve_status;
    afterSnap.approved_at = patch.approved_at;
    afterSnap.approved_by = patch.approved_by;
    afterSnap.review_status = patch.review_status;
    afterSnap.reviewed_at = patch.reviewed_at;
    afterSnap.status = patch.status;
    (afterSnap as any).next_retry_at = null;
    (afterSnap as any).retry_count = 0;
    (afterSnap as any).last_http_status = null;
    (afterSnap as any).last_error_code = null;
    (afterSnap as any).last_error_message = null;

    const warnings: any[] = [];

    const { error: hErr } = await supabase.from("sns_post_media_history").insert({
      plan_id,
      store_id: storeId,
      platform,
      action: "approve",
      actor_user_id: userId,
      before_media_id: beforeSnap.media_id ?? null,
      after_media_id: afterSnap.media_id ?? null,
      before_json: beforeSnap,
      after_json: afterSnap,
      payload: { source, comment, payload, if_version, previous_version: currentVersion, new_version: currentVersion },
      created_at: nowIso(),
    });
    if (hErr) warnings.push({ where: "sns_post_media_history", detail: hErr.message });

    const { error: fErr } = await supabase.from("sns_feedback_logs").insert({
      plan_id,
      store_id: storeId,
      action: "approve",
      source,
      comment,
      payload,
      actor_user_id: userId,
      created_at: nowIso(),
    });
    if (fErr) warnings.push({ where: "sns_feedback_logs", detail: fErr.message });

    return jsonResponse({
      ok: true,
      plan_id,
      store_id: storeId,
      platform,
      action: "approve",
      status: "scheduled",
      approve_status: "approved",
      retry_count: 0,
      next_retry_at: null,
      previous_version: currentVersion,
      new_version: currentVersion,
      ...(warnings.length ? { warnings } : {}),
    });
  }

  /* =========================================================
   * A-2) change_datetime
   * ========================================================= */
  if (action === "change_datetime") {
    const nextScheduledAt = String(payload?.scheduled_at ?? "").trim();
    if (!nextScheduledAt) {
      return errorResponse("payload.scheduled_at is required", 400, { plan_id });
    }

    const dt = new Date(nextScheduledAt);
    if (!Number.isFinite(dt.getTime())) {
      return errorResponse("payload.scheduled_at must be ISO datetime", 400, {
        plan_id,
        scheduled_at: nextScheduledAt,
      });
    }

    // story: 48h constraint
    if ((plan as any).media_kind === "story") {
      const limit = new Date(Date.now() + 48 * 60 * 60 * 1000);
      if (dt.getTime() > limit.getTime()) {
        return errorResponse(
          "Story cannot be scheduled more than 48 hours ahead. Please adjust scheduled_at.",
          409,
          { plan_id, scheduled_at: nextScheduledAt },
        );
      }
    }

    const nextMeta = deepClone(currentMeta);
    nextMeta.version = currentVersion + 1;

    const patch: Record<string, any> = {
      scheduled_at: dt.toISOString(),
      story_meta: nextMeta,
      updated_at: nowIso(),
    };

    const { error: updErr } = await supabase.from("sns_post_plans").update(patch).eq("plan_id", plan_id);
    if (updErr) return errorResponse("Failed to change scheduled_at", 500, { detail: updErr.message });

    const afterSnap = deepClone(beforeSnap);
    (afterSnap as any).scheduled_at = patch.scheduled_at;
    afterSnap.story_meta = nextMeta;

    const warnings: any[] = [];

    const { error: hErr } = await supabase.from("sns_post_media_history").insert({
      plan_id,
      store_id: storeId,
      platform,
      action: "change_datetime",
      actor_user_id: userId,
      before_media_id: beforeSnap.media_id ?? null,
      after_media_id: beforeSnap.media_id ?? null,
      before_json: beforeSnap,
      after_json: afterSnap,
      payload: {
        source,
        comment,
        payload,
        if_version,
        previous_version: currentVersion,
        new_version: nextMeta.version,
      },
      created_at: nowIso(),
    });
    if (hErr) warnings.push({ where: "sns_post_media_history", detail: hErr.message });

    const { error: fErr } = await supabase.from("sns_feedback_logs").insert({
      plan_id,
      store_id: storeId,
      action: "change_datetime",
      source,
      comment,
      payload,
      actor_user_id: userId,
      created_at: nowIso(),
    });
    if (fErr) warnings.push({ where: "sns_feedback_logs", detail: fErr.message });

    return jsonResponse({
      ok: true,
      plan_id,
      store_id: storeId,
      platform,
      action: "change_datetime",
      scheduled_at: patch.scheduled_at,
      previous_version: currentVersion,
      new_version: nextMeta.version,
      story_meta: nextMeta,
      ...(warnings.length ? { warnings } : {}),
    });
  }

  /* =========================================================
   * B) text/image actions
   * ========================================================= */
  let nextMeta = deepClone(currentMeta);
  nextMeta.version = currentVersion + 1;

  if (isText) nextMeta = applyTextAction(nextMeta, action);
  if (isImage) nextMeta = applyImageAction(nextMeta, action);

  const { error: updErr } = await supabase
    .from("sns_post_plans")
    .update({
      story_meta: nextMeta,
      updated_at: nowIso(),
    })
    .eq("plan_id", plan_id);

  if (updErr) return errorResponse("Failed to update plan", 500, { detail: updErr.message });

  const afterSnap = deepClone(beforeSnap);
  afterSnap.story_meta = nextMeta;

  const warnings: any[] = [];

  const { error: hErr } = await supabase.from("sns_post_media_history").insert({
    plan_id,
    store_id: storeId,
    platform,
    action,
    actor_user_id: userId,
    before_media_id: beforeSnap.media_id ?? null,
    after_media_id: beforeSnap.media_id ?? null,
    before_json: beforeSnap,
    after_json: afterSnap,
    payload: { source, comment, payload, if_version, previous_version: currentVersion, new_version: nextMeta.version },
    created_at: nowIso(),
  });
  if (hErr) warnings.push({ where: "sns_post_media_history", detail: hErr.message });

  const { error: fErr } = await supabase.from("sns_feedback_logs").insert({
    plan_id,
    store_id: storeId,
    action,
    source,
    comment,
    payload,
    actor_user_id: userId,
    created_at: nowIso(),
  });
  if (fErr) warnings.push({ where: "sns_feedback_logs", detail: fErr.message });

  return jsonResponse({
    ok: true,
    plan_id,
    store_id: storeId,
    platform,
    action,
    previous_version: currentVersion,
    new_version: nextMeta.version,
    story_meta: nextMeta,
    ...(warnings.length ? { warnings } : {}),
  });
});
