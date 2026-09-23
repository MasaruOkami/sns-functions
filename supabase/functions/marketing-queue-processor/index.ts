import { adminClient } from '../_shared/keys.ts'

const supabase = adminClient('marketing-queue-processor')

// ─── LINE Push送信（ブロック検知付き） ───────────────────────────────────────
async function sendLineMessage(
  token: string,
  lineUserId: string,
  messages: unknown[]
): Promise<{ ok: boolean; blocked: boolean }> {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  })
  if (res.ok) return { ok: true, blocked: false }
  const err = await res.text().catch(() => '')
  console.error(`[LINE] push failed ${res.status}:`, err)
  const blocked = res.status === 403 || /hasn't added|blocked/i.test(err)
  return { ok: false, blocked }
}

// ── クリック計測: メッセージ内の最初のリンクを計測URLに差し替える ──────────────
const TRACK_BASE = 'https://api.review-ai.xyz/functions/v1/marketing-click'

function wrapFirstLink(messages: unknown, logId: string): { messages: unknown; linkUrl: string | null } {
  let linkUrl: string | null = null
  const trackUrl = `${TRACK_BASE}?l=${logId}`
  const walkUri = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walkUri)
    if (node && typeof node === 'object') {
      const o = { ...(node as Record<string, unknown>) }
      if (!linkUrl && o.type === 'uri' && typeof o.uri === 'string' && /^https?:\/\//.test(o.uri)) {
        linkUrl = o.uri
        o.uri = trackUrl
        return o
      }
      for (const k of Object.keys(o)) o[k] = walkUri(o[k])
      return o
    }
    return node
  }
  let result = walkUri(JSON.parse(JSON.stringify(messages)))
  if (!linkUrl) {
    const walkText = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(walkText)
      if (node && typeof node === 'object') {
        const o = { ...(node as Record<string, unknown>) }
        if (!linkUrl && o.type === 'text' && typeof o.text === 'string') {
          const m = o.text.match(/https?:\/\/[^\s"']+/)
          if (m) {
            linkUrl = m[0]
            o.text = o.text.replace(m[0], trackUrl)
          }
        }
        for (const k of Object.keys(o)) o[k] = walkText(o[k])
        return o
      }
      return node
    }
    result = walkText(result)
  }
  return { messages: result, linkUrl }
}

// ─── 月間通数クォータ ─────────────────────────────────────────────────────────
async function getMonthlyQuota(storeId: string): Promise<{ used: number; limit: number | null }> {
  const { data: sp } = await supabase
    .from('store_profiles')
    .select('line_monthly_message_limit')
    .eq('store_id', storeId)
    .maybeSingle()
  const limit = (sp?.line_monthly_message_limit as number | null) ?? null
  const nowJst = new Date(Date.now() + 9 * 3600000)
  const monthStartUtc = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), 1) - 9 * 3600000).toISOString()
  const { count } = await supabase
    .from('marketing_send_logs')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'sent')
    .gte('sent_at', monthStartUtc)
  return { used: count ?? 0, limit }
}

// ── 配信頻度制限 ──────────────────────────────────────────────────────────────
async function getFrequencyCap(storeId: string): Promise<{ count: number | null; days: number }> {
  const { data } = await supabase
    .from('store_profiles')
    .select('line_frequency_cap_count, line_frequency_cap_days')
    .eq('store_id', storeId)
    .maybeSingle()
  return {
    count: (data?.line_frequency_cap_count as number | null) ?? null,
    days: Number(data?.line_frequency_cap_days ?? 7) || 7,
  }
}

async function isOverFrequencyCap(
  storeId: string,
  lineUserId: string,
  cap: { count: number | null; days: number }
): Promise<boolean> {
  if (cap.count == null) return false
  const cutoff = new Date(Date.now() - cap.days * 86400000).toISOString()
  const { count } = await supabase
    .from('marketing_send_logs')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'sent')
    .eq('line_user_id', lineUserId)
    .gte('sent_at', cutoff)
  return (count ?? 0) >= cap.count
}

Deno.serve(async (req: Request) => {
  // シークレット検証
  const secret = req.headers.get('x-trigger-secret')
  const expected = Deno.env.get('MARKETING_TRIGGER_SECRET')
  if (expected && secret !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date().toISOString()

  // 送信期限が来た pending アイテムを最大 100 件取得
  const { data: items, error } = await supabase
    .from('marketing_send_queue')
    .select('id, trigger_id, store_id, line_user_id, messages')
    .eq('status', 'pending')
    .lte('send_after', now)
    .order('send_after', { ascending: true })
    .limit(100)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // ストアごとのクォータ残数キャッシュ
  const quotaRemaining = new Map<string, number>() // Infinity 相当は -1 で表現しない: limit無しは含めない
  const quotaUnlimited = new Set<string>()
  // ストアごとの頻度上限設定キャッシュ
  const freqCapCache = new Map<string, { count: number | null; days: number }>()

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const item of items ?? []) {
    const storeId: string = item.store_id

    // ── 顧客のブロック状態・表示名を取得 ─────────────────────────────────
    const { data: ident } = await supabase
      .from('customer_identity')
      .select('display_name, line_blocked')
      .eq('line_user_id', item.line_user_id)
      .maybeSingle()

    if (ident?.line_blocked === true) {
      await supabase
        .from('marketing_send_queue')
        .update({ status: 'skipped', error_detail: 'user blocked', sent_at: new Date().toISOString() })
        .eq('id', item.id)
      skipped++
      continue
    }

    // ── 配信頻度制限チェック（直近N日に上限超過したユーザーはスキップ） ────
    if (!freqCapCache.has(storeId)) freqCapCache.set(storeId, await getFrequencyCap(storeId))
    const freqCap = freqCapCache.get(storeId)!
    if (await isOverFrequencyCap(storeId, item.line_user_id, freqCap)) {
      await supabase
        .from('marketing_send_queue')
        .update({ status: 'skipped', error_detail: 'frequency cap reached', sent_at: new Date().toISOString() })
        .eq('id', item.id)
      skipped++
      continue
    }

    // ── 月間通数上限チェック（ストアごとに1回だけ取得しキャッシュ） ──────
    if (!quotaUnlimited.has(storeId) && !quotaRemaining.has(storeId)) {
      const { used, limit } = await getMonthlyQuota(storeId)
      if (limit == null) quotaUnlimited.add(storeId)
      else quotaRemaining.set(storeId, Math.max(0, limit - used))
    }
    if (!quotaUnlimited.has(storeId)) {
      const rem = quotaRemaining.get(storeId) ?? 0
      if (rem <= 0) {
        await supabase
          .from('marketing_send_queue')
          .update({ status: 'failed', error_detail: 'monthly limit reached', sent_at: new Date().toISOString() })
          .eq('id', item.id)
        failed++
        continue
      }
    }

    // LINE トークン取得（store_line_credentials から）
    const { data: creds } = await supabase
      .from('store_line_credentials')
      .select('line_channel_access_token')
      .eq('store_id', storeId)
      .single()

    if (!creds?.line_channel_access_token) {
      await supabase
        .from('marketing_send_queue')
        .update({ status: 'failed', error_detail: 'no line token', sent_at: now })
        .eq('id', item.id)
      failed++
      continue
    }

    // ── {name} 差し込み（キュー格納時に未置換のものを送信直前に解決） ────
    const displayName = (ident?.display_name as string | null)?.trim() || 'お客様'
    const substituted = JSON.parse(
      JSON.stringify(item.messages).replace(/\{name\}/g, displayName)
    ) as unknown[]

    // クリック計測: 最初のリンクを計測URLに差し替え
    const logId = crypto.randomUUID()
    const { messages, linkUrl } = wrapFirstLink(substituted, logId)

    const result = await sendLineMessage(
      creds.line_channel_access_token,
      item.line_user_id,
      messages as unknown[]
    )

    const sentAt = new Date().toISOString()
    const queueStatus = result.ok ? 'sent' : 'failed'
    const logStatus = result.ok ? 'sent' : (result.blocked ? 'blocked' : 'failed')

    if (!result.ok && result.blocked) {
      await supabase
        .from('customer_identity')
        .update({ line_blocked: true, line_blocked_at: sentAt })
        .eq('line_user_id', item.line_user_id)
    }

    await supabase
      .from('marketing_send_queue')
      .update({
        status:       queueStatus,
        error_detail: result.ok ? null : (result.blocked ? 'user blocked' : 'LINE push failed'),
        sent_at:      sentAt,
      })
      .eq('id', item.id)

    // marketing_send_logs にも記録（配信効果レポート・通数集計用）
    await supabase.from('marketing_send_logs').insert({
      id:           logId,
      trigger_id:   item.trigger_id,
      store_id:     storeId,
      line_user_id: item.line_user_id,
      status:       logStatus,
      link_url:     linkUrl,
    })

    if (result.ok) {
      sent++
      if (!quotaUnlimited.has(storeId)) {
        quotaRemaining.set(storeId, (quotaRemaining.get(storeId) ?? 1) - 1)
      }
    } else {
      failed++
    }
  }

  console.log(`[queue-processor] processed=${(items ?? []).length} sent=${sent} failed=${failed} skipped=${skipped}`)

  return new Response(
    JSON.stringify({ ok: true, processed: (items ?? []).length, sent, failed, skipped }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
