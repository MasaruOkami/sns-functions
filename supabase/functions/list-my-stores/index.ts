import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, publishableKey, supabaseUrl } from "../_shared/keys.ts";

/**
 * CORS
 * - ローカル開発は localhost:3000/3001 が多いので許可
 * - 本番ドメインが決まっているなら、そのドメインだけに絞るのが安全
 */
const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",
  // "https://YOUR_PROD_DOMAIN.com",
]);

function corsHeaders(origin: string | null) {
  const o = origin && allowedOrigins.has(origin) ? origin : "*"; // 本番は "*" を避けて固定推奨
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });

serve(async (req) => {
  const origin = req.headers.get("Origin");

  // ✅ Preflight（これが無いとブラウザがブロック）
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" }, origin);

    const SUPABASE_URL = supabaseUrl()!;
    const SUPABASE_ANON_KEY = publishableKey()!;

    const authHeader = req.headers.get("Authorization") ?? "";

    // まずユーザーJWTで本人確認
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json(401, { error: "UNAUTHORIZED" }, origin);

    // 店舗一覧は service role で取得（RLSに依存しない）
    const supabaseAdmin = adminClient("list-my-stores");

    const { data, error } = await supabaseAdmin
      .from("user_store_roles")
      .select("store_id, role")
      .eq("user_id", user.id)
      .order("store_id", { ascending: true });

    if (error) return json(500, { error: "DB_ERROR", detail: error.message }, origin);

    return json(200, { user_id: user.id, stores: data ?? [] }, origin);
  } catch (e) {
    return json(500, { error: "INTERNAL_ERROR", detail: String(e) }, origin);
  }
});
