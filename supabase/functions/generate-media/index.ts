// supabase/functions/generate-media/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthPasswordOkAndStoreRole } from "./_shared/guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// JSONレスポンスヘルパー
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // デプロイは通るが、実行時に確実に落とすための保険
  console.warn("[generate-media] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

serve(async (req) => {
  try {
    // 1) Method check
    if (req.method !== "POST") {
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }

    // 2) OpenAI key check（運用で一番ハマるので先に）
    if (!OPENAI_API_KEY) {
      return json(500, { error: "MISSING_OPENAI_API_KEY" });
    }

    // 3) 認証 + PW期限 + 店舗Role
    const g = await requireAuthPasswordOkAndStoreRole(req, {
      allowRoles: ["admin", "editor"], // generate-media は viewer 不可
    }).catch((res) => res as Response);

    if (g instanceof Response) return g;

    const store_id = g.storeId;

    // 4) 店舗プロファイル取得（RLS回避のため service role）
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("store_media_gen_profile")
      .select("*")
      .eq("store_id", store_id)
      .maybeSingle();

    if (profErr) {
      console.error("[generate-media] store_media_gen_profile error:", profErr);
      return json(500, { error: "DB_ERROR", detail: profErr.message });
    }
    if (!profile) {
      return json(400, { error: "STORE_PROFILE_NOT_FOUND", message: "store_media_gen_profile not found" });
    }

    // 5) プロンプト生成（ここは今は簡易）
    const systemPrompt = `
あなたは飲食店向けのSNS動画クリエイターです。
設定に従って動画構成案を作成してください。
`.trim();

    // 6) OpenAI 呼び出し
    const completionRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: "Instagram Reels 用に、冒頭3秒で惹きつける構成案を出してください。",
          },
        ],
      }),
    });

    // ★重要：OpenAIが失敗したら 200 で返さない
    if (!completionRes.ok) {
      const errText = await completionRes.text().catch(() => "");
      console.error("[generate-media] OpenAI error:", completionRes.status, errText);
      return json(502, {
        error: "OPENAI_ERROR",
        status: completionRes.status,
        detail: errText,
      });
    }

    const result = await completionRes.json();

    // 7) 正常終了
    return json(200, {
      store_id,
      profile_used: true, // 使っていることを明示（デバッグ用）
      result,
    });
  } catch (e) {
    console.error("[generate-media] unhandled error:", e);
    return json(500, { error: "INTERNAL_ERROR", detail: String((e as any)?.message ?? e) });
  }
});
