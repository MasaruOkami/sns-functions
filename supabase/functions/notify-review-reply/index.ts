import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const body = await req.json()
    const record = body.record

    if (!record) {
      return new Response('No record', { status: 400 })
    }

    const storeId = record.store_id
    const reviewText = record.review_text ?? ''
    const replyText = record.reply_text ?? ''
    const channel = record.channel ?? ''
    const visitDate = record.visit_date ?? ''
    const reviewPageUrl = record.review_page_url ?? ''

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: profile } = await supabase
      .from('store_profiles')
      .select('store_name_jp, notify_line_channel_access_token, line_user_ids, notify_line')
      .eq('store_id', storeId)
      .single()

    if (!profile?.notify_line) {
      return new Response('LINE notify disabled', { status: 200 })
    }

    const token = profile.notify_line_channel_access_token
    const userIds: string[] = profile.line_user_ids ?? []

    if (!token || !userIds.length) {
      return new Response('No token or user IDs', { status: 200 })
    }

    const storeName = profile.store_name_jp ?? storeId

    // 管理画面URL
    const dashboardUrl = 'https://restaurant-dashboard-ruddy.vercel.app/dashboard'

    // Flex Message構築
    const flexMessage = {
      type: 'flex',
      altText: `【新着口コミ】${storeName}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#e8622a',
          contents: [
            {
              type: 'text',
              text: '【新着口コミ】',
              color: '#ffffff',
              size: 'xs',
              weight: 'bold'
            },
            {
              type: 'text',
              text: storeName,
              color: '#ffffff',
              size: 'md',
              weight: 'bold',
              wrap: true
            }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '📅 投稿日',
                  size: 'xs',
                  color: '#8a8580',
                  flex: 2
                },
                {
                  type: 'text',
                  text: visitDate || '—',
                  size: 'xs',
                  color: '#1a1815',
                  flex: 3
                }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '📱 サイト',
                  size: 'xs',
                  color: '#8a8580',
                  flex: 2
                },
                {
                  type: 'text',
                  text: channel || '—',
                  size: 'xs',
                  color: '#1a1815',
                  flex: 3
                }
              ]
            },
            {
              type: 'separator'
            },
            {
              type: 'text',
              text: '■ 口コミ内容',
              size: 'xs',
              color: '#8a8580',
              weight: 'bold'
            },
            {
              type: 'text',
              text: reviewText.slice(0, 200) + (reviewText.length > 200 ? '...' : ''),
              size: 'xs',
              color: '#1a1815',
              wrap: true
            },
            {
              type: 'separator'
            },
            {
              type: 'text',
              text: '■ 返信案',
              size: 'xs',
              color: '#8a8580',
              weight: 'bold'
            },
            {
              type: 'text',
              text: replyText.slice(0, 200) + (replyText.length > 200 ? '...' : ''),
              size: 'xs',
              color: '#1a1815',
              wrap: true
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            ...(reviewPageUrl ? [{
              type: 'button',
              action: {
                type: 'uri',
                label: '口コミ元を確認する',
                uri: reviewPageUrl
              },
              style: 'primary',
              color: '#e8622a',
              height: 'sm'
            }] : []),
            {
              type: 'button',
              action: {
                type: 'uri',
                label: '管理画面を開く',
                uri: dashboardUrl
              },
              style: 'secondary',
              height: 'sm'
            }
          ]
        }
      }
    }

    const results = await Promise.all(
      userIds.map((userId) =>
        fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: userId,
            messages: [flexMessage],
          }),
        })
      )
    )

    const statuses = await Promise.all(results.map(async (r) => {
      const text = await r.text()
      return { status: r.status, body: text }
    }))
    console.log('LINE Push results:', JSON.stringify(statuses))

    return new Response(JSON.stringify({ statuses }), { status: 200 })
  } catch (e) {
    console.error('Error:', e)
    return new Response('Internal Server Error', { status: 500 })
  }
})