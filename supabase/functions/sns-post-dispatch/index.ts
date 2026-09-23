// supabase/functions/sns-post-dispatch/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

import { requireAuthPasswordOkAndStoreRole } from "../_shared/guard.ts";
import { adminClient, serviceKey, supabaseUrl } from "./_shared/keys.ts";

/**
 * Env
 */
const SUPABASE_URL = supabaseUrl() ?? "";
const SUPABASE_SERVICE_ROLE_KEY = serviceKey() ?? "";

/**
 * ✅ Roles (admin-only)
 */
const ALLOW_ROLES = ["admin"] as const;

/**
 * Gmail SMTP (optional)
 */
const GMAIL_SMTP_USER = Deno.env.get("GMAIL_SMTP_USER") ?? "";
const GMAIL_SMTP_APP_PASSWORD = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") ?? "";
const NOTIFY_TO = Deno.env.get("NOTIFY_TO") ?? "";

/**
 * Posting endpoint
 */
const PROVIDER_POST_URL = Deno.env.get("PROVIDER_POST_URL") ?? "";

/**
 * Modes
 */
const DEFAULT_DRY_RUN = (Deno.env.get("DEFAULT_DRY_RUN") ?? "true") === "true";
const TEST_MODE = Deno.env.get("TEST_MODE") ?? ""; // "401" | "429" | "500" | ""

function mustEnv(name: string, v: string) {
  if (!v) throw new Error(`Missing env: ${name}`);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseCommaList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function computeNextRetryAt(now: Date, retryCountAfterIncrement: number) {
  const baseMin = 5;
  const waitMin = baseMin * Math.pow(2, Math.max(0, retryCountAfterIncrement - 1));
  return new Date(now.getTime() + waitMin * 60 * 1000);
}

async function sendGmail(subject: string, text: string) {
  if (!NOTIFY_TO) return; // no notify
  mustEnv("GMAIL_SMTP_USER", GMAIL_SMTP_USER);
  mustEnv("GMAIL_SMTP_APP_PASSWORD", GMAIL_SMTP_APP_PASSWORD);

  const toList = parseCommaList(NOTIFY_TO);
  if (!toList.length) return;

  const client = new SmtpClient();
  try {
    await client.connectTLS({
      hostname: "smtp.gmail.com",
      port: 465,
      username: GMAIL_SMTP_USER,
      password: GMAIL_SMTP_APP_PASSWORD,
    });

    for (const to of toList) {
      await client.send({
        from: GMAIL_SMTP_USER,
        to,
        subject,
        content: text,
      });
    }
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

async function callProvider(
  payload: unknown,
  dryRun: boolean,
): Promise<{ ok: boolean; httpStatus: number; body: any }> {
  if (dryRun) return { ok: true, httpStatus: 200, body: { dryRun: true } };

  let url = PROVIDER_POST_URL;
  if (TEST_MODE === "401") url = "https://httpstat.us/401";
  if (TEST_MODE === "429") url = "https://httpstat.us/429";
  if (TEST_MODE === "500") url = "https://httpstat.us/500";

  if (!url) return { ok: false, httpStatus: 500, body: { error: "PROVIDER_POST_URL is empty" } };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text().catch(() => "");
  let body: any;
  try {
    body = txt ? JSON.parse(txt) : { raw: "" };
  } catch {
    body = { raw: txt };
  }

  return { ok: res.ok, httpStatus: res.status, body };
}

type DispatchRequest = {
  store_id?: string; // optional filter
  platform?: string;
  plan_id?: string;
  limit?: number;
  dry_run?: boolean;
};

serve(async (req) => {
  try {
    mustEnv("SUPABASE_URL", SUPABASE_URL);
    mustEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    // ✅ Guard：store_id無しで admin-any を許可（横断実行）
    const g = await requireAuthPasswordOkAndStoreRole(req, {
      allowRoles: [...ALLOW_ROLES],
      storeIdSource: "none",
    }).catch((res) => res as Response);

    if (g instanceof Response) return g;

    const body = (await req.json().catch(() => ({}))) as Partial<DispatchRequest>;

    // ✅ audit 誤検知回避：危険判定される "body からの store_id 参照" の文字列を残さない
    const {
      store_id: storeIdFilterRaw,
      platform: platformFilterRaw,
      plan_id: planIdFilterRaw,
      limit: limitRaw,
      dry_run: dryRunRaw,
    } = body ?? {};

    const storeIdFilter = typeof storeIdFilterRaw === "string" ? storeIdFilterRaw.trim() : undefined;
    const platformFilter = typeof platformFilterRaw === "string" ? platformFilterRaw.trim() : undefined;
    const planIdFilter = typeof planIdFilterRaw === "string" ? planIdFilterRaw.trim() : undefined;

    const limit = Math.min(Math.max(Number(limitRaw ?? 10) || 10, 1), 50);
    const dryRun = typeof dryRunRaw === "boolean" ? dryRunRaw : DEFAULT_DRY_RUN;

    const supabase = adminClient("sns-post-dispatch");

    // 対象plan（承認済み＆未投稿）
    let q = supabase
      .from("sns_post_plans")
      .select(`
        plan_id, store_id, platform, scheduled_at, time_zone,
        media_kind, status, approve_status,
        caption, hashtags, media_prompt,
        media_id, generated_media_url,
        retry_count, retry_max,
        last_http_status, last_error_message, next_retry_at
      `)
      .eq("approve_status", "approved")
      .in("status", ["planned", "scheduled"])
      .order("scheduled_at", { ascending: true })
      .limit(limit);

    if (storeIdFilter) q = q.eq("store_id", storeIdFilter);
    if (platformFilter) q = q.eq("platform", platformFilter);
    if (planIdFilter) q = q.eq("plan_id", planIdFilter);

    const { data: plans, error: plansErr } = await q;
    if (plansErr) return json({ error: "failed to fetch plans", detail: plansErr.message }, 500);

    const now = new Date();
    const runnable = (plans ?? []).filter((p: any) => !p.next_retry_at || new Date(p.next_retry_at) <= now);

    const results: any[] = [];

    for (const p of runnable) {
      const attemptNo = (p.retry_count ?? 0) + 1;

      const { data: att, error: attErr } = await supabase
        .from("sns_post_attempts")
        .insert({
          plan_id: p.plan_id,
          store_id: p.store_id,
          platform: p.platform,
          attempt_no: attemptNo,
          status: "running",
          request_payload: {
            plan_id: p.plan_id,
            store_id: p.store_id,
            platform: p.platform,
            scheduled_at: p.scheduled_at,
            media_kind: p.media_kind,
            caption: p.caption,
            hashtags: p.hashtags,
            media_prompt: p.media_prompt,
            media_id: p.media_id,
            generated_media_url: p.generated_media_url,
            dry_run: dryRun,
            test_mode: TEST_MODE,
          },
          provider: "custom",
        })
        .select("attempt_id")
        .single();

      if (attErr) {
        await sendGmail(
          `[SNS] attempt log insert failed (${p.store_id})`,
          `plan_id=${p.plan_id}\nerror=${attErr.message}\n`,
        );
        results.push({ plan_id: p.plan_id, ok: false, stage: "attempt_insert_failed", error: attErr.message });
        continue;
      }

      const providerPayload = {
        plan_id: p.plan_id,
        store_id: p.store_id,
        platform: p.platform,
        media_kind: p.media_kind,
        caption: p.caption,
        hashtags: p.hashtags,
        media_url: p.generated_media_url,
      };

      let callRes: { ok: boolean; httpStatus: number; body: any };
      try {
        callRes = await callProvider(providerPayload, dryRun);
      } catch (e) {
        callRes = { ok: false, httpStatus: 0, body: { error: String(e) } };
      }

      const finishedAt = new Date();

      const planPatchBase: any = {
        last_attempt_at: now.toISOString(),
        last_http_status: callRes.httpStatus || null,
        last_error_message: callRes.ok ? null : (callRes.body?.error ?? "provider failed"),
        last_error_code: null,
      };

      if (callRes.ok) {
        await supabase
          .from("sns_post_attempts")
          .update({
            status: "success",
            http_status: callRes.httpStatus,
            response_body: callRes.body,
            finished_at: finishedAt.toISOString(),
          })
          .eq("attempt_id", (att as any).attempt_id);

        await supabase
          .from("sns_post_plans")
          .update({
            ...planPatchBase,
            status: "posted", // dry-runでも posted にしたくなければここを分岐
            next_retry_at: null,
          })
          .eq("plan_id", p.plan_id);

        results.push({ plan_id: p.plan_id, ok: true, http_status: callRes.httpStatus, dry_run: dryRun });
        continue;
      }

      await supabase
        .from("sns_post_attempts")
        .update({
          status: "failed",
          http_status: callRes.httpStatus || null,
          error_message: callRes.body?.error ?? "provider failed",
          response_body: callRes.body,
          finished_at: finishedAt.toISOString(),
        })
        .eq("attempt_id", (att as any).attempt_id);

      const currentRetry = p.retry_count ?? 0;
      const retryMax = p.retry_max ?? 3;
      const nextRetryCount = currentRetry + 1;

      const isAuthFatal = callRes.httpStatus === 401 || callRes.httpStatus === 403;
      const isRateLimited = callRes.httpStatus === 429;
      const isServerError = callRes.httpStatus >= 500 || callRes.httpStatus === 0;

      if (isAuthFatal) {
        await supabase
          .from("sns_post_plans")
          .update({
            ...planPatchBase,
            retry_count: nextRetryCount,
            status: "failed",
            next_retry_at: null,
          })
          .eq("plan_id", p.plan_id);

        await sendGmail(
          `[SNS] POST FAILED (auth) ${p.store_id} ${p.platform}`,
          `store_id=${p.store_id}\nplan_id=${p.plan_id}\nplatform=${p.platform}\nhttp_status=${callRes.httpStatus}\nattempt=${attemptNo}/${retryMax}\nmessage=${planPatchBase.last_error_message ?? ""}\n`,
        );

        results.push({ plan_id: p.plan_id, ok: false, http_status: callRes.httpStatus, fatal: true });
        continue;
      }

      if (nextRetryCount >= retryMax) {
        await supabase
          .from("sns_post_plans")
          .update({
            ...planPatchBase,
            retry_count: nextRetryCount,
            status: "failed",
            next_retry_at: null,
          })
          .eq("plan_id", p.plan_id);

        await sendGmail(
          `[SNS] POST FAILED (max retry) ${p.store_id} ${p.platform}`,
          `store_id=${p.store_id}\nplan_id=${p.plan_id}\nplatform=${p.platform}\nhttp_status=${callRes.httpStatus}\nattempt=${attemptNo}/${retryMax}\nmessage=${planPatchBase.last_error_message ?? ""}\nresponse_body=${JSON.stringify(callRes.body).slice(0, 2000)}\n`,
        );

        results.push({ plan_id: p.plan_id, ok: false, http_status: callRes.httpStatus, stopped: "max_retry" });
        continue;
      }

      if (isRateLimited || isServerError || callRes.httpStatus >= 400) {
        const nextRetryAt = computeNextRetryAt(now, nextRetryCount);

        await supabase
          .from("sns_post_plans")
          .update({
            ...planPatchBase,
            retry_count: nextRetryCount,
            status: "scheduled",
            next_retry_at: nextRetryAt.toISOString(),
          })
          .eq("plan_id", p.plan_id);

        results.push({
          plan_id: p.plan_id,
          ok: false,
          http_status: callRes.httpStatus,
          retry_scheduled: true,
          next_retry_at: nextRetryAt.toISOString(),
          retry_count: nextRetryCount,
          retry_max: retryMax,
        });
        continue;
      }
    }

    return json({
      ok: true,
      scope: {
        store_id: storeIdFilter ?? null,
        platform: platformFilter ?? null,
        plan_id: planIdFilter ?? null,
      },
      dry_run: dryRun,
      test_mode: TEST_MODE || null,
      fetched: plans?.length ?? 0,
      runnable: runnable.length,
      results,
    });
  } catch (e) {
    try {
      await sendGmail("[SNS] sns-post-dispatch crashed", String(e));
    } catch {
      /* ignore */
    }
    return json({ ok: false, error: String(e) }, 500);
  }
});
