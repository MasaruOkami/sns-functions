// supabase/functions/generate-media/_shared/guard.ts
// 鍵の解決は ./keys.ts に集約している（新方式 sb_secret_ への移行期間中、
// 新旧どちらの鍵でも動くようにするため）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, publishableKey, supabaseUrl } from "./keys.ts";

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
  const SUPABASE_URL = supabaseUrl()!;
  const SUPABASE_ANON_KEY = publishableKey()!;

  const authHeader = req.headers.get("Authorization") ?? "";

  // ユーザーJWT（RLS有効）
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // service role（RLSバイパス）
  const supabaseAdmin = adminClient("generate-media/guard");

  return { supabaseUser, supabaseAdmin };
}

export async function requireAuthPasswordOkAndStoreRole(
  req: Request,
  opts?: { storeId?: string; allowRoles?: string[] }
): Promise<GuardResult> {
  const { supabaseUser, supabaseAdmin } = createSupabaseClients(req);

  /* 1. 認証チェック */
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();

  const user = userData?.user;
  if (userErr || !user) {
    // throw Response で上位に catch される想定
    throw json(401, { error: "UNAUTHORIZED", message: "Login required" });
  }

  /* 2. store_id の取得（opts > query > json body） */
  let storeId = opts?.storeId;

  if (!storeId) {
    const url = new URL(req.url);
    storeId = url.searchParams.get("store_id") ?? undefined;
  }

  // JSON body から取得（req.clone() を使うので後段で req.json() は可能）
  if (!storeId && (req.headers.get("Content-Type") ?? "").includes("application/json")) {
    const body = await req.clone().json().catch(() => ({}));
    storeId = (body?.store_id ?? body?.storeId ?? undefined) as string | undefined;
  }

  if (!storeId) {
    throw json(400, { error: "BAD_REQUEST", message: "store_id is required" });
  }

  /* 3. パスワード期限チェック（user_security） */
  const { data: sec, error: secErr } = await supabaseAdmin
    .from("user_security")
    .select("password_expires_at, require_password_reset")
    .eq("user_id", user.id)
    .maybeSingle();

  if (secErr) {
    throw json(500, { error: "DB_ERROR", message: secErr.message });
  }

  if (!sec) {
    throw json(403, { error: "SECURITY_STATE_MISSING" });
  }

  if (sec.require_password_reset) {
    throw json(403, { error: "PASSWORD_RESET_REQUIRED" });
  }

  const expiresAt = new Date(sec.password_expires_at).getTime();
  if (!Number.isFinite(expiresAt)) {
    throw json(500, { error: "INVALID_PASSWORD_EXPIRES_AT", value: sec.password_expires_at });
  }

  if (expiresAt <= Date.now()) {
    throw json(403, {
      error: "PASSWORD_EXPIRED",
      password_expires_at: sec.password_expires_at,
    });
  }

  /* 4. store 権限チェック（user_store_roles） */
  const { data: roleRow, error: roleErr } = await supabaseAdmin
    .from("user_store_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (roleErr) {
    throw json(500, { error: "DB_ERROR", message: roleErr.message });
  }

  if (!roleRow) {
    throw json(403, { error: "FORBIDDEN", message: "No store access" });
  }

  /* 5. role 制限 */
  if (opts?.allowRoles?.length) {
    if (!opts.allowRoles.includes(roleRow.role)) {
      throw json(403, { error: "FORBIDDEN_ROLE", message: "Insufficient role" });
    }
  }

  return {
    user: { id: user.id, email: user.email },
    storeId,
    role: roleRow.role,
  };
}