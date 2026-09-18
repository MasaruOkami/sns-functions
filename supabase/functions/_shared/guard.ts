// supabase/functions/_shared/guard.ts
// 鍵の解決は ./keys.ts に集約している（新方式 sb_secret_ への移行期間中、
// 新旧どちらの鍵でも動くようにするため）。
import {
  adminClient,
  authClient as makeAuthClient,
  publishableKey,
  serviceKey,
  supabaseUrl,
} from "./keys.ts";

type AllowRole = "viewer" | "editor" | "admin";

type GuardOk = {
  userId: string;
  storeId: string;
  role: AllowRole;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-password, x-worker-secret, x-store-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function textResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function safeReadJson(req: Request): Promise<any | null> {
  try {
    // body は一度しか読めないので clone()
    return await req.clone().json();
  } catch {
    return null;
  }
}

async function resolveStoreId(req: Request): Promise<string | null> {
  // 1) header 優先（推奨：フロントから x-store-id を送る）
  const h = req.headers.get("x-store-id");
  if (h && h.trim()) return h.trim();

  // 2) body fallback（store_id / storeId）
  const body = await safeReadJson(req);
  const s = body?.store_id ?? body?.storeId ?? null;
  if (typeof s === "string" && s.trim()) return s.trim();

  return null;
}

/**
 * ✅ Strict Guard
 * - JWT 必須
 * - store_id 必須（x-store-id header 推奨）
 * - user_store_roles で role を引き、allowRoles に含まれるか検証
 */
export async function requireAuthAndStoreRoleStrict(
  req: Request,
  opts: { allowRoles: AllowRole[] },
): Promise<GuardOk> {
  // preflight はここでは触らない（呼び出し側で処理）
  const token = getBearer(req);
  if (!token) throw jsonResponse({ ok: false, error: "Missing Authorization Bearer token" }, 401);

  const storeId = await resolveStoreId(req);
  if (!storeId) throw jsonResponse({ ok: false, error: "Missing store_id (send x-store-id header)" }, 400);

  if (!supabaseUrl() || !publishableKey() || !serviceKey()) {
    throw jsonResponse(
      { ok: false, error: "Missing SUPABASE_URL / publishable key / service key" },
      500,
    );
  }

  // 1) JWT を publishable（旧 anon）の client で検証（auth.getUser）
  const authClient = makeAuthClient(token);

  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) {
    throw jsonResponse({ ok: false, error: "Invalid session", detail: userErr?.message ?? null }, 401);
  }
  const userId = userData.user.id;

  // 2) role は service 権限で参照（RLSに左右されない）
  const admin = adminClient("guard");

  const { data: roleRow, error: roleErr } = await admin
    .from("user_store_roles")
    .select("store_id, role")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (roleErr) {
    throw jsonResponse({ ok: false, error: "Failed to load user role", detail: roleErr.message }, 500);
  }
  if (!roleRow?.role) {
    throw jsonResponse({ ok: false, error: "Forbidden (no store role)" }, 403);
  }

  const role = String(roleRow.role) as AllowRole;
  if (!opts.allowRoles.includes(role)) {
    throw jsonResponse({ ok: false, error: "Forbidden (role not allowed)", role }, 403);
  }

  return { userId, storeId, role };
}

// guard.ts 側でも CORS 付きレスポンスを作れるように export（必要なら）
export const guardCorsHeaders = corsHeaders;
export const guardTextResponse = textResponse;
export const guardJsonResponse = jsonResponse;
