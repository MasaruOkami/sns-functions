/**
 * grant-healthcheck
 *
 * 「結果」を見張る付与ヘルスチェック。原因（認証・DB・コード変更・外部API障害など）を問わず、
 * “アンケートに回答されたのに付与されていない” 状態を検出して通知する。
 *
 * 背景: 2026-08-11〜08-22、add-loyalty-point の verify_jwt ゲートと anon key 失効が重なり、
 *       全店で付与が11日間ゼロになったが、呼び出し側が失敗を握りつぶしていたため誰も気づけなかった。
 *       個別の原因を潰すのではなく、結果を監視することで未知の原因でも検知する。
 *
 * 呼び出し:
 *   POST ?config=1   … 通知チャネルの設定状況だけ返す（送信しない・値は返さない）
 *   POST ?dry_run=1  … 検査だけ実行し結果を返す（通知しない）
 *   POST             … 検査＋異常時に通知
 *
 * 認証: x-cron-secret ヘッダ（CRON_SECRET と一致）。未設定なら 500 で閉じる（fail-closed）。
 */
import { adminClient } from "../_shared/keys.ts";

// 専用シークレット（他機能と衝突しないよう独立した名前にする）
const CRON_SECRET = Deno.env.get("HEALTHCHECK_SECRET") ?? "";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") ?? "okami@pm-company.net";

// 利用可能なメール送信手段（設定されているものを使う）
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") ?? "";
const SENDGRID_FROM    = Deno.env.get("SENDGRID_FROM") ?? "";
const RESEND_FROM      = Deno.env.get("RESEND_FROM") ?? "";

// 検査条件
const LOOKBACK_HOURS = Number(Deno.env.get("HEALTHCHECK_LOOKBACK_HOURS") ?? 3); // 直近何時間を見るか
const GRACE_MINUTES  = Number(Deno.env.get("HEALTHCHECK_GRACE_MINUTES") ?? 20); // 付与完了までの猶予
const ALERT_THRESHOLD = Number(Deno.env.get("HEALTHCHECK_THRESHOLD") ?? 2);     // 何件で異常とみなすか

const db = adminClient("grant-healthcheck");

type Miss = { store_id: string; submission_id: string; created_at: string };

async function runCheck() {
  const now = Date.now();
  const since = new Date(now - LOOKBACK_HOURS * 3600_000).toISOString();
  const until = new Date(now - GRACE_MINUTES * 60_000).toISOString(); // 直近すぎるものは処理中の可能性があるので除外

  // 付与対象になるはずの店舗（クーポンウォレット or ポイント有効）
  const { data: stores, error: stErr } = await db
    .from("store_profiles")
    .select("store_id, coupon_wallet_enabled, points_enabled, coupon_low_score_enabled, score_threshold_high, point_rule_survey")
    .or("coupon_wallet_enabled.eq.true,points_enabled.eq.true");
  if (stErr) throw new Error(`store fetch: ${stErr.message}`);
  const storeMap = new Map((stores ?? []).map((s) => [s.store_id as string, s as Record<string, unknown>]));
  if (storeMap.size === 0) return { checked: 0, misses: [] as Miss[], reviews: 0 };

  // 対象期間のレビュー（LINE本人特定済み＝付与されるべきもの）
  const { data: reviews, error: rvErr } = await db
    .from("reviews")
    .select("submission_id, store_id, score, created_at, line_user_id")
    .gte("created_at", since)
    .lte("created_at", until)
    .not("line_user_id", "is", null)
    .in("store_id", [...storeMap.keys()]);
  if (rvErr) throw new Error(`review fetch: ${rvErr.message}`);

  const candidates = (reviews ?? []).filter((r) => {
    const st = storeMap.get(r.store_id as string)!;
    // 付与額0の設定なら対象外
    if (Number(st.point_rule_survey ?? 0) <= 0) return false;
    // 低評価は配布しない設定の店舗は対象外（本来付与されないため）
    if (st.coupon_wallet_enabled === true && st.coupon_low_score_enabled === false
        && Number(r.score ?? 0) < Number(st.score_threshold_high ?? 3)) return false;
    return true;
  });
  if (candidates.length === 0) return { checked: 0, misses: [] as Miss[], reviews: (reviews ?? []).length };

  // 付与済みの source_ref を引く
  const sids = candidates.map((r) => r.submission_id as string).filter(Boolean);
  const { data: granted, error: gErr } = await db
    .from("customer_points_ledger")
    .select("source_ref")
    .in("source_ref", sids);
  if (gErr) throw new Error(`ledger fetch: ${gErr.message}`);
  const grantedSet = new Set((granted ?? []).map((g) => g.source_ref as string));

  const misses: Miss[] = candidates
    .filter((r) => !grantedSet.has(r.submission_id as string))
    .map((r) => ({ store_id: r.store_id as string, submission_id: r.submission_id as string, created_at: r.created_at as string }));

  return { checked: candidates.length, misses, reviews: (reviews ?? []).length };
}

async function sendEmail(subject: string, body: string): Promise<{ ok: boolean; via: string; detail?: string }> {
  if (RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: RESEND_FROM || "alert@resend.dev", to: [ALERT_EMAIL], subject, text: body }),
    }).catch(() => null);
    if (r && r.ok) return { ok: true, via: "resend" };
    return { ok: false, via: "resend", detail: r ? (await r.text().catch(() => "")).slice(0, 200) : "network" };
  }
  if (SENDGRID_API_KEY) {
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SENDGRID_API_KEY}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
        from: { email: SENDGRID_FROM || "no-reply@pm-company.net" },
        subject,
        content: [{ type: "text/plain", value: body }],
      }),
    }).catch(() => null);
    if (r && (r.ok || r.status === 202)) return { ok: true, via: "sendgrid" };
    return { ok: false, via: "sendgrid", detail: r ? (await r.text().catch(() => "")).slice(0, 200) : "network" };
  }
  return { ok: false, via: "none", detail: "no email provider configured (RESEND_API_KEY / SENDGRID_API_KEY)" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!CRON_SECRET) {
    return new Response(JSON.stringify({ error: "SERVER_MISCONFIG", detail: "CRON_SECRET unset" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!got || got !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

  // 通知チャネルの設定状況だけ返す（値は返さない）
  if (url.searchParams.get("config") === "1") {
    return json({
      alert_email: ALERT_EMAIL,
      resend_configured: !!RESEND_API_KEY,
      sendgrid_configured: !!SENDGRID_API_KEY,
      sendgrid_from_configured: !!SENDGRID_FROM,
      resend_from_configured: !!RESEND_FROM,
      settings: { LOOKBACK_HOURS, GRACE_MINUTES, ALERT_THRESHOLD },
    });
  }

  // 疎通確認用のテスト送信
  if (url.searchParams.get("test_email") === "1") {
    const sent = await sendEmail(
      "【レポミール】付与ヘルスチェックのテスト送信",
      "これは付与ヘルスチェックの疎通確認メールです。\nこのメールが届いていれば、付与が止まった際に自動で通知が届きます。",
    );
    return json({ test_email: true, notified: sent });
  }

  let result;
  try { result = await runCheck(); }
  catch (e) {
    // 検査自体が失敗した場合も異常として通知する
    const msg = `付与ヘルスチェックの実行に失敗しました。\n\n${String((e as Error).message)}`;
    const sent = url.searchParams.get("dry_run") === "1" ? { ok: false, via: "dry_run" } : await sendEmail("【レポミール】付与ヘルスチェック実行エラー", msg);
    return json({ ok: false, error: String((e as Error).message), notified: sent }, 500);
  }

  const abnormal = result.misses.length >= ALERT_THRESHOLD;
  const dryRun = url.searchParams.get("dry_run") === "1";

  if (!abnormal || dryRun) {
    return json({ ok: true, abnormal, dryRun, ...result });
  }

  // 店舗別に集計して通知
  const byStore = new Map<string, number>();
  for (const m of result.misses) byStore.set(m.store_id, (byStore.get(m.store_id) ?? 0) + 1);
  const lines = [...byStore.entries()].map(([s, n]) => `  ・${s}: ${n}件`).join("\n");
  const body =
`アンケートに回答されたのに、クーポン／ポイントが付与されていない回答を検出しました。

検出件数: ${result.misses.length}件（直近${LOOKBACK_HOURS}時間 / ${GRACE_MINUTES}分の猶予を除く）
対象となった回答: ${result.checked}件

店舗別:
${lines}

未付与の回答ID（最大20件）:
${result.misses.slice(0, 20).map((m) => `  ${m.submission_id} (${m.store_id}, ${m.created_at})`).join("\n")}

■ 確認手順
1. Supabase の Edge Function ログで "GRANT_FAILED" を検索し、失敗理由（HTTPステータス）を確認
2. add-loyalty-point の verify_jwt が false か確認（true だと全リクエストが401で弾かれる）
3. 直接疎通確認:
   curl -X POST https://oahnmyfalnhdkoihrswh.supabase.co/functions/v1/add-loyalty-point
   → 想定レスポンス {"error":"UNAUTHORIZED"}（{"code":"UNAUTHORIZED_NO_AUTH_HEADER"} ならゲートが復活している）

このメールは付与ヘルスチェック（1時間ごと）による自動通知です。`;

  const sent = await sendEmail(`【レポミール】付与されていない回答を${result.misses.length}件検出`, body);
  return json({ ok: true, abnormal, notified: sent, ...result });
});
