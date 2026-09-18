import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MARKETING_TRIGGER_SECRET = Deno.env.get('MARKETING_TRIGGER_SECRET') ?? ''

// JST 時刻で次回の実行 UTC を計算
function calcNextRunAt(
  type: 'daily' | 'weekly' | 'monthly',
  day: number | null,
  sendTimeJst: string,
  after: Date = new Date()
): Date {
  const [h, m] = sendTimeJst.split(':').map(Number)
  const JST = 9 * 3600000

  const afterJst = new Date(after.getTime() + JST)
  const jstY   = afterJst.getUTCFullYear()
  const jstMo  = afterJst.getUTCMonth()
  const jstD   = afterJst.getUTCDate()
  const jstDow = afterJst.getUTCDay()
  const jstH   = afterJst.getUTCHours()
  const jstMin = afterJst.getUTCMinutes()

  const isPast = jstH * 60 + jstMin >= h * 60 + m
  const toUtc = (y: number, mo: number, d: number): Date =>
    new Date(Date.UTC(y, mo, d, h, m) - JST)

  if (type === 'daily') {
    return isPast ? toUtc(jstY, jstMo, jstD + 1) : toUtc(jstY, jstMo, jstD)
  }
  if (type === 'weekly') {
    const target = day ?? 1
    let diff = (target - jstDow + 7) % 7
    if (diff === 0 && isPast) diff = 7
    return toUtc(jstY, jstMo, jstD + diff)
  }
  if (type === 'monthly') {
    const target = Math.max(1, Math.min(31, day ?? 1))
    if (jstD < target || (jstD === target && !isPast)) return toUtc(jstY, jstMo, target)
    return toUtc(jstY, jstMo + 1, target)
  }
  return new Date(after.getTime() + 86400000)
}

function recurrenceLabel(type: string, day: number | null, sendTime: string): string {
  const DOW = ['日', '月', '火', '水', '木', '金', '土']
  if (type === 'daily')   return `毎日 ${sendTime}`
  if (type === 'weekly')  return `毎週${DOW[day ?? 1]}曜 ${sendTime}`
  if (type === 'monthly') return `毎月${day ?? 1}日 ${sendTime}`
  return type
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (MARKETING_TRIGGER_SECRET && auth.replace('Bearer ', '') !== MARKETING_TRIGGER_SECRET) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()

  const { data: schedules, error } = await db
    .from('marketing_recurring_schedules')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', now.toISOString())
    .not('next_run_at', 'is', null)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  if (!schedules || schedules.length === 0)
    return new Response(JSON.stringify({ ok: true, fired: 0 }), { status: 200 })

  console.log(`[recurring-runner] ${schedules.length} schedule(s) due`)

  let fired = 0
  for (const s of schedules) {
    try {
      const label = recurrenceLabel(s.recurrence_type, s.recurrence_day, s.send_time)
      const baseName = `[${label}] ${s.name}`
      const scheduledAt = new Date(now.getTime() - 1000).toISOString()

      if (s.is_ab_test && s.template_id_b) {
        // A/Bテスト: 同一 ab_pair_id で A・B 2件同時作成
        const ab_pair_id = crypto.randomUUID()
        await db.from('marketing_blasts').insert([
          {
            store_id:           s.store_id,
            name:               `${baseName} [A]`,
            template_id:        s.template_id,
            scheduled_at:       scheduledAt,
            segment_conditions: s.segment_conditions ?? null,
            ab_group:           'A',
            ab_pair_id,
          },
          {
            store_id:           s.store_id,
            name:               `${baseName} [B]`,
            template_id:        s.template_id_b,
            scheduled_at:       scheduledAt,
            segment_conditions: s.segment_conditions ?? null,
            ab_group:           'B',
            ab_pair_id,
          },
        ])
        console.log(`[recurring-runner] A/B fired: ${s.name} (pair=${ab_pair_id})`)
      } else {
        // 通常配信
        await db.from('marketing_blasts').insert({
          store_id:           s.store_id,
          name:               baseName,
          template_id:        s.template_id,
          scheduled_at:       scheduledAt,
          segment_conditions: s.segment_conditions ?? null,
        })
        console.log(`[recurring-runner] fired: ${s.name}`)
      }

      const nextRun = calcNextRunAt(
        s.recurrence_type as 'daily' | 'weekly' | 'monthly',
        s.recurrence_day,
        s.send_time,
        now
      )
      await db.from('marketing_recurring_schedules').update({
        last_run_at: now.toISOString(),
        next_run_at: nextRun.toISOString(),
      }).eq('id', s.id)

      fired++
    } catch (e) {
      console.error(`[recurring-runner] error for schedule ${s.id}:`, e)
    }
  }

  return new Response(JSON.stringify({ ok: true, fired }), { status: 200 })
})
