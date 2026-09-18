/**
 * line-referral-webhook
 *
 * LINE公式アカウントのWebhook。紹介コード受付処理。
 * URL: https://xxx.supabase.co/functions/v1/line-referral-webhook?store_id=STORE_ID
 *
 * フロー:
 * 1. 紹介された人が紹介コード（6文字英数大文字）をLINE OA に送信
 * 2. 署名検証 → コード検索 → referral_entries にpending で登録
 * 3. 初来店アンケート完了時（form-engine）にエントリ確定 → 紹介者にポイント付与
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── LINE 署名検証 ─────────────────────────────────────────────
async function verifyLineSignature(
  body: string,
  channelSecret: string,
  signature: string,
): Promise<boolean> {
  try {
    const enc  = new TextEncoder();
    const key  = await crypto.subtle.importKey(
      "raw", enc.encode(channelSecret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig  = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const b64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return b64 === signature;
  } catch {
    return false;
  }
}

// ── LINE Reply ────────────────────────────────────────────────
async function lineReply(replyToken: string, token: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error("[line-reply]", res.status, await res.text());
}

// ── 紹介コード抽出（6文字英数大文字）─────────────────────────
function extractCode(text: string): string | null {
  const upper = text.trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(upper)) return upper;
  const m = upper.match(/\b([A-Z0-9]{6})\b/);
  return m ? m[1] : null;
}

// ── メインハンドラ ────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  const url      = new URL(req.url);
  const store_id = url.searchParams.get("store_id") ?? "";

  if (!store_id) {
    return new Response("store_id required", { status: 400 });
  }

  // ── 店舗設定取得 ─────────────────────────────────────────────
  const { data: store } = await db
    .from("store_profiles")
    .select("store_name_jp, line_channel_secret, line_channel_access_token, point_rule_referral, referral_expiry_days")
    .eq("store_id", store_id)
    .maybeSingle();

  if (!store) {
    return new Response("store not found", { status: 404 });
  }

  const channelSecret = (store.line_channel_secret as string) ?? "";
  const accessToken   = (store.line_channel_access_token as string) ?? "";

  // ── 署名検証 ─────────────────────────────────────────────────
  const rawBody   = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (channelSecret) {
    const valid = await verifyLineSignature(rawBody, channelSecret, signature);
    if (!valid) {
      console.error("[line-referral-webhook] invalid signature", { store_id });
      return new Response("invalid signature", { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const events = (payload.events as unknown[]) ?? [];

  for (const ev of events) {
    const event = ev as Record<string, unknown>;
    if (event.type !== "message") continue;

    const msg = event.message as Record<string, unknown>;
    if (msg?.type !== "text") continue;

    const replyToken   = (event.replyToken as string) ?? "";
    const senderLineId = ((event.source as Record<string, unknown>)?.userId as string) ?? "";
    const text         = (msg.text as string) ?? "";

    if (!senderLineId) continue;

    const code = extractCode(text);
    if (!code) continue;

    console.log(JSON.stringify({
      fn: "line-referral-webhook",
      event: "code_received",
      store_id, code,
      referee_line_user_id: senderLineId,
      ts: new Date().toISOString(),
    }));

    // ── point_rule_referral 未設定の場合は無効 ──────────────────
    if (!store.point_rule_referral) {
      continue;
    }

    // ── コード検索 ────────────────────────────────────────────
    const { data: codeRow } = await db
      .from("referral_codes")
      .select("id, identity_id, store_id")
      .eq("code", code)
      .eq("store_id", store_id)
      .maybeSingle();

    if (!codeRow) {
      await lineReply(replyToken, accessToken,
        "紹介コードが見つかりませんでした。\n正しいコードをご確認ください。");
      continue;
    }

    // ── 自己紹介防止 ──────────────────────────────────────────
    const { data: referrerIdentity } = await db
      .from("customer_identity")
      .select("line_user_id")
      .eq("id", codeRow.identity_id as string)
      .maybeSingle();

    if (referrerIdentity?.line_user_id === senderLineId) {
      await lineReply(replyToken, accessToken,
        "自分自身の紹介コードは使用できません。");
      continue;
    }

    // ── 既存エントリチェック ──────────────────────────────────
    const { data: existingEntry } = await db
      .from("referral_entries")
      .select("id, status")
      .eq("store_id", store_id)
      .eq("referee_line_user_id", senderLineId)
      .maybeSingle();

    if (existingEntry) {
      const status = existingEntry.status as string;
      if (status === "completed") {
        await lineReply(replyToken, accessToken,
          `この店舗の紹介はすでに完了しています 🎉`);
      } else if (status === "pending") {
        await lineReply(replyToken, accessToken,
          `紹介コードはすでに登録されています。\n初来店アンケートにご回答いただくと紹介者にポイントが付与されます！`);
      } else {
        await lineReply(replyToken, accessToken,
          `紹介コードの有効期限が切れています。`);
      }
      continue;
    }

    // ── 有効期限計算 ──────────────────────────────────────────
    const expiryDays = store.referral_expiry_days as number | null;
    let expires_at: string | null = null;
    if (expiryDays != null && expiryDays > 0) {
      const exp = new Date();
      exp.setDate(exp.getDate() + expiryDays);
      expires_at = exp.toISOString();
    }

    // ── referral_entry 作成（pending）──────────────────────────
    const { error: insertErr } = await db.from("referral_entries").insert({
      store_id,
      referral_code:        code,
      referrer_identity_id: codeRow.identity_id,
      referee_line_user_id: senderLineId,
      status:               "pending",
      expires_at,
    });

    if (insertErr) {
      console.error("[line-referral-webhook] insert error:", insertErr);
      await lineReply(replyToken, accessToken,
        "紹介コードの登録中にエラーが発生しました。しばらくしてから再度お試しください。");
      continue;
    }

    // ── 成功返信 ─────────────────────────────────────────────
    const storeName = (store.store_name_jp as string) ?? "当店";
    const expiryNote = (expiryDays != null && expiryDays > 0)
      ? `\n※ ${expiryDays}日以内のご来店が必要です。`
      : "";

    await lineReply(replyToken, accessToken,
      `紹介コードを受け付けました！✅\n\n${storeName}へのご来店時にアンケートにご回答いただくと、紹介してくれた方にポイントが付与されます。${expiryNote}\n\nご来店をお待ちしております 🙏`);
  }

  return new Response("ok", { status: 200 });
});
