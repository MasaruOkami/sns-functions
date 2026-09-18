import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APPROVAL_BASE_URL = (Deno.env.get("PUBLISH_APPROVAL_BASE_URL") ?? "").trim();
const SENDGRID_API_KEY = (Deno.env.get("SENDGRID_API_KEY") ?? "").trim();
const RESEND_FROM = (Deno.env.get("APPROVAL_EMAIL_FROM") ?? "").trim();

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseJsonArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
    } catch {
      // ignore
    }
  }
  return [];
}

function deriveSpoken(nameJa: string): string {
  const s = nameJa.trim();
  const m = s.match(/^([^（(]+)[（(]([^）)]+)[）)]$/u);
  if (!m) return s;
  const base = m[1].trim();
  const flavor = m[2].trim().replace(/^しょうゆ$/i, "醤油");
  if (!base || !flavor) return s;
  if (/ラーメン|らーめん$/.test(base)) {
    if (/^(味噌|みそ)$/i.test(flavor)) return `味噌${base}`;
    if (/^(醤油)$/i.test(flavor)) return `醤油${base}`;
    if (/^塩$/i.test(flavor)) return `塩${base}`;
  }
  return `${flavor.endsWith("味") ? flavor : `${flavor}味`}の${base}`;
}

type MenuCandidate = {
  menu_key: string;
  name_ja: string;
  name_spoken_ja: string;
  category: string | null;
  question_key: string;
  answer_values: string[];
  is_active: boolean;
  sort_order: number;
};

function buildMenuSnapshotFromForm(
  formSnapshotRaw: unknown,
  existingMenuSnapshotRaw: unknown,
): MenuCandidate[] {
  const form = parseJsonArray(formSnapshotRaw);
  const existing = parseJsonArray(existingMenuSnapshotRaw);

  const spokenByKey = new Map<string, string>();
  for (const e of existing) {
    const k = String(e.menu_key ?? e.id ?? "").trim();
    const spoken = String(e.name_spoken_ja ?? "").trim();
    if (k && spoken) spokenByKey.set(k, spoken);
  }

  const mainCategoryById = new Map<string, string>();
  for (const q of form) {
    const qk = String(q.question_key ?? "").trim();
    if (qk !== "main_menu") continue;
    const opts = parseJsonArray(q.options);
    for (const o of opts) {
      const id = String(o.id ?? o.value ?? "").trim();
      const text = String(o.text ?? o.label ?? id).trim();
      if (id && text) mainCategoryById.set(id, text);
    }
  }

  const out: MenuCandidate[] = [];
  let seq = 0;
  for (const q of form) {
    const qk = String(q.question_key ?? "").trim();
    const qt = String(q.question_type ?? "").trim().toLowerCase();
    if (!qk || !["radio", "select"].includes(qt)) continue;
    // メニュー系だけ抽出
    if (!(qk === "main_menu" || qk.includes("menu"))) continue;

    const opts = parseJsonArray(q.options);
    if (opts.length === 0) continue;

    // sub_menu の category 推定（logic_show_if.depends_on=main_menu,value=xxx）
    let category: string | null = null;
    const showIf = (q.logic_show_if && typeof q.logic_show_if === "object")
      ? q.logic_show_if as Record<string, unknown>
      : null;
    if (showIf) {
      const dep = String(showIf.depends_on ?? "").trim();
      const val = String(showIf.value ?? "").trim();
      if (dep === "main_menu" && val) category = mainCategoryById.get(val) || null;
    }

    for (const o of opts) {
      const id = String(o.id ?? o.value ?? "").trim();
      const text = String(o.text ?? o.label ?? id).trim();
      if (!id || !text) continue;
      const spoken = spokenByKey.get(id) || deriveSpoken(text);
      out.push({
        menu_key: id,
        name_ja: text,
        name_spoken_ja: spoken,
        category,
        question_key: qk,
        answer_values: [id, text],
        is_active: true,
        sort_order: (Number(q.sort_order) || 0) * 100 + seq,
      });
      seq += 1;
    }
  }
  return out;
}

function summarizeForMail(round: Record<string, unknown>): {
  formCount: number;
  menuCount: number;
  questionPreviewHtml: string;
  menuPreviewHtml: string;
} {
  const form = Array.isArray(round.form_questions_snapshot)
    ? (round.form_questions_snapshot as Array<Record<string, unknown>>)
    : [];
  const menu = Array.isArray(round.menu_items_snapshot)
    ? (round.menu_items_snapshot as Array<Record<string, unknown>>)
    : [];

  const qLines = form
    .map((q, idx) => {
      const key = String(q.question_key ?? "").trim();
      const label = String(q.label ?? "").trim();
      if (!key && !label) return "";
      return `${idx + 1}. ${label || key}${label && key ? `（${key}）` : ""}`;
    })
    .filter((x) => x.length > 0);

  const menuRows = menu
    .map((m, idx) => {
      const spoken = String(m.name_spoken_ja ?? "").trim();
      const name = String(m.name_ja ?? "").trim();
      if (!name && !spoken) return null;
      return {
        no: idx + 1,
        surveyName: name || "-",
        generatedName: spoken || name || "-",
      };
    })
    .filter((x): x is { no: number; surveyName: string; generatedName: string } => x !== null);

  const questionPreviewHtml = qLines.length > 0
    ? `<pre style="background:#f8fafc;border:1px solid #e5e7eb;padding:10px;border-radius:8px;white-space:pre-wrap;">${escapeHtml(qLines.join("\n"))}</pre>`
    : "<p style=\"color:#6b7280;\">（質問プレビューなし）</p>";
  const menuPreviewHtml = menuRows.length > 0
    ? [
      "<div style=\"overflow:auto;\">",
      "<table style=\"border-collapse:collapse;width:100%;font-size:13px;\">",
      "<thead>",
      "<tr>",
      "<th style=\"text-align:left;border:1px solid #e5e7eb;padding:6px;background:#f8fafc;\">No</th>",
      "<th style=\"text-align:left;border:1px solid #e5e7eb;padding:6px;background:#f8fafc;\">アンケート画面での名前</th>",
      "<th style=\"text-align:left;border:1px solid #e5e7eb;padding:6px;background:#f8fafc;\">生成文での表記</th>",
      "</tr>",
      "</thead>",
      "<tbody>",
      ...menuRows.map((r) => [
        "<tr>",
        `<td style="border:1px solid #e5e7eb;padding:6px;">${r.no}</td>`,
        `<td style="border:1px solid #e5e7eb;padding:6px;">${escapeHtml(r.surveyName)}</td>`,
        `<td style="border:1px solid #e5e7eb;padding:6px;">${escapeHtml(r.generatedName)}</td>`,
        "</tr>",
      ].join("")),
      "</tbody>",
      "</table>",
      "</div>",
    ].join("\n")
    : "<p style=\"color:#6b7280;\">（メニュープレビューなし）</p>";

  return {
    formCount: form.length,
    menuCount: menu.length,
    questionPreviewHtml,
    menuPreviewHtml,
  };
}

async function sendViaSendGrid(to: string[], subject: string, html: string): Promise<{ ok: boolean; detail?: unknown }> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: to.map((email) => ({ email })) }],
      from: { email: RESEND_FROM },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, detail: { status: res.status, body: text } };
  }
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: true, detail: parsed };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "missing_supabase_env" }, 500);
  }

  // GitHub Actions から service_role key で直叩きする運用を想定。
  const auth = req.headers.get("Authorization") || "";
  const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (auth !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: { action?: string; round_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const action = (body.action || "").trim();
  const roundId = (body.round_id || "").trim();
  if (action !== "send" || !roundId) {
    return jsonResponse({ error: "action=send and round_id are required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: roundRaw, error: roundErr } = await supabase
    .from("form_menu_publish_rounds")
    .select("id, store_id, status, form_questions_snapshot, menu_items_snapshot")
    .eq("id", roundId)
    .maybeSingle();

  if (roundErr) return jsonResponse({ error: "round_query_failed", detail: roundErr.message }, 500);
  if (!roundRaw) return jsonResponse({ error: "round_not_found" }, 404);
  const round = roundRaw as Record<string, unknown>;

  const status = String(round.status || "");
  if (!["draft", "needs_revision", "pending", "awaiting_approval"].includes(status)) {
    return jsonResponse({ error: "invalid_round_status", status }, 400);
  }
  if (!round.form_questions_snapshot) {
    return jsonResponse({ error: "missing_round_snapshot", detail: "form_questions_snapshot is required" }, 400);
  }

  // 送信時にフォーム定義から menu_items_snapshot を自動再生成（sub_menu まで展開）
  const generatedMenu = buildMenuSnapshotFromForm(round.form_questions_snapshot, round.menu_items_snapshot);
  if (generatedMenu.length === 0) {
    return jsonResponse({ error: "generated_menu_empty", detail: "form_questions_snapshot からメニュー候補を生成できませんでした（question_key/optionsを確認）" }, 400);
  }
  round.menu_items_snapshot = generatedMenu;

  const { data: approvers, error: approverErr } = await supabase
    .from("store_approver_emails")
    .select("email")
    .eq("store_id", String(round.store_id))
    .eq("is_active", true);
  if (approverErr) return jsonResponse({ error: "approver_query_failed", detail: approverErr.message }, 500);
  const to = (approvers || [])
    .map((r) => String((r as { email?: string }).email || "").trim())
    .filter((v) => v.length > 0);
  if (to.length === 0) return jsonResponse({ error: "no_active_approver_emails" }, 400);

  if (!APPROVAL_BASE_URL) {
    return jsonResponse({ error: "missing_env", detail: "PUBLISH_APPROVAL_BASE_URL is required" }, 500);
  }
  if (!SENDGRID_API_KEY || !RESEND_FROM) {
    return jsonResponse({ error: "missing_env", detail: "SENDGRID_API_KEY and APPROVAL_EMAIL_FROM are required" }, 500);
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const base = APPROVAL_BASE_URL.replace(/\/$/, "");
  const approveUrl = `${base}?round_id=${encodeURIComponent(roundId)}&token=${encodeURIComponent(token)}&decision=approve`;
  const rejectUrl = `${base}?round_id=${encodeURIComponent(roundId)}&token=${encodeURIComponent(token)}&decision=reject`;
  const summary = summarizeForMail(round);

  const { error: updErr } = await supabase
    .from("form_menu_publish_rounds")
    .update({
      status: "awaiting_approval",
      menu_items_snapshot: round.menu_items_snapshot,
      approve_token_hash: tokenHash,
      approve_token_expires_at: expiresAt,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", roundId);
  if (updErr) return jsonResponse({ error: "round_update_failed", detail: updErr.message }, 500);

  const subject = "承認依頼: アンケート/メニュー更新（Approve / Reject）";
  const html = [
    "<p>アンケート/メニュー更新の承認依頼です。</p>",
    `<p>store_id: <strong>${String(round.store_id)}</strong></p>`,
    `<p>round_id: <code>${roundId}</code></p>`,
    `<p>質問数: <strong>${summary.formCount}</strong> / メニュー候補数: <strong>${summary.menuCount}</strong></p>`,
    "<h4 style=\"margin:16px 0 8px;\">質問プレビュー（全件）</h4>",
    summary.questionPreviewHtml,
    "<h4 style=\"margin:16px 0 8px;\">メニュープレビュー（全件）</h4>",
    summary.menuPreviewHtml,
    "<p>内容を確認し、以下のワンクリックリンクを選択してください。</p>",
    `<p><a href="${approveUrl}" style="display:inline-block;padding:10px 14px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;">Approve（ワンクリック反映）</a></p>`,
    `<p><a href="${rejectUrl}" style="display:inline-block;padding:10px 14px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;">Reject（ワンクリック保留）</a></p>`,
    "<p style=\"margin-top:8px;\">※ 編集機能はメールリンクでは提供していません。修正が必要な場合は再送フローで新ラウンドを作成してください。</p>",
    "<p>※ 本リンクの有効期限は7日です。</p>",
  ].join("\n");

  const mail = await sendViaSendGrid(to, subject, html);
  if (!mail.ok) {
    // メール送信失敗時は pending 状態を戻す（ベストエフォート）
    await supabase
      .from("form_menu_publish_rounds")
      .update({
        status,
        approve_token_hash: null,
        approve_token_expires_at: null,
        sent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roundId);
    return jsonResponse({ error: "mail_send_failed", detail: mail.detail }, 502);
  }

  return jsonResponse({
    ok: true,
    round_id: roundId,
    store_id: round.store_id,
    recipients: to,
    expires_at: expiresAt,
    sendgrid: mail.detail,
  });
});

