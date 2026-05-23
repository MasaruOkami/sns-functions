// supabase/functions/line-webhook-coupon/index.ts
// LINE Webhook（友だち追加・クーポン送信）
// 1つのLINEアカウントで複数店舗: https://xxx.supabase.co/functions/v1/line-webhook-coupon
// 店舗ごとに別LINEアカウント: https://xxx.supabase.co/functions/v1/line-webhook-coupon?store_id=XXX

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
/** AI食生活判定クイズ用（Webhook が line-webhook-coupon に向いている場合の postback 対応） */
const AI_LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const AI_LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const INTERNAL_JWT_SECRET = Deno.env.get("INTERNAL_JWT_SECRET") ?? "";
const SNS_WORKER_SECRET = Deno.env.get("SNS_WORKER_SECRET") ?? "";
// supabase.co の生URLだとSafariがHTMLをtext/plainで表示するため、カスタムドメインを使用
const FORM_ENGINE_BASE_URL = (Deno.env.get("FORM_ENGINE_BASE_URL") ?? "").replace(/\/$/, "");

const te = new TextEncoder();
const FUNCTIONS_BASE = SUPABASE_URL ? SUPABASE_URL.replace(/\/$/, "") + "/functions/v1" : "";
// 結果ページURLはカスタムドメイン優先
const RESULT_BASE = FORM_ENGINE_BASE_URL || FUNCTIONS_BASE;

async function verifyLineSignature(body: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

/** カレンダー画像用 JWT を生成（5分有効） */
async function createCalendarToken(lineUserId: string): Promise<string> {
  if (!INTERNAL_JWT_SECRET) return "";
  const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64u(te.encode(JSON.stringify({ sub: lineUserId, iat: now, exp: now + 300 })));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("raw", te.encode(INTERNAL_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(data));
  return `${data}.${b64u(new Uint8Array(sig))}`;
}

/** LINE プロフィールを取得して customer_identity に保存（非同期・失敗しても握りつぶす） */
async function saveLineProfile(supabase: ReturnType<typeof createClient>, userId: string, accessToken: string): Promise<void> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const profile = await res.json() as { displayName?: string; pictureUrl?: string }
    const displayName = profile.displayName ?? null
    const pictureUrl  = profile.pictureUrl  ?? null
    if (!displayName) return
    // 既存レコードがあれば更新、なければ挿入
    const { data: existing } = await supabase
      .from('customer_identity')
      .select('id')
      .eq('line_user_id', userId)
      .maybeSingle()
    if (existing?.id) {
      await supabase
        .from('customer_identity')
        .update({ display_name: displayName, picture_url: pictureUrl, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('customer_identity')
        .insert({ line_user_id: userId, display_name: displayName, picture_url: pictureUrl, first_store_id: null })
    }
    console.log('[saveLineProfile] saved', userId.slice(0, 8), displayName)
  } catch (e) {
    console.error('[saveLineProfile] error (non-fatal):', e)
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let storeId = url.searchParams.get("store_id")?.trim() ?? null;

  if (req.method === "GET") {
    // ★ security fix: 内部モード情報を返さない
    return new Response("ok", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    console.log("[line-webhook-coupon] POST received");
    const signature =
    req.headers.get("x-line-signature") ??
    req.headers.get("X-Line-Signature") ??
    req.headers.get("line-signature") ??
    "";
  const bodyRaw = await req.text();


  // LINE の疎通確認: イベントが含まれない POST（events: []）の場合は 200 を返す
  let parsedBody: { events?: unknown[] };
  try {
    parsedBody = JSON.parse(bodyRaw);
  } catch {
    parsedBody = {};
  }
  if (Array.isArray(parsedBody.events) && parsedBody.events.length === 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ★ security fix: x-line-signature がない場合は即 401
  if (!signature) {
    console.warn("[line-webhook-coupon] x-line-signature header missing — rejected");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  console.log("[line-webhook-coupon] POST", { bodyLen: bodyRaw.length });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let secret: string | null = null;
  let accessToken: string | null = null;
  let resolvedStoreId: string | null = storeId;
  /** 1つのLINEアカウントで複数店舗運用時: 同一チャネル(同一secret)の store_id 一覧。follow 時にこのいずれかの店舗の pending を検索する */
  let sharedChannelStoreIds: string[] | null = null;

  if (storeId) {
    const { data: profile } = await supabase
      .from("store_profiles")
      .select("line_channel_secret, line_channel_access_token")
      .eq("store_id", storeId)
      .maybeSingle();
    if (profile?.line_channel_secret) secret = String(profile.line_channel_secret).trim();
    if (profile?.line_channel_access_token) accessToken = String(profile.line_channel_access_token).trim();
    if (!secret || !accessToken) {
      const { data: creds } = await supabase
        .from("store_line_credentials")
        .select("line_channel_secret, line_channel_access_token")
        .eq("store_id", storeId)
        .maybeSingle();
      if (creds?.line_channel_secret && !secret) secret = String(creds.line_channel_secret).trim();
      if (creds?.line_channel_access_token && !accessToken) accessToken = String(creds.line_channel_access_token).trim();
    }
  } else {
    // store_id 未指定: 登録済み全チャネルの秘密鍵で署名を試し、一致した店舗を使う（複数店舗・1 Webhook URL 対応）
    type Cred = { store_id: string; secret: string; accessToken: string | null };
    const credsList: Cred[] = [];
    const { data: profiles } = await supabase
      .from("store_profiles")
      .select("store_id, line_channel_secret, line_channel_access_token")
      .not("line_channel_secret", "is", null);
    for (const p of profiles ?? []) {
      const s = String((p as { line_channel_secret?: string }).line_channel_secret).trim();
      if (s) {
        const tok = (p as { line_channel_access_token?: string }).line_channel_access_token;
        credsList.push({
          store_id: String((p as { store_id?: string }).store_id ?? ""),
          secret: s,
          accessToken: tok ? String(tok).trim() : null,
        });
      }
    }
    const { data: credsRows } = await supabase
      .from("store_line_credentials")
      .select("store_id, line_channel_secret, line_channel_access_token")
      .not("line_channel_secret", "is", null);
    for (const c of credsRows ?? []) {
      const s = String((c as { line_channel_secret?: string }).line_channel_secret).trim();
      if (!s) continue;
      const sid = String((c as { store_id?: string }).store_id ?? "");
      const tok = (c as { line_channel_access_token?: string }).line_channel_access_token;
      const existing = credsList.find((x) => x.store_id === sid);
      if (existing) {
        existing.secret = s;
        existing.accessToken = tok ? String(tok).trim() : existing.accessToken;
      } else {
        credsList.push({ store_id: sid, secret: s, accessToken: tok ? String(tok).trim() : null });
      }
    }
    {
      for (const cred of credsList) {
        if (!cred.accessToken) continue;
        if (await verifyLineSignature(bodyRaw, signature, cred.secret)) {
          secret = cred.secret;
          accessToken = cred.accessToken;
          resolvedStoreId = cred.store_id;
          sharedChannelStoreIds = credsList.filter((c) => c.secret === secret).map((c) => c.store_id);
          console.log("[line-webhook-coupon] signature matched store_id", cred.store_id, "sharedChannelStores", sharedChannelStoreIds?.length ?? 0);
          break;
        }
      }
    }
    if (!secret || !accessToken) {
      // AI食生活判定チャネル用フォールバック: 店舗に一致しなければ env の AI 用シークレットで検証
      if (AI_LINE_CHANNEL_SECRET && AI_LINE_CHANNEL_ACCESS_TOKEN && (await verifyLineSignature(bodyRaw, signature, AI_LINE_CHANNEL_SECRET))) {
        secret = AI_LINE_CHANNEL_SECRET;
        accessToken = AI_LINE_CHANNEL_ACCESS_TOKEN;
        resolvedStoreId = null;
        console.log("[line-webhook-coupon] Using AI channel fallback credentials (quiz postback)");
      } else {
        console.error("[line-webhook-coupon] No matching LINE credentials (tried stores)", credsList.map((c) => c.store_id));
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
      }
    }
  }

  if (!secret || !accessToken) {
    console.error("[line-webhook-coupon] No LINE credentials found", { storeId });
    return new Response(JSON.stringify({ error: "LINE not configured" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (storeId && !(await verifyLineSignature(bodyRaw, signature, secret))) {
    console.error("[line-webhook-coupon] Signature verification failed", { storeId, bodyLen: bodyRaw.length });
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  let parsed: {
    events?: Array<{
      type: string;
      mode?: string;          // "active" | "standby" | "chase"
      replyToken?: string;
      source?: { userId?: string };
      message?: { type: string; text?: string };
      postback?: { data?: string };
    }>;
  };
  try {
    parsed = JSON.parse(bodyRaw);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  // events は上で空でないことを確認済み（空なら既に 200 で return している）

  if (!accessToken && resolvedStoreId) {
    const { data: credsFull } = await supabase
      .from("store_line_credentials")
      .select("line_channel_access_token")
      .eq("store_id", resolvedStoreId)
      .maybeSingle();
    accessToken = credsFull?.line_channel_access_token ? String(credsFull.line_channel_access_token).trim() : null;
  }

  const replyToUser = async (replyToken: string | null, text: string, imageUrl?: string | null, pushUserId?: string) => {
    if (!accessToken) return;
    const messages: Array<{ type: "text"; text: string } | { type: "image"; originalContentUrl: string; previewImageUrl: string }> = [{ type: "text", text }];
    if (imageUrl && imageUrl.startsWith("https://")) {
      messages.push({ type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl });
    }
    if (replyToken) {
      // 通常モード: reply API
      const r = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ replyToken, messages }),
      });
      if (!r.ok) console.error("[replyToUser] reply API failed:", r.status, await r.text().catch(() => ""));
    } else if (pushUserId) {
      // standbyモード（チャットON）: push API にフォールバック
      const r = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to: pushUserId, messages }),
      });
      if (!r.ok) console.error("[replyToUser] push API failed:", r.status, await r.text().catch(() => ""));
    }
  };

  const getGreetingForStore = async (sid: string | null) => {
    if (!sid) return "友だち追加ありがとうございます！";
    const { data: credsGreeting } = await supabase
      .from("store_line_credentials")
      .select("line_greeting_message")
      .eq("store_id", sid)
      .maybeSingle();
    const { data: storeProfile } = await supabase
      .from("store_profiles")
      .select("store_name_ja")
      .eq("store_id", sid)
      .maybeSingle();
    const storeName = (storeProfile as { store_name_ja?: string })?.store_name_ja ?? "";
    const customGreeting = (credsGreeting as { line_greeting_message?: string })?.line_greeting_message?.trim();
    return customGreeting || (storeName ? `【${storeName}】友だち追加ありがとうございます！` : "友だち追加ありがとうございます！");
  };

  /** 店舗の付与方針に照らし、このユーザーにクーポンを付与してよいか */
  const canUserReceiveCoupon = async (storeIdForPolicy: string | null, lineUserId: string): Promise<{ ok: boolean; intervalDays?: number }> => {
    if (!storeIdForPolicy) return { ok: true };
    const { data: storeRow } = await supabase
      .from("store_profiles")
      .select("coupon_allow_multiple, coupon_interval_days")
      .eq("store_id", storeIdForPolicy)
      .maybeSingle();
    const allowMultiple = (storeRow as { coupon_allow_multiple?: boolean })?.coupon_allow_multiple === true;
    const intervalDays = Math.max(1, Number((storeRow as { coupon_interval_days?: number })?.coupon_interval_days) || 30);
    const { data: lastRow } = await supabase
      .from("coupon_follow_pending")
      .select("used_at, created_at")
      .eq("store_id", storeIdForPolicy)
      .eq("used_by_user_id", lineUserId)
      .not("used_by_user_id", "is", null)
      .order("used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = (lastRow as { used_at?: string | null; created_at?: string } | null)?.used_at ?? (lastRow as { created_at?: string } | null)?.created_at;
    if (!lastAt) return { ok: true };
    if (!allowMultiple) return { ok: false };
    const lastMs = new Date(lastAt).getTime();
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastMs < intervalMs) return { ok: false, intervalDays };
    return { ok: true };
  };

  const DAILY_POINT_CAP = 3;
  const POINT_EXPIRE_MONTHS = 3;
  const getTodayJST = () => new Date().toLocaleString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 10);
  const getTodayPoints = async (sb: typeof supabase, lineUserId: string): Promise<number> => {
    try {
      const today = getTodayJST();
      const { data, error } = await sb.from("user_daily_point_log").select("points").eq("line_user_id", lineUserId).eq("log_date", today);
      if (error || !Array.isArray(data)) return 0;
      return data.reduce((sum: number, r: { points?: number }) => sum + (Number(r?.points) || 0), 0);
    } catch { return 0; }
  };
  const getValidTotalPoints = async (sb: typeof supabase, lineUserId: string): Promise<number> => {
    try {
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - POINT_EXPIRE_MONTHS);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const { data, error } = await sb.from("user_daily_point_log").select("points").eq("line_user_id", lineUserId).gte("log_date", cutoffStr);
      if (error || !Array.isArray(data)) return 0;
      return data.reduce((sum: number, r: { points?: number }) => sum + (Number(r?.points) || 0), 0);
    } catch { return 0; }
  };

  /** 当月の日別ポイント合計を取得（log_date -> 合計pt） */
  const getMonthPointMap = async (sb: typeof supabase, lineUserId: string): Promise<Map<string, number>> => {
    const map = new Map<string, number>();
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const first = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const last = new Date(y, m + 1, 0).toISOString().slice(0, 10);
      const { data, error } = await sb
        .from("user_daily_point_log")
        .select("log_date, points")
        .eq("line_user_id", lineUserId)
        .gte("log_date", first)
        .lte("log_date", last);
      if (error || !Array.isArray(data)) return map;
      for (const r of data) {
        const d = String((r as { log_date?: string }).log_date ?? "").slice(0, 10);
        if (!d) continue;
        const p = Number((r as { points?: number }).points) || 0;
        map.set(d, Math.min(3, (map.get(d) ?? 0) + p));
      }
    } catch { /* noop */ }
    return map;
  };

  /** 日別ptをカレンダー用記号に変換: 1pt=⚪ 2pt=◎ 3pt=㊉(花丸) */
  const pointToMark = (pt: number): string => {
    if (pt >= 3) return "㊉";
    if (pt === 2) return "◎";
    if (pt === 1) return "⚪";
    return "・";
  };

  /** 当月のカレンダーを生成（本日のカレンダー＋記号付き）。1pt=⚪ 2pt=◎ 3pt=㊉ */
  const buildPointCalendar = (pointMap: Map<string, number>): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
    const lines: string[] = [];
    lines.push(`📅 ${month + 1}月のポイント`);
    lines.push("日 月 火 水 木 金 土");
    const week: string[] = [];
    for (let i = 0; i < firstDow; i++) week.push("  ");
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const pt = pointMap.get(dStr) ?? 0;
      const mark = pointToMark(pt);
      week.push(`${d}${mark}`);
      if (week.length === 7) {
        lines.push(week.join(" "));
        week.length = 0;
      }
    }
    if (week.length > 0) lines.push(week.join(" "));
    lines.push("⚪1pt ◎2pt ㊉3pt");
    return lines.join("\n");
  };

  const addQuizPointWithCap = async (sb: typeof supabase, lineUserId: string): Promise<{ added: boolean; newTotal: number }> => {
    try {
      const today = getTodayJST();
      const todayPoints = await getTodayPoints(sb, lineUserId);
      if (todayPoints >= DAILY_POINT_CAP) return { added: false, newTotal: await getValidTotalPoints(sb, lineUserId) };
      await sb.from("user_daily_point_log").insert({ line_user_id: lineUserId, log_date: today, points: 1, source: "quiz" });
      const newTotal = await getValidTotalPoints(sb, lineUserId);
      await sb.from("user_points").upsert({ line_user_id: lineUserId, points: newTotal, updated_at: new Date().toISOString() }, { onConflict: "line_user_id" });
      return { added: true, newTotal };
    } catch { return { added: false, newTotal: 0 }; }
  };

  const events = parsed?.events ?? [];
  console.log("[line-webhook-coupon] events count", events.length, "types", events.map((e: { type?: string }) => e.type));
  for (const ev of events) {
    console.log("[line-webhook-coupon] event", { type: ev.type, hasReplyToken: !!ev.replyToken, hasSource: !!ev.source });
    if (ev.type === "follow") {
      const replyToken = ev.replyToken;
      const userId = ev.source?.userId;
      let greetingMsg = "友だち追加ありがとうございます！";
      let messagesToSend: Array<{ type: string; text: string }> = [];
      let pending: { id?: string; coupon_url?: string; store_id?: string; used_by_user_id?: string } | null = null;
      if (userId && accessToken) {
        // LINEプロフィール（表示名・画像）を非同期で保存（失敗しても続行）
        saveLineProfile(supabase, userId, accessToken).catch(() => {})
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const filterStoreId = storeId ?? resolvedStoreId;
        const storeIdsForPending = sharedChannelStoreIds && sharedChannelStoreIds.length > 0 ? sharedChannelStoreIds : (filterStoreId ? [filterStoreId] : null);
        let pendingQuery = supabase
          .from("coupon_follow_pending")
          .select("id, coupon_url, store_id")
          .is("used_by_user_id", null)
          .gt("created_at", fiveMinAgo)
          .order("created_at", { ascending: false })
          .limit(1);
        if (storeIdsForPending?.length === 1) pendingQuery = pendingQuery.eq("store_id", storeIdsForPending[0]);
        else if (storeIdsForPending && storeIdsForPending.length > 1) pendingQuery = pendingQuery.in("store_id", storeIdsForPending);
        const pendingRes = await pendingQuery.maybeSingle();
        pending = (pendingRes as { data?: { id?: string; coupon_url?: string; store_id?: string; used_by_user_id?: string } | null })?.data ?? null;
        if (!pending?.coupon_url) {
          let fallbackQuery = supabase
            .from("coupon_follow_pending")
            .select("id, coupon_url, store_id")
            .is("used_by_user_id", null)
            .gt("created_at", thirtyMinAgo)
            .order("created_at", { ascending: false })
            .limit(1);
          if (storeIdsForPending?.length === 1) fallbackQuery = fallbackQuery.eq("store_id", storeIdsForPending[0]);
          else if (storeIdsForPending && storeIdsForPending.length > 1) fallbackQuery = fallbackQuery.in("store_id", storeIdsForPending);
          const { data: fallback } = await fallbackQuery.maybeSingle();
          if (fallback?.coupon_url) pending = fallback;
        }
        if (!pending?.coupon_url) {
          // ブロック解除などで同じユーザーが再フォローした場合: 過去にこのユーザーに送ったクーポンがあれば再送する
          let usedByMeQuery = supabase
            .from("coupon_follow_pending")
            .select("id, coupon_url, store_id")
            .eq("used_by_user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1);
          if (storeIdsForPending?.length === 1) usedByMeQuery = usedByMeQuery.eq("store_id", storeIdsForPending[0]);
          else if (storeIdsForPending && storeIdsForPending.length > 1) usedByMeQuery = usedByMeQuery.in("store_id", storeIdsForPending);
          const { data: usedData } = await usedByMeQuery.maybeSingle();
          pending = usedData ?? null;
          if (pending?.coupon_url) {
            console.log("[line-webhook-coupon] follow: re-follow (unblock), sending coupon again", { userId: userId.slice(0, 8) + "...", storeId, pendingId: (pending as { id?: number }).id });
          } else {
            const { data: anyRow } = await supabase
              .from("coupon_follow_pending")
              .select("id, created_at, used_by_user_id")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            console.log("[line-webhook-coupon] follow: no pending, greeting only", {
              userId: userId.slice(0, 8) + "...",
              filterStoreId,
              storeIdsForPendingLen: storeIdsForPending?.length ?? 0,
              latestRow: anyRow ? { id: (anyRow as { id?: string }).id, created_at: (anyRow as { created_at?: string }).created_at, used: !!(anyRow as { used_by_user_id?: string }).used_by_user_id } : null,
            });
          }
        } else {
          console.log("[line-webhook-coupon] follow: new pending, sending coupon", { userId: userId.slice(0, 8) + "...", storeId, pendingStoreId: (pending as { store_id?: string }).store_id, pendingId: (pending as { id?: number }).id });
        }
        if (pending?.coupon_url) {
          const policy = await canUserReceiveCoupon((pending as { store_id?: string }).store_id ?? null, userId);
          if (!policy.ok) {
            console.log("[line-webhook-coupon] follow: store policy blocks grant", { storeId: (pending as { store_id?: string }).store_id, userId: userId.slice(0, 8) + "..." });
            pending = null;
          }
        }
        if (pending?.coupon_url) {
          greetingMsg = await getGreetingForStore((pending as { store_id?: string }).store_id ?? null);
          const couponMsg = `【保存用】お会計時にこちらを提示してください：\n\n${pending.coupon_url}`;
          messagesToSend = [{ type: "text", text: greetingMsg }, { type: "text", text: couponMsg }];
        } else {
          // 複数店舗でチャネルを共有している場合は汎用あいさつ（店舗名固定を避ける）
          const sharedMulti = sharedChannelStoreIds && sharedChannelStoreIds.length > 1;
          greetingMsg = sharedMulti ? "千客万来まねきだこへのご登録ありがとうございます！\nアンケートご回答後にポイントカードのURLをお送りします。" : await getGreetingForStore(resolvedStoreId);
          messagesToSend = [{ type: "text", text: greetingMsg }];
        }
      } else {
        console.log("[line-webhook-coupon] follow: no userId or accessToken", { hasUserId: !!userId, storeId });
        greetingMsg = await getGreetingForStore(resolvedStoreId);
        messagesToSend = [{ type: "text", text: greetingMsg }];
      }
      if (replyToken && accessToken && messagesToSend.length > 0) {
        const replyRes = await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ replyToken, messages: messagesToSend }),
        });
        if (!replyRes.ok) {
          const errText = await replyRes.text();
          console.error("[line-webhook-coupon] LINE reply API error", { status: replyRes.status, body: errText, messageCount: messagesToSend.length });
        }
        if (pending?.coupon_url && (pending as { id?: string }).id) {
          const nowIso = new Date().toISOString();
          await supabase.from("coupon_follow_pending").update({ used_by_user_id: userId, used_at: nowIso }).eq("id", (pending as { id: string }).id);
        }

        // ── ポイント付与 + review に line_user_id 書き込み + 結果ページ通知 ──
        if (userId && SNS_WORKER_SECRET) {
          const addPointUrl = `${FUNCTIONS_BASE}/add-loyalty-point`;
          // ★ 30分 → 24時間に拡張（アンケート送信から時間が経っても検出できるよう）
          // 複数店舗でチャネルを共有している場合は4時間以内に絞る（他店舗のテスト用アンケートが誤マッチするのを防ぐ）
          const reviewWindowMs = (sharedChannelStoreIds && sharedChannelStoreIds.length > 1) ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
          const oneDayAgo = new Date(Date.now() - reviewWindowMs).toISOString();

          // 直近24時間以内の line_user_id 未設定レビューを探す
          let reviewQuery = supabase
            .from("reviews")
            .select("id, submission_id, store_id")
            .is("line_user_id", null)
            .gte("created_at", oneDayAgo)
            .order("created_at", { ascending: false })
            .limit(1);
          // 複数店舗でチャネルを共有している場合は全店舗横断で検索する（先にsharedChannelStoreIdsを優先）
          if (sharedChannelStoreIds && sharedChannelStoreIds.length > 1) reviewQuery = reviewQuery.in("store_id", sharedChannelStoreIds);
          else if (resolvedStoreId) reviewQuery = reviewQuery.eq("store_id", resolvedStoreId);
          const { data: recentReview } = await reviewQuery.maybeSingle();

          const effectiveStoreId = recentReview?.store_id ?? resolvedStoreId;

          if (recentReview && effectiveStoreId) {
            // review に line_user_id を書き込む（これで結果ページのポーリングが検知する）
            await supabase
              .from("reviews")
              .update({ line_user_id: userId })
              .eq("id", recentReview.id);

            // ポイント付与は liff_link_review (form-engine) 側のみで行う
            // （survey と LINE友達追加ポイントは不要）

            // ポイントカード + 個人用チェックインURLをプッシュ
            const _followDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
            const _followSid = recentReview.submission_id;
            const _followWalletUrl = _followDashUrl
              ? `${_followDashUrl}/s/${encodeURIComponent(effectiveStoreId)}/wallet/${encodeURIComponent(_followSid)}`
              : `${RESULT_BASE}/form-engine?store_id=${encodeURIComponent(effectiveStoreId)}&sid=${encodeURIComponent(_followSid)}&_nc=1`;
            const _followCheckinUrl = _followDashUrl
              ? `${_followDashUrl}/s/${encodeURIComponent(effectiveStoreId)}/checkin?sid=${encodeURIComponent(_followSid)}`
              : null;
            // Google口コミURLを取得（ポイントカード通知と一緒に案内）
            const { data: _followStoreData } = await supabase
              .from("store_profiles")
              .select("google_url, point_rule_google, revisit_point_enabled")
              .eq("store_id", effectiveStoreId)
              .maybeSingle();
            const _followGoogleUrl = (_followStoreData as any)?.google_url ?? null;
            const _followGooglePoints = Number((_followStoreData as any)?.point_rule_google ?? 3);
            let _followMsg = `🎴 ポイントカードを発行しました！\n\nタップして確認してください👇\n${_followWalletUrl}`;
            if (_followGoogleUrl) {
              _followMsg += `\n\n⭐ Google口コミを書くと＋${_followGooglePoints}P もらえます！`;
            }
            if ((_followStoreData as any)?.revisit_point_enabled) {
              _followMsg += `\n\n📌 次回の来店時は再来店ポイントが貯められます。次回来店時にQRコードかNFCを読み込んでください。`;
            }
            await fetch("https://api.line.me/v2/bot/message/push", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ to: userId, messages: [{ type: "text", text: _followMsg }] }),
            }).catch((e) => console.error("[follow] push message error", e));
          } else if (resolvedStoreId || effectiveStoreId) {
            // ★ レビューが見つからない場合: 店舗の一般URLを送信（ポイント付与なし）
            const fallbackStoreId = effectiveStoreId ?? resolvedStoreId!;
            // ★ 店舗の一般フォームURLをプッシュ（ブラウザへの誘導）
            const storeUrl = `${RESULT_BASE}/form-engine?store_id=${encodeURIComponent(fallbackStoreId)}&_nc=1`;
            fetch("https://api.line.me/v2/bot/message/push", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({
                to: userId,
                messages: [{ type: "text", text: `✅ 友達追加ありがとうございます！\n\nポイントを受け取るにはブラウザでアンケートページを開いてください👇\n${storeUrl}` }],
              }),
            }).catch((e) => console.error("[follow] push fallback URL error", e));
          }
        }
      }
    }
    if (ev.type === "message" && ev.message?.type === "text" && ev.source?.userId && accessToken) {
      const userId = ev.source.userId;
      // standbyモード: LINEはダミー replyToken を送ってくるが reply API は使えない → 必ず push API
      const isStandby = ev.mode === "standby";
      const replyToken: string | null = (!isStandby && ev.replyToken) ? ev.replyToken : null;
      console.log("[line-webhook-coupon] message event mode:", ev.mode, "isStandby:", isStandby, "hasReplyToken:", !!replyToken);
      // 複数メッセージ送信ヘルパ（reply/push を自動切替）
      const sendMessages = async (msgs: Array<Record<string, unknown>>) => {
        const h = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
        if (replyToken) {
          const r = await fetch("https://api.line.me/v2/bot/message/reply", { method: "POST", headers: h, body: JSON.stringify({ replyToken, messages: msgs }) });
          if (!r.ok) console.error("[sendMessages] reply API failed:", r.status, await r.text().catch(() => ""));
        } else {
          const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: h, body: JSON.stringify({ to: userId, messages: msgs }) });
          if (!r.ok) console.error("[sendMessages] push API failed:", r.status, await r.text().catch(() => ""));
        }
      };
      // LINE oaMessage URL の一部端末バグ: "text=REVIEW:xxx" のように text= プレフィックスが付く場合がある
      let rawText = String(ev.message.text ?? "").trim();
      if (rawText.startsWith("text=")) rawText = rawText.slice(5);
      if (rawText.startsWith("TEXT=")) rawText = rawText.slice(5);
      const text = rawText.toUpperCase();
      console.log("[line-webhook-coupon] message event", { userId: userId?.slice(0, 8) + "...", resolvedStoreId, textLen: rawText.length });


      let replied = false;

      // ── ポイント確認 ──────────────────────────────────────────
      if (!replied && (rawText === 'ポイント' || rawText.toLowerCase() === 'point')) {
        const { data: storeDataPt } = await supabase
          .from('store_profiles').select('store_name_jp, points_scope, chain_id, point_threshold')
          .eq('store_id', resolvedStoreId).maybeSingle();
        const storeName = (storeDataPt as any)?.store_name_jp ?? 'お店';
        const scopeType = (storeDataPt as any)?.points_scope === 'chain' && (storeDataPt as any)?.chain_id
          ? 'chain' : 'store';
        const scopeId = scopeType === 'chain' ? (storeDataPt as any).chain_id : resolvedStoreId;
        const pointThreshold = (storeDataPt as any)?.point_threshold ?? 4;

        // customer_identity から identity_id を取得
        const { data: identityData } = await supabase
          .from('customer_identity').select('id')
          .eq('line_user_id', userId).maybeSingle();
        const identityId = (identityData as any)?.id ?? null;

        let totalPoints = 0;
        let nextReward: { reward_title: string; required_points: number } | null = null;

        if (identityId) {
          // ウォレットから残高取得
          const { data: wallet } = await supabase
            .from('customer_points_wallet').select('total_earned')
            .eq('identity_id', identityId).eq('scope_type', scopeType).eq('scope_id', scopeId)
            .maybeSingle();
          totalPoints = (wallet as any)?.total_earned ?? 0;

          // 次の特典を取得
          const { data: nextRw } = await supabase
            .from('store_point_rewards').select('reward_title, required_points')
            .eq('store_id', resolvedStoreId).eq('is_active', true)
            .gt('required_points', totalPoints)
            .order('required_points', { ascending: true }).limit(1).maybeSingle();
          nextReward = nextRw as typeof nextReward;
        }

        // ポイントカード風ビジュアル
        const filledDots = Math.min(totalPoints, pointThreshold);
        const emptyDots = Math.max(0, pointThreshold - filledDots);
        const bar = "●".repeat(filledDots) + "○".repeat(emptyDots);
        let ptMsg = `╔══════════════════╗\n`;
        ptMsg += `  🎴 ${storeName}\n`;
        ptMsg += `  ポイントカード\n`;
        ptMsg += `╚══════════════════╝\n\n`;
        ptMsg += `${bar}\n`;
        ptMsg += `累計: ${totalPoints}P`;
        if (totalPoints > 0) {
          ptMsg += ` / 目標 ${pointThreshold}P`;
        }
        ptMsg += `\n`;
        if (!identityId) {
          ptMsg += `\nまだカードが発行されていません。\nアンケート回答後にLINE友達追加でカード発行！`;
        } else if (nextReward) {
          const remaining = Math.max(0, (nextReward as any).required_points - totalPoints);
          ptMsg += `\n次の特典: 「${(nextReward as any).reward_title}」\nあと ${remaining}P で交換できます！\n`;
        } else if (totalPoints >= pointThreshold) {
          ptMsg += `\n🎁 特典が使えます！\nスタッフにこの画面をご提示ください。\n`;
        }
        ptMsg += `\n📊 貯め方\nアンケート回答 +1P\nGoogle等・口コミ +3P`;

        // 個人用チェックインURL（来店ポイントをテキスト不要でワンタップ加算）
        if (identityId && resolvedStoreId) {
          const _ptDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
          if (_ptDashUrl) {
            const { data: _ptRev } = await supabase
              .from("reviews").select("submission_id")
              .eq("line_user_id", userId).eq("store_id", resolvedStoreId)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            const _ptSid = (_ptRev as Record<string, unknown> | null)?.submission_id as string | undefined;
            if (_ptSid) {
              ptMsg += `\n\n📌 来店時はこちらをタップするだけでポイントが加算されます👇\n${_ptDashUrl}/s/${encodeURIComponent(resolvedStoreId)}/checkin?sid=${encodeURIComponent(_ptSid)}`;
            }
          }
        }

        await replyToUser(replyToken, ptMsg, null, userId);
        replied = true;
      }

      // ── REVIEW:${submissionId} メッセージ: oaMessage ボタンから届くポイントカード発行依頼 ──
      if (!replied && rawText.startsWith("REVIEW:")) {
        const submissionIdFromMsg = rawText.slice(7).trim();
        console.log("[REVIEW-msg] ENTERED block", { submissionIdFromMsg, userId: userId.slice(0,8) });
        if (submissionIdFromMsg) {
          const { data: revBySubId } = await supabase
            .from("reviews")
            .select("id, submission_id, store_id, line_user_id")
            .eq("submission_id", submissionIdFromMsg)
            .maybeSingle();
          const revObj = revBySubId as { id: string; submission_id: string; store_id: string; line_user_id: string | null } | null;
          console.log("[REVIEW-msg] DB lookup result", { found: !!revObj, line_user_id: revObj?.line_user_id?.slice(0,10) ?? null });
          // ★ security fix: ストア所有権チェック（他店舗のsubmission_idを使った乗っ取りを防ぐ）
          if (revObj) {
            const allowedForReview = !resolvedStoreId ||
              revObj.store_id === resolvedStoreId ||
              (sharedChannelStoreIds && sharedChannelStoreIds.length > 0 && sharedChannelStoreIds.includes(revObj.store_id));
            if (!allowedForReview) {
              console.warn("[REVIEW-msg] store mismatch, rejecting", { revStoreId: revObj.store_id, resolvedStoreId });
              await replyToUser(replyToken, "⚠️ アンケートが見つかりません。URLが正しいか確認してください。", null, userId);
              replied = true;
            }
          }
          if (!replied && revObj && !revObj.line_user_id) {
            // review に line_user_id を紐付け（ブラウザ側ポーリングが検知する）
            const { error: updErr } = await supabase.from("reviews").update({ line_user_id: userId }).eq("id", revObj.id);
            console.log("[REVIEW-msg] update line_user_id:", updErr ? "ERROR:" + updErr.message : "OK");
            const linkStoreId = revObj.store_id ?? resolvedStoreId ?? "";
            const linkSid = revObj.submission_id ?? "";
            if (SNS_WORKER_SECRET && linkStoreId) {
              const addPtUrl = `${FUNCTIONS_BASE}/add-loyalty-point`;
              // ポイント付与は liff_link_review (form-engine) 側のみで行う
              // （survey と LINE友達追加ポイントは不要）
            }
            const liffDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
            const resultUrl = liffDashUrl
              ? `${liffDashUrl}/s/${encodeURIComponent(linkStoreId)}/wallet/${encodeURIComponent(linkSid)}`
              : `${RESULT_BASE}/form-engine?store_id=${encodeURIComponent(linkStoreId)}&sid=${encodeURIComponent(linkSid)}&_nc=1`;
            const checkinUrl = liffDashUrl
              ? `${liffDashUrl}/s/${encodeURIComponent(linkStoreId)}/checkin?sid=${encodeURIComponent(linkSid)}`
              : null;
            console.log("[REVIEW-msg] sending point card URL", { resultUrl, userId: userId.slice(0,8), replyToken: replyToken?.slice(0,8) ?? null });
            let cardMsg = `🎴 ポイントカードを発行しました！\n\nタップして確認してください👇\n${resultUrl}`;
            if (checkinUrl) cardMsg += `\n\n📌 次回の来店時はこちらをタップするだけでポイントが加算されます👇\n${checkinUrl}`;
            await replyToUser(replyToken, cardMsg, null, userId);
          } else if (!replied && revObj?.line_user_id) {
            // 既連携: ポイントカードURLを再送する
            const linkStoreId = revObj.store_id ?? resolvedStoreId ?? "";
            const linkSid = revObj.submission_id ?? "";
            const liffDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
            const resultUrl = liffDashUrl
              ? `${liffDashUrl}/s/${encodeURIComponent(linkStoreId)}/wallet/${encodeURIComponent(linkSid)}`
              : `${RESULT_BASE}/form-engine?store_id=${encodeURIComponent(linkStoreId)}&sid=${encodeURIComponent(linkSid)}&_nc=1`;
            console.log("[REVIEW-msg] already linked, resending URL", { userId: userId.slice(0,8) });
            await replyToUser(replyToken, `✅ すでに連携済みです。ポイントカードはこちら👇\n${resultUrl}`, null, userId);
          } else {
            console.log("[REVIEW-msg] submission not found", { submissionIdFromMsg });
            await replyToUser(replyToken, "⚠️ アンケートが見つかりません。URLが正しいか確認してください。", null, userId);
          }
          replied = true;
        }
      }

      // ── checkin_{storeId}: 来店ポイント付与 ─────────────────────
      if (!replied && rawText.startsWith("checkin_")) {
        const rawCheckinStoreId = rawText.slice("checkin_".length).trim();
        let checkinStoreId = rawCheckinStoreId;
        try { checkinStoreId = decodeURIComponent(rawCheckinStoreId); } catch { /* keep raw */ }
        console.log("[checkin] storeId:", checkinStoreId, "userId:", userId.slice(0, 8));
        // ★ security fix: checkinStoreId がこのチャネルの許可ストアかを検証（任意store_id注入を防ぐ）
        const checkinAllowed = !resolvedStoreId ||
          checkinStoreId === resolvedStoreId ||
          (sharedChannelStoreIds && sharedChannelStoreIds.length > 0 && sharedChannelStoreIds.includes(checkinStoreId));
        if (checkinStoreId && SNS_WORKER_SECRET && checkinAllowed) {
          // JST日付ベースのsource_ref（1日1回）
          const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
          const dateStr = nowJst.toISOString().slice(0, 10).replace(/-/g, "");
          const source_ref = `visit_${checkinStoreId}_${dateStr}`;
          let replyMsg = "";
          try {
            const ptRes = await fetch(`${FUNCTIONS_BASE}/add-loyalty-point`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-worker-secret": SNS_WORKER_SECRET },
              body: JSON.stringify({
                store_id: checkinStoreId,
                action_type: "visit",
                source_ref,
                line_user_id: userId,
              }),
            });
            const ptData = await ptRes.json() as Record<string, unknown>;
            console.log("[checkin] add-loyalty-point result:", JSON.stringify(ptData));

            // ウォレット・個人用チェックインURLを生成（最新の submission_id を検索）
            const liffDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
            let walletUrl = "";
            let personalCheckinUrl = "";
            if (liffDashUrl) {
              const { data: revRow } = await supabase
                .from("reviews").select("submission_id")
                .eq("line_user_id", userId).eq("store_id", checkinStoreId)
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
              const subId = (revRow as Record<string, unknown> | null)?.submission_id as string | undefined;
              if (subId) {
                walletUrl = `${liffDashUrl}/s/${encodeURIComponent(checkinStoreId)}/wallet/${encodeURIComponent(subId)}`;
                // 個人用チェックインURL（?sid= 付き）- 次回QR不要でワンタップ加算できる
                personalCheckinUrl = `${liffDashUrl}/s/${encodeURIComponent(checkinStoreId)}/checkin?sid=${encodeURIComponent(subId)}`;
              }
            }

            if (ptData.ok && (ptData as Record<string, unknown>).first_visit) {
              replyMsg = "👋 初回ご来店ありがとうございます！\n\n2回目のご来店からこのQRコードで来店ポイントが付与されます。次回もよろしくお願いします！";
            } else if (ptData.ok && !ptData.skipped) {
              const pts = Number(ptData.points_delta ?? 1);
              replyMsg = `✅ ＋${pts}P 来店ポイントを加算しました！`;
              if (walletUrl) {
                replyMsg += `\n\nポイントカードはこちら👇\n${walletUrl}`;
              }
              if (personalCheckinUrl) {
                replyMsg += `\n\n📌 次回の来店時はこちらをタップするだけでポイントが加算されます👇\n${personalCheckinUrl}`;
              }
              if (!walletUrl) replyMsg += `\n\n「ポイント」と送信するとポイント残高を確認できます。`;
            } else if (ptData.skipped && !(ptData as Record<string, unknown>).first_visit) {
              replyMsg = "✅ 本日の来店ポイントはすでに付与済みです。\nまた明日ご来店ください！";
              if (walletUrl) replyMsg += `\n\nポイントカード👇\n${walletUrl}`;
            } else {
              replyMsg = "⚠️ ポイントの付与に失敗しました。しばらくしてからもう一度お試しください。";
            }
          } catch (e) {
            console.error("[checkin] add-loyalty-point error", e);
            replyMsg = "⚠️ ポイントの付与に失敗しました。しばらくしてからもう一度お試しください。";
          }
          await replyToUser(replyToken, replyMsg, null, userId);
          replied = true;
        }
      }

      if (!replied && text.length >= 4 && text.length <= 12) {
        let codeQuery = supabase
          .from("coupon_pending_codes")
          .select("code, coupon_url, store_id")
          .eq("code", text)
          .gt("expires_at", new Date().toISOString());
        if (storeId) codeQuery = codeQuery.eq("store_id", storeId);
        const { data: codePending } = await codeQuery.maybeSingle();

        if ((codePending?.coupon_url as string | null)?.startsWith("REVIEW:")) {
          // ★ LINEポイント取得コード（既存LINE友達対応）
          const reviewId = (codePending!.coupon_url as string).slice(7);
          const { data: revLinked } = await supabase
            .from("reviews")
            .select("id, submission_id, store_id, line_user_id")
            .eq("id", reviewId)
            .maybeSingle();
          if (revLinked && !(revLinked as any).line_user_id) {
            // review に line_user_id を紐付け（ブラウザ側ポーリングが検知する）
            await supabase.from("reviews").update({ line_user_id: userId }).eq("id", reviewId);
            if (SNS_WORKER_SECRET) {
              const addPtUrl = `${FUNCTIONS_BASE}/add-loyalty-point`;
              // アンケートポイント
              await fetch(addPtUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-worker-secret": SNS_WORKER_SECRET },
                body: JSON.stringify({
                  store_id: (revLinked as any).store_id,
                  action_type: "survey",
                  source_ref: (revLinked as any).submission_id,
                  line_user_id: userId,
                }),
              }).catch((e) => console.error("[msg-code] survey point error", e));
              // LINE友達追加ポイントは不要のため付与しない
            }
            // コードを消費
            await supabase.from("coupon_pending_codes").delete().eq("code", text);
            // 結果ページへ誘導
            const linkStoreId = (revLinked as any).store_id ?? resolvedStoreId ?? "";
            const linkSid = (revLinked as any).submission_id ?? "";
            const liffDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
            const resultUrl = liffDashUrl
              ? `${liffDashUrl}/s/${encodeURIComponent(linkStoreId)}/wallet/${encodeURIComponent(linkSid)}`
              : `${RESULT_BASE}/form-engine?store_id=${encodeURIComponent(linkStoreId)}&sid=${encodeURIComponent(linkSid)}&_nc=1`;
            await replyToUser(replyToken, `🎴 ポイントカードを発行しました！\n\nタップして確認してください👇\n${resultUrl}`, null, userId);
          } else if ((revLinked as any)?.line_user_id) {
            await replyToUser(replyToken, "✅ すでに連携済みです。ブラウザのページでポイントをご確認ください！", null, userId);
          } else {
            await replyToUser(replyToken, "⚠️ コードの確認に失敗しました。もう一度お試しください。", null, userId);
          }
          replied = true;
        } else if (codePending?.coupon_url) {
          const messageText = `【保存用】お会計時にこちらを提示してください：\n\n${codePending.coupon_url}`;
          await sendMessages([{ type: "text", text: messageText }]);
          await supabase.from("coupon_pending_codes").delete().eq("code", text);
          replied = true;
        }
      }
      // 識別コード(access_code)で照合。このコードを送った人だけが1回だけクーポンURLを受け取れる
      if (!replied && rawText.length >= 4 && rawText.length <= 12) {
        const filterStoreId = storeId ?? resolvedStoreId;
        const { data: pendingByCode } = await supabase
          .from("coupon_follow_pending")
          .select("id, coupon_url, store_id, used_by_user_id")
          .eq("access_code", rawText)
          .maybeSingle();
        const pStoreId = (pendingByCode as { store_id?: string } | null)?.store_id ?? null;
        const allowedStore = !filterStoreId || pStoreId === filterStoreId || (sharedChannelStoreIds && sharedChannelStoreIds.length > 0 && sharedChannelStoreIds.includes(pStoreId ?? ""));
        if (pendingByCode?.coupon_url && allowedStore) {
          const usedBy = (pendingByCode as { used_by_user_id?: string | null }).used_by_user_id;
          if (usedBy != null) {
            console.log("[line-webhook-coupon] message: access_code already used", { code: rawText.slice(0, 3) + "***" });
            await sendMessages([{ type: "text", text: "このコードは使用済みです。クーポンは1回限りです。" }]);
            replied = true;
          } else {
            const pStoreId = (pendingByCode as { store_id?: string }).store_id ?? null;
            const policy = await canUserReceiveCoupon(pStoreId, userId);
            if (!policy.ok) {
              const limitMsg = policy.intervalDays != null
                ? `この店舗ではクーポンは${policy.intervalDays}日に1回までです。またのご利用をお待ちしています。`
                : "この店舗ではクーポンは1回限りです。";
              await sendMessages([{ type: "text", text: limitMsg }]);
              replied = true;
            } else {
              // ★ security fix: アトミック UPDATE（TOCTOU対策 — used_by_user_id IS NULL 条件付き）
              const nowIso = new Date().toISOString();
              const { data: claimedRows } = await supabase
                .from("coupon_follow_pending")
                .update({ used_by_user_id: userId, used_at: nowIso })
                .eq("id", (pendingByCode as { id: string }).id)
                .is("used_by_user_id", null)
                .select("id");
              if (!claimedRows || claimedRows.length === 0) {
                // 並行リクエストが先に取得済み
                await sendMessages([{ type: "text", text: "このコードは使用済みです。クーポンは1回限りです。" }]);
              } else {
                const greetingMsg = await getGreetingForStore(pStoreId);
                const couponMsg = `【保存用】お会計時にこちらを提示してください：\n\n${pendingByCode.coupon_url}`;
                await sendMessages([{ type: "text", text: greetingMsg }, { type: "text", text: couponMsg }]);
              }
              replied = true;
            }
          }
        }
      }
      // 識別番号・コード以外のメッセージには返信しない（アンケート案内などは送らない）
    }
    if (ev.type === "postback" && (ev as { postback?: { data?: string } }).postback?.data && ev.replyToken && ev.source?.userId && accessToken) {
      const data = String((ev as { postback: { data?: string } }).postback.data ?? "").trim();
      const lineUserId = ev.source.userId;
      const params = new URLSearchParams(data);
      const quizId = params.get("quiz")?.trim();
      const idxStr = params.get("idx")?.trim();
      if (quizId && idxStr !== undefined && idxStr !== "") {
        const selectedIndex = parseInt(idxStr, 10);
        if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex <= 2) {
          const quizExpireMinutes = 10;
          const expireSince = new Date(Date.now() - quizExpireMinutes * 60 * 1000).toISOString();
          // 削除で取得：最初に削除できたリクエストのみ行を取得。連打による二重解答を防ぐ
          const { data: deletedRows } = await supabase
            .from("user_quiz_pending")
            .delete()
            .eq("id", quizId)
            .eq("line_user_id", lineUserId)
            .gte("created_at", expireSince)
            .select("id, line_user_id, correct_index, question, choices, explanation, created_at");
          const quiz = Array.isArray(deletedRows) && deletedRows.length === 1 ? deletedRows[0] : null;
          if (!quiz) {
            await replyToUser(ev.replyToken, "このクイズは既に解答済み、または期限切れです。また次回のスキャンでお試しください。");
          } else {
            const quizObj = quiz as { correct_index?: number; choices?: string[]; explanation?: string };
            const correctIndex = Number(quizObj.correct_index ?? 0);
            const isCorrect = selectedIndex === correctIndex;
            let newTotal = 0;
            let pointAdded = false;
            if (isCorrect) {
              const result = await addQuizPointWithCap(supabase, lineUserId);
              newTotal = result.newTotal;
              pointAdded = result.added;
            }
            const choices = Array.isArray(quizObj.choices) ? quizObj.choices : [];
            const correctLabel = choices[correctIndex] ?? "正解";
            const explanation = String(quizObj.explanation ?? "").trim() || null;
            const ptHeader = pointAdded ? "＋1ptゲット！貯まってきたね 👇" : "本日はポイント上限（3pt）に達しています。また明日チャレンジ！ 👇";
            const calendarToken = FUNCTIONS_BASE && INTERNAL_JWT_SECRET ? await createCalendarToken(lineUserId) : "";
            const calendarImageUrl = calendarToken ? `${FUNCTIONS_BASE}/point-calendar-image?token=${encodeURIComponent(calendarToken)}` : null;
            const ptLine = `${ptHeader}\n\n合計 ${newTotal} pt`;
            const correctBodies = [
              `🎉 バッチリ正解！\n「${correctLabel}」\n\n${ptLine}`,
              `✨ ナイス回答！\n「${correctLabel}」で合ってるよ\n\n${ptLine}`,
              `🌟 正解！その調子！\n「${correctLabel}」\n\n${ptLine}`,
            ];
            const correctBodiesWithExp = [
              `🎉 バッチリ正解！\n「${correctLabel}」\n\n💡 ${explanation}\n\n${ptLine}`,
              `✨ ナイス回答！\n「${correctLabel}」\n\n💡 ${explanation}\n\n${ptLine}`,
            ];
            const incorrectBodies = [
              `💭 惜しい！\n正解は「${correctLabel}」でした\n\n次もチャレンジしてみてね！`,
              `😊 おしかった！\n正解：「${correctLabel}」\n\nまた次回お楽しみに！`,
            ];
            const incorrectBodiesWithExp = [
              `💭 惜しい！\n正解は「${correctLabel}」でした\n\n💡 ${explanation}\n\nなるほど〜。次回も挑戦してね！`,
              `😊 おしかった！\n正解：「${correctLabel}」\n\n💡 ${explanation}\n\n勉強になるね。また試してみて！`,
            ];
            if (isCorrect) {
              const capNote = !pointAdded ? "\n\n※本日は3ptの上限に達しているためポイントは加算されませんでした。明日また挑戦してね！" : "";
              const arr = explanation ? correctBodiesWithExp : correctBodies;
              const body = arr[Math.floor(Math.random() * arr.length)] + capNote;
              await replyToUser(ev.replyToken, body, calendarImageUrl ?? undefined);
            } else {
              const arr = explanation ? incorrectBodiesWithExp : incorrectBodies;
              const body = arr[Math.floor(Math.random() * arr.length)];
              await replyToUser(ev.replyToken, body);
            }
          }
        }
      }
    }
  }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[line-webhook-coupon] uncaught error", String(e), (e as Error)?.stack);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});

