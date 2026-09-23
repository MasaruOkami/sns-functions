// form-to-tally: form_questions を Tally API へプッシュしてフォームを作成/更新
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, supabaseUrl as resolveSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FormQuestion = {
  store_id: string;
  sort_order: number;
  question_key: string;
  label: string;
  question_type: string;
  options: { id: string; text: string }[] | null;
  logic_show_if: { depends_on: string; value: string } | null;
  required: boolean;
};

function uuid(): string {
  return crypto.randomUUID();
}

/** Tally ブロック構造の検証。問題があれば diagnostics に追加 */
function validateTallyBlocks(blocks: unknown[]): {
  ok: boolean;
  diagnostics: { blockIndex: number; blockType: string; blockUuid?: string; issue: string; suggestion?: string }[];
} {
  const bl = blocks as Record<string, unknown>[];
  const diagnostics: { blockIndex: number; blockType: string; blockUuid?: string; issue: string; suggestion?: string }[] = [];

  const mcParents = new Map<string, { blockIndex: number; options: { uuid: string; index: number }[] }>();
  const optionBlocksByParent = new Map<string, { blockIndex: number; uuid: string; index: number }[]>();

  bl.forEach((b, i) => {
    const type = String(b?.type ?? "");
    const uuid = b?.uuid as string | undefined;

    if (type === "MULTIPLE_CHOICE") {
      const payload = b.payload as Record<string, unknown> | undefined;
      const options = payload?.options as { uuid?: string; index?: number }[] | undefined;
      if (!Array.isArray(options) || options.length === 0) {
        diagnostics.push({
          blockIndex: i,
          blockType: type,
          blockUuid: uuid,
          issue: "options が空または不正",
          suggestion: "payload.options に [{ uuid, index }, ...] 形式の配列が必要",
        });
      } else {
        const hasUndefinedIndex = options.some((o, idx) => o?.index === undefined);
        if (hasUndefinedIndex) {
          diagnostics.push({
            blockIndex: i,
            blockType: type,
            blockUuid: uuid,
            issue: "options 内に index が undefined の要素あり",
            suggestion: "各 option に index: 0, 1, 2... を明示的に設定",
          });
        }
        mcParents.set(uuid ?? "", {
          blockIndex: i,
          options: options.map((o, idx) => ({ uuid: String(o?.uuid ?? ""), index: Number(o?.index ?? idx) })),
        });
      }
    }

    if (type === "MULTIPLE_CHOICE_OPTION" || type === "DROPDOWN_OPTION" || type === "CHECKBOX") {
      const groupUuid = b.groupUuid as string | undefined;
      const idx = b.index as number | undefined;
      if (groupUuid) {
        const arr = optionBlocksByParent.get(groupUuid) ?? [];
        arr.push({ blockIndex: i, uuid: uuid ?? "", index: idx ?? -1 });
        optionBlocksByParent.set(groupUuid, arr);
      }
      if (idx === undefined) {
        diagnostics.push({
          blockIndex: i,
          blockType: type,
          blockUuid: uuid,
          issue: "index が undefined",
          suggestion: "ブロックのトップレベルに index: 0, 1, 2... を設定",
        });
      }
    }
  });

  // 親の options と子ブロックの対応チェック
  mcParents.forEach((parent, parentUuid) => {
    const children = optionBlocksByParent.get(parentUuid) ?? [];
    const optUuids = new Set(parent.options.map((o) => o.uuid));
    const childUuids = new Set(children.map((c) => c.uuid));

    const inParentNotChild = [...optUuids].filter((u) => !childUuids.has(u));
    const inChildNotParent = [...childUuids].filter((u) => !optUuids.has(u));
    if (inParentNotChild.length > 0) {
      diagnostics.push({
        blockIndex: parent.blockIndex,
        blockType: "MULTIPLE_CHOICE",
        issue: `親の options に含まれるが、該当する *_OPTION ブロックが存在しない uuid: ${inParentNotChild.join(", ")}`,
        suggestion: "MULTIPLE_CHOICE_OPTION ブロックを options の uuid と一致するよう作成",
      });
    }
    if (inChildNotParent.length > 0) {
      diagnostics.push({
        blockIndex: parent.blockIndex,
        blockType: "MULTIPLE_CHOICE",
        issue: `MULTIPLE_CHOICE_OPTION が存在するが、親の options に含まれない uuid: ${inChildNotParent.join(", ")}`,
        suggestion: "payload.options に全オプションブロックの uuid を登録",
      });
    }

    const indices = children.map((c) => c.index).sort((a, b) => a - b);
    const expected = [...Array(children.length).keys()];
    if (JSON.stringify(indices) !== JSON.stringify(expected)) {
      diagnostics.push({
        blockIndex: parent.blockIndex,
        blockType: "MULTIPLE_CHOICE",
        blockUuid: parentUuid,
        issue: `オプションの index が 0,1,2... の連番でない。実際: [${indices.join(",")}]`,
        suggestion: "Expected 0, got undefined エラーの原因の可能性。index を 0 から連番で設定",
      });
    }
  });

  return { ok: diagnostics.length === 0, diagnostics };
}

function buildTallyBlocks(
  questions: FormQuestion[],
  storeName: string,
  debug: boolean,
  opts?: { themeColor?: string; logoImageUrl?: string; coverImageUrl?: string }
): { blocks: unknown[]; debugInfo?: unknown } {
  const blocks: unknown[] = [];
  const themeColor = opts?.themeColor;
  const logoImageUrl = opts?.logoImageUrl;
  const coverImageUrl = opts?.coverImageUrl;

  // フォームタイトル（ロゴ・カバーは別々に指定可能）
  const formTitleUuid = uuid();
  const formTitlePayload: Record<string, unknown> = {
    title: `${storeName} アンケート`,
    html: `${storeName} アンケート`,
  };
  if (logoImageUrl) formTitlePayload.logo = logoImageUrl;
  if (coverImageUrl) formTitlePayload.cover = coverImageUrl;
  blocks.push({
    uuid: formTitleUuid,
    type: "FORM_TITLE",
    groupUuid: formTitleUuid,
    groupType: "FORM_TITLE",
    payload: formTitlePayload,
  });

  // ※ store_id の Hidden field は Tally API の HIDDEN_FIELDS が複雑なため未対応。
  // フォーム作成後、Tally エディタで /hidden から store_id を手動追加し、
  // リダイレクト URL を ?store_id=xxx 付きで使用してください。

  for (const q of questions) {
    const groupUuid = uuid();

    // 質問ラベル（Tally の TITLE ブロック）
    const titleUuid = uuid();
    blocks.push({
      uuid: titleUuid,
      type: "TITLE",
      groupUuid,
      groupType: "QUESTION",
      payload: { html: q.label },
    });

    // 入力ブロック
    if (q.question_type === "rating") {
      const opts = q.options as { max?: number } | null;
      const stars = typeof opts?.max === "number" && opts.max >= 1 && opts.max <= 10 ? opts.max : 5;
      blocks.push({
        uuid: uuid(),
        type: "RATING",
        groupUuid,
        groupType: "RATING",
        payload: {
          isRequired: q.required,
          stars,
        },
      });
    } else if (q.question_type === "textarea") {
      blocks.push({
        uuid: uuid(),
        type: "TEXTAREA",
        groupUuid,
        groupType: "TEXTAREA",
        payload: { isRequired: q.required, placeholder: "" },
      });
    } else if (q.question_type === "text") {
      blocks.push({
        uuid: uuid(),
        type: "INPUT_TEXT",
        groupUuid,
        groupType: "INPUT_TEXT",
        payload: { isRequired: q.required, placeholder: "" },
      });
    } else if (q.question_type === "radio" && q.options?.length) {
      const mcUuid = uuid();
      const opts = q.options;
      const optUuids = opts.map(() => uuid());
      // Tally DROPDOWN 例: オプションのみで親なし。MULTIPLE_CHOICE もオプション先行を試す。
      opts.forEach((opt, i) => {
        blocks.push({
          uuid: optUuids[i],
          type: "MULTIPLE_CHOICE_OPTION",
          groupUuid: mcUuid,
          groupType: "MULTIPLE_CHOICE",
          index: i,
          payload: {
            index: i,
            text: opt.text,
            isFirst: i === 0,
            isLast: i === opts.length - 1,
          },
        });
      });
      blocks.push({
        uuid: mcUuid,
        type: "MULTIPLE_CHOICE",
        groupUuid,
        groupType: "QUESTION",
        payload: {
          isRequired: q.required,
          allowOther: false,
          options: optUuids.map((u, i) => ({ uuid: u, index: i })),
        },
      });
    } else if (q.question_type === "select" && q.options?.length) {
      const ddUuid = uuid();
      const opts = q.options;
      const optUuids = opts.map(() => uuid());
      blocks.push({
        uuid: ddUuid,
        type: "DROPDOWN",
        groupUuid,
        groupType: "DROPDOWN",
        payload: {
          isRequired: q.required,
          options: optUuids.map((u, i) => ({ uuid: u, index: i })),
        },
      });
      opts.forEach((opt, i) => {
        blocks.push({
          uuid: optUuids[i],
          type: "DROPDOWN_OPTION",
          groupUuid: ddUuid,
          groupType: "DROPDOWN",
          index: i,
          payload: {
            index: i,
            text: opt.text,
            html: opt.text,
            isFirst: i === 0,
            isLast: i === opts.length - 1,
          },
        });
      });
    } else if (q.question_type === "checkbox" && q.options?.length) {
      const cbUuid = uuid();
      const opts = q.options;
      const optUuids = opts.map(() => uuid());
      blocks.push({
        uuid: cbUuid,
        type: "CHECKBOXES",
        groupUuid,
        groupType: "CHECKBOXES",
        payload: {
          isRequired: q.required,
          options: optUuids.map((u, i) => ({ uuid: u, index: i })),
        },
      });
      opts.forEach((opt, i) => {
        blocks.push({
          uuid: optUuids[i],
          type: "CHECKBOX",
          groupUuid: cbUuid,
          groupType: "CHECKBOXES",
          index: i,
          payload: {
            index: i,
            html: opt.text,
            isFirst: i === 0,
            isLast: i === opts.length - 1,
          },
        });
      });
    }
  }

  const debugInfo = debug
    ? {
        questions_with_options: questions
          .filter((q) => q.options)
          .map((q) => ({
            question_key: q.question_key,
            question_type: q.question_type,
            options_count: q.options?.length ?? 0,
            options_sample: q.options?.slice(0, 2),
          })),
        blocks_summary: blocks.map((b: unknown) => {
          const block = b as Record<string, unknown>;
          return {
            type: block.type,
            uuid: block.uuid,
            groupUuid: block.groupUuid,
            groupType: block.groupType,
            payload_keys: block.payload
              ? Object.keys(block.payload as Record<string, unknown>)
              : [],
            payload: block.payload,
          };
        }),
        options_blocks: blocks.filter(
          (b: unknown) =>
            (b as Record<string, unknown>).type === "MULTIPLE_CHOICE_OPTION" ||
            (b as Record<string, unknown>).type === "DROPDOWN_OPTION" ||
            (b as Record<string, unknown>).type === "CHECKBOX"
        ),
      }
    : undefined;

  return { blocks, debugInfo };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("TALLY_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "TALLY_API_KEY が設定されていません。Supabase Secrets に追加してください。" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const storeId = url.searchParams.get("store_id")?.trim();
  const debug = url.searchParams.get("debug") === "1" || url.searchParams.get("debug") === "true";
  const fetchFormId = url.searchParams.get("fetch_form")?.trim();

  // デバッグ: 既存 Tally フォームの構造を取得（MULTIPLE_CHOICE 等の正しい形式確認用）
  if (fetchFormId && apiKey) {
    try {
      const res = await fetch(`https://api.tally.so/forms/${fetchFormId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const form = await res.json();
      const mcBlocks = (form?.blocks || []).filter(
        (b: Record<string, unknown>) =>
          b.type === "MULTIPLE_CHOICE" ||
          b.type === "MULTIPLE_CHOICE_OPTION" ||
          b.type === "DROPDOWN" ||
          b.type === "DROPDOWN_OPTION"
      );
      return new Response(
        JSON.stringify({
          debug: "fetch_form",
          formId: form?.id,
          formName: form?.name,
          mc_blocks_sample: mcBlocks,
          full_blocks_count: form?.blocks?.length ?? 0,
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: String((e as Error).message) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  if (!storeId) {
    return new Response(
      JSON.stringify({ error: "store_id が必要です。例: /form-to-tally?store_id=manekidako_kyoto_avanti" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = adminClient("form-to-tally");

  const { data: store } = await supabase
    .from("store_profiles")
    .select("store_id, store_name_ja, tally_form_id, theme_color, logo_image_path, cover_image_path")
    .eq("store_id", storeId)
    .maybeSingle();

  if (!store) {
    return new Response(
      JSON.stringify({ error: `店舗が見つかりません: ${storeId}` }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: questionsRaw } = await supabase
    .from("form_questions")
    .select("*")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true });

  const questions = (questionsRaw || []) as FormQuestion[];
  if (!questions.length) {
    return new Response(
      JSON.stringify({ error: `form_questions に質問がありません: ${storeId}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const storeName = (store.store_name_ja as string) || storeId;
  const themeColor = (store.theme_color as string)?.trim() || null;
  const logoPath = (store.logo_image_path as string)?.trim() || null;
  const coverPath = (store.cover_image_path as string)?.trim() || null;
  const supabaseUrl = resolveSupabaseUrl();
  const origin = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const toPublicUrl = (p: string | null) =>
    p && origin
      ? `${origin}/storage/v1/object/public/assets/${p.replace(/^\/+/, "")}`
      : null;
  const logoImageUrl = toPublicUrl(logoPath);
  const coverImageUrl = toPublicUrl(coverPath);
  const { blocks, debugInfo } = buildTallyBlocks(questions, storeName, debug, {
    themeColor: themeColor ?? undefined,
    logoImageUrl: logoImageUrl ?? undefined,
    coverImageUrl: coverImageUrl ?? undefined,
  });

  const validation = validateTallyBlocks(blocks);

  const dryRun = url.searchParams.get("dry_run") === "1" || url.searchParams.get("dry_run") === "true";
  if (dryRun) {
    return new Response(
      JSON.stringify({
        success: true,
        dry_run: true,
        validation: {
          ok: validation.ok,
          diagnostics: validation.diagnostics,
          message: validation.ok
            ? "検証OK。Tally API の制約によりエラーが出る可能性は残ります。"
            : "検証で問題を検出しました。",
        },
        blocks_count: blocks.length,
        design_push: {
          theme_color: themeColor ?? "(なし)",
          logo_image_url: logoImageUrl ?? "(なし)",
          cover_image_url: coverImageUrl ?? "(なし)",
          note: "logo_image_path / cover_image_path で指定",
        },
        debugInfo,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const tallyPayload: Record<string, unknown> = {
    name: `${storeName} アンケート`,
    status: "PUBLISHED" as const,
    blocks,
  };

  // デザインベース: theme_color があれば settings.styles でプッシュ
  if (themeColor) {
    const hex = themeColor.startsWith("#") ? themeColor : `#${themeColor}`;
    tallyPayload.settings = {
      styles: {
        theme: "CUSTOM",
        color: {
          background: "#ffffff",
          text: "#37352f",
          accent: hex,
          buttonBackground: hex,
          buttonText: "#ffffff",
        },
        direction: "ltr",
      },
    };
  }

  try {
    const existingFormId = store.tally_form_id as string | null;
    let formId: string;
    let formUrl: string;

    if (existingFormId) {
      // 既存フォームを PATCH で更新
      const res = await fetch(`https://api.tally.so/forms/${existingFormId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tallyPayload),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Tally API PATCH failed:", res.status, err);
        let parsedDetail: unknown = err;
        try {
          parsedDetail = JSON.parse(err) as unknown;
        } catch {
          /* keep as string */
        }
        const errBlock = typeof parsedDetail === "object" && parsedDetail !== null && "block" in parsedDetail
          ? (parsedDetail as { block?: { uuid?: string; type?: string } }).block
          : null;
        const errorUuid = errBlock?.uuid;
        const body: Record<string, unknown> = {
          success: false,
          error: `Tally API 更新失敗: ${res.status}`,
          detail: parsedDetail,
          validation: {
            ok: validation.ok,
            diagnostics: validation.diagnostics,
            tally_未設定の可能性: validation.ok
              ? "自前検証はOK。Tally API 固有の制約（ブロック順序・payload 形式等）の可能性"
              : "自前検証で問題あり。diagnostics を確認",
          },
          debug: {
            error_block: errBlock,
            blocks_with_error_uuid: errorUuid
              ? blocks.filter((b: unknown) => (b as Record<string, unknown>).uuid === errorUuid)
              : undefined,
            all_option_blocks: blocks.filter(
              (b: unknown) =>
                ["MULTIPLE_CHOICE_OPTION", "DROPDOWN_OPTION", "CHECKBOX"].includes(
                  String((b as Record<string, unknown>).type)
                )
            ),
          },
          debugInfo,
          tallyPayload: debug ? tallyPayload : undefined,
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      formId = existingFormId;
    } else {
      // 新規作成
      const res = await fetch("https://api.tally.so/forms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tallyPayload),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Tally API POST failed:", res.status, err);
        let parsedDetail: unknown = err;
        try {
          parsedDetail = JSON.parse(err) as unknown;
        } catch {
          /* keep as string */
        }
        const errBlock = typeof parsedDetail === "object" && parsedDetail !== null && "block" in parsedDetail
          ? (parsedDetail as { block?: { uuid?: string; type?: string } }).block
          : null;
        const msg = typeof parsedDetail === "object" && parsedDetail !== null && "message" in parsedDetail
          ? String((parsedDetail as { message?: string }).message)
          : "";
        const uuidMatch = msg.match(/UUID ([a-f0-9-]{36})/i);
        const errorUuid = errBlock?.uuid ?? uuidMatch?.[1];
        const body: Record<string, unknown> = {
          success: false,
          error: `Tally API 作成失敗: ${res.status}`,
          detail: parsedDetail,
          validation: {
            ok: validation.ok,
            diagnostics: validation.diagnostics,
            tally_未設定の可能性: validation.ok
              ? "自前検証はOK。Tally API 固有の制約（ブロック順序・payload 形式等）の可能性"
              : "自前検証で問題あり。diagnostics を確認",
          },
          debug: {
            error_block: errBlock,
            error_uuid: errorUuid,
            blocks_with_error_uuid: errorUuid
              ? blocks.filter((b: unknown) => (b as Record<string, unknown>).uuid === errorUuid)
              : undefined,
            parent_blocks_referencing_error: errorUuid
              ? blocks.filter((b: unknown) => (b as Record<string, unknown>).groupUuid === errorUuid)
              : undefined,
            first_multiple_choice_block: blocks.find(
              (b: unknown) => (b as Record<string, unknown>).type === "MULTIPLE_CHOICE"
            ),
            all_option_blocks: blocks.filter(
              (b: unknown) =>
                ["MULTIPLE_CHOICE_OPTION", "DROPDOWN_OPTION", "CHECKBOX"].includes(
                  String((b as Record<string, unknown>).type)
                )
            ),
          },
          debugInfo,
          tallyPayload: debug ? tallyPayload : undefined,
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const created = (await res.json()) as { id: string };
      formId = created.id;

      await supabase
        .from("store_profiles")
        .update({ tally_form_id: formId })
        .eq("store_id", storeId);

      // 新規作成時のみ Webhook を登録（tally-webhook へ送信）
      try {
        const supabaseUrl = resolveSupabaseUrl();
        if (supabaseUrl) {
          const baseUrl = new URL(supabaseUrl).origin;
          const webhookUrl = `${baseUrl}/functions/v1/tally-webhook`;
          const whRes = await fetch("https://api.tally.so/webhooks", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              formId,
              url: webhookUrl,
              eventTypes: ["FORM_RESPONSE"],
            }),
          });
          if (!whRes.ok) {
            console.error("Tally Webhook 登録失敗:", await whRes.text());
          }
        }
      } catch (whErr) {
        console.error("Tally Webhook 登録でエラー:", whErr);
      }
    }

    formUrl = `https://tally.so/r/${formId}?store_id=${encodeURIComponent(storeId)}`;

    return new Response(
      JSON.stringify({
        success: true,
        form_id: formId,
        form_url: formUrl,
        message: existingFormId ? "Tally フォームを更新しました" : "Tally フォームを作成しました",
        note: "store_id を渡すには、Tally エディタで /hidden から「store_id」を追加し、form_url の ?store_id=xxx 付きで共有してください。",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    return new Response(
      JSON.stringify({ error: String((e as Error).message) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
