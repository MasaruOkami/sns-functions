// supabase/functions/story-availability-preview/_shared/guard.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type GuardResult = {
  user: { id: string; email?: string | null };
  storeId: string;
  role?: string | null;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export function createSupabaseClients(req: Request) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";

  // ユーザーJWT（RLS有効）
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // service role（RLSバイパス）
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  return { supabaseUser, supabaseAdmin };
}

export async function requireAuthPasswordOkAndStoreRole(
  req: Request,
  opts?: { storeId?: string; allowRoles?: string[] },
): Promise<GuardResult> {
  const { supabaseUser, supabaseAdmin } = createSupabaseClients(req);

  // 1) 認証
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    throw json(401, { error: "UNAUTHORIZED", message: "Login required." });
  }

  // 2) store_id（query -> body）
  let storeId = opts?.storeId;
  if (!storeId) {
    const url = new URL(req.url);
    storeId = url.searchParams.get("store_id") ?? undefined;
  }
  if (!storeId) {
    if (req.headers.get("Content-Type")?.includes("application/json")) {
      const body = await req.clone().json().catch(() => ({}));
      storeId = body?.store_id ?? body?.storeId ?? undefined;
    }
  }
  if (!storeId) {
    throw json(400, { error: "BAD_REQUEST", message: "store_id is required." });
  }

  // 3) PW期限チェック
  const { data: sec, error: secErr } = await supabaseAdmin
    .from("user_security")
    .select("password_expires_at, require_password_reset")
    .eq("user_id", user.id)
    .maybeSingle();

  if (secErr || !sec) {
    throw json(403, { error: "SECURITY_STATE_MISSING", message: "Security state missing." });
  }
  if (sec.require_password_reset) {
    throw json(403, { error: "PASSWORD_RESET_REQUIRED", message: "Password reset required." });
  }

  const expiresAt = new Date(sec.password_expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw json(403, { error: "PASSWORD_EXPIRED", message: "Password expired." });
  }

  // 4) 店舗権限
  const { data: roleRow, error: roleErr } = await supabaseAdmin
    .from("user_store_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (roleErr || !roleRow) {
    throw json(403, { error: "FORBIDDEN", message: "No access to this store." });
  }

  // 5) 役割制限
  if (opts?.allowRoles?.length) {
    if (!opts.allowRoles.includes(roleRow.role)) {
      throw json(403, { error: "FORBIDDEN_ROLE", message: "Insufficient role." });
    }
  }

  return { user: { id: user.id, email: user.email }, storeId, role: roleRow.role };
}
