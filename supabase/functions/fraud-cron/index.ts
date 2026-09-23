/**
 * fraud-cron
 * pg_cron から毎朝 9:00 JST (0:00 UTC) に呼び出される。
 * 全店舗の不正利用を検知して okami@pm-company.net にメール通知する。
 */

import { adminClient } from "../_shared/keys.ts";

const SNS_WORKER_SECRET         = Deno.env.get("SNS_WORKER_SECRET") ?? "";
const SENDGRID_API_KEY          = Deno.env.get("SENDGRID_API_KEY") ?? "";
const ALERT_TO                  = "okami@pm-company.net";
const ALERT_FROM                = Deno.env.get("ALERT_FROM_EMAIL") ?? Deno.env.get("APPROVAL_EMAIL_FROM") ?? "noreply@pm-company.net";

const db = adminClient("fraud-cron");

// ── 型定義 ────────────────────────────────────────────────────────────────────

type FraudReason = {
  code:     string;
  label:    string;
  detail:   string;
  severity: "high" | "medium" | "low";
};

type FraudUser = {
  identity_id:   string;
  display_label: string;
  total_earned:  number;
  fraud_score:   number; // 1=low 2=medium 3=high
  reasons:       FraudReason[];
  store_id:      string;
  store_name:    string;
};

// ── 不正検知ロジック ──────────────────────────────────────────────────────────

async function detectFraud(storeId: string): Promise<FraudUser[]> {
  // 店舗スコープ
  const { data: stRaw } = await db.from("store_profiles")
    .select("points_scope, chain_id").eq("store_id", storeId).maybeSingle();
  const st = stRaw as Record<string, unknown> | null;
  const scopeType = (st?.points_scope as string) === "chain" && st?.chain_id ? "chain" : "store";
  const scopeId   = scopeType === "chain" ? String(st!.chain_id) : storeId;

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();

  // survey 履歴（30日）
  const { data: surveyLedger } = await db
    .from("customer_points_ledger")
    .select("identity_id, created_at")
    .eq("store_id", storeId)
    .eq("action_type", "survey")
    .gte("created_at", since30d);

  // ウォレット
  const { data: allWallets } = await db
    .from("customer_points_wallet")
    .select("identity_id, total_earned")
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .order("total_earned", { ascending: false })
    .limit(500);

  // identity 一覧
  const relevantIds = [...new Set([
    ...(surveyLedger ?? []).map((r: Record<string, unknown>) => r.identity_id as string),
    ...(allWallets   ?? []).map((w: Record<string, unknown>) => w.identity_id as string),
  ])].slice(0, 500);

  const { data: allIdentities } = relevantIds.length > 0
    ? await db.from("customer_identity").select("id, line_user_id, anon_id").in("id", relevantIds)
    : { data: [] };

  // ── シグナル計算 ──────────────────────────────────────────────────────────
  const fraudMap: Record<string, FraudReason[]> = {};
  const addReason = (id: string, r: FraudReason) => {
    if (!fraudMap[id]) fraudMap[id] = [];
    if (!fraudMap[id].find((x) => x.code === r.code)) fraudMap[id].push(r);
  };

  // Signal 1: 1日に複数 survey
  const surveyByDay: Record<string, Record<string, number>> = {};
  for (const row of (surveyLedger ?? []) as Array<{ identity_id: string; created_at: string }>) {
    const jstDate = new Date(new Date(row.created_at).getTime() + 9 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    if (!surveyByDay[row.identity_id]) surveyByDay[row.identity_id] = {};
    surveyByDay[row.identity_id][jstDate] = (surveyByDay[row.identity_id][jstDate] ?? 0) + 1;
  }
  for (const [id, days] of Object.entries(surveyByDay)) {
    const multi = Object.entries(days).filter(([, cnt]) => cnt > 1);
    if (multi.length > 0) {
      addReason(id, {
        code: "multi_survey_per_day",
        label: "1日複数回アンケート",
        detail: multi.map(([d, cnt]) => `${d}: ${cnt}回`).join("、"),
        severity: "high",
      });
    }
  }

  // Signal 2: 7日間で3回以上 survey
  const survey7d: Record<string, number> = {};
  for (const row of (surveyLedger ?? []) as Array<{ identity_id: string; created_at: string }>) {
    if (row.created_at >= since7d) {
      survey7d[row.identity_id] = (survey7d[row.identity_id] ?? 0) + 1;
    }
  }
  for (const [id, cnt] of Object.entries(survey7d)) {
    if (cnt >= 3) {
      addReason(id, {
        code: "high_survey_frequency",
        label: "7日間で頻繁なアンケート",
        detail: `直近7日間で${cnt}回回答`,
        severity: cnt >= 5 ? "high" : "medium",
      });
    }
  }

  // Signal 3: 深夜・早朝送信（JST 0〜9時）
  for (const row of (surveyLedger ?? []) as Array<{ identity_id: string; created_at: string }>) {
    const jstHour = (new Date(row.created_at).getUTCHours() + 9) % 24;
    if (jstHour < 9) {
      addReason(row.identity_id, {
        code: "odd_hours",
        label: "営業時間外の送信",
        detail: `深夜〜早朝（JST ${jstHour}時台）に送信`,
        severity: "medium",
      });
    }
  }

  // Signal 4: 同一 anon_id が複数 identity に紐づく
  const anonToIds: Record<string, string[]> = {};
  for (const ident of (allIdentities ?? []) as Array<{ id: string; anon_id: string | null }>) {
    if (ident.anon_id) {
      if (!anonToIds[ident.anon_id]) anonToIds[ident.anon_id] = [];
      anonToIds[ident.anon_id].push(ident.id);
    }
  }
  for (const ids of Object.values(anonToIds)) {
    if (ids.length > 1) {
      for (const id of ids) {
        addReason(id, {
          code: "shared_device",
          label: "同一デバイスで複数アカウント",
          detail: `同じデバイスから${ids.length}つのアカウント`,
          severity: "high",
        });
      }
    }
  }

  // Signal 5: 累計ポイントが平均の4倍超（かつ10P以上）
  const walletMap: Record<string, number> = {};
  let earnedSum = 0, earnedCount = 0;
  for (const w of (allWallets ?? []) as Array<{ identity_id: string; total_earned: number }>) {
    walletMap[w.identity_id] = Number(w.total_earned);
    earnedSum += Number(w.total_earned);
    earnedCount++;
  }
  const avgEarned = earnedCount > 1 ? earnedSum / earnedCount : 0;
  if (avgEarned > 0) {
    for (const [id, earned] of Object.entries(walletMap)) {
      if (earned > avgEarned * 4 && earned > 10) {
        addReason(id, {
          code: "high_earner_outlier",
          label: "累計ポイントが平均の4倍超",
          detail: `累計${earned}P（店舗平均${Math.round(avgEarned)}P）`,
          severity: "low",
        });
      }
    }
  }

  // ── レスポンス構築 ────────────────────────────────────────────────────────
  const identityLookup: Record<string, { line_user_id: string | null; anon_id: string | null }> = {};
  for (const ident of (allIdentities ?? []) as Array<{ id: string; line_user_id: string | null; anon_id: string | null }>) {
    identityLookup[ident.id] = ident;
  }

  return Object.entries(fraudMap)
    .map(([id, reasons]) => {
      const ident = identityLookup[id] ?? {};
      const lineId = (ident as Record<string, unknown>).line_user_id as string | null;
      const anonId = (ident as Record<string, unknown>).anon_id   as string | null;
      const label  = lineId
        ? "LINE:" + lineId.slice(0, 14) + "…"
        : anonId ? "匿名:" + anonId.slice(0, 14) + "…" : "不明";
      const score = Math.max(...reasons.map((r) =>
        r.severity === "high" ? 3 : r.severity === "medium" ? 2 : 1
      ));
      return {
        identity_id:   id,
        display_label: label,
        total_earned:  walletMap[id] ?? 0,
        fraud_score:   score,
        reasons,
        store_id:   storeId,
        store_name: "", // 呼び出し元で補完
      };
    })
    .sort((a, b) => b.fraud_score - a.fraud_score || b.total_earned - a.total_earned);
}

// ── メール送信（Resend）─────────────────────────────────────────────────────

function scoreLabel(score: number) {
  if (score === 3) return '<span style="color:#ef4444;font-weight:bold">🔴 高リスク</span>';
  if (score === 2) return '<span style="color:#f97316;font-weight:bold">🟠 中リスク</span>';
  return '<span style="color:#eab308;font-weight:bold">🟡 低リスク</span>';
}

function buildHtml(users: FraudUser[], date: string): string {
  const highCount   = users.filter((u) => u.fraud_score === 3).length;
  const mediumCount = users.filter((u) => u.fraud_score === 2).length;
  const lowCount    = users.filter((u) => u.fraud_score === 1).length;

  // 店舗ごとにグループ化
  const byStore: Record<string, FraudUser[]> = {};
  for (const u of users) {
    if (!byStore[u.store_name]) byStore[u.store_name] = [];
    byStore[u.store_name].push(u);
  }

  const storeBlocks = Object.entries(byStore).map(([storeName, storeUsers]) => {
    const rows = storeUsers.map((u) => {
      const bg = u.fraud_score === 3 ? "#fef2f2" : u.fraud_score === 2 ? "#fff7ed" : "#fefce8";
      const reasonList = u.reasons.map((r) =>
        `<li><strong>${r.label}</strong>：${r.detail}</li>`
      ).join("");
      return `
        <tr style="background:${bg}">
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">${scoreLabel(u.fraud_score)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px">${u.display_label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6366f1;font-weight:bold">${u.total_earned}P</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">
            <ul style="margin:0;padding-left:16px">${reasonList}</ul>
          </td>
        </tr>`;
    }).join("");

    return `
      <h3 style="margin:24px 0 8px;color:#374151">🏪 ${storeName}</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">リスク</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">ユーザーID</th>
            <th style="padding:8px 12px;text-align:right;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">累計P</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb">検知理由</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:720px;margin:0 auto;padding:24px">
  <div style="background:#ef4444;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0">
    <h1 style="margin:0;font-size:20px">🚨 不正利用アラート</h1>
    <p style="margin:4px 0 0;opacity:0.85;font-size:13px">${date}（JST 9:00 自動検知）</p>
  </div>

  <div style="background:#fef2f2;border:1px solid #fca5a5;border-top:none;padding:16px 24px;border-radius:0 0 12px 12px;margin-bottom:24px">
    <div style="display:flex;gap:24px">
      <div style="text-align:center">
        <div style="font-size:28px;font-weight:900;color:#ef4444">${highCount}</div>
        <div style="font-size:11px;color:#6b7280">🔴 高リスク</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:28px;font-weight:900;color:#f97316">${mediumCount}</div>
        <div style="font-size:11px;color:#6b7280">🟠 中リスク</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:28px;font-weight:900;color:#eab308">${lowCount}</div>
        <div style="font-size:11px;color:#6b7280">🟡 低リスク</div>
      </div>
    </div>
  </div>

  ${storeBlocks}

  <div style="margin-top:32px;padding:16px;background:#f9fafb;border-radius:8px;font-size:12px;color:#9ca3af;text-align:center">
    このメールは自動送信です。管理画面の「ロイヤルティ → 🚨 不正検知」タブで詳細を確認できます。
  </div>
</body>
</html>`;
}

async function sendEmail(users: FraudUser[]): Promise<void> {
  if (!SENDGRID_API_KEY) {
    console.warn("[fraud-cron] SENDGRID_API_KEY が未設定のためメール送信をスキップ");
    return;
  }

  const now = new Date();
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const highCount = users.filter((u) => u.fraud_score === 3).length;

  const subject = highCount > 0
    ? `[緊急] 不正利用アラート：高リスク${highCount}件を検出 ${jstDate}`
    : `[通知] 不正利用アラート：${users.length}件を検出 ${jstDate}`;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: ALERT_TO }],
        },
      ],
      from:    { email: ALERT_FROM, name: "ポイント不正検知システム" },
      subject,
      content: [{ type: "text/html", value: buildHtml(users, jstDate) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[fraud-cron] SendGrid エラー:", res.status, text);
  } else {
    console.log("[fraud-cron] メール送信完了:", subject);
  }
}

// ── メインハンドラ ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // pg_cron / 手動テスト用の認証
  if (req.headers.get("x-worker-secret") !== SNS_WORKER_SECRET) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }

  console.log("[fraud-cron] 開始");

  // 全店舗を取得
  const { data: stores, error: storesErr } = await db
    .from("store_profiles")
    .select("store_id, store_name_jp")
    .limit(200);

  if (storesErr || !stores) {
    console.error("[fraud-cron] 店舗一覧取得失敗:", storesErr?.message);
    return new Response(JSON.stringify({ ok: false, error: storesErr?.message }), { status: 500 });
  }

  const allFraudUsers: FraudUser[] = [];

  for (const store of stores) {
    try {
      const users = await detectFraud(store.store_id);
      for (const u of users) {
        allFraudUsers.push({
          ...u,
          store_name: (store.store_name_jp as string) ?? store.store_id,
        });
      }
    } catch (e) {
      console.error(`[fraud-cron] 店舗 ${store.store_id} の検知エラー:`, e);
    }
  }

  console.log(`[fraud-cron] 検知件数: ${allFraudUsers.length}`);

  if (allFraudUsers.length === 0) {
    console.log("[fraud-cron] 不審なユーザーなし。メール送信スキップ。");
    return new Response(JSON.stringify({ ok: true, sent: false, count: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await sendEmail(allFraudUsers);

  return new Response(
    JSON.stringify({ ok: true, sent: true, count: allFraudUsers.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
