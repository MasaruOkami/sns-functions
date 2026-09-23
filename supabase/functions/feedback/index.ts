import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// 鍵の解決は ../_shared/keys.ts に集約（新方式 sb_secret_ / レガシー両対応）
import { adminClient } from "../_shared/keys.ts";

// 返信ログの保存先は 2026-03 以降グローバルの review_reply_logs に一本化されている。
// ここが店舗別テーブル {store_id}_review_reply_log を読み続けていたため、
// メール/LINE の「満足・不満」リンクが半年間ずっと 404 を返していた。
// （稼働6店舗のうち3店舗はそのテーブル自体が存在しない）
//
// 店舗別テーブルの主キーは review_id 単独だったが、
// グローバル表の一意キーは (store_id, review_id)。必ず両方で絞ること。
const TABLE = "review_reply_logs";

function page(body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.7">
${body}
</body></html>`;
  // 文字化け対策：TextEncoder でエンコードして返却
  return new Response(new TextEncoder().encode(html), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const review_id = url.searchParams.get("review_id")?.trim();
  const store_id = url.searchParams.get("store_id")?.trim();
  const status = url.searchParams.get("status"); // "satisfied" / "unsatisfied"

  if (!review_id || !store_id) {
    return page(
      `<h2>リンクが不完全です</h2><p>メール本文のリンクをもう一度お試しください。</p>`,
      400,
    );
  }

  const satisfaction = status === "satisfied"
    ? "満足"
    : status === "unsatisfied"
    ? "不満"
    : null;

  // status が付いていないリンクは、これまで 400 で落ちていた。
  // その場で選べるページを返す。
  if (!satisfaction) {
    const q = `review_id=${encodeURIComponent(review_id)}` +
      `&store_id=${encodeURIComponent(store_id)}`;
    return page(
      `<h2>この返信内容はいかがでしたか？</h2>
      <p><a href="?status=satisfied&${q}">👍 満足</a></p>
      <p><a href="?status=unsatisfied&${q}">👎 不満</a></p>`,
      200,
    );
  }

  let supabase;
  try {
    supabase = adminClient("feedback");
  } catch (e) {
    console.error("[feedback] 鍵が未設定:", e);
    return page(
      `<h2>いま受け付けできません</h2><p>時間をおいて再度お試しください。</p>`,
      500,
    );
  }

  // UPDATE ... RETURNING を1往復で。読んでから書く方式をやめたので、
  // 返信文の再生成と競合して古い値を書き戻すこともない。
  const { data, error } = await supabase
    .from(TABLE)
    .update({ satisfaction })
    .eq("store_id", store_id)
    .eq("review_id", review_id)
    .select("review_id");

  // DB エラーと「該当行なし」を分ける。
  // 両方を 404 に潰していたせいで、このバグが半年間見えなかった。
  if (error) {
    console.error("[feedback] 更新に失敗:", {
      store_id,
      review_id,
      code: error.code,
      message: error.message,
    });
    return page(
      `<h2>記録できませんでした</h2><p>時間をおいて再度お試しください。</p>`,
      500,
    );
  }

  if (!data || data.length === 0) {
    console.warn("[feedback] 該当行なし:", { store_id, review_id });
    return page(
      `<h2>対象の返信が見つかりません</h2><p>このリンクは古い可能性があります。</p>`,
      404,
    );
  }

  return page(
    `<h2>ご回答ありがとうございます</h2><p>「${satisfaction}」で記録しました。</p>`,
    200,
  );
});
