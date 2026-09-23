import { adminClient } from '../_shared/keys.ts'

const supabase = adminClient('marketing-trigger-runner')

// ─── 型定義 ───────────────────────────────────────────────────────────────────
interface UserData {
  line_user_id: string
  points: number
  days: number  // trigger_typeに応じて days_since_visit or days_until_expiry
  name?: string // LINE表示名（{name} 変数用）
}

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

async function markBlocked(lineUserId: string) {
  await supabase
    .from('customer_identity')
    .update({ line_blocked: true, line_blocked_at: new Date().toISOString() })
    .eq('line_user_id', lineUserId)
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

// ── 配信頻度制限（直近N日に上限回数を超えて受信したユーザーを除外）──────────────
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

async function filterByFrequencyCap(
  storeId: string,
  lineUserIds: string[]
): Promise<{ allowed: Set<string>; capped: number }> {
  const cap = await getFrequencyCap(storeId)
  if (cap.count == null || lineUserIds.length === 0) return { allowed: new Set(lineUserIds), capped: 0 }
  const cutoff = new Date(Date.now() - cap.days * 86400000).toISOString()
  const tally = new Map<string, number>()
  // ★ サーバー側で GROUP BY 集計（行数=ユーザー数なので max_rows 切り捨ての影響を受けない）
  const CHUNK = 150
  for (let i = 0; i < lineUserIds.length; i += CHUNK) {
    const chunk = lineUserIds.slice(i, i + CHUNK)
    const { data, error } = await supabase.rpc('marketing_freq_counts', {
      p_store_id: storeId,
      p_cutoff: cutoff,
      p_user_ids: chunk,
    })
    if (error) {
      // 集計失敗時は安全側（送らない＝全員除外）に倒す
      console.error('[trigger-runner] freq_counts rpc failed, excluding chunk:', error.message)
      for (const uid of chunk) tally.set(uid, cap.count!)
      continue
    }
    for (const r of (data ?? []) as Array<{ line_user_id: string; cnt: number }>) {
      tally.set(r.line_user_id, Number(r.cnt) || 0)
    }
  }
  const allowed = new Set(lineUserIds.filter(uid => (tally.get(uid) ?? 0) < cap.count!))
  return { allowed, capped: lineUserIds.length - allowed.size }
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

// ─── 変数置換（{points}, {days}, {store_name}, {name}） ─────────────────────
function substituteVars(messages: unknown[], data: UserData, storeName: string): unknown[] {
  const json = JSON.stringify(messages)
    .replace(/\{points\}/g, String(data.points))
    .replace(/\{days\}/g, String(data.days))
    .replace(/\{store_name\}/g, storeName)
    .replace(/\{name\}/g, (data.name ?? '').trim() || 'お客様')
  return JSON.parse(json)
}

// ─── トリガー評価 ─────────────────────────────────────────────────────────────
async function evaluateTrigger(
  triggerType: string,
  conditions: Record<string, number>,
  storeId: string
): Promise<UserData[]> {
  switch (triggerType) {
    case 'no_visit_days': {
      const { data, error } = await supabase.rpc('get_no_visit_users', {
        p_store_id: storeId,
        p_days: conditions.days ?? 30,
      })
      if (error) { console.error('[eval] no_visit_days:', error); return [] }
      return (data ?? []).map((r: { line_user_id: string; days_since_visit: number; points: number }) => ({
        line_user_id: r.line_user_id,
        points: r.points ?? 0,
        days: r.days_since_visit ?? 0,
      }))
    }
    case 'point_expiry_days': {
      const { data, error } = await supabase.rpc('get_point_expiry_users', {
        p_store_id: storeId,
        p_days_before: conditions.days_before ?? 7,
        p_expiry_days: conditions.expiry_days ?? 365,
      })
      if (error) { console.error('[eval] point_expiry_days:', error); return [] }
      return (data ?? []).map((r: { line_user_id: string; days_until_expiry: number; points: number }) => ({
        line_user_id: r.line_user_id,
        points: r.points ?? 0,
        days: r.days_until_expiry ?? 0,
      }))
    }
    case 'point_threshold': {
      const { data, error } = await supabase.rpc('get_point_threshold_users', {
        p_store_id: storeId,
        p_min_points: conditions.min_points ?? 100,
      })
      if (error) { console.error('[eval] point_threshold:', error); return [] }
      return (data ?? []).map((r: { line_user_id: string; points: number }) => ({
        line_user_id: r.line_user_id,
        points: r.points ?? 0,
        days: 0,
      }))
    }
    default:
      console.warn('[eval] unknown trigger_type:', triggerType)
      return []
  }
}

// ─── クールダウンフィルター ───────────────────────────────────────────────────
async function filterCooldown(
  users: UserData[],
  triggerId: string,
  cooldownDays: number
): Promise<UserData[]> {
  if (users.length === 0) return []
  const lineUserIds = users.map(u => u.line_user_id)
  const cutoff = new Date(Date.now() - cooldownDays * 86400000).toISOString()
  const { data } = await supabase
    .from('marketing_send_logs')
    .select('line_user_id')
    .eq('trigger_id', triggerId)
    .eq('status', 'sent')
    .gte('sent_at', cutoff)
    .in('line_user_id', lineUserIds)
  const recentSet = new Set((data ?? []).map((r: { line_user_id: string }) => r.line_user_id))
  return users.filter(u => !recentSet.has(u.line_user_id))
}

// ─── 表示名の付与 + ブロック済み除外 ─────────────────────────────────────────
async function enrichAndFilterBlocked(users: UserData[]): Promise<UserData[]> {
  if (users.length === 0) return []
  const ids = users.map(u => u.line_user_id)
  const { data } = await supabase
    .from('customer_identity')
    .select('line_user_id, display_name, line_blocked')
    .in('line_user_id', ids)
  const map = new Map(
    (data ?? []).map((r: { line_user_id: string; display_name: string | null; line_blocked: boolean }) => [r.line_user_id, r])
  )
  return users
    .filter(u => map.get(u.line_user_id)?.line_blocked !== true)
    .map(u => ({ ...u, name: (map.get(u.line_user_id)?.display_name as string | null) ?? undefined }))
}

// ─── メインハンドラー ─────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // シークレット検証
  const secret = req.headers.get('x-trigger-secret')
  const expected = Deno.env.get('MARKETING_TRIGGER_SECRET')
  if (expected && secret !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const targetStoreId: string | null = body.store_id ?? null

  // アクティブなトリガーを全取得
  let query = supabase
    .from('marketing_triggers')
    .select('*, marketing_message_templates(content)')
    .eq('is_active', true)
  if (targetStoreId) query = query.eq('store_id', targetStoreId)

  const { data: triggers, error: tErr } = await query
  if (tErr) return new Response(JSON.stringify({ error: tErr }), { status: 500 })

  const results = []

  for (const trigger of (triggers ?? [])) {
    const storeId: string = trigger.store_id

    // LINE アクセストークン取得
    const { data: creds } = await supabase
      .from('store_line_credentials')
      .select('line_channel_access_token')
      .eq('store_id', storeId)
      .single()
    if (!creds?.line_channel_access_token) {
      console.warn(`[${storeId}] LINE credentials not found`)
      continue
    }

    // 店舗名取得（{store_name} 変数用）
    const { data: storeProfile } = await supabase
      .from('store_profiles')
      .select('store_name_jp, store_name_ja')
      .eq('store_id', storeId)
      .single()
    const storeName = storeProfile?.store_name_jp ?? storeProfile?.store_name_ja ?? storeId

    // トリガー条件を評価
    const candidates = await evaluateTrigger(
      trigger.trigger_type,
      trigger.conditions ?? {},
      storeId
    )

    // クールダウン除外
    const cooled = await filterCooldown(candidates, trigger.id, trigger.cooldown_days)

    // ブロック済み除外 + 表示名付与（{name} 変数用）
    let eligible = await enrichAndFilterBlocked(cooled)

    // ★ 配信頻度制限チェック（直近N日に上限超過した受信者を除外）
    {
      const { allowed, capped } = await filterByFrequencyCap(storeId, eligible.map(u => u.line_user_id))
      if (capped > 0) {
        eligible = eligible.filter(u => allowed.has(u.line_user_id))
        console.warn(`[${trigger.name}] frequency cap excluded ${capped} recipient(s)`)
      }
    }

    // ★ 月間通数上限チェック
    const { used, limit } = await getMonthlyQuota(storeId)
    if (limit != null) {
      const remaining = Math.max(0, limit - used)
      if (eligible.length > remaining) {
        console.warn(`[${trigger.name}] monthly limit(${limit}) reached: trimming ${eligible.length} -> ${remaining}`)
        eligible = eligible.slice(0, remaining)
      }
    }

    const templateMessages: unknown[] = trigger.marketing_message_templates?.content ?? []
    if (templateMessages.length === 0) {
      console.warn(`[${trigger.id}] no message content`)
      continue
    }

    // LINE送信 & ログ記録
    let sent = 0, failed = 0
    for (const userData of eligible) {
      const logId = crypto.randomUUID()
      // ユーザー固有の変数を置換
      const substituted = substituteVars(templateMessages, userData, storeName)
      // クリック計測: 最初のリンクを計測URLに差し替え
      const { messages, linkUrl } = wrapFirstLink(substituted, logId)

      const result = await sendLineMessage(creds.line_channel_access_token, userData.line_user_id, messages as unknown[])
      let status = result.ok ? 'sent' : 'failed'
      if (!result.ok && result.blocked) {
        status = 'blocked'
        await markBlocked(userData.line_user_id)
      }
      await supabase.from('marketing_send_logs').insert({
        id:           logId,
        trigger_id:   trigger.id,
        store_id:     storeId,
        line_user_id: userData.line_user_id,
        status,
        link_url:     linkUrl,
      })
      result.ok ? sent++ : failed++
    }

    console.log(`[${trigger.name}] candidates:${candidates.length} eligible:${eligible.length} sent:${sent} failed:${failed}`)
    results.push({
      trigger_id: trigger.id,
      name:       trigger.name,
      store_id:   storeId,
      candidates: candidates.length,
      eligible:   eligible.length,
      sent,
      failed,
    })
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
