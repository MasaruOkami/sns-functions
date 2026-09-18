import { serve } from "https://deno.land/std/http/server.ts";
// 鍵の解決は ../_shared/keys.ts に集約（新方式 sb_secret_ / レガシー両対応）
import { adminClient, serviceKey, supabaseUrl } from "../_shared/keys.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const review_id = url.searchParams.get("review_id");
  const store_id = url.searchParams.get("store_id");
  const status = url.searchParams.get("status"); // "satisfied" or "unsatisfied"

  if (!review_id || !store_id || !status) {
    return new Response("❌ 必要なパラメータが不足しています", { status: 400 });
  }

  const satisfaction =
    status === "satisfied" ? "満足" :
    status === "unsatisfied" ? "不満" :
    null;

  if (!satisfaction) {
    return new Response("❌ 無効なステータスです", { status: 400 });
  }

  if (!supabaseUrl() || !serviceKey()) {
    return new Response("❌ 環境変数が未設定です", { status: 500 });
  }

  const supabase = adminClient("feedback");
  const table = `${store_id}_review_reply_log`;

  // ✅ レコード取得
  const { data: row, error: fetchError } = await supabase
    .from(table)
    .select("*")
    .eq("review_id", review_id)
    .maybeSingle();

  if (fetchError || !row) {
    console.error("❌ レコード取得エラー:", fetchError);
    return new Response("❌ レコードの取得に失敗しました", { status: 404 });
  }

  // ✅ 全カラム指定でアップデート（制約回避）
  const { error: updateError } = await supabase.from(table).update({
    reply_status: row.reply_status,
    source: row.source,
    channel: row.channel,
    review_text: row.review_text,
    reply_text: row.reply_text,
    generated_at: row.generated_at,
    reject_reason: row.reject_reason,
    reply_style: row.reply_style,
    store_name_jp: row.store_name_jp,
    visit_date: row.visit_date,
    notified: row.notified,
    satisfaction: satisfaction // 🔸これだけ変更
  }).eq("review_id", review_id);

  if (updateError) {
    console.error("❌ Supabase更新エラー:", updateError);
    return new Response("❌ Supabase更新失敗: " + updateError.message, { status: 500 });
  }

  // ✅ 文字化け対策：TextEncoderでエンコードして返却
  const html = `
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <h2>ご回答ありがとうございます！</h2>
        <p>ステータス「${satisfaction}」で記録しました。</p>
      </body>
    </html>
  `;
  const encodedHtml = new TextEncoder().encode(html);

  return new Response(encodedHtml, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    status: 200
  });
});
