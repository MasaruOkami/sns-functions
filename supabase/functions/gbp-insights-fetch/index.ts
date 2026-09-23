// supabase/functions/gbp-insights-fetch/index.ts
// Fetches daily metrics from Google Business Profile Performance API.
// Two modes:
//   - Cron / worker: x-worker-secret header → fetch all connected stores
//   - User: JWT auth → fetch specific store_id
//
// 本番(oahnmyfalnhdkoihrswh)のデプロイ実体をそのまま土台にしている。
// 変更は「鍵の取得を ./_shared/keys.ts 経由にした」ことだけ。
// CORS（x-worker-secret を含む許可ヘッダ・Max-Age 無し）とガードは本番と同一。
import { serve } from "https://deno.land/std/http/server.ts";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";
import { adminClient } from "./_shared/keys.ts";

const GOOGLE_CLIENT_ID      = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET  = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const SNS_WORKER_SECRET     = Deno.env.get("SNS_WORKER_SECRET") ?? "";

const supabaseAdmin = adminClient("gbp-insights-fetch");

const GBP_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "DIRECTION_REQUESTS",
  "WEBSITE_CLICKS",
] as const;

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-store-id, x-worker-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

// ── Token refresh ─────────────────────────────────────────────────
async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) return null;
  return data;
}

// ── Fetch insights for one store ──────────────────────────────────
async function fetchInsightsForStore(tokenRow: {
  store_id: string;
  location_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}): Promise<{ inserted: number; error?: string }> {
  let accessToken = tokenRow.access_token;

  // Refresh token if expired (with 60 s buffer)
  if (new Date(tokenRow.expires_at).getTime() - 60_000 <= Date.now()) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    if (!refreshed) return { inserted: 0, error: "token_refresh_failed" };
    accessToken = refreshed.access_token;
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("gbp_tokens")
      .update({ access_token: accessToken, expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq("store_id", tokenRow.store_id);
  }

  // Derive Performance API resource name from full location name
  // "accounts/123/locations/456" → "locations/456"
  const parts = tokenRow.location_name.split("/");
  const locationResourceName =
    parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : tokenRow.location_name;

  // Date range: yesterday − 90 days
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 91);

  const params = new URLSearchParams({
    "dailyRange.startDate.year":  String(startDate.getFullYear()),
    "dailyRange.startDate.month": String(startDate.getMonth() + 1),
    "dailyRange.startDate.day":   String(startDate.getDate()),
    "dailyRange.endDate.year":    String(endDate.getFullYear()),
    "dailyRange.endDate.month":   String(endDate.getMonth() + 1),
    "dailyRange.endDate.day":     String(endDate.getDate()),
  });
  for (const m of GBP_METRICS) params.append("dailyMetrics", m);

  const apiUrl =
    `https://businessprofileperformance.googleapis.com/v1/${locationResourceName}/dailyMetrics:batchGet?${params}`;

  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    return { inserted: 0, error: `api_error:${res.status} ${errText.slice(0, 200)}` };
  }

  const data = await res.json();

  // Pivot: { dateStr → { metricKey → value } }
  const byDate: Record<string, Record<string, number>> = {};

  for (const series of (data.multiDailyMetricTimeSeries ?? [])) {
    const metricKey = series.dailyMetric as string;
    for (const dv of (series.timeSeries?.datedValues ?? [])) {
      const { year, month, day } = dv.date ?? {};
      if (!year) continue;
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (!byDate[dateStr]) byDate[dateStr] = {};
      byDate[dateStr][metricKey] = parseInt(dv.value ?? "0", 10);
    }
  }

  if (Object.keys(byDate).length === 0) return { inserted: 0 };

  const rows = Object.entries(byDate).map(([date, m]) => ({
    store_id:                   tokenRow.store_id,
    date,
    impressions_maps_desktop:   m["BUSINESS_IMPRESSIONS_DESKTOP_MAPS"]   ?? null,
    impressions_maps_mobile:    m["BUSINESS_IMPRESSIONS_MOBILE_MAPS"]    ?? null,
    impressions_search_desktop: m["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"] ?? null,
    impressions_search_mobile:  m["BUSINESS_IMPRESSIONS_MOBILE_SEARCH"]  ?? null,
    call_clicks:                m["CALL_CLICKS"]        ?? null,
    direction_requests:         m["DIRECTION_REQUESTS"] ?? null,
    website_clicks:             m["WEBSITE_CLICKS"]     ?? null,
    fetched_at:                 new Date().toISOString(),
  }));

  const { error: upsertErr } = await supabaseAdmin
    .from("gbp_insights")
    .upsert(rows, { onConflict: "store_id,date" });

  if (upsertErr) return { inserted: 0, error: upsertErr.message };
  return { inserted: rows.length };
}

// ── Main handler ──────────────────────────────────────────────────
serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  }

  // ── Mode: worker (cron) ─────────────────────────────────────────
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret) {
    if (!SNS_WORKER_SECRET || workerSecret !== SNS_WORKER_SECRET) {
      return json({ error: "FORBIDDEN" }, 403, origin);
    }

    // Fetch all stores with connected tokens
    const { data: tokens, error: tokErr } = await supabaseAdmin
      .from("gbp_tokens")
      .select("store_id, location_name, access_token, refresh_token, expires_at")
      .not("location_name", "is", null);

    if (tokErr || !tokens?.length) {
      return json({ ok: true, message: "no connected stores", stores: 0 }, 200, origin);
    }

    const results: Record<string, unknown> = {};
    for (const tok of tokens) {
      results[tok.store_id] = await fetchInsightsForStore(tok);
    }

    return json({ ok: true, stores: tokens.length, results }, 200, origin);
  }

  // ── Mode: user (manual refresh) ─────────────────────────────────
  const g = await requireAuthPasswordOkAndStoreRole(req, {
    allowRoles: ["admin", "editor"],
  }).catch((res) => res as Response);
  if (g instanceof Response) return g;
  const { storeId } = g;

  const { data: tok, error: tokErr } = await supabaseAdmin
    .from("gbp_tokens")
    .select("store_id, location_name, access_token, refresh_token, expires_at")
    .eq("store_id", storeId)
    .maybeSingle();

  if (tokErr || !tok) {
    return json({ error: "NOT_CONNECTED", message: "GBP not connected for this store" }, 422, origin);
  }
  if (!tok.location_name) {
    return json({ error: "LOCATION_UNKNOWN", message: "Location name not set. Reconnect to auto-discover." }, 422, origin);
  }

  const result = await fetchInsightsForStore(tok);
  return json({ ok: true, ...result }, 200, origin);
});
