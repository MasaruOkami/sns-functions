// supabase/functions/keyword-qc-report/index.ts
//
// 週次のキーワードQCレポートを SendGrid で送信する（pg_cron: 毎週日曜 2:00）。
//
// 【2026-08-22 修正】
//  - これまで verify_jwt=true のままだったため、pg_cron が Authorization ヘッダを付けずに
//    呼ぶとプラットフォーム層で 401 になり、**一度も送信できていなかった**。
//    verify_jwt=false（config.toml に明記）にし、認証は下記の x-cron-secret に一本化。
//  - 旧実装の認証は `if (KEYWORD_CRON_SECRET && ...)` という fail-open で、env 未設定時に
//    認証チェックごと消えていた。未設定なら 500 で閉じる fail-closed に変更。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient } from "../_shared/keys.ts";

// ===== 環境変数 =====
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") ?? "";
const KEYWORD_QC_FROM = Deno.env.get("KEYWORD_QC_FROM") ?? "";
const KEYWORD_QC_TO = Deno.env.get("KEYWORD_QC_TO") ?? "";
const KEYWORD_CRON_SECRET = Deno.env.get("KEYWORD_CRON_SECRET") ?? "";

const supabase = adminClient("keyword-qc-report");

// ===== HTTP ハンドラ =====
Deno.serve(async (req) => {
  try {
    // 認証（verify_jwt=false のため、ここが唯一の防御線。fail-closed）
    if (!KEYWORD_CRON_SECRET) {
      console.error("[keyword-qc-report] KEYWORD_CRON_SECRET is not configured — refusing all requests");
      return jsonResponse({ ok: false, error: "SERVER_MISCONFIG" }, 500);
    }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!headerSecret || headerSecret !== KEYWORD_CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // 設定状況の確認用（値は返さない）
    const url = new URL(req.url);
    if (url.searchParams.get("config") === "1") {
      return jsonResponse({
        sendgrid_configured: !!SENDGRID_API_KEY,
        from_configured: !!KEYWORD_QC_FROM,
        to_configured: !!KEYWORD_QC_TO,
      });
    }

    if (!SENDGRID_API_KEY || !KEYWORD_QC_FROM || !KEYWORD_QC_TO) {
      console.error("[keyword-qc-report] mail env missing", {
        sendgrid: !!SENDGRID_API_KEY, from: !!KEYWORD_QC_FROM, to: !!KEYWORD_QC_TO,
      });
      return jsonResponse({ ok: false, error: "MAIL_ENV_MISSING" }, 500);
    }

    // 1) 店舗別サマリ
    const { data: storeStats, error: storeErr } = await supabase
      .from("v_kw_qc_store_ratio_kemuriya")
      .select("*")
      .order("suspect_ratio_pct", { ascending: false });

    if (storeErr) {
      console.error("store ratio error", storeErr);
      throw new Error("failed to fetch store ratio");
    }

    // 2) 疑わしいキーワード一覧（重いようなら limit を調整）
    const { data: suspects, error: susErr } = await supabase
      .from("v_kw_qc_suspect_kemuriya")
      .select("*")
      .order("weight", { ascending: false })
      .limit(300);

    if (susErr) {
      console.error("suspect error", susErr);
      throw new Error("failed to fetch suspects");
    }

    // 3) HTML 本文生成
    const html = buildHtmlReport(storeStats ?? [], suspects ?? []);

    // 4) CSV 添付用データ生成
    const csvText = buildCsvSuspects(suspects ?? []);
    const csvBase64 = btoa(unescape(encodeURIComponent(csvText)));

    // 5) SendGrid 送信
    await sendMailWithSendgrid({
      from: KEYWORD_QC_FROM,
      to: KEYWORD_QC_TO,
      subject: "【週次】Kemuriyaグループ キーワードQCレポート",
      html,
      attachments: [
        {
          content: csvBase64,
          type: "text/csv",
          filename: "keyword_qc_suspects_kemuriya.csv",
        },
      ],
    });

    return jsonResponse({ ok: true, stores: (storeStats ?? []).length, suspects: (suspects ?? []).length });
  } catch (e) {
    console.error("keyword-qc-report error", e);
    return jsonResponse({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

// ===== HTML レポート生成 =====

function buildHtmlReport(storeStats: Record<string, unknown>[], suspects: Record<string, unknown>[]): string {
  const today = new Date().toISOString().slice(0, 10);

  const storeRows = storeStats
    .map((s) => {
      const ratio = s.suspect_ratio_pct != null ? `${s.suspect_ratio_pct}%` : "–";
      const mc = s.multi_canonical_count ?? 0;
      const wc = s.wide_canonical_count ?? 0;
      const mcat = s.multi_category_count ?? 0;

      return `
      <tr>
        <td>${escapeHtml(s.store_id)}</td>
        <td style="text-align:right;">${escapeHtml(s.total_keywords)}</td>
        <td style="text-align:right;">${escapeHtml(s.suspect_total)}</td>
        <td style="text-align:right;">${escapeHtml(ratio)}</td>
        <td style="text-align:right;">${escapeHtml(mc)}</td>
        <td style="text-align:right;">${escapeHtml(wc)}</td>
        <td style="text-align:right;">${escapeHtml(mcat)}</td>
        <td style="text-align:center;">${escapeHtml(s.volume_bucket)}</td>
      </tr>`;
    })
    .join("");

  const suspectRows = suspects
    .map((r) => {
      return `
      <tr>
        <td>${escapeHtml(r.issue_type)}</td>
        <td>${escapeHtml(r.store_id)}</td>
        <td>${escapeHtml(r.lemma ?? "")}</td>
        <td>${escapeHtml(r.canonical_key ?? "")}</td>
        <td>${escapeHtml(r.category_pred ?? "")}</td>
        <td style="text-align:right;">${escapeHtml(r.weight)}</td>
        <td>${escapeHtml(r.details ?? "")}</td>
      </tr>`;
    })
    .join("");

  return `
<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<title>Keyword QC Report</title>
</head>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; color:#222;">

<h2>キーワードQCレポート（Kemuriyaグループ）</h2>
<p>${today} 時点の集計結果です。</p>

<h3>1. 店舗別サマリ</h3>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
  <thead style="background:#f5f5f5;">
    <tr>
      <th>store_id</th>
      <th>総キーワード数</th>
      <th>QC候補数</th>
      <th>QC候補率(%)</th>
      <th>multi_canonical</th>
      <th>wide_canonical</th>
      <th>multi_category</th>
      <th>ボリューム</th>
    </tr>
  </thead>
  <tbody>
    ${storeRows || "<tr><td colspan=\"8\">データなし</td></tr>"}
  </tbody>
</table>
<p style="font-size:12px;color:#555;margin-top:4px;">
※ total_keywords &lt; 100 の店舗は割合(%)を表示していません。<br/>
※ ボリューム: L=1000件以上 / M=300〜999件 / S=100〜299件 / XS=100件未満
</p>

<h3>2. 要確認キーワード一覧（上位 ${suspects.length} 件）</h3>
<p style="font-size:13px;">
詳細な一覧は添付の CSV（<code>keyword_qc_suspects_kemuriya.csv</code>）も併せてご確認ください。
</p>

<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px;max-width:100%;">
  <thead style="background:#f5f5f5;">
    <tr>
      <th>issue_type</th>
      <th>store_id</th>
      <th>lemma</th>
      <th>canonical_key</th>
      <th>category_pred</th>
      <th>weight</th>
      <th>details</th>
    </tr>
  </thead>
  <tbody>
    ${suspectRows || "<tr><td colspan=\"7\">該当なし</td></tr>"}
  </tbody>
</table>

</body>
</html>
`;
}

// ===== CSV 生成 =====

function buildCsvSuspects(suspects: Record<string, unknown>[]): string {
  const header = [
    "issue_type",
    "store_id",
    "lemma",
    "canonical_key",
    "category_pred",
    "weight",
    "details",
  ].join(",");

  const rows = suspects.map((r) =>
    [
      r.issue_type ?? "",
      r.store_id ?? "",
      r.lemma ?? "",
      r.canonical_key ?? "",
      r.category_pred ?? "",
      r.weight ?? "",
      r.details ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );

  return [header, ...rows].join("\n");
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ===== SendGrid 送信 =====

async function sendMailWithSendgrid(params: {
  from: string;
  to: string; // カンマ区切りOK
  subject: string;
  html: string;
  attachments?: { content: string; type: string; filename: string }[];
}) {
  const toList = params.to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  const body = {
    personalizations: [{ to: toList }],
    from: { email: params.from },
    subject: params.subject,
    content: [{ type: "text/html", value: params.html }],
    attachments: params.attachments ?? [],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("SendGrid error", res.status, txt);
    throw new Error(`SendGrid error: ${res.status} ${txt.slice(0, 200)}`);
  }
}

// ===== 共通ユーティリティ =====

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
