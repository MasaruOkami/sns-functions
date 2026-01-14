// supabase/functions/sns-p-plan-restore/_shared/guard.ts
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-password",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function error(message: string, status = 400, extra: any = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function env(name: string, fallback?: string) {
  const v = Deno.env.get(name);
  if (v == null || v === "") return fallback;
  return v;
}

/**
 * - Authorization Bearer JWT を必須にする
 * - Supabase Auth で user を検証して userId を返す
 * - （任意）x-auth-password チェックしたい場合はここに追加
 */
export async function requireAuthedUser(req: Request): Promise<{ userId: string }> {
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const jwt = m?.[1];
  if (!jwt) {
    return Promise.reject(error("Missing Authorization Bearer token", 401));
  }

  const SUPABASE_URL = env("SUPABASE_URL");
  // anon key で OK（ユーザーJWT検証用途）
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return Promise.reject(error("Missing SUPABASE_URL / SUPABASE_ANON_KEY", 500));
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data, error: uerr } = await supabase.auth.getUser();
  if (uerr || !data?.user?.id) {
    return Promise.reject(error("Invalid token", 401, { detail: uerr?.message ?? null }));
  }

  return { userId: data.user.id };
}
