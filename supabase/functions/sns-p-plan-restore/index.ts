// supabase/functions/sns-p-plan-restore/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAuthedUser } from "./_shared/guard.ts";

/* -------------------------------------------------- */
/* CORS / Response helpers */
/* -------------------------------------------------- */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: any, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function fail(message: string, status = 400, extra: any = {}) {
  return new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function env(name: string, fallback?: string) {
  const v = Deno.env.get(name);
  if (v == null || v === "") return fallback;
  return v;
}

function nowIso() {
  return new Date().toISOString();
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function safeJsonClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** story_meta.version 抽出（無ければ 1 扱い） */
function getStoryVersion(story_meta: any): number {
  if (!story_meta || typeof story_meta !== "object") return 1;
  const v = Number((story_meta as any).version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** 復元対象キー（sns_post_plans DDL準拠で “戻してよいもの” だけ） */
const RESTORE_ALLOWED_KEYS = [
  "media_id",
  "caption",
  "hashtags",
  "story_meta",
  "media_kind",
  "status",
  "review_status",
  "review_comment",
  "approve_status",
  "approved_at",
  "approved_by",
  "media_prompt",
  "gen_preset_id",
  "media_source",
  "media_gen_status",
  "external_job_id",
  "external_job_status",
  "generated_media_url",
  "external_job_payload",
  "external_job_response",
  "external_error_message",
] as const;

function pickAllowed(snapshot: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!snapshot || typeof snapshot !== "object") return out;
  for (const k of RESTORE_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(snapshot, k)) out[k] = (snapshot as any)[k];
  }
  return out;
}

/**
 * history の before/after の読み取り
 * - before_json/after_json を優先
 * - 無ければ before_media_id/after_media_id のみ復元
 */
function resolveRestoreSnapshot(historyRow: any, restore_to: "before" | "after") {
  const snap = restore_to === "before" ? historyRow?.before_json : historyRow?.after_json;
  const mediaId = restore_to === "before" ? historyRow?.before_media_id : historyRow?.after_media_id;

  if (snap && typeof snap === "object") {
    const s = safeJsonClone(snap);
    if ((s as any).media_id == null && mediaId != null) (s as any).media_id = mediaId;
    return s;
  }
  if (mediaId != null) return { media_id: mediaId };
  return null;
}

/* -------------------------------------------------- */
/* Main */
/* -------------------------------------------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  // 0) Auth
  const authed = await requireAuthedUser(req).catch((res) => res as Response);
  if (authed instanceof Response) return authed;
  const actorUserId = authed.userId;

  // 1) Env + client
  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return fail("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 2) Input
  const body = await req.json().catch(() => null);
  if (!body) return fail("Invalid JSON body", 400);

  const history_id = String(body?.history_id ?? "").trim();
  const restore_to = (String(body?.restore_to ?? "before").trim() as "before" | "after");
  const if_version = body?.if_version == null ? null : Number(body.if_version);
  const comment = body?.comment != null ? String(body.comment) : null;
  const source = body?.source != null ? String(body.source) : "dashboard";

  if (!history_id) return fail("history_id is required", 400);
  if (!isUuidLike(history_id)) return fail("history_id must be UUID", 400, { history_id });
  if (restore_to !== "before" && restore_to !== "after") {
    return fail("restore_to must be 'before' or 'after'", 400, { restore_to });
  }

  // 3) history 取得（必要最小列）
  const { data: hist, error: histErr } = await supabase
    .from("sns_post_media_history")
    .select("history_id, plan_id, store_id, platform, action, before_media_id, after_media_id, before_json, after_json, created_at")
    .eq("history_id", history_id)
    .maybeSingle();

  if (histErr || !hist) {
    return fail("Failed to fetch history", 500, { detail: histErr?.message ?? null, history_id });
  }

  const planId = String((hist as any).plan_id ?? "");
  const storeId = String((hist as any).store_id ?? "");
  const platformFromHist = (hist as any).platform != null ? String((hist as any).platform) : null;

  if (!planId || !isUuidLike(planId)) return fail("History row has invalid plan_id", 500, { plan_id: planId });
  if (!storeId) return fail("History row has invalid store_id", 500, { store_id: storeId });

  // 4) store role check（最小）
  const { data: member, error: memErr } = await supabase
    .from("store_members")
    .select("role")
    .eq("store_id", storeId)
    .eq("user_id", actorUserId)
    .maybeSingle();

  if (memErr) return fail("Failed to check store role", 500, { detail: memErr.message });
  const role = String((member as any)?.role ?? "");
  if (!member || !["admin", "editor"].includes(role)) {
    return fail("Forbidden: requires admin/editor", 403, { store_id: storeId, role: role || null });
  }

  // 5) plan 現在値取得（before_json用 + versionチェック用）
  const { data: plan, error: planErr } = await supabase
    .from("sns_post_plans")
    .select("plan_id, store_id, platform, media_id, caption, hashtags, story_meta")
    .eq("plan_id", planId)
    .maybeSingle();

  if (planErr || !plan) return fail("Failed to fetch plan", 500, { detail: planErr?.message ?? null, plan_id: planId });
  if (String((plan as any).store_id ?? "") !== storeId) {
    return fail("Store mismatch between plan and history", 409, {
      plan_store_id: String((plan as any).store_id ?? ""),
      history_store_id: storeId,
    });
  }

  const currentVersion = getStoryVersion((plan as any).story_meta);
  if (if_version != null && Number.isFinite(if_version) && if_version !== currentVersion) {
    return fail("Version conflict", 409, {
      plan_id: planId,
      current_version: currentVersion,
      if_version,
    });
  }

  // 6) restore snapshot
  const restoreSnapshot = resolveRestoreSnapshot(hist, restore_to);
  if (!restoreSnapshot) {
    return fail("No restorable data in history row (before/after)", 400, { history_id, restore_to });
  }

  // 7) update payload
  const planUpdate = pickAllowed(restoreSnapshot);

  // story_meta.version は強制 +1（復元操作は必ず履歴が進む）
  const baseMeta = (planUpdate as any).story_meta ?? (plan as any).story_meta ?? {};
  const metaObj = typeof baseMeta === "object" && baseMeta ? safeJsonClone(baseMeta) : {};
  (metaObj as any).version = currentVersion + 1;
  (planUpdate as any).story_meta = metaObj;

  // updated_at はトリガーがあるが、明示しても害はない
  (planUpdate as any).updated_at = nowIso();

  const beforeJson = {
    media_id: (plan as any).media_id ?? null,
    caption: (plan as any).caption ?? null,
    hashtags: (plan as any).hashtags ?? null,
    story_meta: (plan as any).story_meta ?? null,
  };

  // 8) ✅ update + select を1回で（DB往復削減）
  const { data: updatedRows, error: updErr } = await supabase
    .from("sns_post_plans")
    .update(planUpdate)
    .eq("plan_id", planId)
    .select("plan_id, store_id, platform, media_id, caption, hashtags, story_meta")
    .limit(1);

  if (updErr) return fail("Failed to update plan (restore)", 500, { detail: updErr.message, plan_id: planId });

  const planAfter = updatedRows?.[0];
  if (!planAfter) {
    return fail("Restored, but failed to read updated plan", 500, { plan_id: planId });
  }

  const afterJson = {
    media_id: (planAfter as any).media_id ?? null,
    caption: (planAfter as any).caption ?? null,
    hashtags: (planAfter as any).hashtags ?? null,
    story_meta: (planAfter as any).story_meta ?? null,
  };

  // 9) 履歴 insert（ここが主役）
  const restoreAction = "restore_to_history";
  const restorePayload = {
    history_id,
    restore_to,
    source,
    comment,
    from_action: String((hist as any).action ?? ""),
    from_created_at: String((hist as any).created_at ?? ""),
  };

  const { error: histInsErr } = await supabase.from("sns_post_media_history").insert({
    plan_id: planId,
    store_id: storeId,
    platform: platformFromHist ?? String((planAfter as any).platform ?? null),
    action: restoreAction,
    actor_user_id: actorUserId,
    before_media_id: (beforeJson as any).media_id ?? null,
    after_media_id: (afterJson as any).media_id ?? null,
    before_json: beforeJson,
    after_json: afterJson,
    payload: restorePayload,
    created_at: nowIso(),
  });

  if (histInsErr) {
    // 復元自体は成功 → 部分失敗として返す
    return fail("Restored, but failed to insert sns_post_media_history", 500, {
      plan_id: planId,
      detail: histInsErr.message,
    });
  }

  // 10) feedback logs（監査/分析）— 失敗しても成功扱い
  let warn: any = null;
  try {
    const { error: fbErr } = await supabase.from("sns_feedback_logs").insert({
      plan_id: planId,
      store_id: storeId,
      action: restoreAction,
      source,
      comment,
      payload: restorePayload,
      actor_user_id: actorUserId,
      created_at: nowIso(),
    });
    if (fbErr) warn = { warning: "sns_feedback_logs insert failed", detail: fbErr.message };
  } catch (e: any) {
    warn = { warning: "sns_feedback_logs insert threw", detail: e?.message ?? String(e) };
  }

  return ok({
    plan_id: planId,
    store_id: storeId,
    platform: platformFromHist ?? String((planAfter as any).platform ?? ""),
    restored_from_history_id: history_id,
    restore_to,
    previous_version: currentVersion,
    new_version: getStoryVersion((planAfter as any).story_meta),
    plan_before: beforeJson,
    plan_after: afterJson,
    ...(warn ? { warn } : {}),
  });
});
