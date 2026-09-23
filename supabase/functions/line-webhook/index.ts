import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// 鍵の解決は ../_shared/keys.ts に集約（新方式 sb_secret_ / レガシー両対応）
import { adminClient } from '../_shared/keys.ts'

const supabase = adminClient('line-webhook')

// LINE Push メッセージ送信
async function linePush(to: string, channelToken: string, text: string) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelToken}`,
    },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  })
  if (!res.ok) {
    console.error('[line-push] failed:', res.status, await res.text())
  }
}

// submission_id に紐づく review に line_user_id をセットし、AI口コミをプッシュする共通処理。
// follow イベント（start.data=submissionId）と message イベント（"REVIEW:{sid}"）の両方で使用。
async function linkReviewAndSendAiMessage(userId: string, submissionId: string, logPrefix: string) {
  // reviews テーブルから AI生成口コミを取得
  const { data: review } = await supabase
    .from('reviews')
    .select('id, store_id, submission_id, review_options, line_user_id')
    .eq('submission_id', submissionId)
    .maybeSingle()

  if (!review) {
    console.warn(`${logPrefix} review not found for submission_id: ${submissionId}`)
    return
  }

  // reviews に line_user_id を紐付け（ポイントシステム連携用）
  if (!review.line_user_id) {
    await supabase
      .from('reviews')
      .update({ line_user_id: userId })
      .eq('submission_id', submissionId)
  }

  // customer_identity に line_user_id がなければ新規作成
  const { data: existingId } = await supabase
    .from('customer_identity')
    .select('id')
    .eq('line_user_id', userId)
    .maybeSingle()
  if (!existingId) {
    await supabase.from('customer_identity').insert({
      line_user_id: userId,
      first_store_id: review.store_id,
    }).catch(() => { /* 重複はスキップ */ })
  }

  // 店舗情報（チャネルトークン + 店舗名 + Google口コミURL）を取得
  const { data: store } = await supabase
    .from('store_profiles')
    .select('store_name_jp, line_channel_access_token, review_url_google')
    .eq('store_id', review.store_id)
    .maybeSingle()

  const channelToken =
    (store?.line_channel_access_token as string | null) ||
    Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ||
    ''

  if (channelToken) {
    const opts = (review.review_options as Record<string, string>) ?? {}
    const reviewText =
      opts.style1?.trim() || opts.style2?.trim() || opts.style3?.trim() || ''

    if (reviewText) {
      const storeName = (store?.store_name_jp as string) || 'お店'
      const googleUrl = (store?.review_url_google as string) || ''

      let msg = `📝 ${storeName}へのクチコミ案文です！\n\n${reviewText}`

      if (googleUrl) {
        msg += `\n\n─────────\n上記の文をコピーして、Googleマップで投稿してください👇\n${googleUrl}`
      }

      await linePush(userId, channelToken, msg)
      console.log(`${logPrefix} sent AI review to ${userId} for submission ${submissionId}`)
    }
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.json()
    const events = body.events ?? []

    for (const event of events) {
      const userId = event.source?.userId
      if (!userId) continue

      const eventType = event.type // follow, unfollow, message など

      if (eventType === 'unfollow') {
        // ブロック・削除時は is_active を false に
        await supabase
          .from('line_users')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('user_id', userId)

        console.log(`unfollowed: ${userId}`)
        continue
      }

      if (eventType === 'follow' || eventType === 'message') {
        // 表示名を取得
        let displayName = ''
        try {
          const profileRes = await fetch(
            `https://api.line.me/v2/bot/profile/${userId}`,
            {
              headers: {
                Authorization: `Bearer ${Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')}`,
              },
            }
          )
          if (profileRes.ok) {
            const profile = await profileRes.json()
            displayName = profile.displayName ?? ''
          }
        } catch (e) {
          console.warn('プロフィール取得失敗:', e)
        }

        // line_users に upsert
        const { error } = await supabase
          .from('line_users')
          .upsert(
            {
              user_id: userId,
              display_name: displayName,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )

        if (error) {
          console.error('upsert error:', error)
        } else {
          console.log(`upserted: ${userId} (${displayName})`)
        }

        // ── follow イベント: start パラメータから submission_id を取得し、AI生成口コミを送信 ──
        if (eventType === 'follow') {
          // LINE follow event の start.data に submission_id が入っている
          // URL: https://line.me/R/ti/p/@botId?start=ENCODED_SUBMISSION_ID
          const startData: string | null = event.follow?.start?.data ?? null

          if (startData) {
            let startDecoded: string
            try {
              startDecoded = decodeURIComponent(startData)
            } catch {
              startDecoded = startData
            }

            console.log(`[follow] start data: ${startDecoded}`)

            // ── パターン A: checkin_STORE_ID（来店チェックイン anon_id マージ） ──
            if (startDecoded.startsWith('checkin_')) {
              const checkinStoreId = startDecoded.slice('checkin_'.length)
              console.log(`[follow] checkin merge for store: ${checkinStoreId}`)

              // customer_identity で anon_id から LINE ユーザーにマージ
              // anon_id は localStorage 'fe_anon_global' で管理されているが、
              // follow event では anon_id を直接取れないため、
              // 該当店舗の最新 anon_id identity を LINE で上書きする
              const { data: existing } = await supabase
                .from('customer_identity')
                .select('id, anon_id, line_user_id')
                .eq('line_user_id', userId)
                .maybeSingle()

              if (!existing) {
                // LINE未登録 → 新規作成
                await supabase.from('customer_identity').insert({
                  line_user_id: userId,
                  first_store_id: checkinStoreId,
                })
              }

              // 店舗情報取得
              const { data: ciStore } = await supabase
                .from('store_profiles')
                .select('store_name_jp, line_channel_access_token, point_rule_visit')
                .eq('store_id', checkinStoreId)
                .maybeSingle()

              const channelTokenCi =
                (ciStore?.line_channel_access_token as string | null) ||
                Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || ''

              if (channelTokenCi) {
                const storeNameCi = (ciStore?.store_name_jp as string) || 'お店'
                const visitPts = Number(ciStore?.point_rule_visit ?? 1)
                const msg = `📍 ${storeNameCi}へのご来店ありがとうございます！\n\n✅ LINEアカウントに来店ポイントが紐づきました。\n\n今後はNFC/QRタップで自動的にポイントが貯まります。\nポイントカードでクーポンとの交換も可能です🎁`
                await linePush(userId, channelTokenCi, msg).catch(console.error)
              }

            // ── パターン B: submission_id（アンケート後のAI口コミ送信） ──
            } else {
              const submissionId = startDecoded
              await linkReviewAndSendAiMessage(userId, submissionId, '[follow]')
            }
          }
        }

        // ── message イベント: "REVIEW:{submission_id}" テキストから口コミ紐付け ──
        // wallet ページの「LINEでポイントカードを発行する」ボタン（oaMessage形式）が
        // このテキストを送信する。follow event の start.data が取れない場合のフォールバック。
        if (eventType === 'message') {
          const msgText: string = event.message?.text ?? ''
          if (event.message?.type === 'text' && msgText.startsWith('REVIEW:')) {
            const submissionId = msgText.slice('REVIEW:'.length).trim()
            if (submissionId) {
              console.log(`[message] REVIEW link detected, submissionId=${submissionId}`)
              await linkReviewAndSendAiMessage(userId, submissionId, '[message]')
            }
          }
        }
      }
    }

    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('webhook error:', e)
    return new Response('Internal Server Error', { status: 500 })
  }
})
