// supabase/functions/_shared/keys.ts
//
// API キーの解決を1か所に集める。
//
// 背景（2026-09-18）
//   本番の service_role キーが公開状態のファイルに含まれて漏えいした。
//   レガシー方式では anon と service_role が同じ JWT シークレットで署名されているため、
//   service_role だけを失効させられない。そこで新方式（sb_secret_ / sb_publishable_）へ
//   移行してから、レガシーキーを無効化する。
//
// この係の役目
//   「新しいキーがあればそれを使い、無ければ従来のキーにフォールバックする」
//   これにより、移行期間中はどちらのキーでも動く。全関数をこの経由に統一してから
//   レガシーキーを無効化すれば、切り替えの瞬間に落ちない。
//
// 参照する環境変数（上から順に探す）
//   service 側 : SUPABASE_SECRET_KEY → SUPABASE_SECRET_KEYS → SUPABASE_SERVICE_ROLE_KEY
//   client 側  : SUPABASE_PUBLISHABLE_KEY → SUPABASE_PUBLISHABLE_KEYS → SUPABASE_ANON_KEY
//
//   SUPABASE_*_KEYS（複数形）は Supabase が自動で入れるもので、複数キーがあると
//   カンマ区切りになりうるため先頭を採用する。単数形は手動で設定する用。

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type KeyMode = "new" | "legacy" | "missing";

function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v == null || v === "" ? undefined : v;
}

/** 複数形の env はカンマ区切りになりうるので先頭だけ取る */
function first(name: string): string | undefined {
  const v = env(name);
  return v?.split(",")[0]?.trim() || undefined;
}

export function supabaseUrl(): string | undefined {
  return env("SUPABASE_URL");
}

/** サーバー側で使う鍵（RLS を迂回する権限） */
export function serviceKey(): string | undefined {
  return env("SUPABASE_SECRET_KEY") ??
    first("SUPABASE_SECRET_KEYS") ??
    env("SUPABASE_SERVICE_ROLE_KEY");
}

/** ブラウザに出してよい鍵（JWT の検証などに使う） */
export function publishableKey(): string | undefined {
  return env("SUPABASE_PUBLISHABLE_KEY") ??
    first("SUPABASE_PUBLISHABLE_KEYS") ??
    env("SUPABASE_ANON_KEY");
}

/**
 * いまどちらの鍵で動いているか。
 * 移行の進み具合をログで確認するために使う（Step 5 の「レガシー利用がゼロ」の判定）。
 */
export function keyMode(): KeyMode {
  if (env("SUPABASE_SECRET_KEY") || first("SUPABASE_SECRET_KEYS")) return "new";
  if (env("SUPABASE_SERVICE_ROLE_KEY")) return "legacy";
  return "missing";
}

let logged = false;

/** 起動時に1回だけ、どちらの鍵を使っているかを残す */
export function logKeyMode(fnName: string): void {
  if (logged) return;
  logged = true;
  console.log(`[keys] ${fnName}: mode=${keyMode()}`);
}

/**
 * service 権限の client。
 * 鍵が無ければ例外を投げる（空文字のまま起動して後で 401 になるのを防ぐ）。
 */
export function adminClient(fnName?: string): SupabaseClient {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or service key " +
        "(SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  if (fnName) logKeyMode(fnName);
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 利用者の JWT を検証するための client */
export function authClient(token: string): SupabaseClient {
  const url = supabaseUrl();
  const key = publishableKey();
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or publishable key " +
        "(SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEYS / SUPABASE_ANON_KEY)",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
