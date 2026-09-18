// supabase/functions/sns-feedback/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";
import { adminClient } from "./_shared/keys.ts";

// ====== CORS ヘッダ ======
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

// ====== 環境変数 ======
const supabaseAdmin = adminClient("sns-feedback");

// 今回許可する action と source
const ALLOWED_ACTIONS = ["approve", "regen_caption", "regen_video", "skip"] as const;
const ALLOWED_SOURCES = ["dashboard", "email", "api"] as const;

type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
type AllowedSource = (typeof ALLOWED_SOURCES)[number];

serve(async (req) => {
  const origin = req.headers.get("origin");

  // 0) preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  }

  // 1) body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400, origin);
  }

  const { plan_id, store_id: store_id_from_body, action, source, comment, payload } = body ?? {};
  if (!plan_id || !action) {
    return json({ error: "MISSING_FIELDS", message: "plan_id, action are required" }, 400, origin);
  }

  const normalizedAction = String(action).toLowerCase() as AllowedAction;
  const normalizedSource = (source ? String(source).toLowerCase() : "dashboard") as AllowedSource;

  if (!ALLOWED_ACTIONS.includes(normalizedAction)) {
    return json({ error: "INVALID_ACTION", got: action }, 400, origin);
  }
  if (!ALLOWED_SOURCES.includes(normalizedSource)) {
    return json({ error: "INVALID_SOURCE", got: source }, 400, origin);
  }

  // 2) plan_id から store_id を確定（bodyの store_id は信用しない）
  const { data: plan, error: planErr } = await supabaseAdmin
    .from("sns_post_plans")
    .select("plan_id, store_id")
    .eq("plan_id", plan_id)
    .maybeSingle();

  if (planErr) {
    console.error("sns_post_plans fetch error:", planErr);
    return json({ error: "PLAN_FETCH_FAILED" }, 500, origin);
  }
  if (!plan?.store_id) {
    return json({ error: "PLAN_NOT_FOUND" }, 404, origin);
  }

  // bodyに store_id が来ている場合だけ整合性チェック（任意）
  if (store_id_from_body && String(store_id_from_body) !== String(plan.store_id)) {
    return json(
      { error: "STORE_ID_MISMATCH", message: "store_id does not match plan_id." },
      400,
      origin,
    );
  }

  // 3) guard（このEFは書き込み＝viewer禁止）
  const g = await requireAuthPasswordOkAndStoreRole(req, {
    storeId: plan.store_id,
    allowRoles: ["admin", "editor"],
    extraHeaders: corsHeaders(origin),
  }).catch((res) => res as Response);

  if (g instanceof Response) return g;

  // 4) sns_feedback_logs INSERT
  const { data: logData, error: logError } = await supabaseAdmin
    .from("sns_feedback_logs")
    .insert({
      plan_id,
      store_id: plan.store_id, // ✅ 確定値
      action: normalizedAction,
      source: normalizedSource,
      comment: comment ?? null,
      payload: payload ?? null,
    })
    .select("feedback_id")
    .single();

  if (logError) {
    console.error("sns_feedback_logs insert error:", logError);
    return json({ error: "LOG_INSERT_FAILED" }, 500, origin);
  }

  // 5) sns_post_plans UPDATE（action→review_status）
  let nextReviewStatus: "pending" | "approved" | "changes_requested" | null = null;

  if (normalizedAction === "approve") nextReviewStatus = "approved";
  else if (normalizedAction === "regen_caption" || normalizedAction === "regen_video" || normalizedAction === "skip") {
    nextReviewStatus = "changes_requested";
  }

  if (nextReviewStatus) {
    const { error: updateError } = await supabaseAdmin
      .from("sns_post_plans")
      .update({
        review_status: nextReviewStatus,
        review_comment: comment ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("plan_id", plan_id);

    if (updateError) {
      console.error("sns_post_plans update error:", updateError);
      return json({ error: "PLAN_UPDATE_FAILED", feedback_id: logData?.feedback_id ?? null }, 500, origin);
    }
  }

  return json({ ok: true, feedback_id: logData?.feedback_id ?? null }, 200, origin);
});
