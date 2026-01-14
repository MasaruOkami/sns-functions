// supabase/functions/_guard_template/guard.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type GuardOk = {
  userId: string;
  storeId: string | null;
  role: "admin" | "editor" | "viewer" | null;
};

type GuardOptions = {
  allowRoles: Array<"admin" | "editor" | "viewer">;
  /**
   * store_id をどこから取るか。EFごとに「bodyを信頼しない」前提でも
   * store_id を “入力としては受け取り”、DBで権限チェックするのでOK。
   */
  storeIdSource?: "body" | "query" | "either" | "none";
  storeIdKey?: string; // default: "store_id"
};

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function safeReadJson(req: Request): Promise<any> {
  try {
    const t = await req.text();
    if (!t) return null;
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function getStoreIdFromQuery(req: Request, key: string): string | null {
  try {
    const url = new URL(req.url);
    const v = url.searchParams.get(key);
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function getStoreId(req: Request, opt: GuardOptions): Promise<string | null> {
  const key = opt.storeIdKey ?? "store_id";
  const source = opt.storeIdSource ?? "either";

  let bodyStoreId: string | null = null;
  let queryStoreId: string | null = null;

  if (source === "body" || source === "either") {
    const body = await safeReadJson(req);
    const v = body?.[key];
    if (typeof v === "string" && v.trim()) bodyStoreId = v.trim();
  }

  if (source === "query" || source === "either") {
    queryStoreId = getStoreIdFromQuery(req, key);
  }

  if (source === "none") return null;

  return bodyStoreId ?? queryStoreId ?? null;
}

export async function requireAuthPasswordOkAndStoreRole(req: Request, opt: GuardOptions): Promise<GuardOk | Response> {
  const token = getBearerToken(req);
  if (!token) return json({ ok: false, error: "UNAUTHORIZED", detail: "Missing Bearer token" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY"); // RLSで本人selectできればOK
  if (!url || !anon) return json({ ok: false, error: "SERVER_MISCONFIG", detail: "Missing SUPABASE_URL/ANON" }, 500);

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: u, error: uerr } = await sb.auth.getUser();
  if (uerr || !u?.user?.id) return json({ ok: false, error: "UNAUTHORIZED", detail: "Invalid session" }, 401);

  const userId = u.user.id;

  // 1) password expiry check
  {
    const { data, error } = await sb
      .from("user_security")
      .select("user_id, password_expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    // レコードが無い場合でも “弾く” よりは、運用上は作るのが正しい
    if (error) return json({ ok: false, error: "RLS_DENIED", detail: error.message }, 403);
    if (!data?.password_expires_at) {
      return json({ ok: false, error: "USER_SECURITY_MISSING", detail: "user_security row not found" }, 403);
    }

    const exp = new Date(data.password_expires_at).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      return json({ ok: false, error: "PASSWORD_EXPIRED", detail: "Password expired" }, 403);
    }
  }

  const storeId = await getStoreId(req, opt);

  // 2) store role check
  if (storeId) {
    const { data, error } = await sb
      .from("user_store_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) return json({ ok: false, error: "RLS_DENIED", detail: error.message }, 403);

    const role = (data?.role ?? null) as GuardOk["role"];
    if (!role) return json({ ok: false, error: "FORBIDDEN", detail: "No role for this store" }, 403);

    if (!opt.allowRoles.includes(role)) {
      return json({ ok: false, error: "FORBIDDEN", detail: `Role ${role} not allowed` }, 403);
    }

    return { userId, storeId, role };
  }

  // storeIdが無い場合（dispatch/worker想定）
  // allowRoles に admin が含まれているなら「adminを1つでも持つ」かで判定
  if (opt.allowRoles.includes("admin")) {
    const { data, error } = await sb
      .from("user_store_roles")
      .select("role, store_id")
      .eq("user_id", userId);

    if (error) return json({ ok: false, error: "RLS_DENIED", detail: error.message }, 403);

    const hasAdmin = (data ?? []).some((r: any) => r?.role === "admin");
    if (!hasAdmin) return json({ ok: false, error: "FORBIDDEN", detail: "Admin required" }, 403);

    return { userId, storeId: null, role: "admin" };
  }

  return json({ ok: false, error: "FORBIDDEN", detail: "store_id is required" }, 403);
}
