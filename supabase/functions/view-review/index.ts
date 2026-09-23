import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// 鍵の解決は ../_shared/keys.ts に集約（新方式 sb_secret_ / レガシー両対応）
import { adminClient } from "../_shared/keys.ts"

serve(async (req) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return new Response("Error: Missing ID", { status: 400 })

  const supabase = adminClient("view-review")

  // 1. レビューデータの取得
  let query = supabase.from('reviews').select(`
    id,
    review_text,
    store_profiles (store_name_ja, google_url, line_official_url)
  `);

  if (id === 'latest') {
    query = query.order('created_at', { ascending: false }).limit(1).single();
  } else {
    query = query.eq('id', id).single();
  }

  const { data: review, error: dbError } = await query;
  if (dbError || !review) return new Response("Review not found", { status: 404 });

  const store = review.store_profiles;
  const targetId = review.id; // UUIDを取得

  // 2. HTMLの生成（UTF-8で組み立て）
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AIレビュー案 - ${store?.store_name_ja || ''}</title>
    <style>
        body { font-family: sans-serif; text-align: center; background: #f4f7f6; padding: 20px; color: #333; margin:0; }
        .container { background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); max-width: 400px; margin: auto; }
        .review-box { background: #f0f0f0; padding: 15px; border-radius: 10px; text-align: left; margin: 20px 0; font-size: 15px; white-space: pre-wrap; line-height: 1.6; }
        .btn { display: block; width: 100%; padding: 15px; margin: 10px 0; border-radius: 50px; text-decoration: none; font-weight: bold; color: white; font-size: 16px; box-sizing: border-box; }
        .copy-btn { background: #333; border: none; width: 100%; cursor: pointer; }
        .google-btn { background: #4285F4; }
    </style>
</head>
<body>
    <div class="container">
        <h3>レビュー案が完成！✨</h3>
        <div class="review-box" id="reviewText">${review.review_text}</div>
        <button onclick="copyReview()" class="btn copy-btn">文章をコピーする</button>
        <a href="${store?.google_url || '#'}" target="_blank" class="btn google-btn">Googleマップを開く</a>
    </div>
    <script>
    function copyReview() {
        var text = document.getElementById("reviewText").innerText;
        navigator.clipboard.writeText(text).then(() => alert("コピーしました！"));
    }
    </script>
</body>
</html>`;

  // 3. StorageにHTMLファイルをアップロード (ここが解決策)
  const filePath = `pages/${targetId}.html`;
  const { error: uploadError } = await supabase.storage
    .from('reviews') // 先ほど作ったバケット名
    .upload(filePath, html, {
      contentType: 'text/html; charset=utf-8',
      upsert: true
    });

  if (uploadError) return new Response("Storage upload error: " + uploadError.message, { status: 500 });

  // 4. アップロードしたファイルの公開URLを取得
  const { data: { publicUrl } } = supabase.storage
    .from('reviews')
    .getPublicUrl(filePath);

  // 5. そのURLへリダイレクト（ブラウザに直接表示させる）
  return Response.redirect(publicUrl, 302);
})