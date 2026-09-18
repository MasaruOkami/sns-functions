// supabase/functions/gbp-oauth-callback/index.ts
// Exchanges Google OAuth code for tokens, discovers account/location,
// saves credentials to gbp_tokens.
import { requireAuthPasswordOkAndStoreRole } from "../_shared/guard.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/keys.ts";

const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const supabaseAdmin = adminClient("gbp-oauth-callback");

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  }

  // ── 1. Auth guard ────────────────────────────────────────────────
  const g = await requireAuthPasswordOkAndStoreRole(req, {
    allowRoles: ["admin", "editor"],
  }).catch((res) => res as Response);
  if (g instanceof Response) return g;
  const { storeId } = g;

  // ── 2. Parse body ────────────────────────────────────────────────
  let body: { code?: string; redirect_uri?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400, origin);
  }
  const { code, redirect_uri } = body;
  if (!code || !redirect_uri) {
    return json({ error: "MISSING_PARAMS", message: "code and redirect_uri are required" }, 400, origin);
  }

  // ── 3. Exchange code for tokens ──────────────────────────────────
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return json(
      { error: "TOKEN_EXCHANGE_FAILED", detail: tokenData },
      400,
      origin,
    );
  }

  const {
    access_token,
    refresh_token,
    expires_in = 3600,
  } = tokenData as { access_token: string; refresh_token: string; expires_in: number };

  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  // ── 4. Discover account name ─────────────────────────────────────
  let accountName: string | null = null;
  let locationName: string | null = null;
  let locationDisplayName: string | null = null;

  try {
    const acctRes = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (acctRes.ok) {
      const acctData = await acctRes.json();
      const firstAccount = acctData.accounts?.[0];
      if (firstAccount?.name) {
        accountName = firstAccount.name; // "accounts/1234567890"

        // ── 5. Discover first location ──────────────────────────────
        const locRes = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`,
          { headers: { Authorization: `Bearer ${access_token}` } },
        );
        if (locRes.ok) {
          const locData = await locRes.json();
          const firstLoc = locData.locations?.[0];
          if (firstLoc) {
            locationName = firstLoc.name;         // "accounts/123/locations/456"
            locationDisplayName = firstLoc.title ?? null;
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal: save tokens even if account discovery fails
    console.warn("Account discovery failed:", e);
  }

  // ── 6. Upsert to gbp_tokens ──────────────────────────────────────
  const { error: upsertErr } = await supabaseAdmin
    .from("gbp_tokens")
    .upsert(
      {
        store_id: storeId,
        account_name: accountName,
        location_name: locationName,
        location_display_name: locationDisplayName,
        access_token,
        refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );

  if (upsertErr) {
    return json({ error: "DB_ERROR", message: upsertErr.message }, 500, origin);
  }

  return json({
    ok: true,
    store_id: storeId,
    account_name: accountName,
    location_name: locationName,
    location_display_name: locationDisplayName,
  }, 200, origin);
});
