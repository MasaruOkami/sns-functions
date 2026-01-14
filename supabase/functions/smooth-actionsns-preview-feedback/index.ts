// supabase/functions/smooth-actionsns-preview-feedback/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";

type ActionKey =
  | "ok"
  | "soft_text"
  | "more_formal"
  | "more_friendly"
  | "shorter"
  | "fewer_emoji"
  | "change_image"
  | "main_dish_image"
  | "adjust_hashtags"
  | "change_datetime";

const ACTION_MAP: Record<
  ActionKey,
  { status: "approved" | "changes_requested"; comment: string }
> = {
  ok: { status: "approved", comment: "この内容でOK" },
  soft_text: { status: "changes_requested", comment: "文面をやわらかくしてほしい" },
  more_formal: { status: "changes_requested", comment: "もっとフォーマルにしてほしい" },
  more_friendly: { status: "changes_requested", comment: "もっと親しみやすくしてほしい" },
  shorter: { status: "changes_requested", comment: "文章をもう少し短くしてほしい" },
  fewer_emoji: { status: "changes_requested", comment: "絵文字を減らしてほしい" },
  change_image: { status: "changes_requested", comment: "画像を変更してほしい" },
  main_dish_image: { status: "changes_requested", comment: "料理写真メインの画像にしてほしい" },
  adjust_hashtags: { status: "changes_requested", comment: "ハッシュタグを調整してほしい" },
  change_datetime: { status: "changes_requested", comment: "投稿日時を変更したい" },
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * ✅ CORS
 * - localhost の dev と、本番ドメインを許可したい場合はここに追加
 * - "*" でも動くが、Authorization を使うなら原則「明示許可」が安全
 */
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function buildCorsHeaders(origin: string | null) {
  const o = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  // origin が許可されない場合でも preflight を落とすと困るので、空のまま返す
  // → ブラウザは許可されないオリジンだと結局ブロックする
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function htmlResponse(body: string, status = 200, origin: string | null = null) {
  const cors = buildCorsHeaders(origin);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...cors,
    },
  });
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  // ✅ preflight を最優先で処理
  if (req.method === "OPTIONS") {
    const cors = buildCorsHeaders(origin);
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const url = new URL(req.url);
    const planId = url.searchParams.get("plan_id");
    const action = url.searchParams.get("action") as ActionKey | null;

    if (!planId || !action) {
      return htmlResponse("<h3>パラメータが不足しています（plan_id / action）。</h3>", 400, origin);
    }

    const actionInfo = ACTION_MAP[action];
    if (!actionInfo) {
      return htmlResponse("<h3>不正なアクションです。</h3>", 400, origin);
    }

    // ① plan_id から store_id を取得（先に確定）
    const { data: plan, error: planErr } = await supabaseAdmin
      .from("sns_post_plans")
      .select("plan_id, store_id")
      .eq("plan_id", planId)
      .maybeSingle();

    if (planErr) {
      console.error("plan fetch error:", planErr);
      return htmlResponse("<h3>プランの取得に失敗しました。</h3>", 500, origin);
    }
    if (!plan?.store_id) {
      return htmlResponse("<h3>Plan not found.</h3>", 404, origin);
    }

    // ② guard（このEFは書き込み＝viewer禁止）
    const g = await requireAuthPasswordOkAndStoreRole(req, {
      storeId: plan.store_id,
      allowRoles: ["admin", "editor"],
    }).catch((res) => res as Response);

    if (g instanceof Response) {
      // guard が返す Response に CORS が付かないので、ここでHTMLに包み直す
      return htmlResponse("<h3>アクセス権限がありません（ログインが必要です）。</h3>", g.status, origin);
    }

    // ③ update
    const { status, comment } = actionInfo;
    const reviewedAt = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("sns_post_plans")
      .update({
        review_status: status,
        review_comment: comment,
        reviewed_at: reviewedAt,
      })
      .eq("plan_id", planId);

    if (error) {
      console.error("Update error:", error);
      return htmlResponse("<h3>フィードバックの保存中にエラーが発生しました。</h3>", 500, origin);
    }

    const message =
      status === "approved"
        ? "この内容でOKとして受け付けました。"
        : "ご希望内容を受け付けました。担当者が内容を確認のうえ、必要に応じて調整いたします。";

    const label = escapeHtml(actionInfo.comment);

    const body = `
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>SNS投稿フィードバックありがとうございました</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, 'Noto Sans JP', sans-serif; padding: 24px; color: #333;">
    <h2>フィードバックありがとうございます</h2>
    <p>${escapeHtml(message)}</p>
    <p>選択された内容：<strong>${label}</strong></p>
    <p style="margin-top:16px; font-size: 13px; color:#666;">
      この画面は閉じていただいて構いません。
    </p>
  </body>
</html>
    `.trim();

    return htmlResponse(body, 200, origin);
  } catch (e) {
    console.error("Unexpected error:", e);
    return htmlResponse("<h3>予期せぬエラーが発生しました。</h3>", 500, origin);
  }
});
