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
//   service 側 : SB_SECRET_KEY → SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SECRET_KEYS
//   client 側  : SB_PUBLISHABLE_KEY → SUPABASE_ANON_KEY → SUPABASE_PUBLISHABLE_KEYS
//
//   どちらも「自動で入る複数形の変数」を最後に置いている。切り替えは SB_* を
//   設定するという明示的な操作でのみ起きる（デプロイしただけでは切り替わらない）。
//
// 変数名についての注意
//   ・SUPABASE_ で始まる名前は Supabase の予約で、シークレットとして自分では登録できない
//     （"Name must not start with the SUPABASE_ prefix" で弾かれる）。
//     手動で上書きしたいときのために SB_ 接頭辞の名前を用意している。
//   ・SUPABASE_*_KEYS（複数形）は Supabase が自動で入れるもの。ダッシュボードで
//     新方式キーを作ると値が入る。複数キーがあるとカンマ区切りになりうるため先頭を採用する。
//   ・client 側だけ ANON を先に見るのは、新方式キーが未作成のプロジェクトでも
//     SUPABASE_PUBLISHABLE_KEYS に値が入っている場合があり、中身を確認できないため。
//     いまの挙動を変えないでおき、切り替えるときは SB_PUBLISHABLE_KEY を明示的に設定する。

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
  // SUPABASE_SECRET_KEYS を最後に見るのは意図的。
  // これは Supabase が自動で埋める変数で、ダッシュボードで新方式キーを1本でも
  // 作った時点で値が入る。先に見ると「デプロイした瞬間に全関数が一斉に新キーへ移り、
  // しかも複数キーのうちどれを掴んだか分からない」状態になる。
  // 切り替えは SB_SECRET_KEY を設定するという明示的な操作で行う（publishable 側と同じ方針）。
  return env("SB_SECRET_KEY") ??
    env("SUPABASE_SERVICE_ROLE_KEY") ??
    first("SUPABASE_SECRET_KEYS");
}

/** ブラウザに出してよい鍵（JWT の検証などに使う） */
export function publishableKey(): string | undefined {
  return env("SB_PUBLISHABLE_KEY") ??
    env("SUPABASE_ANON_KEY") ??
    first("SUPABASE_PUBLISHABLE_KEYS");
}

/**
 * いまどちらの鍵で動いているか。
 * 移行の進み具合をログで確認するために使う（Step 5 の「レガシー利用がゼロ」の判定）。
 */
export function keyMode(): KeyMode {
  if (env("SB_SECRET_KEY")) return "new";
  if (env("SUPABASE_SERVICE_ROLE_KEY")) return "legacy";
  if (first("SUPABASE_SECRET_KEYS")) return "new";
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
        "(SB_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS)",
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
        "(SB_PUBLISHABLE_KEY / SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEYS)",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
