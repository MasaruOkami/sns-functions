// supabase/functions/gbp-oauth-callback/_shared/guard.ts
//
// 本番(oahnmyfalnhdkoihrswh)にデプロイされていた _shared/guard.ts をそのまま持ち込んだもの。
// トップレベルの supabase/functions/_shared/guard.ts は別設計に書き換えられており
// requireAuthPasswordOkAndStoreRole を export していない（PW期限チェックも無い）。
// 鍵の移行で認証条件まで変えないよう、gbp-* は本番と同じこの版を関数ローカルで使う。
//
// 本番版からの変更は「鍵の取得を ./keys.ts 経由にした」ことだけ。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publishableKey, serviceKey, supabaseUrl } from "./keys.ts";

export type GuardResult = {
  user: { id: string; email?: string | null };
  storeId: string;
  role?: string | null;
};

type GuardOpts = {
  // 優先的に使う storeId（story-ui のように header を渡したい場合など）
  storeId?: string;
  allowRoles?: string[];
};

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-store-id",
    },
  });

export function createSupabaseClients(req: Request) {
  const SUPABASE_URL = supabaseUrl()!;
  const SUPABASE_ANON_KEY = publishableKey()!;
  const SUPABASE_SERVICE_ROLE_KEY = serviceKey()!;

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";

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

function pickStoreIdFromReq(req: Request): string | undefined {
  // 1) header: x-store-id（UI/ブラウザ運用で最重要）
  const h =
    req.headers.get("x-store-id") ??
    req.headers.get("X-Store-Id") ??
    req.headers.get("x-store_id") ??
    req.headers.get("X-Store_Id");
  if (h && h.trim()) return h.trim();

  // 2) query: ?store_id=
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("store_id") ?? url.searchParams.get("storeId");
    if (q && q.trim()) return q.trim();
  } catch {
    // ignore
  }

  return undefined;
}

async function pickStoreIdFromBody(req: Request): Promise<string | undefined> {
  // body は最後（POST JSONのときのみ）
  const ct = req.headers.get("Content-Type") ?? req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined;

  const body = await req.clone().json().catch(() => ({}));
  const v = (body as any)?.store_id ?? (body as any)?.storeId;
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

export async function requireAuthPasswordOkAndStoreRole(
  req: Request,
  opts?: GuardOpts,
): Promise<GuardResult> {
  const { supabaseUser, supabaseAdmin } = createSupabaseClients(req);

  // -----------------------------------------------------
  // 1) 認証（ログイン必須）
  // -----------------------------------------------------
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  const user = userData?.user;

  if (userErr || !user) {
    throw jsonRes(401, { error: "UNAUTHORIZED", message: "Login required." });
  }

  // -----------------------------------------------------
  // 2) store_id 解決（優先順：opts → header → query → body）
  // -----------------------------------------------------
  let storeId =
    (opts?.storeId && opts.storeId.trim() ? opts.storeId.trim() : undefined) ??
    pickStoreIdFromReq(req) ??
    (await pickStoreIdFromBody(req));

  if (!storeId) {
    throw jsonRes(400, {
      error: "BAD_REQUEST",
      message: "store_id is required (use header x-store-id or body store_id).",
    });
  }

  // -----------------------------------------------------
  // 3) PW期限チェック（service role で user_security）
  // -----------------------------------------------------
  const { data: sec, error: secErr } = await supabaseAdmin
    .from("user_security")
    .select("password_expires_at, require_password_reset")
    .eq("user_id", user.id)
    .maybeSingle();

  if (secErr || !sec) {
    throw jsonRes(403, { error: "SECURITY_STATE_MISSING", message: "Security state missing." });
  }
  if (sec.require_password_reset) {
    throw jsonRes(403, { error: "PASSWORD_RESET_REQUIRED", message: "Password reset required." });
  }

  const expiresAt = new Date(sec.password_expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw jsonRes(403, { error: "PASSWORD_EXPIRED", message: "Password expired." });
  }

  // -----------------------------------------------------
  // 4) 店舗権限（service role で user_store_roles）
  // -----------------------------------------------------
  const { data: roleRow, error: roleErr } = await supabaseAdmin
    .from("user_store_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (roleErr || !roleRow) {
    throw jsonRes(403, { error: "FORBIDDEN", message: "No access to this store." });
  }

  // -----------------------------------------------------
  // 5) allowRoles（必要なEFだけ指定）
  // -----------------------------------------------------
  if (opts?.allowRoles?.length) {
    if (!opts.allowRoles.includes(roleRow.role)) {
      throw jsonRes(403, { error: "FORBIDDEN_ROLE", message: "Insufficient role." });
    }
  }

  return {
    user: { id: user.id, email: user.email },
    storeId,
    role: roleRow.role,
  };
}

// ----------------------------------------------------------------
// requireAuthAndStoreRoleStrict
// requireAuthPasswordOkAndStoreRole と同じ処理だが
// 戻り値が { userId, storeId, role } の形（sns-preview-feedback 互換）
// ----------------------------------------------------------------
export type GuardResultStrict = {
  userId: string;
  storeId: string;
  role: string | null;
};

export async function requireAuthAndStoreRoleStrict(
  req: Request,
  opts?: GuardOpts,
): Promise<GuardResultStrict> {
  const result = await requireAuthPasswordOkAndStoreRole(req, opts);
  return {
    userId: result.user.id,
    storeId: result.storeId,
    role: result.role ?? null,
  };
}
