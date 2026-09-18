import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
// createClient は型注釈（ReturnType<typeof createClient>）でも使うため残す。
// 鍵の取得だけを _shared/keys.ts 経由に変更している。
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { logKeyMode, serviceKey, supabaseUrl } from '../_shared/keys.ts'

const SUPABASE_URL = supabaseUrl()!
const SUPABASE_SERVICE_ROLE_KEY = serviceKey()!
const MARKETING_TRIGGER_SECRET = Deno.env.get('MARKETING_TRIGGER_SECRET') ?? ''

logKeyMode('marketing-blast-runner')

interface SegmentConditions {
  no_visit_days?: number | null
  min_balance?: number | null
  max_balance?: number | null
  min_total?: number | null
  rank_id?: string | null
  friend_source_code?: string | null
  min_visits?: number | null
  last_score_min?: number | null
  last_score_max?: number | null
  clicked_within_days?: number | null
  gender?: string | null
  age_bands?: string[] | null
  areas?: string[] | null
  birth_month?: number | null
  birth_month_current?: boolean | null
}

// line_user_id の末尾16進数を使って A/B を 50/50 に分割（決定論的）
function abSplit(lineUserId: string, group: 'A' | 'B'): boolean {
  const hex = lineUserId.replace(/[^0-9a-fA-F]/g, '')
  const lastChar = hex.slice(-1) || '0'
  const num = parseInt(lastChar, 16) // 0-15
  return group === 'A' ? num % 2 === 0 : num % 2 === 1
}

// ── 月間通数クォータ（JST月初から status='sent' を集計）──────────────────────
async function getMonthlyQuota(
  db: ReturnType<typeof createClient>,
  storeId: string
): Promise<{ used: number; limit: number | null }> {
  const { data: sp } = await db
    .from('store_profiles')
    .select('line_monthly_message_limit')
    .eq('store_id', storeId)
    .maybeSingle()
  const limit = (sp?.line_monthly_message_limit as number | null) ?? null
  const nowJst = new Date(Date.now() + 9 * 3600000)
  const monthStartUtc = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), 1) - 9 * 3600000).toISOString()
  const { count } = await db
    .from('marketing_send_logs')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'sent')
    .gte('sent_at', monthStartUtc)
  return { used: count ?? 0, limit }
}

// ── 配信頻度制限（直近N日に上限回数を超えて受信したユーザーを除外）──────────────
async function getFrequencyCap(
  db: ReturnType<typeof createClient>,
  storeId: string
): Promise<{ count: number | null; days: number }> {
  const { data } = await db
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
  db: ReturnType<typeof createClient>,
  storeId: string,
  lineUserIds: string[]
): Promise<{ allowed: string[]; capped: number; cap: { count: number | null; days: number } }> {
  const cap = await getFrequencyCap(db, storeId)
  if (cap.count == null || lineUserIds.length === 0) return { allowed: lineUserIds, capped: 0, cap }
  const cutoff = new Date(Date.now() - cap.days * 86400000).toISOString()
  const tally = new Map<string, number>()
  // ★ サーバー側で GROUP BY 集計（行数=ユーザー数なので max_rows 切り捨ての影響を受けない）
  const CHUNK = 150
  for (let i = 0; i < lineUserIds.length; i += CHUNK) {
    const chunk = lineUserIds.slice(i, i + CHUNK)
    const { data, error } = await db.rpc('marketing_freq_counts', {
      p_store_id: storeId,
      p_cutoff: cutoff,
      p_user_ids: chunk,
    })
    if (error) {
      // 集計失敗時は安全側（送らない＝全員除外）に倒す
      console.error('[blast-runner] freq_counts rpc failed, excluding chunk:', error.message)
      for (const uid of chunk) tally.set(uid, cap.count!)
      continue
    }
    for (const r of (data ?? []) as Array<{ line_user_id: string; cnt: number }>) {
      tally.set(r.line_user_id, Number(r.cnt) || 0)
    }
  }
  const allowed = lineUserIds.filter(uid => (tally.get(uid) ?? 0) < cap.count!)
  return { allowed, capped: lineUserIds.length - allowed.length, cap }
}

// ── ブロック検知付き送信 ──────────────────────────────────────────────────────
async function sendLineMessages(
  token: string,
  lineUserId: string,
  messages: unknown
): Promise<{ ok: boolean; blocked: boolean }> {
  const msgs = Array.isArray(messages) ? messages : [messages]
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: msgs }),
  })
  if (res.ok) return { ok: true, blocked: false }
  const bodyText = await res.text().catch(() => '')
  console.error(`[blast-runner] push failed ${lineUserId.slice(0, 8)}: ${res.status} ${bodyText}`)
  const blocked = res.status === 403 || /hasn't added|blocked/i.test(bodyText)
  return { ok: false, blocked }
}

async function markBlocked(db: ReturnType<typeof createClient>, lineUserId: string) {
  await db
    .from('customer_identity')
    .update({ line_blocked: true, line_blocked_at: new Date().toISOString() })
    .eq('line_user_id', lineUserId)
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (MARKETING_TRIGGER_SECRET && authHeader.replace('Bearer ', '') !== MARKETING_TRIGGER_SECRET) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: blasts, error: blastErr } = await db
    .from('marketing_blasts')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .select('id, store_id, name, template_id, segment_conditions, ab_group, ab_pair_id')

  if (blastErr) return new Response(JSON.stringify({ error: blastErr.message }), { status: 500 })

  let totalProcessed = 0
  for (const blast of blasts ?? []) {
    try {
      await processBlast(db, blast)
      totalProcessed++
    } catch (e) {
      console.error(`[blast-runner] blast ${blast.id} failed:`, e)
      await db.from('marketing_blasts').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', blast.id)
    }
  }

  // ── シナリオ分岐フォローアップ（クリック有無で分岐した追撃配信）──────────────
  let followupsProcessed = 0
  try {
    followupsProcessed = await processDueFollowups(db)
  } catch (e) {
    console.error('[blast-runner] followup processing failed:', e)
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed, followups: followupsProcessed }), { status: 200 })
})

// ── フォローアップ実行 ────────────────────────────────────────────────────────
async function processDueFollowups(db: ReturnType<typeof createClient>): Promise<number> {
  const { data: fups } = await db
    .from('marketing_followups')
    .select('id, store_id, blast_id, condition, delay_hours, template_id')
    .eq('status', 'waiting')
  if (!fups || fups.length === 0) return 0

  let processed = 0
  for (const f of fups) {
    const { data: parent } = await db
      .from('marketing_blasts')
      .select('id, name, status, completed_at')
      .eq('id', f.blast_id)
      .maybeSingle()

    // 親が消滅・キャンセル・失敗 → フォローも中止
    if (!parent || parent.status === 'cancelled' || parent.status === 'failed') {
      await db.from('marketing_followups').update({ status: 'cancelled' }).eq('id', f.id)
      continue
    }
    if (parent.status !== 'completed' || !parent.completed_at) continue // 親の完了待ち

    const dueAt = new Date(parent.completed_at).getTime() + f.delay_hours * 3600000
    if (dueAt > Date.now()) continue // 待ち時間中

    // 多重実行防止（waiting → running の原子的クレーム）
    const { data: claimed } = await db
      .from('marketing_followups')
      .update({ status: 'running' })
      .eq('id', f.id)
      .eq('status', 'waiting')
      .select('id')
    if (!claimed || claimed.length === 0) continue

    try {
      const executedId = await processFollowup(db, f, parent as { id: string; name: string })
      await db.from('marketing_followups').update({ status: 'completed', executed_blast_id: executedId }).eq('id', f.id)
      processed++
    } catch (e) {
      console.error(`[blast-runner] followup ${f.id} failed:`, e)
      await db.from('marketing_followups').update({ status: 'failed' }).eq('id', f.id)
    }
  }
  return processed
}

async function processFollowup(
  db: ReturnType<typeof createClient>,
  f: { id: string; store_id: string; blast_id: string; condition: string; delay_hours: number; template_id: string },
  parent: { id: string; name: string }
): Promise<string> {
  const { store_id } = f
  const condLabel = f.condition === 'clicked' ? 'クリックした人' : 'クリックしなかった人'

  // 親配信の送信ログから条件に合う対象を抽出
  let logQ = db
    .from('marketing_send_logs')
    .select('line_user_id, clicked_at')
    .eq('blast_id', f.blast_id)
    .eq('status', 'sent')
  logQ = f.condition === 'clicked' ? logQ.not('clicked_at', 'is', null) : logQ.is('clicked_at', null)
  const { data: logs } = await logQ
  const lineUserIds = [...new Set((logs ?? []).map((l: { line_user_id: string }) => l.line_user_id))]

  // 実行記録用の blast 行を作成（レポート・一覧に表示される）
  const nowIso = new Date().toISOString()
  const { data: fblast, error: fbErr } = await db
    .from('marketing_blasts')
    .insert({
      store_id,
      name: `[フォロー:${condLabel}] ${parent.name}`,
      template_id: f.template_id,
      scheduled_at: nowIso,
      status: 'running',
      started_at: nowIso,
      note: `シナリオ分岐: 親配信「${parent.name}」の${condLabel}へ ${f.delay_hours}時間後に自動配信`,
    })
    .select('id')
    .single()
  if (fbErr || !fblast) throw new Error(`followup blast insert failed: ${fbErr?.message}`)
  const executedId = fblast.id as string

  if (lineUserIds.length === 0) {
    await db.from('marketing_blasts').update({ status: 'completed', target_count: 0, sent_count: 0, failed_count: 0, completed_at: new Date().toISOString() }).eq('id', executedId)
    return executedId
  }

  // テンプレート・トークン・店舗名
  const { data: tpl } = await db.from('marketing_message_templates').select('content').eq('id', f.template_id).single()
  if (!tpl) throw new Error(`Template not found: ${f.template_id}`)
  let accessToken: string | null = null
  const { data: cred } = await db.from('store_line_credentials').select('line_channel_access_token').eq('store_id', store_id).maybeSingle()
  accessToken = cred?.line_channel_access_token ?? null
  if (!accessToken) {
    const { data: sp } = await db.from('store_profiles').select('line_channel_access_token').eq('store_id', store_id).maybeSingle()
    accessToken = sp?.line_channel_access_token ?? null
  }
  if (!accessToken) throw new Error(`LINE token not set for store: ${store_id}`)
  const { data: profile } = await db.from('store_profiles').select('store_name_ja').eq('store_id', store_id).maybeSingle()
  const storeName = profile?.store_name_ja ?? store_id

  // 表示名・ブロック状態・残高をバッチ取得
  const { data: idents } = await db
    .from('customer_identity')
    .select('id, line_user_id, display_name, line_blocked')
    .in('line_user_id', lineUserIds)
  const identMap = new Map(
    (idents ?? []).map((r: { id: string; line_user_id: string; display_name: string | null; line_blocked: boolean }) => [r.line_user_id, r])
  )
  const identityIds = (idents ?? []).map((r: { id: string }) => r.id)
  const { data: wallets } = identityIds.length > 0
    ? await db.from('customer_points_wallet').select('identity_id, balance').eq('scope_type', 'store').eq('scope_id', store_id).in('identity_id', identityIds)
    : { data: [] }
  const balanceMap = new Map(
    (wallets ?? []).map((w: { identity_id: string; balance: number }) => [w.identity_id, w.balance])
  )

  // ブロック済み除外
  let targets = lineUserIds.filter(uid => identMap.get(uid)?.line_blocked !== true)
  const fupNotes: string[] = []

  // 配信頻度制限
  {
    const { allowed, capped, cap } = await filterByFrequencyCap(db, store_id, targets)
    if (capped > 0) {
      const allowSet = new Set(allowed)
      targets = targets.filter(uid => allowSet.has(uid))
      fupNotes.push(`配信頻度制限（${cap.days}日で${cap.count}通まで）により ${capped} 件を除外`)
    }
  }

  // 月間通数上限
  const { used, limit } = await getMonthlyQuota(db, store_id)
  if (limit != null) {
    const remaining = Math.max(0, limit - used)
    if (targets.length > remaining) {
      fupNotes.push(`月間配信上限(${limit}通)により ${targets.length - remaining} 件をスキップ`)
      targets = targets.slice(0, remaining)
    }
  }
  await db.from('marketing_blasts').update({ target_count: targets.length, note: fupNotes.length ? fupNotes.join(' / ') : undefined }).eq('id', executedId)

  let sentCount = 0, failedCount = 0
  for (const lineUserId of targets) {
    const ident = identMap.get(lineUserId)
    const logId = crypto.randomUUID()
    const substituted = substituteVariables(tpl.content, {
      store_name: storeName,
      points: String(ident ? balanceMap.get(ident.id) ?? 0 : 0),
      days: String(Math.round(f.delay_hours / 24)),
      name: (ident?.display_name ?? '').trim() || 'お客様',
    })
    const { messages, linkUrl } = wrapFirstLink(substituted, logId)
    const result = await sendLineMessages(accessToken, lineUserId, messages)
    let status = result.ok ? 'sent' : 'failed'
    if (!result.ok && result.blocked) {
      status = 'blocked'
      await markBlocked(db, lineUserId)
    }
    result.ok ? sentCount++ : failedCount++
    await db.from('marketing_send_logs').insert({ id: logId, blast_id: executedId, store_id, line_user_id: lineUserId, sent_at: new Date().toISOString(), status, link_url: linkUrl })
  }

  await db.from('marketing_blasts').update({ status: 'completed', sent_count: sentCount, failed_count: failedCount, completed_at: new Date().toISOString() }).eq('id', executedId)
  console.log(`[blast-runner] followup ${f.id} (${condLabel}) done: targets=${targets.length} sent=${sentCount} failed=${failedCount}`)
  return executedId
}

async function resolveTargets(
  db: ReturnType<typeof createClient>,
  store_id: string,
  seg: SegmentConditions
): Promise<Array<{ identity_id: string; line_user_id: string; balance: number; display_name: string | null }>> {
  let q = db
    .from('customer_points_wallet')
    .select('identity_id, balance, total_earned, customer_identity!inner(line_user_id, display_name, line_blocked)')
    .eq('scope_type', 'store')
    .eq('scope_id', store_id)
    .eq('customer_identity.line_blocked', false) // ★ ブロック済みユーザーを除外

  // 流入経路フィルタ（友だち追加計測QR）
  if (seg.friend_source_code) q = q.eq('customer_identity.friend_source_code', seg.friend_source_code)

  if (seg.min_balance != null) q = q.gte('balance', seg.min_balance)
  if (seg.max_balance != null) q = q.lte('balance', seg.max_balance)
  if (seg.min_total != null)   q = q.gte('total_earned', seg.min_total)

  if (seg.rank_id) {
    const { data: tier } = await db
      .from('store_loyalty_tiers')
      .select('min_points')
      .eq('id', seg.rank_id)
      .maybeSingle()
    if (tier?.min_points != null) q = q.gte('total_earned', tier.min_points)
  }

  const { data: wallets } = await q
  let targets = (wallets ?? []).filter(
    (w: Record<string, unknown>) => !!(w.customer_identity as Record<string, unknown>)?.line_user_id
  ) as Array<{ identity_id: string; balance: number; total_earned: number; customer_identity: { line_user_id: string; display_name: string | null } }>

  if (seg.no_visit_days != null && seg.no_visit_days > 0) {
    const cutoff = new Date(Date.now() - seg.no_visit_days * 86400000).toISOString()
    const { data: recent } = await db
      .from('customer_points_ledger')
      .select('identity_id')
      .eq('store_id', store_id)
      .in('action_type', ['visit', 'survey'])
      .gt('occurred_at', cutoff)
    const recentSet = new Set((recent ?? []).map((r: { identity_id: string }) => r.identity_id))
    targets = targets.filter(t => !recentSet.has(t.identity_id))
  }

  // 来店回数フィルター（visit/survey 件数 >= min_visits）
  if (seg.min_visits != null && seg.min_visits > 0 && targets.length > 0) {
    const ids = targets.map(t => t.identity_id)
    const { data: vc } = await db.rpc('marketing_visit_counts', { p_store_id: store_id, p_identity_ids: ids })
    const okSet = new Set((vc ?? []).filter((r: { cnt: number }) => Number(r.cnt) >= seg.min_visits!).map((r: { identity_id: string }) => r.identity_id))
    targets = targets.filter(t => okSet.has(t.identity_id))
  }

  // 評価スコアフィルター（最新レビューのスコアが範囲内 / レビュー未投稿は対象外）
  if ((seg.last_score_min != null || seg.last_score_max != null) && targets.length > 0) {
    const lineIds = targets.map(t => t.customer_identity.line_user_id).filter(Boolean)
    const { data: ls } = await db.rpc('marketing_last_scores', { p_store_id: store_id, p_line_user_ids: lineIds })
    const scoreMap = new Map<string, number>((ls ?? []).map((r: { line_user_id: string; last_score: number }) => [r.line_user_id, Number(r.last_score)]))
    targets = targets.filter(t => {
      const s = scoreMap.get(t.customer_identity.line_user_id)
      if (s == null) return false
      if (seg.last_score_min != null && s < seg.last_score_min) return false
      if (seg.last_score_max != null && s > seg.last_score_max) return false
      return true
    })
  }

  // クリック反応フィルター（直近N日に配信リンクをクリック）
  if (seg.clicked_within_days != null && seg.clicked_within_days > 0 && targets.length > 0) {
    const cutoff = new Date(Date.now() - seg.clicked_within_days * 86400000).toISOString()
    const lineIds = targets.map(t => t.customer_identity.line_user_id).filter(Boolean)
    const { data: cu } = await db.rpc('marketing_clicked_users', { p_store_id: store_id, p_cutoff: cutoff, p_line_user_ids: lineIds })
    const clickedSet = new Set((cu ?? []).map((r: { line_user_id: string }) => r.line_user_id))
    targets = targets.filter(t => clickedSet.has(t.customer_identity.line_user_id))
  }

  // デモグラフィックフィルター（性別・年齢帯・地域・誕生月）
  const ageSet = Array.isArray(seg.age_bands) && seg.age_bands.length ? new Set(seg.age_bands) : null
  const areaSet = Array.isArray(seg.areas) && seg.areas.length ? new Set(seg.areas) : null
  // 誕生月: 今月(birth_month_current) は送信時のJST月で解決
  const targetBirthMonth = seg.birth_month_current
    ? new Date(Date.now() + 9 * 3600000).getUTCMonth() + 1
    : (seg.birth_month != null ? Number(seg.birth_month) : null)
  if ((seg.gender || ageSet || areaSet || targetBirthMonth != null) && targets.length > 0) {
    const lineIds = targets.map(t => t.customer_identity.line_user_id).filter(Boolean)
    const { data: dm } = await db.rpc('marketing_demographics', { p_store_id: store_id, p_line_user_ids: lineIds })
    const demoMap = new Map<string, { gender: string | null; age_band: string | null; area: string | null; birth_month: number | null }>(
      (dm ?? []).map((r: { line_user_id: string; gender: string | null; age_band: string | null; area: string | null; birth_month: number | null }) => [r.line_user_id, r])
    )
    targets = targets.filter(t => {
      const d = demoMap.get(t.customer_identity.line_user_id)
      if (!d) return false
      if (seg.gender && d.gender !== seg.gender) return false
      if (ageSet && !(d.age_band && ageSet.has(d.age_band))) return false
      if (areaSet && !(d.area && areaSet.has(d.area))) return false
      if (targetBirthMonth != null && d.birth_month !== targetBirthMonth) return false
      return true
    })
  }

  return targets.map(t => ({
    identity_id: t.identity_id,
    line_user_id: t.customer_identity.line_user_id,
    balance: t.balance,
    display_name: t.customer_identity.display_name ?? null,
  }))
}

async function processBlast(
  db: ReturnType<typeof createClient>,
  blast: { id: string; store_id: string; name: string; template_id: string; segment_conditions: SegmentConditions | null; ab_group: string | null; ab_pair_id: string | null }
) {
  const { store_id, template_id } = blast
  const seg: SegmentConditions = blast.segment_conditions ?? {}

  const { data: tpl } = await db.from('marketing_message_templates').select('content').eq('id', template_id).single()
  if (!tpl) throw new Error(`Template not found: ${template_id}`)

  // トークン取得: store_line_credentials → store_profiles の順
  let accessToken: string | null = null
  const { data: cred } = await db.from('store_line_credentials').select('line_channel_access_token').eq('store_id', store_id).maybeSingle()
  accessToken = cred?.line_channel_access_token ?? null
  if (!accessToken) {
    const { data: sp } = await db.from('store_profiles').select('line_channel_access_token').eq('store_id', store_id).maybeSingle()
    accessToken = sp?.line_channel_access_token ?? null
  }
  if (!accessToken) throw new Error(`LINE token not set for store: ${store_id}`)

  const { data: profile } = await db.from('store_profiles').select('store_name_ja').eq('store_id', store_id).maybeSingle()
  const storeName = profile?.store_name_ja ?? store_id

  let targets = await resolveTargets(db, store_id, seg)

  // A/B テスト: line_user_id の末尾 hex を使って 50/50 に分割
  if (blast.ab_group === 'A' || blast.ab_group === 'B') {
    targets = targets.filter(t => abSplit(t.line_user_id, blast.ab_group as 'A' | 'B'))
    console.log(`[blast-runner] ${blast.id} A/B=${blast.ab_group}: ${targets.length} targets after split`)
  } else {
    console.log(`[blast-runner] ${blast.id}: ${targets.length} targets (seg=${JSON.stringify(seg)})`)
  }

  // ★ 配信頻度制限チェック（直近N日に上限超過した受信者を除外）
  const notes: string[] = []
  {
    const { allowed, capped, cap } = await filterByFrequencyCap(db, store_id, targets.map(t => t.line_user_id))
    if (capped > 0) {
      const allowSet = new Set(allowed)
      targets = targets.filter(t => allowSet.has(t.line_user_id))
      const note = `配信頻度制限（${cap.days}日で${cap.count}通まで）により ${capped} 件を除外`
      console.warn(`[blast-runner] ${blast.id}: ${note}`)
      notes.push(note)
    }
  }

  // ★ 月間通数上限チェック（上限超過分は送信しない）
  const { used, limit } = await getMonthlyQuota(db, store_id)
  if (limit != null) {
    const remaining = Math.max(0, limit - used)
    if (targets.length > remaining) {
      const note = `月間配信上限(${limit}通)により ${targets.length - remaining} 件をスキップ（今月送信済み: ${used}通）`
      console.warn(`[blast-runner] ${blast.id}: ${note}`)
      notes.push(note)
      targets = targets.slice(0, remaining)
    }
  }

  await db.from('marketing_blasts').update({ target_count: targets.length, note: notes.length ? notes.join(' / ') : null }).eq('id', blast.id)

  let sentCount = 0, failedCount = 0
  for (const target of targets) {
    const logId = crypto.randomUUID()
    const substituted = substituteVariables(tpl.content, {
      store_name: storeName,
      points: String(target.balance ?? 0),
      days: '0',
      name: (target.display_name ?? '').trim() || 'お客様',
    })
    // クリック計測: 最初のリンクを計測URLに差し替え
    const { messages, linkUrl } = wrapFirstLink(substituted, logId)
    const result = await sendLineMessages(accessToken, target.line_user_id, messages)
    let status = result.ok ? 'sent' : 'failed'
    if (!result.ok && result.blocked) {
      status = 'blocked'
      await markBlocked(db, target.line_user_id)
    }
    result.ok ? sentCount++ : failedCount++
    await db.from('marketing_send_logs').insert({ id: logId, blast_id: blast.id, store_id, line_user_id: target.line_user_id, sent_at: new Date().toISOString(), status, link_url: linkUrl })
  }

  await db.from('marketing_blasts').update({ status: 'completed', sent_count: sentCount, failed_count: failedCount, completed_at: new Date().toISOString() }).eq('id', blast.id)
  console.log(`[blast-runner] ${blast.id} done: sent=${sentCount} failed=${failedCount}`)
}

function substituteVariables(content: unknown, vars: Record<string, string>): unknown {
  return JSON.parse(JSON.stringify(content).replace(/\{(\w+)\}/g, (_: string, k: string) => vars[k] ?? `{${k}}`))
}

// ── クリック計測: メッセージ内の最初のリンクを計測URLに差し替える ──────────────
const TRACK_BASE = 'https://api.review-ai.xyz/functions/v1/marketing-click'

export function wrapFirstLink(messages: unknown, logId: string): { messages: unknown; linkUrl: string | null } {
  let linkUrl: string | null = null
  const trackUrl = `${TRACK_BASE}?l=${logId}`
  // ① Flexボタン等の uri アクションを優先してラップ
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
  // ② uriアクションが無ければテキスト本文中の最初のURLをラップ
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
