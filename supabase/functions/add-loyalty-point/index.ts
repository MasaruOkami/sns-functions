/**
 * add-loyalty-point  (v2 — customer_identity / customer_points_* 対応)
 *
 * 呼び出し元:
 *   A) PostgreSQL トリガー (reviews INSERT) → x-worker-secret で認証
 *   B) 管理画面 API route                  → x-worker-secret で認証
 *   C) line-webhook-coupon (SNS拡散/Google口コミ通知)
 *
 * POST body パターン:
 *   A) { type:"INSERT", table:"reviews", record:{ line_user_id, store_id, submission_id, ... } }
 *   B/C) {
 *          store_id,
 *          action_type,          // "survey" | "sns" | "google"
 *          source_ref?,          // 重複防止用 ID
 *          line_user_id?,        // LINE ユーザー
 *          phone?,               // 電話番号（平文、関数内でハッシュ化）
 *          anon_id?,             // クッキー由来の匿名ID
 *        }
 */

// 鍵の解決は ../_shared/keys.ts に集約（新方式 sb_secret_ / レガシー両対応）
import { adminClient } from "../_shared/keys.ts";

const SNS_WORKER_SECRET         = Deno.env.get("SNS_WORKER_SECRET") ?? "";
const WALLET_BASE_URL           = Deno.env.get("WALLET_BASE_URL") ?? "https://restaurant-dashboard-ruddy.vercel.app";

const db = adminClient("add-loyalty-point");

// ── ユーティリティ ────────────────────────────────────────────

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-worker-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

async function hashPhone(phone: string): Promise<string> {
  const normalized = phone.replace(/\D/g, "");
  const buf = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function linePush(to: string, token: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error("[line-push]", res.status, await res.text());
}

// ── ID 解決 ───────────────────────────────────────────────────
// LINE / 電話番号 / 匿名クッキーのいずれかから customer_identity.id を返す

async function resolveIdentity(params: {
  line_user_id?: string | null;
  phone_hash?: string | null;
  anon_id?: string | null;
  first_store_id: string;
}): Promise<string | null> {
  const { line_user_id, phone_hash, anon_id, first_store_id } = params;

  if (line_user_id) {
    const { data } = await db
      .from("customer_identity")
      .select("id")
      .eq("line_user_id", line_user_id)
      .maybeSingle();
    if (data) return data.id as string;
    const { data: created } = await db
      .from("customer_identity")
      .insert({ line_user_id, first_store_id })
      .select("id")
      .single();
    return (created?.id as string) ?? null;
  }

  if (phone_hash) {
    const { data } = await db
      .from("customer_identity")
      .select("id")
      .eq("phone_hash", phone_hash)
      .maybeSingle();
    if (data) {
      // anon_id があれば後からマージしてもよいが Phase1 では省略
      return data.id as string;
    }
    const { data: created } = await db
      .from("customer_identity")
      .insert({ phone_hash, anon_id: anon_id ?? null, first_store_id })
      .select("id")
      .single();
    return (created?.id as string) ?? null;
  }

  if (anon_id) {
    const { data } = await db
      .from("customer_identity")
      .select("id")
      .eq("anon_id", anon_id)
      .maybeSingle();
    if (data) return data.id as string;
    const { data: created } = await db
      .from("customer_identity")
      .insert({ anon_id, first_store_id })
      .select("id")
      .single();
    return (created?.id as string) ?? null;
  }

  return null;
}

// ── メインハンドラ ────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  // 認証（この関数は verify_jwt=false でデプロイするため、ここが唯一の防御線）
  // SNS_WORKER_SECRET が未設定だと「空 === 空」で誰でも通る fail-open になるため、
  // 未設定は設定ミスとして 500 で閉じる（fail-closed）。
  if (!SNS_WORKER_SECRET) {
    console.error("[add-loyalty-point] SNS_WORKER_SECRET is not configured — refusing all requests");
    return json({ error: "SERVER_MISCONFIG" }, 500, origin);
  }
  const providedSecret = req.headers.get("x-worker-secret") ?? "";
  if (!providedSecret || providedSecret !== SNS_WORKER_SECRET) {
    return json({ error: "UNAUTHORIZED" }, 401, origin);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "INVALID_JSON" }, 400, origin); }

  // ── Body 正規化（DB Webhook 形式 vs 直接呼び出し）──────────
  const record = (body.type === "INSERT" && body.record)
    ? (body.record as Record<string, unknown>)
    : body;

  const store_id:    string = String(record.store_id ?? "");
  const action_type: string = String(record.action_type ?? (body.type === "INSERT" ? "survey" : ""));
  const source_ref:  string | null = String(record.source_ref ?? record.submission_id ?? record.id ?? "") || null;
  const line_user_id: string | null = String(record.line_user_id ?? "") || null;
  const phone_raw:    string | null = String(record.phone ?? "") || null;
  const anon_id:      string | null = String(record.anon_id ?? "") || null;
  const points_override: number | null = record.points_override != null ? Number(record.points_override) : null;

  if (!store_id || !action_type) {
    return json({ error: "MISSING_FIELDS", required: ["store_id", "action_type"] }, 400, origin);
  }
  if (!["survey", "sns", "google", "visit", "referral", "feedback"].includes(action_type)) {
    return json({ error: "INVALID_ACTION_TYPE", allowed: ["survey", "sns", "google", "visit", "referral", "feedback"] }, 400, origin);
  }
  if (!line_user_id && !phone_raw && !anon_id) {
    return json({ error: "NO_IDENTITY", message: "line_user_id, phone, or anon_id is required" }, 400, origin);
  }

  // ── 店舗設定取得 ─────────────────────────────────────────────
  const { data: store } = await db
    .from("store_profiles")
    .select([
      "store_name_jp",
      "points_scope",
      "chain_id",
      "point_rule_survey",
      "point_rule_sns",
      "point_rule_google",
      "point_rule_visit",
      "line_channel_access_token",
      "otp_required_on_redeem",
      "coupon_wallet_enabled",
      "coupon_tiers",
      "point_expiry_days",
      "test_mode",
    ].join(", "))
    .eq("store_id", store_id)
    .maybeSingle();

  if (!store) return json({ error: "STORE_NOT_FOUND" }, 404, origin);

  // LINE チャネルトークンは store_line_credentials を優先（管理画面が書き込む先）。無ければ store_profiles にフォールバック。
  const { data: lineCredsAlp } = await db
    .from("store_line_credentials")
    .select("line_channel_access_token")
    .eq("store_id", store_id)
    .maybeSingle();

  const scope_type = ((store.points_scope as string) === "chain" && store.chain_id)
    ? "chain" : "store";
  const scope_id   = scope_type === "chain" ? (store.chain_id as string) : store_id;

  const pointsMap: Record<string, number> = {
    survey: (store.point_rule_survey as number) ?? 1,
    sns:    (store.point_rule_sns    as number) ?? 2,
    google: (store.point_rule_google as number) ?? 3,
    visit:  (store.point_rule_visit  as number) ?? 1,
  };
  const points_delta = (points_override != null && points_override > 0) ? points_override : (pointsMap[action_type] ?? 1);

  // 配布枚数/付与ポイントが 0（クーポンウォレットで「このタイミングは配布なし」設定など）の場合は
  // 0行挿入・日次枠消費・誤通知を避けて即終了する
  if (action_type !== "visit" && points_delta <= 0) {
    return json({ ok: true, skipped: true, reason: "zero_points" }, 200, origin);
  }

  // ── ID 解決 ───────────────────────────────────────────────────
  const phone_hash = phone_raw ? await hashPhone(phone_raw) : null;
  const identity_id = await resolveIdentity({ line_user_id, phone_hash, anon_id, first_store_id: store_id });

  if (!identity_id) {
    return json({ error: "IDENTITY_RESOLUTION_FAILED" }, 500, origin);
  }

  // ── 来店ポイント: 2回目以降のみ付与 ──────────────────────────
  // 初回来店（アンケート完了時）はポイントなし。2回目から付与。
  if (action_type === "visit") {
    const { count: visitTotal } = await db
      .from("customer_points_ledger")
      .select("id", { count: "exact", head: true })
      .eq("identity_id", identity_id)
      .eq("action_type", "visit");
    if ((visitTotal ?? 0) === 0) {
      // 初回来店: レジャーには記録しないが、初回フラグをレスポンスに含める
      return json({ ok: true, skipped: true, reason: "first_visit_no_points", first_visit: true }, 200, origin);
    }
  }

  // ── 重複チェック（source_ref）────────────────────────────────
  if (source_ref) {
    const { data: dup } = await db
      .from("customer_points_ledger")
      .select("id")
      .eq("identity_id", identity_id)
      .eq("action_type", action_type)
      .eq("source_ref", source_ref)
      .maybeSingle();
    if (dup) return json({ ok: true, skipped: true, reason: "duplicate_source_ref" }, 200, origin);
  }

  // ── 1日上限チェック（visit/survey/google: 1回 / その他: 3回）日本時間(JST)基準 ────────────────
  // test_mode === true の店舗はスキップ。google は claim_google_bonus 直挿入パスと揃えて 1回/日(JST)。
  if ((store as Record<string, unknown>).test_mode !== true) {
    const dailyLimit = (action_type === "visit" || action_type === "survey" || action_type === "google") ? 1 : 3;
    // JST の本日0:00（UTCではなく日本時間で日付を区切る）
    const _jstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayStart = new Date(`${_jstDate}T00:00:00+09:00`);
    const { count: todayCount } = await db
      .from("customer_points_ledger")
      .select("id", { count: "exact", head: true })
      .eq("identity_id", identity_id)
      .eq("action_type", action_type)
      .gte("created_at", todayStart.toISOString());
    if ((todayCount ?? 0) >= dailyLimit) {
      return json({ ok: false, error: "DAILY_LIMIT_EXCEEDED", message: `1日${dailyLimit}回の上限に達しています` }, 429, origin);
    }
  }

  // ── 種別(tier_key)判定: クーポンウォレットの種別別残高用 ──────────
  // action_type から trigger を導出（google→review, survey→survey, 他はそのまま）。
  // その trigger のクーポンが店舗に未定義なら先頭クーポンへ寄せる（付与分を失わせない）。
  const _derivedTrigger = action_type === "google" ? "review"
    : action_type === "survey" ? "survey" : action_type;
  const _tiers = Array.isArray((store as Record<string, unknown>).coupon_tiers)
    ? ((store as Record<string, unknown>).coupon_tiers as Array<{ trigger?: string }>)
    : [];
  const _triggers = _tiers.map((t) => String(t?.trigger ?? "")).filter(Boolean);
  const tier_key = _tiers.length > 0
    ? (_triggers.includes(_derivedTrigger) ? _derivedTrigger : (_triggers[0] || _derivedTrigger))
    : _derivedTrigger;

  // ── レジャーへ記録 ────────────────────────────────────────────
  const { error: ledgerErr } = await db.from("customer_points_ledger").insert({
    identity_id,
    store_id,
    chain_id:    store.chain_id ?? null,
    scope_type,
    scope_id,
    action_type,
    points_delta,
    source_ref:  source_ref ?? null,
    tier_key,
    metadata:    {},
  });

  if (ledgerErr) {
    console.error("[add-loyalty-point] ledger insert error:", ledgerErr);
    return json({ error: "LEDGER_INSERT_FAILED", detail: ledgerErr.message }, 500, origin);
  }

  // ── ウォレット更新（ledger + redemption から再集計。wallet は競合で乖離するため使わない）
  const [{ data: ledgerRows }, { data: redeemRows }] = await Promise.all([
    db.from("customer_points_ledger").select("points_delta")
      .eq("identity_id", identity_id).eq("scope_type", scope_type).eq("scope_id", scope_id).gt("points_delta", 0),
    db.from("points_redemption").select("spent_points")
      .eq("identity_id", identity_id).eq("scope_type", scope_type).eq("scope_id", scope_id)
      .eq("status", "used").gt("spent_points", 0),
  ]);

  const new_total   = (ledgerRows ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.points_delta ?? 0), 0);
  const total_spent = (redeemRows ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.spent_points ?? 0), 0);
  // 閾値判定用: 今回のポイント付与前の累計（reward check で使用）
  const old_total   = new_total - points_delta;

  const walletPayload = {
    total_earned: new_total,
    total_spent,
    balance: Math.max(0, new_total - total_spent),
    updated_at: new Date().toISOString(),
  };

  const { data: walletExists } = await db
    .from("customer_points_wallet")
    .select("identity_id")
    .eq("identity_id", identity_id).eq("scope_type", scope_type).eq("scope_id", scope_id)
    .maybeSingle();

  if (walletExists) {
    await db.from("customer_points_wallet")
      .update(walletPayload)
      .eq("identity_id", identity_id).eq("scope_type", scope_type).eq("scope_id", scope_id);
  } else {
    await db.from("customer_points_wallet").insert({ identity_id, scope_type, scope_id, ...walletPayload });
  }

  // ── 特典チェック（閾値を新たに超えた store_point_rewards を検出）
  const { data: rewards } = await db
    .from("store_point_rewards")
    .select("id, reward_type, reward_title, reward_detail, required_points")
    .eq("store_id", store_id)
    .eq("is_active", true)
    .gt("required_points", old_total)
    .lte("required_points", new_total)
    .order("required_points", { ascending: true });

  const issuedRewards: Array<{ title: string; detail: string; code: string | null }> = [];

  for (const reward of rewards ?? []) {
    // 既付与チェック
    const { data: already } = await db
      .from("points_redemption")
      .select("id")
      .eq("identity_id", identity_id)
      .eq("reward_id", reward.id)
      .maybeSingle();
    if (already) continue;

    // OTP コード生成（店舗設定による）
    const issued_code = (store.otp_required_on_redeem as boolean)
      ? Math.random().toString(36).substring(2, 8).toUpperCase()
      : null;

    await db.from("points_redemption").insert({
      identity_id,
      store_id,
      reward_id:    reward.id,
      scope_type,
      scope_id,
      spent_points: 0,
      status:       "issued",
      issued_code,
      metadata:     {},
    });

    issuedRewards.push({
      title:  reward.reward_title  as string,
      detail: reward.reward_detail as string,
      code:   issued_code,
    });
  }

  // ── LINE Push ────────────────────────────────────────────────
  const channelToken = ((lineCredsAlp?.line_channel_access_token as string | null)?.trim())
    || ((store.line_channel_access_token as string | null)?.trim())
    || null;
  const storeName    = (store.store_name_jp as string) ?? "お店";

  const isCouponWalletMode = (store.coupon_wallet_enabled as boolean) === true;

  if (line_user_id && channelToken) {
    // action_type=google（口コミ投稿→生成画面復帰）の通知は form-engine の claim_google_bonus に一元化しているため、ここでは送らない（二重送信防止）
    if (isCouponWalletMode && points_delta > 0 && action_type !== "google") {
      // クーポンウォレットモード: 取得クーポンと有効期限を通知
      const tiers = Array.isArray(store.coupon_tiers)
        ? (store.coupon_tiers as { name?: string; trigger?: string; usage_conditions?: string }[])
        : [];
      const tierTrigger = action_type === "google" ? "review" : action_type;
      const matchedTier = tiers.find((t) => t.trigger === tierTrigger) ?? tiers[0];
      const couponName  = matchedTier?.name?.trim() || "クーポン";
      const usageCond   = matchedTier?.usage_conditions?.trim() || "";
      const expiryDays  = Number((store as Record<string, unknown>).point_expiry_days ?? 0);

      let msg = `🎁 クーポンをGETしました！\n${storeName}\n\n【${couponName}】`;
      if (usageCond) msg += `\n${usageCond}`;
      if (expiryDays > 0) {
        const exp = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
        msg += `\n\n有効期限：${exp.getFullYear()}年${exp.getMonth() + 1}月${exp.getDate()}日まで`;
      }
      msg += `\n\nご来店時に生成画面のURLからクーポンをお見せください。`;
      linePush(line_user_id, channelToken, msg).catch(console.error);

    } else if (!isCouponWalletMode && issuedRewards.length > 0) {
      // ポイントモード: 閾値到達時の特典通知
      let rewardMsg = `🎁【特典のお知らせ】${storeName}\n\n`;
      for (const r of issuedRewards) {
        rewardMsg += `■ ${r.title}\n${r.detail}\n`;
        if (r.code) rewardMsg += `認証コード: ${r.code}\n`;
        rewardMsg += "\n";
      }
      rewardMsg += `現在の累計ポイント: ${new_total}P\n`;
      rewardMsg += `次回ご来店時にスタッフにご提示ください。`;
      linePush(line_user_id, channelToken, rewardMsg).catch(console.error);
    }
  }

  return json({
    ok:             true,
    identity_id,
    points_awarded: points_delta,
    total_points:   new_total,
    issued_rewards: issuedRewards.length > 0 ? issuedRewards : undefined,
  }, 200, origin);
});
