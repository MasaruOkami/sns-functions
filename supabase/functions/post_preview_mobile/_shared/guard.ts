// supabase/functions/post_preview_mobile/_shared/guard.ts
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

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const supabaseAdmin = adminClient("post_preview_mobile/guard");

  return { supabaseUser, supabaseAdmin };
}

export async function requireAuthPasswordOkAndStoreRole(
  req: Request,
  opts?: { storeId?: string; allowRoles?: string[] },
): Promise<GuardResult> {
  const { supabaseUser, supabaseAdmin } = createSupabaseClients(req);

  // 1) 認証
  const { data } = await supabaseUser.auth.getUser();
  const user = data?.user;
  if (!user) {
    throw json(401, { error: "UNAUTHORIZED" });
  }

  // 2) store_id（optsで必須）
  const storeId = opts?.storeId;
  if (!storeId) {
    throw json(400, { error: "store_id required" });
  }

  // 3) PW期限
  const { data: sec } = await supabaseAdmin
    .from("user_security")
    .select("password_expires_at, require_password_reset")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sec || sec.require_password_reset) {
    throw json(403, { error: "PASSWORD_RESET_REQUIRED" });
  }

  if (new Date(sec.password_expires_at).getTime() <= Date.now()) {
    throw json(403, { error: "PASSWORD_EXPIRED" });
  }

  // 4) store role
  const { data: roleRow } = await supabaseAdmin
    .from("user_store_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (!roleRow) {
    throw json(403, { error: "NO_STORE_ACCESS" });
  }

  // 5) role 制限
  if (opts?.allowRoles?.length) {
    if (!opts.allowRoles.includes(roleRow.role)) {
      throw json(403, { error: "FORBIDDEN_ROLE" });
    }
  }

  return {
    user: { id: user.id, email: user.email },
    storeId,
    role: roleRow.role,
  };
}
