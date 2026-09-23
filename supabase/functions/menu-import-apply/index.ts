import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, serviceKey, supabaseUrl } from "../_shared/keys.ts";

const SUPABASE_URL = supabaseUrl() ?? "";
const SERVICE_KEY = serviceKey() ?? "";
// この関数は「呼び出し側が service 鍵そのものを Authorization ヘッダに載せてくる」設計。
// 移行期間中は新方式(sb_secret_)・レガシー(service_role)のどちらの鍵で来ても通す。
// 片方だけにすると呼び出し側と同時に切り替える必要が生じて事故るため、両方と比較する。
const LEGACY_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

type StagingRow = {
  store_id?: string | null;
  store_name_ja?: string | null;
  main_menu_id?: string | null;
  main_menu_name?: string | null;
  question_key?: string | null;
  menu_key?: string | null;
  name_ja: string;
  name_spoken_ja?: string | null;
  is_active?: boolean | null;
  sort_order?: number | null;
  answer_values_json?: string | null;
  category_path?: string | null;
  category_levels_json?: string | null;
  parent_menu_key?: string | null;
  display_group?: string | null;
  tags_json?: string | null;
  attributes_json?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  notes?: string | null;
};

type FormQuestion = {
  id: number;
  store_id: string;
  question_key: string;
  sort_order: number;
  label?: string;
  question_type?: string;
  options: unknown;
  logic_show_if: unknown;
  required?: boolean;
};

function safeJsonArrayText(raw: string | null | undefined, fallback: unknown[]): unknown[] {
  if (!raw || !raw.trim()) return fallback;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : fallback;
  } catch {
    return fallback;
  }
}

function safeJsonObjectText(raw: string | null | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!raw || !raw.trim()) return fallback;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? p as Record<string, unknown> : fallback;
  } catch {
    return fallback;
  }
}

function slugifyMenuKey(nameJa: string, storeId: string): string {
  let s = nameJa.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) {
    // fallback
    const base = `${nameJa}_${storeId}_${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
    s = `menu_${hash.toString(16)}`;
  }
  return s;
}

function deriveSpokenJa(nameJa: string): string {
  const s = nameJa.trim();
  if (!s) return s;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: "missing_env" }, 500);

  const auth = req.headers.get("Authorization") || "";
  // 新旧どちらの鍵で来ても通す（冒頭のコメント参照）
  const authOk = (SERVICE_KEY !== "" && auth === `Bearer ${SERVICE_KEY}`) ||
    (LEGACY_SERVICE_KEY !== "" && auth === `Bearer ${LEGACY_SERVICE_KEY}`);
  if (!authOk) return jsonResponse({ error: "unauthorized" }, 401);

  let body: { store_id?: string; clear_staging?: boolean; create_round?: boolean; proposal_only?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const targetStoreId = String(body.store_id ?? "").trim() || null;
  const clearStaging = body.clear_staging === true;
  const createRound = body.create_round === true;
  const proposalOnly = body.proposal_only === true;
  if (proposalOnly && !createRound) {
    return jsonResponse({ error: "proposal_only_requires_create_round" }, 400);
  }

  const supabase = adminClient("menu-import-apply");

  const { data: storeProfilesRaw, error: storeProfilesErr } = await supabase
    .from("store_profiles")
    .select("store_id, store_name_ja, store_name_jp");
  if (storeProfilesErr) return jsonResponse({ error: "store_profiles_query_failed", detail: storeProfilesErr.message }, 500);
  const profiles = (storeProfilesRaw ?? []) as Array<{ store_id?: string; store_name_ja?: string | null; store_name_jp?: string | null }>;
  const storeNameToId = new Map<string, string>();
  for (const p of profiles) {
    const sid = String(p.store_id ?? "").trim();
    if (!sid) continue;
    const n1 = String(p.store_name_ja ?? "").trim();
    const n2 = String(p.store_name_jp ?? "").trim();
    if (n1) storeNameToId.set(n1.toLowerCase(), sid);
    if (n2) storeNameToId.set(n2.toLowerCase(), sid);
  }

  let stagingQuery = supabase
    .from("menu_import_staging")
    .select("*")
    .order("store_id", { ascending: true })
    .order("sort_order", { ascending: true });
  if (targetStoreId) stagingQuery = stagingQuery.eq("store_id", targetStoreId);

  const { data: rowsRaw, error: rowsErr } = await stagingQuery;
  if (rowsErr) return jsonResponse({ error: "staging_query_failed", detail: rowsErr.message }, 500);
  const rows = (rowsRaw ?? []) as StagingRow[];
  if (rows.length === 0) return jsonResponse({ ok: true, message: "no_staging_rows" });

  const grouped = new Map<string, StagingRow[]>();
  for (const r of rows) {
    const sidRaw = String(r.store_id ?? "").trim();
    const storeNameJa = String(r.store_name_ja ?? "").trim();
    const sid = sidRaw || (storeNameJa ? (storeNameToId.get(storeNameJa.toLowerCase()) ?? "") : "");
    const nameJa = String(r.name_ja ?? "").trim();
    if (!sid || !nameJa) continue;
    if (!grouped.has(sid)) grouped.set(sid, []);
    grouped.get(sid)!.push({ ...r, store_id: sid });
  }
  if (grouped.size === 0) return jsonResponse({ ok: true, message: "no_valid_rows" });

  const result: Array<Record<string, unknown>> = [];

  for (const [storeId, storeRows] of grouped.entries()) {
    const { data: fqRaw, error: fqErr } = await supabase
      .from("form_questions")
      .select("id, store_id, question_key, sort_order, options, logic_show_if")
      .eq("store_id", storeId)
      .or("question_key.eq.main_menu,question_key.like.sub_menu_%");
    if (fqErr) return jsonResponse({ error: "form_questions_query_failed", store_id: storeId, detail: fqErr.message }, 500);
    const fq = (fqRaw ?? []) as FormQuestion[];

    let mainQ = fq.find((q) => q.question_key === "main_menu") ?? null;
    const subQs = fq.filter((q) => q.question_key.startsWith("sub_menu_"));

    const mainMapById = new Map<string, string>();
    const mainOptions = Array.isArray(mainQ?.options) ? (mainQ!.options as Array<Record<string, unknown>>) : [];
    for (const opt of mainOptions) {
      const id = String(opt.id ?? "").trim();
      const text = String(opt.text ?? "").trim();
      if (id) mainMapById.set(id, text || id);
    }

    const byNameToExisting = new Map<string, { question_key: string; main_menu_id: string; menu_key: string }>();
    for (const sq of subQs) {
      const logic = sq.logic_show_if && typeof sq.logic_show_if === "object" ? sq.logic_show_if as Record<string, unknown> : {};
      const mainId = String(logic.value ?? sq.question_key.replace(/^sub_menu_/, "")).trim();
      const opts = Array.isArray(sq.options) ? (sq.options as Array<Record<string, unknown>>) : [];
      for (const o of opts) {
        const n = String(o.text ?? "").trim().toLowerCase();
        const mk = String(o.id ?? "").trim();
        if (n && mk) byNameToExisting.set(n, { question_key: sq.question_key, main_menu_id: mainId, menu_key: mk });
      }
    }

    const normalized = storeRows.map((r, idx) => {
      const nameJa = String(r.name_ja ?? "").trim();
      const spoken = String(r.name_spoken_ja ?? "").trim() || deriveSpokenJa(nameJa);
      const hit = byNameToExisting.get(nameJa.toLowerCase());

      const mainMenuId = String(r.main_menu_id ?? "").trim() || hit?.main_menu_id || "";
      const mainMenuName = String(r.main_menu_name ?? "").trim() || (mainMenuId ? (mainMapById.get(mainMenuId) || mainMenuId) : "");
      const questionKey = String(r.question_key ?? "").trim() || hit?.question_key || (mainMenuId ? `sub_menu_${mainMenuId}` : "sub_menu_imported");
      const menuKey = String(r.menu_key ?? "").trim() || hit?.menu_key || slugifyMenuKey(nameJa, storeId);
      const sortOrder = Number(r.sort_order ?? ((idx + 1) * 10));
      const answerValues = safeJsonArrayText(r.answer_values_json, [menuKey, nameJa]);

      return {
        store_id: storeId,
        main_menu_id: mainMenuId || null,
        main_menu_name: mainMenuName || null,
        question_key: questionKey,
        menu_key: menuKey,
        name_ja: nameJa,
        name_spoken_ja: spoken,
        is_active: r.is_active !== false,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : (idx + 1) * 10,
        answer_values: answerValues,
        category_path: r.category_path ?? null,
        category_levels: safeJsonArrayText(r.category_levels_json, []),
        parent_menu_key: r.parent_menu_key ?? null,
        display_group: r.display_group ?? null,
        tags: safeJsonArrayText(r.tags_json, []),
        attributes: safeJsonObjectText(r.attributes_json, {}),
        valid_from: r.valid_from ?? null,
        valid_to: r.valid_to ?? null,
        notes: r.notes ?? null,
      };
    });

    normalized.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

    // form_questions: main_menu options（候補生成）
    const mainOptionMap = new Map<string, string>();
    for (const row of normalized) {
      const mid = String(row.main_menu_id ?? "").trim();
      if (!mid) continue;
      const mname = String(row.main_menu_name ?? "").trim() || mid;
      if (!mainOptionMap.has(mid)) mainOptionMap.set(mid, mname);
    }
    const mainOpts = mainOptionMap.size > 0 ? Array.from(mainOptionMap.entries()).map(([id, text]) => ({ id, text })) : null;

    // form_questions: sub_menu_* options
    const byQuestion = new Map<string, Array<{ id: string; text: string; sort_order: number }>>();
    for (const row of normalized) {
      const qk = String(row.question_key ?? "").trim();
      if (!qk) continue;
      if (!byQuestion.has(qk)) byQuestion.set(qk, []);
      byQuestion.get(qk)!.push({
        id: String(row.menu_key),
        text: String(row.name_ja),
        sort_order: Number(row.sort_order ?? 0),
      });
    }
    const subOptionsByQuestion = new Map<string, Array<{ id: string; text: string }>>();
    for (const [qk, opts] of byQuestion.entries()) {
      opts.sort((a, b) => a.sort_order - b.sort_order);
      subOptionsByQuestion.set(qk, opts.map((o) => ({ id: o.id, text: o.text })));
    }

    // form_questions 未作成でも動くよう、必要な設問を自動生成/更新する
    const formMap = new Map<string, FormQuestion>();
    for (const q of fq) formMap.set(q.question_key, q);
    const nowIso = new Date().toISOString();

    const ensureQuestion = async (
      questionKey: string,
      sortOrder: number,
      label: string,
      questionType: string,
      options: unknown,
      logicShowIf: unknown,
      required: boolean,
    ): Promise<FormQuestion | null> => {
      const existing = formMap.get(questionKey);
      if (existing) {
        const { data: updated, error: updErr } = await supabase
          .from("form_questions")
          .update({
            sort_order: sortOrder,
            label,
            question_type: questionType,
            options,
            logic_show_if: logicShowIf,
            required,
            updated_at: nowIso,
          })
          .eq("id", existing.id)
          .select("id, store_id, sort_order, question_key, label, question_type, options, logic_show_if, required")
          .maybeSingle();
        if (updErr) return null;
        const q = updated as unknown as FormQuestion;
        if (q) formMap.set(questionKey, q);
        return q ?? null;
      }
      const { data: inserted, error: insErr } = await supabase
        .from("form_questions")
        .insert({
          store_id: storeId,
          sort_order: sortOrder,
          question_key: questionKey,
          label,
          question_type: questionType,
          options,
          logic_show_if: logicShowIf,
          required,
        })
        .select("id, store_id, sort_order, question_key, label, question_type, options, logic_show_if, required")
        .maybeSingle();
      if (insErr) return null;
      const q = inserted as unknown as FormQuestion;
      if (q) formMap.set(questionKey, q);
      return q ?? null;
    };

    const ensureErr = (msg: string) => jsonResponse({ error: msg, store_id: storeId }, 500);

    // main_menuを生成/更新
    if (mainOpts && mainOpts.length > 0) {
      const maybeMain = await ensureQuestion(
        "main_menu",
        5,
        "注文したメニューを選んでください",
        "radio",
        mainOpts,
        null,
        true,
      );
      if (!maybeMain) return ensureErr("main_menu_ensure_failed");
      mainQ = maybeMain;
    }

    // sub_menu_* を生成/更新
    const mainIds = Array.from(mainOptionMap.keys());
    let subSort = 6;
    for (const mainId of mainIds) {
      const qk = `sub_menu_${mainId}`;
      const subOpts = subOptionsByQuestion.get(qk) ?? [];
      if (subOpts.length === 0) continue;
      const mainName = mainOptionMap.get(mainId) || mainId;
      const label = `${mainName}の種類を選んでください`;
      const logic = { depends_on: "main_menu", value: mainId };
      const maybeSub = await ensureQuestion(
        qk,
        subSort,
        label,
        "radio",
        subOpts,
        logic,
        true,
      );
      if (!maybeSub) return ensureErr(`sub_menu_ensure_failed:${qk}`);
      subSort += 1;
    }

    // 最新form_questionsを再取得してsnapshotへ使う
    const { data: fqAfterRaw, error: fqAfterErr } = await supabase
      .from("form_questions")
      .select("sort_order, question_key, label, question_type, options, logic_show_if, required")
      .eq("store_id", storeId)
      .or("question_key.eq.main_menu,question_key.like.sub_menu_%")
      .order("sort_order", { ascending: true });
    if (fqAfterErr) return jsonResponse({ error: "form_questions_reload_failed", store_id: storeId, detail: fqAfterErr.message }, 500);
    const formRowsSnapshot = (fqAfterRaw ?? []).map((r) => ({
      sort_order: (r as Record<string, unknown>).sort_order ?? 0,
      question_key: (r as Record<string, unknown>).question_key ?? "",
      label: (r as Record<string, unknown>).label ?? "",
      question_type: (r as Record<string, unknown>).question_type ?? "text",
      options: (r as Record<string, unknown>).options ?? null,
      logic_show_if: (r as Record<string, unknown>).logic_show_if ?? null,
      required: (r as Record<string, unknown>).required === true,
    }));

    // snapshotへoptions反映
    for (const row of formRowsSnapshot) {
      if (row.question_key === "main_menu" && mainOpts) row.options = mainOpts;
      const subOpts = subOptionsByQuestion.get(row.question_key);
      if (subOpts) row.options = subOpts;
    }

    if (!proposalOnly) {
      const { error: upsertMenuErr } = await supabase
        .from("store_menu_items")
        .upsert({
          store_id: storeId,
          items: normalized,
          updated_at: new Date().toISOString(),
        }, { onConflict: "store_id" });
      if (upsertMenuErr) return jsonResponse({ error: "store_menu_items_upsert_failed", store_id: storeId, detail: upsertMenuErr.message }, 500);

      if (mainQ && mainOpts) {
        const { error: updateMainErr } = await supabase
          .from("form_questions")
          .update({ options: mainOpts, updated_at: new Date().toISOString() })
          .eq("id", mainQ.id);
        if (updateMainErr) return jsonResponse({ error: "main_menu_update_failed", store_id: storeId, detail: updateMainErr.message }, 500);
      }

      for (const sq of subQs) {
        const pureOpts = subOptionsByQuestion.get(sq.question_key);
        if (!pureOpts || pureOpts.length === 0) continue;
        const { error: updateSubErr } = await supabase
          .from("form_questions")
          .update({ options: pureOpts, updated_at: new Date().toISOString() })
          .eq("id", sq.id);
        if (updateSubErr) return jsonResponse({ error: "sub_menu_update_failed", store_id: storeId, question_key: sq.question_key, detail: updateSubErr.message }, 500);
      }
    }

    let roundId: string | null = null;
    let roundInsertError: string | null = null;
    if (createRound) {
      const formSnapshot = formRowsSnapshot;
      const menuSnapshot = normalized;
      const { data: insertedRound, error: insertRoundErr } = await supabase
        .from("form_menu_publish_rounds")
        .insert({
          store_id: storeId,
          status: proposalOnly ? "draft" : "applied",
          form_questions_snapshot: formSnapshot,
          menu_items_snapshot: menuSnapshot,
          apply_decision: proposalOnly ? null : "approve",
          approved_by_email: proposalOnly ? null : "csv-import",
          approved_at: proposalOnly ? null : new Date().toISOString(),
          applied_at: proposalOnly ? null : new Date().toISOString(),
          sent_at: null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      if (insertRoundErr) {
        roundInsertError = insertRoundErr.message;
      } else {
        roundId = String((insertedRound as { id?: string } | null)?.id ?? "") || null;
      }
    }

    if (clearStaging) {
      await supabase.from("menu_import_staging").delete().eq("store_id", storeId);
    }

    result.push({
      store_id: storeId,
      imported_rows: storeRows.length,
      applied_to_production: !proposalOnly,
      applied_menu_items: normalized.length,
      updated_sub_menu_questions: proposalOnly ? 0 : subQs.length,
      created_round: roundId,
      round_insert_error: roundInsertError,
    });
  }

  return jsonResponse({ ok: true, stores: result });
});
