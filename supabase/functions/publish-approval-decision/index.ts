import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type FormQuestionInsert = {
  store_id: string;
  sort_order: number;
  question_key: string;
  label: string;
  question_type: string;
  options: unknown;
  logic_show_if: unknown;
  required: boolean;
};

function sanitizeFormQuestion(storeId: string, raw: Record<string, unknown>, i: number): FormQuestionInsert | null {
  const key = String(raw.question_key ?? "").trim();
  const label = String(raw.label ?? "").trim();
  if (!key || !label) return null;
  const sort = raw.sort_order == null || raw.sort_order === "" ? i : Number(raw.sort_order);
  return {
    store_id: storeId,
    sort_order: Number.isNaN(sort) ? i : sort,
    question_key: key,
    label,
    question_type: String(raw.question_type ?? "text"),
    options: raw.options ?? null,
    logic_show_if: raw.logic_show_if ?? null,
    required: raw.required === true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ error: "missing_env" }, 500);
  if (!["GET", "POST"].includes(req.method)) return jsonResponse({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  let roundId = (url.searchParams.get("round_id") || "").trim();
  let token = (url.searchParams.get("token") || "").trim();
  let decision = (url.searchParams.get("decision") || "").trim().toLowerCase();
  let mode = (url.searchParams.get("mode") || "").trim().toLowerCase();
  let editedMenuJson = "";
  let editedFormJson = "";
  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      roundId = String(body.round_id ?? "").trim();
      token = String(body.token ?? "").trim();
      decision = String(body.decision ?? "").trim().toLowerCase();
      mode = decision;
      editedMenuJson = String(body.edited_menu_json ?? "").trim();
      editedFormJson = String(body.edited_form_json ?? "").trim();
    } else {
      const form = await req.formData();
      roundId = String(form.get("round_id") || "").trim();
      token = String(form.get("token") || "").trim();
      decision = String(form.get("decision") || "").trim().toLowerCase();
      mode = decision;
      editedMenuJson = String(form.get("edited_menu_json") || "").trim();
      editedFormJson = String(form.get("edited_form_json") || "").trim();
    }
  }
  if (!roundId || !token) return jsonResponse({ error: "invalid_params" }, 400);
  if (!mode) mode = "approve";
  if (!["approve", "reject"].includes(mode)) mode = "approve";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: round, error: roundErr } = await supabase
    .from("form_menu_publish_rounds")
    .select("id, store_id, status, approve_token_hash, approve_token_expires_at, form_questions_snapshot, menu_items_snapshot, edit_count, max_edits")
    .eq("id", roundId)
    .maybeSingle();
  if (roundErr) return jsonResponse({ error: "round_query_failed", detail: roundErr.message }, 500);
  if (!round) return jsonResponse({ error: "round_not_found" }, 404);
  const currentStatus = String(round.status ?? "");
  if (currentStatus !== "awaiting_approval") {
    // メールクライアントの事前アクセス/再クリック時に分かりやすく返す（冪等）
    return jsonResponse({
      ok: true,
      already_processed: true,
      status: currentStatus,
      round_id: roundId,
      message: currentStatus === "pending"
        ? "Reject は既に処理済みです。現在は pending です。"
        : currentStatus === "applied"
          ? "Approve は既に処理済みです。現在は applied です。"
          : `この依頼は既に処理済みです（status: ${currentStatus}）。`,
    }, 200);
  }

  const expectedHash = String((round as Record<string, unknown>).approve_token_hash ?? "");
  if (!expectedHash) return jsonResponse({ error: "token_not_configured" }, 400);
  const actualHash = await sha256Hex(token);
  if (actualHash !== expectedHash) return jsonResponse({ error: "invalid_token" }, 401);
  const expRaw = (round as Record<string, unknown>).approve_token_expires_at;
  const expiresAt = expRaw ? new Date(String(expRaw)) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return jsonResponse({ error: "token_expired" }, 410);
  }

  // HTML編集UIは使わず、decision付きのAPI呼び出しのみ受け付ける。
  if (req.method === "GET" && !["approve", "reject"].includes(decision)) {
    return jsonResponse({ error: "decision_required", detail: "use decision=approve or decision=reject" }, 400);
  }

  if (!["approve", "reject"].includes(decision)) return jsonResponse({ error: "invalid_decision" }, 400);

  const editCount = Number((round as Record<string, unknown>).edit_count ?? 0);
  const maxEdits = Math.max(0, Number((round as Record<string, unknown>).max_edits ?? 1));
  let parsedForm = (round as Record<string, unknown>).form_questions_snapshot;
  let parsedMenu = (round as Record<string, unknown>).menu_items_snapshot;
  let edited = false;
  if (editedFormJson || editedMenuJson) {
    try {
      if (editedFormJson) parsedForm = JSON.parse(editedFormJson);
      if (editedMenuJson) parsedMenu = JSON.parse(editedMenuJson);
      edited = true;
    } catch {
      return html("修正内容のJSONが不正です。", 400);
    }
  }
  if (edited && editCount >= maxEdits) {
    return jsonResponse({ error: "edit_limit_reached" }, 409);
  }

  if (edited) {
    const { error: snapErr } = await supabase
      .from("form_menu_publish_rounds")
      .update({
        form_questions_snapshot: parsedForm,
        menu_items_snapshot: parsedMenu,
        edit_count: editCount + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roundId)
      .eq("status", "awaiting_approval");
    if (snapErr) return jsonResponse({ error: "snapshot_update_failed", detail: snapErr.message }, 500);
  }

  if (decision === "reject") {
    const { error } = await supabase
      .from("form_menu_publish_rounds")
      .update({
        status: "pending",
        approved_at: new Date().toISOString(),
        approved_by_email: "email-link",
        apply_decision: "reject",
        approve_token_hash: null,
        approve_token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roundId)
      .eq("status", "awaiting_approval");
    if (error) return jsonResponse({ error: "reject_update_failed", detail: error.message }, 500);
    return jsonResponse({ ok: true, decision: "reject", status: "pending", round_id: roundId });
  }

  // approve: スナップショットを本番へ反映
  const storeId = String(round.store_id);
  const formSnap = Array.isArray(parsedForm)
    ? parsedForm as Array<Record<string, unknown>>
    : [];
  const menuSnap = parsedMenu;

  // form_questions: 一旦置換
  const { error: delErr } = await supabase
    .from("form_questions")
    .delete()
    .eq("store_id", storeId);
  if (delErr) return jsonResponse({ error: "form_questions_delete_failed", detail: delErr.message }, 500);

  const rows = formSnap
    .map((x, i) => sanitizeFormQuestion(storeId, x, i))
    .filter((x): x is FormQuestionInsert => x !== null);
  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from("form_questions")
      .insert(rows);
    if (insErr) return jsonResponse({ error: "form_questions_insert_failed", detail: insErr.message }, 500);
  }

  // store_menu_items: 1店舗1行（items jsonb）に upsert
  const menuPayload = Array.isArray(menuSnap) ? menuSnap : [];
  const { error: menuErr } = await supabase
    .from("store_menu_items")
    .upsert({
      store_id: storeId,
      items: menuPayload,
      updated_at: new Date().toISOString(),
    }, { onConflict: "store_id" });
  if (menuErr) return jsonResponse({ error: "store_menu_items_upsert_failed", detail: menuErr.message }, 500);

  const { error: updErr } = await supabase
    .from("form_menu_publish_rounds")
    .update({
      status: "applied",
      approved_at: new Date().toISOString(),
      approved_by_email: "email-link",
      apply_decision: "approve",
      applied_at: new Date().toISOString(),
      approve_token_hash: null,
      approve_token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", roundId)
    .eq("status", "awaiting_approval");
  if (updErr) return jsonResponse({ error: "round_update_failed", detail: updErr.message }, 500);

  return jsonResponse({ ok: true, decision: "approve", status: "applied", round_id: roundId });
});

