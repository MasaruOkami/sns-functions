import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MARKETING_TRIGGER_SECRET = Deno.env.get('MARKETING_TRIGGER_SECRET') ?? ''

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const secret = authHeader.replace('Bearer ', '')
  if (MARKETING_TRIGGER_SECRET && secret !== MARKETING_TRIGGER_SECRET) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body: { store_id?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  const filterStoreId = body.store_id ?? null

  // display_name 未取得の LINE ユーザーを取得
  let query = db
    .from('customer_identity')
    .select('id, line_user_id')
    .not('line_user_id', 'is', null)
    .is('display_name', null)
    .limit(200)

  if (filterStoreId) {
    const { data: wallets } = await db
      .from('customer_points_wallet')
      .select('identity_id')
      .eq('scope_type', 'store')
      .eq('scope_id', filterStoreId)
    const ids = (wallets ?? []).map((w: { identity_id: string }) => w.identity_id)
    if (ids.length === 0) {
      return new Response(JSON.stringify({ ok: true, updated: 0, skipped: 0 }), { status: 200 })
    }
    query = query.in('id', ids)
  }

  const { data: identities, error: idErr } = await query
  if (idErr) return new Response(JSON.stringify({ error: idErr.message }), { status: 500 })
  if (!identities || identities.length === 0) {
    return new Response(JSON.stringify({ ok: true, updated: 0, skipped: 0 }), { status: 200 })
  }

  console.log(`[backfill] ${identities.length} users to process`)

  // store_id → token キャッシュ
  const tokenCache = new Map<string, string>()

  async function getTokenForUser(identityId: string): Promise<string | null> {
    const { data: wallet } = await db
      .from('customer_points_wallet')
      .select('scope_id')
      .eq('identity_id', identityId)
      .eq('scope_type', 'store')
      .limit(1)
      .maybeSingle()
    if (!wallet?.scope_id) return null

    const storeId = wallet.scope_id as string
    if (tokenCache.has(storeId)) return tokenCache.get(storeId)!

    // 1️⃣ store_line_credentials を先に確認
    const { data: cred } = await db
      .from('store_line_credentials')
      .select('line_channel_access_token')
      .eq('store_id', storeId)
      .maybeSingle()
    let token = cred?.line_channel_access_token ?? null

    // 2️⃣ なければ store_profiles にフォールバック
    if (!token) {
      const { data: profile } = await db
        .from('store_profiles')
        .select('line_channel_access_token')
        .eq('store_id', storeId)
        .maybeSingle()
      token = profile?.line_channel_access_token ?? null
    }

    if (token) tokenCache.set(storeId, token)
    return token
  }

  let updated = 0
  let skipped = 0

  for (const identity of identities) {
    const lineUserId = identity.line_user_id as string
    const token = await getTokenForUser(identity.id as string)
    if (!token) { skipped++; continue }

    try {
      const res = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        console.warn(`[backfill] LINE API ${res.status} for ${lineUserId.slice(0, 8)}`)
        skipped++
        continue
      }

      const profile = await res.json() as { displayName?: string; pictureUrl?: string }
      if (!profile.displayName) { skipped++; continue }

      await db
        .from('customer_identity')
        .update({
          display_name: profile.displayName,
          picture_url: profile.pictureUrl ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', identity.id)

      updated++
      console.log(`[backfill] ✅ ${lineUserId.slice(0, 8)} → ${profile.displayName}`)
    } catch (e) {
      console.error(`[backfill] error for ${lineUserId.slice(0, 8)}:`, e)
      skipped++
    }
  }

  console.log(`[backfill] done: updated=${updated} skipped=${skipped}`)
  return new Response(
    JSON.stringify({ ok: true, updated, skipped, total: identities.length }),
    { status: 200 }
  )
})
