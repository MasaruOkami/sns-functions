import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient } from '../_shared/keys.ts'

// 計測リダイレクト: 配信メッセージ内のリンクは本エンドポイント経由で開かれる
// GET ?l=<marketing_send_logs.id> → クリック記録 → 元URLへ302
// 遷移先は send_logs.link_url（DB管理）のためオープンリダイレクトにならない
Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const logId = (url.searchParams.get('l') ?? '').trim()

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(logId)) {
    return new Response('Not found', { status: 404 })
  }

  const db = adminClient('marketing-click')

  const { data: log } = await db
    .from('marketing_send_logs')
    .select('id, link_url, clicked_at, click_count')
    .eq('id', logId)
    .maybeSingle()

  if (!log?.link_url) return new Response('Not found', { status: 404 })

  // 初回クリック日時 + クリック回数を記録（失敗してもリダイレクトは行う）
  try {
    await db
      .from('marketing_send_logs')
      .update({
        clicked_at: log.clicked_at ?? new Date().toISOString(),
        click_count: (log.click_count ?? 0) + 1,
      })
      .eq('id', logId)
  } catch (e) {
    console.error('[marketing-click] update failed:', e)
  }

  return new Response(null, {
    status: 302,
    headers: { Location: String(log.link_url), 'Cache-Control': 'no-store' },
  })
})
