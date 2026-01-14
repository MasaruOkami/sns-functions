// supabase/functions/post_preview_mobile/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";

// viewer許可（確定）
const ALLOW_ROLES = ["admin", "editor", "viewer"] as const;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

// 簡易 HTML エスケープ
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const planId = url.searchParams.get("plan_id");

    if (!planId) {
      return new Response("Missing plan_id", { status: 400 });
    }

    // ① plan 取得（store_id 確定のため）
    const { data: plan } = await supabase
      .from("sns_post_plans")
      .select("plan_id, store_id, platform, scheduled_at, media_kind, status, caption, hashtags, generated_media_url, approve_status, review_status, posted_url")
      .eq("plan_id", planId)
      .maybeSingle();

    if (!plan || !plan.store_id) {
      return new Response("Plan not found", { status: 404 });
    }

    // ② guard（viewer OK）※plan.store_id を検証対象にして認可
    const g = await requireAuthPasswordOkAndStoreRole(req, {
      storeId: plan.store_id,
      allowRoles: [...ALLOW_ROLES],
    }).catch((res) => res as Response);

    if (g instanceof Response) {
      return new Response("Access denied", { status: g.status });
    }

    // ★以降は “確定した store_id” を g.storeId に統一（監査にも乗る）
    const store_id = g.storeId;

    // ★念のため：planとguardのstoreが食い違うことは通常ないが、より安全に
    if (plan.store_id !== store_id) {
      return new Response("Access denied", { status: 403 });
    }

    /* --- 以降は元の HTML ロジック（変更なし） --- */
    const caption = plan.caption ?? "";
    const hashtagsArray = Array.isArray(plan.hashtags) ? plan.hashtags : [];
    const hashtagsText = hashtagsArray.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");

    const html = `
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>SNS 投稿プレビュー</title>
</head>
<body>
  <h2>${escapeHtml(plan.platform ?? "SNS")}</h2>
  <p>${escapeHtml(caption)}</p>
  <p>${escapeHtml(hashtagsText)}</p>
</body>
</html>
`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    console.error(e);
    return new Response("Internal error", { status: 500 });
  }
});
