import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai@4.28.0";
import { corsHeaders } from "../_shared/cors.ts";

/** fetch with automatic AbortController timeout (default 20s) */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const createHtmlResponse = (html: string): Response => {
  return new Response(html, {
    headers: {
      ...corsHeaders(null),
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Surrogate-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
    },
  });
};

// ========== 多言語対応（デバイス言語検出・フォールバック日本語） ==========
type Lang = "ja" | "en" | "zh" | "ko" | "es" | "fr" | "th" | "vi";
const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  ja: {
    need_store_id: "store_id が必要です。/?store_id=XXX",
    store_not_found: "店舗が見つかりません。",
    no_questions: "この店舗のアンケート質問が設定されていません。",
    survey_title_suffix: "アンケート",
    submit_btn: "提出する",
    loading_ai: "AIが口コミ案を作成中...",
    select_placeholder: "選択してください",
    review_select_title: "口コミ案を選択",
    style1_title: "🟢 カジュアル",
    style2_title: "🔵 分析型",
    style3_title: "🟣 スタンダード",
    edit_hint: "✏️ 文章をタップして直接編集できます",
    edit_options_toggle: "編集オプション",
    post_hint: "コピーして、下記リンクから投稿",
    post_hint_copy_then_open: "各サイトのボタンをタップすると口コミ文をコピーして投稿ページを開きます。",
    coupon_use_hint: "※使用前にボタン押下（1回限り）。スクショ不可。後日はリンク保存。",
    coupon_usage_instructions: "【利用方法】この画面をスタッフに提示しボタン押下※1回限り有効／スクショ不可",
    coupon_browser_limit: "このブラウザではクーポンは{days}日に1回までです。すでにご利用済みです。",
    longer_btn: "長くする",
    shorter_btn: "短くする",
    emoji_more_btn: "絵文字増",
    emoji_none_btn: "絵文字なし",
    copy_btn: "文章をコピー",
    save_btn: "編集を保存",
    post_to_sites: "各サイトに口コミを書く",
    post_to_sites_support: "口コミ書いて店舗を応援！",
    post_to_sites_links: "各サイトリンク",
    copy_paste_hint: "コピーした文章を貼り付けて投稿できます",
    post_request: "各サイトに口コミの投稿をお願いします",
    link_post_hint: "リンクから各サイトに投稿できます",
    coupon_title_prefix: "アンケート回答特典クーポン",
    line_message: "公式LINE友だち追加でさらにお得な情報をお届け！",
    line_open: "LINE友だち登録",
    show_to_staff_today: "お会計時に店員へお見せください",
    show_to_staff_next: "次回来店時に店員へお見せください",
    issued: "発行",
    staff_use_hint: "※ご利用前に「クーポンを使用する」ボタンを押してください。（1回限り）",
    use_btn_staff: "使用する（店員様）",
    used_label: "使用済み",
    coupon_stopped: "クーポンは現在停止中です",
    scout_title: "紹介でお店を応援する",
    scout_intro: "ご紹介から、将来の店長候補・マネージャー候補をスカウトしたいと考えています。専用URL付きの紹介文をご友人に送っていただいたり、SNSで拡散をお願いします。",
    scout_reward_prefix: "【採用した際の特典】",
    scout_note: "※LINEの友達になっていただく事で、採用された際にご連絡をいたします。紹介URLにはあなた専用のIDが含まれますので、ご連絡可能となります。",
    scout_direct_title: "採用のご案内",
    scout_direct_intro: "当店では{type}を募集しています。条件や仕事内容は詳細ページでご確認いただけます。ご興味のある方は詳細確認のうえ、応募者識別番号（{sid}）を入力して下記より応募・質問ください。",
    scout_recruit_arubaito: "アルバイトスタッフ",
    scout_recruit_seisyain: "正社員",
    scout_recruit_keiyaku: "契約社員",
    scout_recruit_part: "パート",
    scout_recruit_kanbu: "幹部候補",
    scout_recruit_staff: "スタッフ",
    scout_recruit_join: "と",
    scout_direct_line_btn: "採用にご連絡（LINE）",
    recruit_page_btn: "採用ページ",
    recruit_detail_link: "詳細はこちらで確認",
    contact_page_btn: "連絡ページ",
    line_contact_btn: "LINEで応募・質問する",
    line_contact_copy_and_open_btn: "識別番号をコピーしてLINEで応募・質問",
    line_contact_sid_hint: "応募者識別番号（LINEで送る際にコピーして貼り付けてください）：",
    sid_copy_btn: "コピー",
    scout_direct_interview_reward: "面接日程が確定した方には「{reward}」をプレゼント！",
    scout_both_title: "採用・ご紹介のご案内",
    scout_both_intro: "当店では{type}を募集しています。ご紹介いただける方は専用URLを、直接応募したい方はLINEよりご連絡ください。",
    scout_both_note: "※ご紹介の方は、紹介URLにあなた専用のIDが含まれます。採用された際にご連絡いたします。",
    scout_both_line_btn: "採用にご連絡（LINE）",
    line_official: "LINE公式アカウントを開く",
    scout_copy_btn: "紹介文と専用URLをコピーする",
    recruit_title: "求人情報",
    recruit_intro: "当店で一緒に働きませんか？",
    recruit_link: "求人を見る",
    toast_copied: "コピーしました",
    toast_saved: "保存しました",
    loading_refine: "調整中...",
    loading_modify: "修正中...",
    tone_polite: "丁寧・誠実",
    tone_friendly: "親しみやすい",
    tone_short: "短め・シンプル",
    keywords_placeholder: "追加したいキーワード（例：生ハム）",
    modify_btn: "キーワードを加えて再生成",
    store_feedback_btn: "上記を店舗へ要望として送信",
    feedback_sent_label: "送信済み",
    not_generated: "（未生成）",
    post_request_low: "各サイトに口コミの投稿をお願いします",
    scout_toast_copied: "紹介文とURLをコピーしました！",
    screen_navigating: "画面移動中",
    photo_upload_label: "写真を投稿する（任意）",
    photo_upload_hint: "料理や店内の写真を撮って、SNSでシェアできます",
    photo_download_btn: "画像をダウンロード",
    photo_sns_hint: "長押しで画像を保存し、Instagram等に投稿できます",
    photo_remove_btn: "削除",
    photo_sns_title: "SNS用写真",
    msg_high_score: "スタッフの励みになります！ぜひこの感想をシェアしてください",
    msg_low_score: "貴重なご意見ありがとうございます。サービス改善のため詳細をお聞かせいただけますか？",
    msg_thank_high: "ご回答ありがとうございました！\n口コミでお店を応援してください！",
    msg_thank_low: "ご回答ありがとうございました！\nご意見をお店への送信をお願いします。",
    msg_review_encourage: "口コミがスタッフの励みになります",
    use_coupon_btn: "クーポンを使用する",
    coupon_screenshot_hint: "後日ご利用の場合はリンクを保存してください",
    coupon_usable_today_hint: "※当日利用可",
    coupon_usable_next_hint: "※次回の会計から利用可",
    coupon_scope_chain_wide: "※{chain}全店でご利用いただけます",
    coupon_scope_store_only: "※この店舗のみでご利用いただけます",
    line_add_title: "LINE友だち登録でさらにクーポンGET！",
    line_add_bonus: "LINE友だち追加でさらに「{bonus}」をプレゼント！",
    google_review_btn: "Google口コミを書く",
    line_save_coupon_btn: "LINEでクーポンを保存",
    line_save_coupon_success: "LINEに届きました！お会計時はLINEを確認してください",
    line_save_coupon_hint: "タップでLINEが開きます。友だち追加後にクーポンが届きます",
    line_save_coupon_steps: "① 下の「LINEでクーポンを保存」をタップ → ② 開いたページで「友だち追加する」を押す → ③ 友だち追加するとクーポンが届きます",
    line_save_coupon_hint_copy: "タップしてURLをコピーし、LINEの「自分へのトーク」に貼り付けて保存",
    screenshot_warning: "※スクリーンショット・撮影はご遠慮ください",
    loyalty_breakdown_survey: "アンケート回答",
    loyalty_breakdown_sns: "SNS拡散",
    loyalty_breakdown_google: "Google等・口コミ",
    loyalty_breakdown_feedback: "店舗へ要望送信",
    loyalty_hint_title_high: "⭐ 口コミ投稿でクーポンをゲット！",
    loyalty_hint_review_label: "口コミ投稿",
    loyalty_hint_goal: "目標達成！",
    loyalty_hint_coupon_earned: "🎁 クーポン獲得",
    loyalty_hint_post_hint: "上の口コミ案をコピーして投稿 → 戻るとポイントが加算されます",
    loyalty_hint_low: "💡 店舗へ要望を送信すると<strong>＋{fb}P</strong>獲得！<br>口コミ投稿（＋{google}P）より<strong>1P多い</strong>のでお得です。<br>ご意見はお店の改善に活かします🙏",
    available_points: "利用可能ポイント",
    review_earn_point_hint: "✍️ 口コミを書くと ＋{n}P が加算されます",
    phone_register_hint: "電話番号を登録するとポイントを管理できます。<br>{n}P 貯めてクーポンと交換！",
    phone_register_btn: "登録する",
    phone_register_note: "※電話番号はハッシュ化して保存。ポイント管理のみに使用します。",
    view_points_btn: "🎴 ポイント確認・特典（クーポン）交換はこちら",
    view_points_line_btn: "📲 LINEでポイント確認・特典（クーポン）交換はこちら",
    arrow_earn_hint: "上記アクション後に追加ポイント獲得！ポイントでクーポンと交換できます",
  },
  en: {
    need_store_id: "store_id is required. /?store_id=XXX",
    store_not_found: "Store not found.",
    no_questions: "No survey questions are set for this store.",
    survey_title_suffix: "Survey",
    submit_btn: "Submit",
    loading_ai: "Creating review suggestions...",
    select_placeholder: "Please select",
    review_select_title: "Choose a review style",
    style1_title: "🟢 Casual",
    style2_title: "🔵 Detailed",
    style3_title: "🟣 Standard",
    edit_hint: "Click to edit",
    edit_options_toggle: "Edit options",
    post_hint: "Copy and post from the links below.",
    post_hint_copy_then_open: "Tap a button to copy this tab’s text and open the review page.",
    coupon_use_hint: "Tap button before use (one-time only). No screenshots. Save link for later.",
    coupon_usage_instructions: "[How to use] Show this screen to staff and tap the button. One-time use only. No screenshots.",
    coupon_browser_limit: "From this browser, coupons are limited to once per {days} days. Already used.",
    longer_btn: "Longer",
    shorter_btn: "Shorter",
    emoji_more_btn: "More emoji",
    emoji_none_btn: "No emoji",
    copy_btn: "Copy text",
    save_btn: "Save edits",
    post_to_sites: "Post review to sites",
    post_to_sites_support: "Post a review to support us!",
    post_to_sites_links: "Site links",
    copy_paste_hint: "Paste the copied text to post",
    post_request: "Please post your review on each site",
    link_post_hint: "You can post from the links below",
    coupon_title_prefix: "Survey thank-you coupon",
    line_message: "Add us on LINE for more deals!",
    line_open: "Add LINE friend",
    show_to_staff_today: "Please show this to staff at checkout.",
    show_to_staff_next: "Please show this to staff on your next visit.",
    issued: "Issued",
    staff_use_hint: "Please tap the \"Use coupon\" button before use. (One-time only)",
    use_btn_staff: "Use (Staff)",
    used_label: "Used",
    coupon_stopped: "Coupons are currently suspended",
    scout_title: "Refer a friend",
    scout_intro: "We're looking for future managers. Please share the referral URL with friends or on SNS.",
    scout_reward_prefix: "【Reward when hired】",
    scout_note: "Add us on LINE so we can notify you when someone is hired through your link. Your referral ID is included in the URL.",
    scout_direct_title: "Recruitment",
    scout_direct_intro: "We are hiring {type}! Job details are on the link below. Please check the details, then enter your application ID ({sid}) and apply or ask via LINE below.",
    scout_recruit_arubaito: "part-time staff",
    scout_recruit_seisyain: "full-time employees",
    scout_recruit_keiyaku: "contract employees",
    scout_recruit_part: "part-time workers",
    scout_recruit_kanbu: "management candidates",
    scout_recruit_staff: "staff",
    scout_recruit_join: " and ",
    scout_direct_line_btn: "Contact for recruitment (LINE)",
    scout_both_title: "Recruitment & Referral",
    scout_both_intro: "We are hiring {type}! Share our referral URL with friends, or contact us directly via LINE to apply.",
    scout_both_note: "Your referral ID is included in the URL. We will notify you when someone is hired through your link.",
    scout_both_line_btn: "Contact for recruitment (LINE)",
    recruit_page_btn: "Recruitment page",
    recruit_detail_link: "View job details",
    contact_page_btn: "Contact page",
    line_contact_btn: "Apply / Ask via LINE",
    line_contact_copy_and_open_btn: "Copy ID and apply / ask via LINE",
    line_contact_sid_hint: "Application ID (copy and paste when messaging on LINE):",
    sid_copy_btn: "Copy",
    scout_direct_interview_reward: "We'll give \"{reward}\" to those who have an interview scheduled!",
    line_official: "Open LINE",
    scout_copy_btn: "Copy referral message & URL",
    recruit_title: "Careers",
    recruit_intro: "Join our team!",
    recruit_link: "View jobs",
    toast_copied: "Copied",
    toast_saved: "Saved",
    loading_refine: "Updating...",
    loading_modify: "Updating...",
    tone_polite: "Polite & sincere",
    tone_friendly: "Friendly",
    tone_short: "Short & simple",
    keywords_placeholder: "Keywords to add (e.g. ham)",
    modify_btn: "Regenerate with keywords",
    store_feedback_btn: "Send the above as feedback to the store",
    feedback_sent_label: "Sent",
    not_generated: "(Not generated)",
    post_request_low: "Please post your review on each site",
    scout_toast_copied: "Referral message & URL copied!",
    screen_navigating: "Loading...",
    photo_upload_label: "Add a photo (optional)",
    photo_upload_hint: "Share your dish or store photo on SNS",
    photo_download_btn: "Download image",
    photo_sns_hint: "Long-press to save and post to Instagram etc.",
    photo_remove_btn: "Remove",
    photo_sns_title: "Photo for SNS",
    msg_high_score: "Your feedback encourages our staff! Please share your experience.",
    msg_low_score: "Thank you for your feedback. Could you tell us more so we can improve our service?",
    msg_thank_high: "Thank you for your response!\nIf you have a moment,\nwe'd appreciate your review to support our store.",
    msg_thank_low: "Thank you for your response!\nIf you have a moment,\nplease send your feedback to the store.",
    msg_review_encourage: "Reviews encourage our staff",
    use_coupon_btn: "Use coupon",
    coupon_screenshot_hint: "Save this link if you plan to use the coupon later",
    coupon_usable_today_hint: "*Valid for today's payment",
    coupon_usable_next_hint: "*Valid from your next visit",
    coupon_scope_chain_wide: "*Valid at all {chain} locations",
    coupon_scope_store_only: "*Valid at this store only",
    line_add_title: "Add us on LINE for more coupons!",
    line_add_bonus: "Get \"{bonus}\" when you add us on LINE!",
    google_review_btn: "Write a Google review",
    line_save_coupon_btn: "Save coupon to LINE",
    line_save_coupon_success: "Sent to LINE! Check LINE at checkout",
    line_save_coupon_hint: "Tap to open LINE and receive the coupon URL",
    line_save_coupon_steps: "① Tap \"Save coupon to LINE\" below → ② On the opened page, tap \"Add as friend\" → ③ You will receive the coupon after adding",
    line_save_coupon_hint_copy: "Tap to copy URL, then paste in LINE \"Note to self\" to save",
    screenshot_warning: "Please do not take screenshots or photos",
    loyalty_breakdown_survey: "Survey",
    loyalty_breakdown_sns: "SNS Share",
    loyalty_breakdown_google: "Google Review",
    loyalty_breakdown_feedback: "Store Feedback",
    loyalty_hint_title_high: "⭐ Earn a coupon by posting a review!",
    loyalty_hint_review_label: "Review",
    loyalty_hint_goal: "Goal reached!",
    loyalty_hint_coupon_earned: "🎁 Coupon earned",
    loyalty_hint_post_hint: "Post using the review above → return to this page to earn points",
    loyalty_hint_low: "💡 Send feedback to the store and earn <strong>+{fb}P</strong>!<br><strong>1P more</strong> than a review (+{google}P) — a better deal!<br>Your opinions help us improve 🙏",
    available_points: "Available Points",
    review_earn_point_hint: "✍️ Post a review to earn +{n}P",
    phone_register_hint: "Register your phone number to manage points.<br>Earn {n}P and redeem for coupons!",
    phone_register_btn: "Register",
    phone_register_note: "* Phone number is hashed and used only for point management.",
    view_points_btn: "🎴 View Points",
    view_points_line_btn: "📲 View Points via LINE",
    arrow_earn_hint: "After the above action, earn additional points below!",
  },
  zh: {
    need_store_id: "需要 store_id。/?store_id=XXX",
    store_not_found: "找不到店铺。",
    no_questions: "此店铺未设置问卷。",
    survey_title_suffix: "问卷调查",
    submit_btn: "提交",
    loading_ai: "AI正在生成评价...",
    select_placeholder: "请选择",
    review_select_title: "选择评价风格",
    style1_title: "🟢 轻松",
    style2_title: "🔵 详细",
    style3_title: "🟣 标准",
    edit_hint: "点击直接编辑",
    edit_options_toggle: "编辑选项",
    post_hint: "粘贴复制的文字即可发布。可从下方链接发布到各网站。",
    post_hint_copy_then_open: "点击下方按钮可复制当前标签页文字并打开投稿页面。",
    coupon_use_hint: "使用前请点击「使用优惠券」（仅限一次）。禁止截图。后日利用请保存链接。",
    coupon_usage_instructions: "【使用方法】向店员出示本画面并点击按钮。仅限一次有效／禁止截图。",
    coupon_browser_limit: "此浏览器每{days}天仅可使用一次优惠券。已使用。",
    longer_btn: "加长",
    shorter_btn: "缩短",
    emoji_more_btn: "增加表情",
    emoji_none_btn: "无表情",
    copy_btn: "复制",
    save_btn: "保存",
    post_to_sites: "发布评价",
    post_to_sites_support: "去各网站写评价支持店铺！",
    post_to_sites_links: "各网站链接",
    copy_paste_hint: "粘贴复制的文字即可发布",
    post_request: "请在各网站发布评价",
    link_post_hint: "可从下方链接发布",
    coupon_title_prefix: "问卷感谢券",
    line_message: "添加LINE获取更多优惠！",
    line_open: "添加LINE好友",
    show_to_staff_today: "结账时请向店员出示",
    show_to_staff_next: "下次来店时请向店员出示",
    issued: "发行",
    coupon_scope_chain_wide: "※{chain}全店可使用",
    coupon_scope_store_only: "※仅限本店使用",
    staff_use_hint: "店员请点击下方按钮使用。（仅限一次）",
    use_btn_staff: "使用（店员）",
    used_label: "已使用",
    coupon_stopped: "优惠券已暂停",
    scout_title: "推荐好友",
    scout_intro: "我们正在寻找未来的店长和经理。请将推荐链接分享给朋友或SNS。",
    scout_reward_prefix: "【录用奖励】",
    scout_note: "添加LINE，录用时可通知您。推荐链接包含您的专属ID。",
    scout_direct_intro: "本店正在招聘{type}。详情请查看下方链接。有兴趣者请确认详情后，输入应聘者识别号（{sid}）并申请或咨询。",
    scout_recruit_arubaito: "兼职员工",
    scout_recruit_seisyain: "正式员工",
    scout_recruit_keiyaku: "合同员工",
    scout_recruit_part: "兼职",
    scout_recruit_kanbu: "干部候补",
    scout_recruit_staff: "员工",
    scout_recruit_join: "、",
    scout_both_intro: "本店正在招聘{type}。推荐者可分享专用链接，直接应聘者可通过LINE联系。",
    line_official: "打开LINE官方账号",
    scout_copy_btn: "复制推荐文和链接",
    recruit_title: "招聘信息",
    recruit_intro: "一起加入我们吧！",
    recruit_link: "查看招聘",
    toast_copied: "已复制",
    toast_saved: "已保存",
    loading_refine: "调整中...",
    loading_modify: "修改中...",
    tone_polite: "礼貌诚恳",
    tone_friendly: "亲切",
    tone_short: "简短",
    keywords_placeholder: "要添加的关键词（例：生火腿）",
    modify_btn: "加入关键词重新生成",
    store_feedback_btn: "将以上内容作为建议发送给店铺",
    feedback_sent_label: "已发送",
    not_generated: "（未生成）",
    post_request_low: "请在各网站发布评价",
    scout_toast_copied: "已复制推荐文和链接！",
    screen_navigating: "加载中",
    photo_upload_label: "添加照片（可选）",
    photo_upload_hint: "可将料理或店铺照片分享至SNS",
    photo_download_btn: "下载图片",
    photo_sns_hint: "长按保存后可发至Instagram等",
    photo_remove_btn: "删除",
    photo_sns_title: "SNS用照片",
    msg_high_score: "您的反馈会鼓励我们！请分享您的体验。",
    msg_low_score: "感谢您的宝贵意见。能否详细说明以便我们改进服务？",
    loyalty_breakdown_survey: "问卷回答",
    loyalty_breakdown_sns: "SNS分享",
    loyalty_breakdown_google: "Google评价",
    loyalty_breakdown_feedback: "发送店铺建议",
    loyalty_hint_title_high: "⭐ 发布评价即可获得优惠券！",
    loyalty_hint_review_label: "发布评价",
    loyalty_hint_goal: "目标达成！",
    loyalty_hint_coupon_earned: "🎁 获得优惠券",
    loyalty_hint_post_hint: "使用上方评价发布 → 返回本页即可加积分",
    loyalty_hint_low: "💡 向店铺发送建议可获得<strong>＋{fb}P</strong>！<br>比发布评价（＋{google}P）<strong>多1P</strong>，更划算！<br>您的意见将用于改善服务🙏",
    available_points: "可用积分",
    review_earn_point_hint: "✍️ 发布评价可获得 +{n}P",
    phone_register_hint: "注册手机号码以管理积分。<br>累计{n}P可兑换优惠券！",
    phone_register_btn: "注册",
    phone_register_note: "※手机号码经哈希处理后保存，仅用于积分管理。",
    view_points_btn: "🎴 查看积分",
    view_points_line_btn: "📲 通过LINE查看积分",
    arrow_earn_hint: "完成以上操作后，可从下方获得额外积分！",
  },
  ko: {
    need_store_id: "store_id가 필요합니다. /?store_id=XXX",
    store_not_found: "매장을 찾을 수 없습니다.",
    no_questions: "이 매장에 설문이 설정되지 않았습니다.",
    survey_title_suffix: "설문",
    submit_btn: "제출",
    loading_ai: "AI가 리뷰를 생성 중...",
    select_placeholder: "선택하세요",
    review_select_title: "리뷰 스타일 선택",
    style1_title: "🟢 캐주얼",
    style2_title: "🔵 상세",
    style3_title: "🟣 스탠다드",
    edit_hint: "클릭하여 직접 편집",
    edit_options_toggle: "편집 옵션",
    post_hint: "복사한 글을 붙여넣기하여 게시할 수 있습니다. 아래 링크에서 게시 가능합니다.",
    post_hint_copy_then_open: "버튼을 누르면 이 탭의 글이 복사되고 리뷰 작성 화면이 열립니다.",
    coupon_use_hint: "사용 전에 버튼을 눌러주세요（1회 한정）. 스크린샷·촬영 금지. 나중에 이용 시 링크 저장.",
    coupon_usage_instructions: "【이용 방법】이 화면을 직원에게 보여 주시고 버튼을 눌러 주세요. 1회 한정／스크린샷 금지.",
    coupon_browser_limit: "이 브라우저에서는 쿠폰은 {days}일당 1회만 사용 가능합니다. 이미 사용하셨습니다.",
    longer_btn: "길게",
    shorter_btn: "짧게",
    emoji_more_btn: "이모지 추가",
    emoji_none_btn: "이모지 없음",
    copy_btn: "복사",
    save_btn: "저장",
    post_to_sites: "리뷰 작성",
    post_to_sites_support: "각 사이트에 리뷰를 남겨 매장을 응원해 주세요!",
    post_to_sites_links: "사이트 링크",
    copy_paste_hint: "복사한 글을 붙여넣기하여 게시",
    post_request: "각 사이트에 리뷰를 작성해 주세요",
    link_post_hint: "아래 링크에서 게시할 수 있습니다",
    coupon_title_prefix: "설문 감사 쿠폰",
    line_message: "LINE 추가로 더 많은 혜택을!",
    line_open: "LINE 친구 추가",
    show_to_staff_today: "결제 시 직원에게 보여 주세요",
    show_to_staff_next: "다음 방문 시 직원에게 보여 주세요",
    issued: "발행",
    coupon_scope_chain_wide: "※{chain} 전 매장에서 사용 가능",
    coupon_scope_store_only: "※이 매장에서만 사용 가능",
    staff_use_hint: "직원은 아래 버튼을 눌러 사용하세요.（1회 한정）",
    use_btn_staff: "사용하기（직원용）",
    used_label: "사용됨",
    coupon_stopped: "쿠폰이 일시 중지되었습니다",
    scout_title: "친구 추천",
    scout_intro: "미래의 점장·매니저를 찾고 있습니다. 추천 URL을 친구나 SNS에 공유해 주세요.",
    scout_reward_prefix: "【채용 시 혜택】",
    scout_note: "LINE 친구 추가 시 채용 시 연락드립니다. 추천 URL에 고유 ID가 포함됩니다.",
    scout_direct_intro: "저희 가게에서는 {type}을(를) 모집합니다. 조건 및 업무 내용은 상세 페이지에서 확인해 주세요. 관심 있는 분은 상세 확인 후 지원자 식별번호（{sid}）를 입력하여 아래에서 지원·문의해 주세요.",
    scout_recruit_arubaito: "아르바이트 직원",
    scout_recruit_seisyain: "정규직",
    scout_recruit_keiyaku: "계약직",
    scout_recruit_part: "파트",
    scout_recruit_kanbu: "간부 후보",
    scout_recruit_staff: "스태프",
    scout_recruit_join: ", ",
    scout_both_intro: "저희 가게에서는 {type}을(를) 모집합니다. 추천해 주실 분은 전용 URL을, 직접 지원하려면 LINE으로 연락해 주세요.",
    line_official: "LINE 공식 계정 열기",
    scout_copy_btn: "추천문과 URL 복사",
    recruit_title: "채용 정보",
    recruit_intro: "함께 일해요!",
    recruit_link: "채용 보기",
    toast_copied: "복사됨",
    toast_saved: "저장됨",
    loading_refine: "조정 중...",
    loading_modify: "수정 중...",
    tone_polite: "정중·성실",
    tone_friendly: "친근한",
    tone_short: "짧고 심플",
    keywords_placeholder: "추가할 키워드（예: 생햄）",
    modify_btn: "키워드 넣어 다시 생성",
    store_feedback_btn: "위 내용을 매장에 요청으로 보내기",
    feedback_sent_label: "발송 완료",
    not_generated: "（미생성）",
    post_request_low: "각 사이트에 리뷰를 작성해 주세요",
    scout_toast_copied: "추천문과 URL 복사됨!",
    screen_navigating: "로딩 중",
    photo_upload_label: "사진 추가 (선택)",
    photo_upload_hint: "요리나 매장 사진을 SNS에 공유할 수 있습니다",
    photo_download_btn: "이미지 다운로드",
    photo_sns_hint: "길게 눌러 저장 후 Instagram 등에 게시하세요",
    photo_remove_btn: "삭제",
    photo_sns_title: "SNS용 사진",
    msg_high_score: "스태프에게 큰 힘이 됩니다! 이 소감을 공유해 주세요.",
    msg_low_score: "소중한 의견 감사합니다. 서비스 개선을 위해 자세한 내용을 알려주실 수 있을까요?",
    loyalty_breakdown_survey: "설문 응답",
    loyalty_breakdown_sns: "SNS 공유",
    loyalty_breakdown_google: "Google 리뷰",
    loyalty_breakdown_feedback: "매장 건의 발송",
    loyalty_hint_title_high: "⭐ 리뷰 게시하고 쿠폰 받기！",
    loyalty_hint_review_label: "리뷰 게시",
    loyalty_hint_goal: "목표 달성！",
    loyalty_hint_coupon_earned: "🎁 쿠폰 획득",
    loyalty_hint_post_hint: "위의 리뷰안을 사용해 게시 → 이 페이지로 돌아오면 포인트 적립",
    loyalty_hint_low: "💡 매장에 건의를 보내면 <strong>＋{fb}P</strong> 획득！<br>리뷰 게시（＋{google}P）보다 <strong>1P 많아</strong> 더 유리！<br>의견은 매장 개선에 활용됩니다🙏",
    available_points: "사용 가능 포인트",
    review_earn_point_hint: "✍️ 리뷰 게시 시 +{n}P 적립",
    phone_register_hint: "전화번호를 등록하면 포인트를 관리할 수 있습니다.<br>{n}P 모아 쿠폰으로 교환！",
    phone_register_btn: "등록하기",
    phone_register_note: "※전화번호는 해시화하여 저장. 포인트 관리에만 사용합니다.",
    view_points_btn: "🎴 포인트 확인하기",
    view_points_line_btn: "📲 LINE으로 포인트 확인",
    arrow_earn_hint: "위 액션 후 아래에서 추가 포인트 획득！",
  },
  es: {
    need_store_id: "Se requiere store_id. /?store_id=XXX",
    store_not_found: "Tienda no encontrada.",
    no_questions: "No hay preguntas configuradas para esta tienda.",
    survey_title_suffix: "Encuesta",
    submit_btn: "Enviar",
    loading_ai: "Creando sugerencias de reseñas...",
    select_placeholder: "Seleccione",
    review_select_title: "Elegir estilo de reseña",
    style1_title: "🟢 Casual",
    style2_title: "🔵 Detallado",
    style3_title: "🟣 Estándar",
    edit_hint: "Haga clic para editar",
    edit_options_toggle: "Opciones de edición",
    post_hint: "Pegue el texto copiado para publicar. Use los enlaces para publicar en cada sitio.",
    post_hint_copy_then_open: "Toque un botón para copiar el texto de esta pestaña y abrir la página de reseñas.",
    coupon_use_hint: "Toque \"Usar cupón\" antes de mostrar（una vez）. No capturas. Guarde el enlace para después.",
    coupon_usage_instructions: "[Uso] Muestre esta pantalla al personal y toque el botón. Un solo uso. No capturas.",
    coupon_browser_limit: "En este navegador el cupón es una vez cada {days} días. Ya usado.",
    longer_btn: "Más largo",
    shorter_btn: "Más corto",
    emoji_more_btn: "Más emojis",
    emoji_none_btn: "Sin emojis",
    copy_btn: "Copiar",
    save_btn: "Guardar",
    post_to_sites: "Publicar reseña",
    post_to_sites_support: "¡Publica una reseña y apoya la tienda!",
    post_to_sites_links: "Enlaces a sitios",
    copy_paste_hint: "Pegue el texto copiado para publicar",
    post_request: "Por favor publique su reseña en cada sitio",
    link_post_hint: "Puede publicar desde los enlaces siguientes",
    coupon_title_prefix: "Cupón de agradecimiento",
    line_message: "¡Agréguenos en LINE para más ofertas!",
    line_open: "Agregar amigo LINE",
    show_to_staff_today: "Muestre esto al personal al pagar.",
    show_to_staff_next: "Muestre esto al personal en su próxima visita.",
    issued: "Emitido",
    coupon_scope_chain_wide: "*Válido en todas las tiendas {chain}",
    coupon_scope_store_only: "*Válido solo en esta tienda",
    staff_use_hint: "Personal: toque el botón para marcar como usado.（Una sola vez）",
    use_btn_staff: "Usar（Personal）",
    used_label: "Usado",
    coupon_stopped: "Los cupones están suspendidos",
    scout_title: "Recomendar amigo",
    scout_intro: "Buscamos futuros gerentes. Comparta el enlace de recomendación con amigos o en SNS.",
    scout_reward_prefix: "【Recompensa al contratar】",
    scout_note: "Agregue LINE para ser notificado cuando alguien sea contratado. Su ID está en el enlace.",
    scout_direct_intro: "Estamos contratando {type}. Detalles en el enlace. Introduzca su ID de solicitud ({sid}) y aplique o pregunte por LINE.",
    scout_recruit_arubaito: "personal a tiempo parcial",
    scout_recruit_seisyain: "empleados a tiempo completo",
    scout_recruit_keiyaku: "empleados contractuales",
    scout_recruit_part: "trabajadores a tiempo parcial",
    scout_recruit_kanbu: "candidatos a gerencia",
    scout_recruit_staff: "personal",
    scout_recruit_join: " y ",
    scout_both_intro: "Estamos contratando {type}. Comparta el enlace de referidos o contáctenos por LINE para aplicar.",
    line_official: "Abrir cuenta LINE",
    scout_copy_btn: "Copiar mensaje y URL de recomendación",
    recruit_title: "Empleo",
    recruit_intro: "¡Únase a nuestro equipo!",
    recruit_link: "Ver empleos",
    toast_copied: "Copiado",
    toast_saved: "Guardado",
    loading_refine: "Actualizando...",
    loading_modify: "Actualizando...",
    tone_polite: "Educado y sincero",
    tone_friendly: "Amigable",
    tone_short: "Corto y simple",
    keywords_placeholder: "Palabras clave a añadir (ej. jamón)",
    modify_btn: "Regenerar con palabras clave",
    store_feedback_btn: "Enviar lo anterior como sugerencia a la tienda",
    feedback_sent_label: "Enviado",
    not_generated: "（No generado）",
    post_request_low: "Por favor publique su reseña en cada sitio",
    scout_toast_copied: "¡Mensaje y URL copiados!",
    screen_navigating: "Cargando...",
    photo_upload_label: "Añadir foto (opcional)",
    photo_upload_hint: "Comparte tu foto en SNS",
    photo_download_btn: "Descargar imagen",
    photo_sns_hint: "Mantén presionado para guardar y publicar en Instagram",
    photo_remove_btn: "Eliminar",
    photo_sns_title: "Foto para SNS",
    msg_high_score: "¡Tu opinión anima al equipo! Comparte tu experiencia.",
    msg_low_score: "Gracias por tu opinión. ¿Podrías contarnos más para mejorar nuestro servicio?",
    loyalty_breakdown_survey: "Encuesta",
    loyalty_breakdown_sns: "Compartir SNS",
    loyalty_breakdown_google: "Reseña Google",
    loyalty_breakdown_feedback: "Sugerencia a tienda",
    loyalty_hint_title_high: "⭐ ¡Publica una reseña y consigue un cupón!",
    loyalty_hint_review_label: "Reseña",
    loyalty_hint_goal: "¡Objetivo alcanzado!",
    loyalty_hint_coupon_earned: "🎁 Cupón obtenido",
    loyalty_hint_post_hint: "Publica con la reseña de arriba → vuelve a esta página para ganar puntos",
    loyalty_hint_low: "💡 Envía sugerencias a la tienda y gana <strong>+{fb}P</strong>.<br><strong>1P más</strong> que publicar una reseña (+{google}P) — ¡más ventajoso!<br>Tus opiniones ayudan a mejorar el servicio 🙏",
    available_points: "Puntos Disponibles",
    review_earn_point_hint: "✍️ Publica una reseña para ganar +{n}P",
    phone_register_hint: "Registra tu número de teléfono para gestionar puntos.<br>¡Acumula {n}P y canjéalos por cupones!",
    phone_register_btn: "Registrar",
    phone_register_note: "* El teléfono se almacena con hash y solo se usa para la gestión de puntos.",
    view_points_btn: "🎴 Ver Puntos",
    view_points_line_btn: "📲 Ver Puntos vía LINE",
    arrow_earn_hint: "¡Tras la acción anterior, gana puntos adicionales abajo!",
  },
  fr: {
    need_store_id: "store_id requis. /?store_id=XXX",
    store_not_found: "Magasin introuvable.",
    no_questions: "Aucune question configurée pour ce magasin.",
    survey_title_suffix: "Sondage",
    submit_btn: "Envoyer",
    loading_ai: "Création des suggestions d'avis...",
    select_placeholder: "Veuillez sélectionner",
    review_select_title: "Choisir le style d'avis",
    style1_title: "🟢 Décontracté",
    style2_title: "🔵 Détaillé",
    style3_title: "🟣 Standard",
    edit_hint: "Cliquez pour éditer",
    edit_options_toggle: "Options d'édition",
    post_hint: "Collez le texte copié pour publier. Utilisez les liens ci-dessous pour publier sur chaque site.",
    post_hint_copy_then_open: "Appuyez sur un bouton pour copier le texte de cet onglet et ouvrir la page d’avis.",
    coupon_use_hint: "Appuyez sur le bouton avant utilisation（une fois seulement）. Pas de captures. Sauvegardez le lien pour plus tard.",
    coupon_usage_instructions: "[Utilisation] Montrez cet écran au personnel et appuyez sur le bouton. Valable une fois. Pas de captures.",
    coupon_browser_limit: "Sur ce navigateur, le coupon est limité à une fois par {days} jours. Déjà utilisé.",
    longer_btn: "Plus long",
    shorter_btn: "Plus court",
    emoji_more_btn: "Plus d'emojis",
    emoji_none_btn: "Pas d'emoji",
    copy_btn: "Copier",
    save_btn: "Enregistrer",
    post_to_sites: "Publier l'avis",
    post_to_sites_support: "Publiez un avis pour soutenir le magasin !",
    post_to_sites_links: "Liens des sites",
    copy_paste_hint: "Collez le texte copié pour publier",
    post_request: "Veuillez publier votre avis sur chaque site",
    link_post_hint: "Vous pouvez publier depuis les liens ci-dessous",
    coupon_title_prefix: "Coupon de remerciement",
    line_message: "Ajoutez-nous sur LINE pour plus d'offres !",
    line_open: "Ajouter en ami LINE",
    show_to_staff_today: "Montrez ceci au personnel à la caisse.",
    show_to_staff_next: "Montrez ceci au personnel lors de votre prochaine visite.",
    issued: "Émis",
    coupon_scope_chain_wide: "*Valable dans tous les magasins {chain}",
    coupon_scope_store_only: "*Valable dans ce magasin uniquement",
    staff_use_hint: "Personnel : appuyez sur le bouton pour marquer comme utilisé.（Une fois seulement）",
    use_btn_staff: "Utiliser（Personnel）",
    used_label: "Utilisé",
    coupon_stopped: "Les coupons sont suspendus",
    scout_title: "Parrainer un ami",
    scout_intro: "Nous recherchons de futurs managers. Partagez le lien de parrainage avec des amis ou sur les réseaux sociaux.",
    scout_reward_prefix: "【Récompense à l'embauche】",
    scout_note: "Ajoutez LINE pour être notifié lors d'une embauche. Votre ID est dans le lien.",
    scout_direct_intro: "Nous recrutons {type}. Détails dans le lien. Entrez votre ID de candidature ({sid}) pour postuler ou demander via LINE.",
    scout_recruit_arubaito: "personnel à temps partiel",
    scout_recruit_seisyain: "employés à temps plein",
    scout_recruit_keiyaku: "employés en CDD",
    scout_recruit_part: "travailleurs à temps partiel",
    scout_recruit_kanbu: "candidats au management",
    scout_recruit_staff: "personnel",
    scout_recruit_join: " et ",
    scout_both_intro: "Nous recrutons {type}. Partagez le lien ou contactez-nous via LINE pour postuler.",
    line_official: "Ouvrir le compte LINE",
    scout_copy_btn: "Copier message et URL de parrainage",
    recruit_title: "Emplois",
    recruit_intro: "Rejoignez notre équipe !",
    recruit_link: "Voir les emplois",
    toast_copied: "Copié",
    toast_saved: "Enregistré",
    loading_refine: "Mise à jour...",
    loading_modify: "Mise à jour...",
    tone_polite: "Poli et sincère",
    tone_friendly: "Amical",
    tone_short: "Court et simple",
    keywords_placeholder: "Mots-clés à ajouter (ex. jambon)",
    modify_btn: "Régénérer avec mots-clés",
    store_feedback_btn: "Envoyer ce qui précède comme suggestion au magasin",
    feedback_sent_label: "Envoyé",
    not_generated: "（Non généré）",
    post_request_low: "Veuillez publier votre avis sur chaque site",
    scout_toast_copied: "Message et URL copiés !",
    screen_navigating: "Chargement...",
    photo_upload_label: "Ajouter une photo (optionnel)",
    photo_upload_hint: "Partagez votre photo sur les réseaux sociaux",
    photo_download_btn: "Télécharger l'image",
    photo_sns_hint: "Appuyez longuement pour enregistrer et publier sur Instagram",
    photo_remove_btn: "Supprimer",
    photo_sns_title: "Photo pour SNS",
    msg_high_score: "Votre avis encourage l'équipe ! Partagez votre expérience.",
    msg_low_score: "Merci pour votre avis. Pourriez-vous nous en dire plus pour améliorer notre service ?",
    loyalty_breakdown_survey: "Sondage",
    loyalty_breakdown_sns: "Partage SNS",
    loyalty_breakdown_google: "Avis Google",
    loyalty_breakdown_feedback: "Suggestion au magasin",
    loyalty_hint_title_high: "⭐ Postez un avis et obtenez un coupon !",
    loyalty_hint_review_label: "Avis",
    loyalty_hint_goal: "Objectif atteint !",
    loyalty_hint_coupon_earned: "🎁 Coupon obtenu",
    loyalty_hint_post_hint: "Postez avec l'avis ci-dessus → revenez sur cette page pour gagner des points",
    loyalty_hint_low: "💡 Envoyez une suggestion au magasin et gagnez <strong>+{fb}P</strong> !<br><strong>1P de plus</strong> qu'un avis (+{google}P) — plus avantageux !<br>Vos opinions nous aident à améliorer le service 🙏",
    available_points: "Points Disponibles",
    review_earn_point_hint: "✍️ Postez un avis pour gagner +{n}P",
    phone_register_hint: "Enregistrez votre numéro pour gérer vos points.<br>Cumulez {n}P et échangez contre des coupons !",
    phone_register_btn: "Enregistrer",
    phone_register_note: "* Le numéro est stocké sous forme de hash et utilisé uniquement pour la gestion des points.",
    view_points_btn: "🎴 Voir les Points",
    view_points_line_btn: "📲 Voir les Points via LINE",
    arrow_earn_hint: "Après l'action ci-dessus, gagnez des points supplémentaires ci-dessous !",
  },
  th: {
    need_store_id: "ต้องการ store_id /?store_id=XXX",
    store_not_found: "ไม่พบร้านค้า",
    no_questions: "ยังไม่ได้ตั้งคำถามสำหรับร้านนี้",
    survey_title_suffix: "แบบสำรวจ",
    submit_btn: "ส่ง",
    loading_ai: "กำลังสร้างคำแนะนำรีวิว...",
    select_placeholder: "กรุณาเลือก",
    review_select_title: "เลือกสไตล์รีวิว",
    style1_title: "🟢 สบายๆ",
    style2_title: "🔵 รายละเอียด",
    style3_title: "🟣 มาตรฐาน",
    edit_hint: "คลิกเพื่อแก้ไข",
    edit_options_toggle: "ตัวเลือกการแก้ไข",
    post_hint: "วางข้อความที่คัดลอกเพื่อโพสต์ คุณสามารถโพสต์ได้จากลิงก์ด้านล่าง",
    post_hint_copy_then_open: "แตะปุ่มเพื่อคัดลอกข้อความในแท็บนี้แล้วเปิดหน้าเขียนรีวิว",
    coupon_use_hint: "กดปุ่มก่อนใช้งาน（ครั้งเดียวเท่านั้น）ห้ามสกรีนช็อต เก็บลิงก์ไว้ใช้ภายหลัง",
    coupon_usage_instructions: "【วิธีใช้】แสดงหน้านี้ต่อพนักงานแล้วกดปุ่ม ใช้ได้ครั้งเดียว／ห้ามสกรีนช็อต",
    coupon_browser_limit: "ในเบราว์เซอร์นี้คูปองใช้ได้ครั้งเดียวทุก {days} วัน ใช้แล้ว",
    longer_btn: "ยาวขึ้น",
    shorter_btn: "สั้นลง",
    emoji_more_btn: "เพิ่มอีโมจิ",
    emoji_none_btn: "ไม่มีอีโมจิ",
    copy_btn: "คัดลอก",
    save_btn: "บันทึก",
    post_to_sites: "โพสต์รีวิว",
    post_to_sites_support: "โพสต์รีวิวเพื่อสนับสนุนร้าน!",
    post_to_sites_links: "ลิงก์แต่ละไซต์",
    copy_paste_hint: "วางข้อความที่คัดลอกเพื่อโพสต์",
    post_request: "กรุณาโพสต์รีวิวในแต่ละไซต์",
    link_post_hint: "สามารถโพสต์ได้จากลิงก์ด้านล่าง",
    coupon_title_prefix: "คูปองขอบคุณ",
    line_message: "เพิ่ม LINE เพื่อรับข้อเสนอพิเศษ!",
    line_open: "เพิ่มเพื่อน LINE",
    show_to_staff_today: "เมื่อชำระเงินให้พนักงานดู",
    show_to_staff_next: "แสดงให้พนักงานดูในการมาเยือนครั้งถัดไป",
    issued: "ออกแล้ว",
    coupon_scope_chain_wide: "*ใช้ได้ทุกสาขา {chain}",
    coupon_scope_store_only: "*ใช้ได้เฉพาะสาขานี้",
    staff_use_hint: "พนักงาน: กดปุ่มเพื่อใช้（ครั้งเดียวเท่านั้น）",
    use_btn_staff: "ใช้（พนักงาน）",
    used_label: "ใช้แล้ว",
    coupon_stopped: "คูปองถูกระงับชั่วคราว",
    scout_title: "แนะนำเพื่อน",
    scout_intro: "เรากำลังหาผู้จัดการในอนาคต แชร์ลิงก์แนะนำให้เพื่อนหรือบน SNS",
    scout_reward_prefix: "【รางวัลเมื่อได้รับการว่าจ้าง】",
    scout_note: "เพิ่ม LINE เพื่อรับแจ้งเมื่อมีคนสมัคร ลิงก์มี ID เฉพาะของคุณ",
    scout_direct_intro: "เรากำลังรับสมัคร{type} รายละเอียดและงานดูได้ที่หน้าเพจ สนใจกรุณากรอกรหัสผู้สมัคร ({sid}) แล้วสมัครหรือสอบถามด้านล่าง",
    scout_recruit_arubaito: "พนักงานพาร์ทไทม์",
    scout_recruit_seisyain: "พนักงานประจำ",
    scout_recruit_keiyaku: "พนักงานสัญญาจ้าง",
    scout_recruit_part: "พนักงานพาร์ท",
    scout_recruit_kanbu: "ผู้สมัครตำแหน่งบริหาร",
    scout_recruit_staff: "สตาฟ",
    scout_recruit_join: " และ ",
    scout_both_intro: "เรากำลังรับสมัคร{type} ผู้แนะนำให้ใช้ลิงก์พิเศษ ผู้สมัครตรงติดต่อ LINE",
    line_official: "เปิดบัญชี LINE",
    scout_copy_btn: "คัดลอกข้อความและลิงก์แนะนำ",
    recruit_title: "งานว่าง",
    recruit_intro: "มาร่วมทีมกับเรา!",
    recruit_link: "ดูงาน",
    toast_copied: "คัดลอกแล้ว",
    toast_saved: "บันทึกแล้ว",
    loading_refine: "กำลังปรับ...",
    loading_modify: "กำลังแก้ไข...",
    tone_polite: "สุภาพและจริงใจ",
    tone_friendly: "เป็นกันเอง",
    tone_short: "สั้นและกระชับ",
    keywords_placeholder: "คำสำคัญที่ต้องการเพิ่ม (เช่น แฮม)",
    modify_btn: "เพิ่มคำสำคัญแล้วสร้างใหม่",
    store_feedback_btn: "ส่งข้อความด้านบนเป็นข้อเสนอแนะถึงร้าน",
    feedback_sent_label: "ส่งแล้ว",
    not_generated: "（ยังไม่ได้สร้าง）",
    post_request_low: "กรุณาโพสต์รีวิวในแต่ละไซต์",
    scout_toast_copied: "คัดลอกข้อความและลิงก์แล้ว!",
    screen_navigating: "กำลังโหลด",
    photo_upload_label: "เพิ่มรูปภาพ (ไม่บังคับ)",
    photo_upload_hint: "แชร์รูปอาหารหรือร้านบน SNS",
    photo_download_btn: "ดาวน์โหลดรูป",
    photo_sns_hint: "กดค้างเพื่อบันทึกและโพสต์บน Instagram",
    photo_remove_btn: "ลบ",
    photo_sns_title: "รูปสำหรับ SNS",
    msg_high_score: "ความเห็นของคุณเป็นกำลังใจให้ทีมงาน! แชร์ประสบการณ์ของคุณได้เลย",
    msg_low_score: "ขอบคุณสำหรับความเห็น เราขอรายละเอียดเพิ่มเติมเพื่อปรับปรุงบริการได้ไหมครับ",
    loyalty_breakdown_survey: "ตอบแบบสอบถาม",
    loyalty_breakdown_sns: "แชร์ SNS",
    loyalty_breakdown_google: "รีวิว Google",
    loyalty_breakdown_feedback: "ส่งข้อเสนอแนะ",
    loyalty_hint_title_high: "⭐ โพสต์รีวิวแล้วรับคูปอง！",
    loyalty_hint_review_label: "โพสต์รีวิว",
    loyalty_hint_goal: "ถึงเป้าหมายแล้ว！",
    loyalty_hint_coupon_earned: "🎁 ได้รับคูปอง",
    loyalty_hint_post_hint: "โพสต์โดยใช้รีวิวด้านบน → กลับมาหน้านี้เพื่อรับแต้ม",
    loyalty_hint_low: "💡 ส่งข้อเสนอแนะถึงร้านค้าแล้วรับ <strong>＋{fb}P</strong>！<br><strong>มากกว่า 1P</strong> เมื่อเทียบกับการโพสต์รีวิว（＋{google}P）！<br>ความเห็นของคุณจะช่วยพัฒนาบริการ🙏",
    available_points: "แต้มที่ใช้ได้",
    review_earn_point_hint: "✍️ โพสต์รีวิวเพื่อรับ +{n}P",
    phone_register_hint: "ลงทะเบียนหมายเลขโทรศัพท์เพื่อจัดการแต้ม<br>สะสม {n}P แลกคูปองได้！",
    phone_register_btn: "ลงทะเบียน",
    phone_register_note: "※หมายเลขโทรศัพท์จะถูกเข้ารหัสและใช้เพื่อการจัดการแต้มเท่านั้น",
    view_points_btn: "🎴 ดูแต้ม",
    view_points_line_btn: "📲 ดูแต้มผ่าน LINE",
    arrow_earn_hint: "หลังจากทำกิจกรรมด้านบน รับแต้มเพิ่มเติมด้านล่าง！",
  },
  vi: {
    need_store_id: "Cần store_id. /?store_id=XXX",
    store_not_found: "Không tìm thấy cửa hàng.",
    no_questions: "Chưa có câu hỏi khảo sát cho cửa hàng này.",
    survey_title_suffix: "Khảo sát",
    submit_btn: "Gửi",
    loading_ai: "Đang tạo gợi ý đánh giá...",
    select_placeholder: "Vui lòng chọn",
    review_select_title: "Chọn phong cách đánh giá",
    style1_title: "🟢 Thân thiện",
    style2_title: "🔵 Chi tiết",
    style3_title: "🟣 Tiêu chuẩn",
    edit_hint: "Nhấn để chỉnh sửa",
    edit_options_toggle: "Tùy chọn chỉnh sửa",
    post_hint: "Dán văn bản đã sao chép để đăng. Có thể đăng từ các liên kết bên dưới.",
    post_hint_copy_then_open: "Chạm nút để sao chép nội dung tab này và mở trang đăng đánh giá.",
    coupon_use_hint: "Nhấn nút trước khi sử dụng（chỉ một lần）. Không chụp màn hình. Lưu liên kết để dùng sau.",
    coupon_usage_instructions: "[Cách dùng] Đưa màn hình này cho nhân viên và nhấn nút. Chỉ có hiệu lực 1 lần. Không chụp màn hình.",
    coupon_browser_limit: "Trên trình duyệt này coupon chỉ dùng 1 lần mỗi {days} ngày. Đã sử dụng.",
    longer_btn: "Dài hơn",
    shorter_btn: "Ngắn hơn",
    emoji_more_btn: "Thêm emoji",
    emoji_none_btn: "Không emoji",
    copy_btn: "Sao chép",
    save_btn: "Lưu",
    post_to_sites: "Đăng đánh giá",
    post_to_sites_support: "Đăng đánh giá để ủng hộ cửa hàng!",
    post_to_sites_links: "Liên kết các trang",
    copy_paste_hint: "Dán văn bản đã sao chép để đăng",
    post_request: "Vui lòng đăng đánh giá trên mỗi trang",
    link_post_hint: "Có thể đăng từ các liên kết bên dưới",
    coupon_title_prefix: "Phiếu ưu đãi cảm ơn",
    line_message: "Thêm LINE để nhận ưu đãi!",
    line_open: "Thêm bạn LINE",
    show_to_staff_today: "Vui lòng cho nhân viên xem khi thanh toán.",
    show_to_staff_next: "Vui lòng cho nhân viên xem khi đến lần sau.",
    issued: "Đã phát hành",
    coupon_scope_chain_wide: "*Có hiệu lực tại tất cả cửa hàng {chain}",
    coupon_scope_store_only: "*Chỉ có hiệu lực tại cửa hàng này",
    staff_use_hint: "Nhân viên: nhấn nút để sử dụng.（Chỉ một lần）",
    use_btn_staff: "Sử dụng（Nhân viên）",
    used_label: "Đã dùng",
    coupon_stopped: "Phiếu ưu đãi tạm ngưng",
    scout_title: "Giới thiệu bạn bè",
    scout_intro: "Chúng tôi đang tìm quản lý tương lai. Chia sẻ liên kết giới thiệu với bạn bè hoặc SNS.",
    scout_reward_prefix: "【Phần thưởng khi được tuyển】",
    scout_note: "Thêm LINE để được thông báo khi có người được tuyển. Liên kết có ID riêng của bạn.",
    scout_direct_intro: "Chúng tôi đang tuyển {type}. Chi tiết xem tại liên kết. Vui lòng nhập ID ứng viên ({sid}) để ứng tuyển hoặc hỏi qua LINE.",
    scout_recruit_arubaito: "nhân viên bán thời gian",
    scout_recruit_seisyain: "nhân viên chính thức",
    scout_recruit_keiyaku: "nhân viên hợp đồng",
    scout_recruit_part: "nhân viên part-time",
    scout_recruit_kanbu: "ứng viên quản lý",
    scout_recruit_staff: "nhân viên",
    scout_recruit_join: " và ",
    scout_both_intro: "Chúng tôi đang tuyển {type}. Chia sẻ liên kết giới thiệu hoặc liên hệ LINE để ứng tuyển.",
    line_official: "Mở tài khoản LINE",
    scout_copy_btn: "Sao chép tin nhắn và liên kết giới thiệu",
    recruit_title: "Tuyển dụng",
    recruit_intro: "Tham gia cùng chúng tôi!",
    recruit_link: "Xem việc làm",
    toast_copied: "Đã sao chép",
    toast_saved: "Đã lưu",
    loading_refine: "Đang cập nhật...",
    loading_modify: "Đang sửa...",
    tone_polite: "Lịch sự & chân thành",
    tone_friendly: "Thân thiện",
    tone_short: "Ngắn gọn",
    keywords_placeholder: "Từ khóa thêm (vd: giăm bông)",
    modify_btn: "Thêm từ khóa và tạo lại",
    store_feedback_btn: "Gửi nội dung trên làm góp ý đến cửa hàng",
    feedback_sent_label: "Đã gửi",
    not_generated: "（Chưa tạo）",
    post_request_low: "Vui lòng đăng đánh giá trên mỗi trang",
    scout_toast_copied: "Đã sao chép tin nhắn và liên kết!",
    screen_navigating: "Đang tải",
    photo_upload_label: "Thêm ảnh (tùy chọn)",
    photo_upload_hint: "Chia sẻ ảnh món ăn hoặc cửa hàng lên SNS",
    photo_download_btn: "Tải ảnh",
    photo_sns_hint: "Nhấn giữ để lưu và đăng lên Instagram",
    photo_remove_btn: "Xóa",
    photo_sns_title: "Ảnh cho SNS",
    msg_high_score: "Ý kiến của bạn động viên nhân viên! Hãy chia sẻ trải nghiệm.",
    msg_low_score: "Cảm ơn ý kiến quý báu. Bạn có thể cho chúng tôi biết chi tiết để cải thiện dịch vụ không?",
    loyalty_breakdown_survey: "Trả lời khảo sát",
    loyalty_breakdown_sns: "Chia sẻ SNS",
    loyalty_breakdown_google: "Đánh giá Google",
    loyalty_breakdown_feedback: "Gửi góp ý đến cửa hàng",
    loyalty_hint_title_high: "⭐ Đăng đánh giá để nhận phiếu giảm giá！",
    loyalty_hint_review_label: "Đăng đánh giá",
    loyalty_hint_goal: "Đạt mục tiêu！",
    loyalty_hint_coupon_earned: "🎁 Nhận phiếu giảm giá",
    loyalty_hint_post_hint: "Đăng bằng nội dung đánh giá trên → quay lại trang này để cộng điểm",
    loyalty_hint_low: "💡 Gửi góp ý đến cửa hàng để nhận <strong>＋{fb}P</strong>！<br><strong>Nhiều hơn 1P</strong> so với đăng đánh giá（＋{google}P）！<br>Ý kiến của bạn giúp cải thiện dịch vụ🙏",
    available_points: "Điểm khả dụng",
    review_earn_point_hint: "✍️ Đăng đánh giá để nhận +{n}P",
    phone_register_hint: "Đăng ký số điện thoại để quản lý điểm.<br>Tích {n}P đổi phiếu giảm giá！",
    phone_register_btn: "Đăng ký",
    phone_register_note: "※Số điện thoại được mã hóa hash và chỉ dùng để quản lý điểm.",
    view_points_btn: "🎴 Xem Điểm",
    view_points_line_btn: "📲 Xem Điểm qua LINE",
    arrow_earn_hint: "Sau hành động trên, nhận điểm bổ sung bên dưới！",
  },
};

function getPreferredLang(req: Request): Lang {
  const accept = req.headers.get("Accept-Language") || "";
  const parts = accept.split(",").map((p) => p.trim().toLowerCase().split(";")[0] || "");
  for (const part of parts) {
    if (part.startsWith("ja")) return "ja";
    if (part.startsWith("zh")) return "zh";
    if (part.startsWith("ko")) return "ko";
    if (part.startsWith("es")) return "es";
    if (part.startsWith("fr")) return "fr";
    if (part.startsWith("th")) return "th";
    if (part.startsWith("vi")) return "vi";
    if (part.startsWith("en")) return "en";
  }
  return "ja";
}

function t(lang: Lang, key: string): string {
  const dict = TRANSLATIONS[lang];
  const fallback = lang === "ja" ? null : (TRANSLATIONS.en[key] || TRANSLATIONS.ja[key]);
  return (dict && dict[key]) || fallback || key;
}

// ========== プロンプト構築（tally-webhook と同等） ==========
type StorePromptRow = Record<string, unknown> & {
  score_max?: number | null;
  score_min?: number | null;
  prompt_style1?: string | null;
  style1_target_length?: number | null;
  prompt_style2?: string | null;
  style2_target_length?: number | null;
  prompt_style3?: string | null;
  style3_target_length?: number | null;
  system_prompt_override?: string | null;
};

const DEFAULT_STYLE1 =
  "40〜80文字程度。トレンド感を意識し、適度に絵文字を活用。パッと目を引くカジュアルな表現。";
const DEFAULT_STYLE2 =
  "120〜180文字程度。誠実で信頼感のある敬語ベース。味、接客、価格のバランスを網羅。";
const DEFAULT_STYLE3 =
  "200〜300文字以上。特定のメニューへの深いこだわりや、店内の照明・接客の細かなエピソードを盛り込んだ「ファンの声」としての長文。";
const FLEXIBLE_LENGTH_NOTE_JA =
  "上記の文字数帯は目安であり厳密な上限ではない。ただし帯の中心に無理やり合わせるために冗長化しないこと。";
const FLEXIBLE_LENGTH_NOTE_EN =
  "The character range is a guide, not a strict cap. Do not pad or repeat ideas just to land near the middle of the range.";

/** 店舗設定の目標文字数を基準に ±50% の帯を返す（生成プロンプト用） */
function targetLengthBand(base: number): { min: number; max: number } {
  const b = Math.max(1, base);
  const min = Math.max(1, Math.round(b * 0.5));
  const max = Math.max(min + 1, Math.round(b * 1.5));
  return { min, max };
}

function buildLengthInstruction(base: number, lang: Lang): string {
  const { min, max } = targetLengthBand(base);
  if (lang === "ja") {
    return `【文字量】目安はおおよそ${min}〜${max}文字（店舗設定${base}文字を基準に±50%の幅）。文字数を満たすためだけの足し足し、意味の薄い繰り返し、決まり文句の乱用は禁止。内容が尽きた時点で自然に終える。${FLEXIBLE_LENGTH_NOTE_JA}`;
  }
  return `【Length】Aim for roughly ${min}–${max} characters (±50% around the store target of ${base}). No filler, no thin repetition, no stock phrases just to hit a quota; end when it feels complete. ${FLEXIBLE_LENGTH_NOTE_EN}`;
}

function pickRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function pickRandomSubset<T>(arr: T[], minCount: number, maxCount: number): T[] {
  const copy = [...arr];
  const n = copy.length;
  if (n === 0) return [];
  const k = Math.max(minCount, Math.min(maxCount, n));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

const STRUCT_PATTERNS_JA = [
  "Aパターン: 「導入（来店のきっかけ）→料理・ドリンク→接客→まとめ（また来たい理由）」の順で書いてください。",
  "Bパターン: 「来店動機→一番よかった点→他にも良かった点→また来たい理由」の順で書いてください。",
  "Cパターン: 「お店の雰囲気→料理・ドリンク→スタッフの印象→おすすめしたい人」の順で書いてください。",
];

const EMPHASIS_TAGS_JA = [
  "味（料理・ドリンク）",
  "雰囲気（内装・BGM・空間）",
  "接客（スタッフの対応）",
  "価格・コスパ",
];

const CLOSING_TEMPLATES_JA = [
  "また行きたいです。",
  "次は別のメニューも試してみたいです。",
  "友人にも勧めたいお店です。",
  "特別な日の候補にしたいと思いました。",
];

const ADJECTIVE_PHRASES_JA = [
  "ほっぺが落ちそうな美味しさ",
  "至福のひととき",
  "クオリティが高い",
  "リピ確定",
  "癖になる味",
  "安定の美味しさ",
];

/** 評価点に基づく3パターン: 4以上 / 3 / 2以下（スケールは scoreMin/scoreMax で汎用） */
function buildScoreToneBlock(score: number, scoreMax: number, scoreMin: number): string {
  const isHigh = score >= scoreMax - 1;
  const isLow = score <= scoreMin + 1;
  if (isHigh) {
    return `【高評価（${score}/${scoreMax}）のトーン】
・「感動系」「落ち着いた褒め」「フラットだけど丁寧」のいずれかの雰囲気で、1つに寄せて書くこと。
・喜びや感謝をストレートに表現しつつ、具体的なエピソードを1つ以上入れる。
・ポジティブな語彙は自然な範囲で使う。文字数稼ぎの誇張、同義の繰り返し、テンプレ感の強い連発は避ける。
・心から満足した体験として書く。`;
  }
  if (isLow) {
    return `【低評価（${score}/${scoreMax}）のトーン・建設的フィードバック】
・「〜が最悪だった」「二度と行かない」といった攻撃的・感情的表現は絶対に避ける。
・「〜という点は残念でしたが、改善されることを期待しています」「今後は〜のようになるとより良いと感じました」といった、誠実で建設的なトーンにする。
・ユーザーが選択した不満点（アンケート answers 内のデータ）を「改善のヒント」として文章に自然に組み込む。箇条書きにせず、文脈に溶け込ませる。`;
  }
  return `【中程度の評価（${score}/${scoreMax}）のトーン】
・良い点と気になった点をバランスよく書く。
・事実に基づき、過度に攻撃的にも過度に褒めすぎない表現にする。`;
}

function buildPromptConfig(store: StorePromptRow | null, score: number, lang: Lang, recentReviews?: string[]): { systemPrompt: string } {
  const s = store ?? {};
  const len1 = Math.max(1, Number(s.style1_target_length) || 70);
  const len2 = Math.max(1, Number(s.style2_target_length) || 150);
  const len3 = Math.max(1, Number(s.style3_target_length) || 250);
  const scoreMax = Math.max(1, Number(s.score_max) || 5);
  const scoreMin = Math.min(scoreMax - 1, Math.max(0, Number(s.score_min) ?? 1));
  const scoreClamped = Math.max(scoreMin, Math.min(scoreMax, score));
  const getPrompt = (v: unknown, def: string) =>
    (String(v ?? "").trim() || def).replace(/\n/g, " ");
  const prompt1 = getPrompt(s.prompt_style1, DEFAULT_STYLE1);
  const prompt2 = getPrompt(s.prompt_style2, DEFAULT_STYLE2);
  const prompt3 = getPrompt(s.prompt_style3, DEFAULT_STYLE3);

  const structPatternJa =
    lang === "ja" ? STRUCT_PATTERNS_JA[pickRandomInt(STRUCT_PATTERNS_JA.length)] : "";
  const emphasisJa =
    lang === "ja" ? pickRandomSubset(EMPHASIS_TAGS_JA, 2, 3) : [];
  const closingJa =
    lang === "ja" ? pickRandomSubset(CLOSING_TEMPLATES_JA, 1, 2) : [];
  const adjectivesJa =
    lang === "ja" ? pickRandomSubset(ADJECTIVE_PHRASES_JA, 2, 3) : [];

  const emojiEnabled = s.emoji_enabled !== false;
  const emojiRule = emojiEnabled ? "" : "・絵文字は一切使わないこと。\n";
  const baseBlock = `【絶対ルール】
${emojiRule}・接続詞を多用せず、自然な話し言葉を意識すること。
・語尾を3案でバラバラにすること。
・文字数や構成要素の数を満たすために、同じ内容の言い換えや薄い一文を足さないこと。
【事実に基づく厳守】アンケート回答に記載された事実のみを使用すること。回答にない体験・エピソード（待ち時間、接客、味など）は絶対に捏造・創作してはならない。記載がある項目のみ自然に膨らませる。
【ポジティブ項目の優先】アンケートで回答者が肯定的に選択・記入した項目（高評価、良い点、気に入った点、満足した点、選んだオプションなど）を特に優先して文章に組み込み、具体的に言及すること。

${buildScoreToneBlock(scoreClamped, scoreMax, scoreMin)}${lang === "ja" ? `

【構成パターン】
${structPatternJa}
※4段すべてを無理に埋めなくてよい。自然な長さで重要な2〜3点に絞ってよい。

【強調する観点（2〜3個を優先して深掘り）】
${emphasisJa.map((x) => "・" + x).join("\n")}
→ 実際にアンケートに触れられる観点を1〜2個に絞り、深掘りしすぎて本文が膨らみすぎないこと。

【文末テンプレ候補】
${closingJa.map((x) => "・" + x).join("\n")}
→ 上記の中から自然なものを0〜1個だけ選び、無理に入れないこと。

【形容表現の候補】
${adjectivesJa.map((x) => "・" + x).join("\n")}
→ 上記から自然に使えるものだけ0〜2個まで。詰め込まないこと。` : ""}

【回答者属性の活用】アンケートで回答された来店者情報（同伴者・利用シーン・来店きっかけ等）を口コミに自然に織り込むこと。例：「who=友人」→「友人と久々に」「scene=デート」→雰囲気で示す。ただし回答にない属性は一切捏造しないこと。
【使用禁止フレーズ】以下はAI生成特有の不自然な表現のため絶対に使わないこと：「〜をいただきました」「〜させていただきました」（過剰な謙譲語）、「全体的に」「総じて」「非常に」「とても」の単体使用、「また訪れたいと思います」「また来たいと思います」で文を締めること、「〜という点が印象的でした」「〜という体験ができました」「〜な一品です」。
【スタイル間の人物差別化】style1・2・3は同一人物の別バージョンではなく、全く異なる属性の人物が書いた体で作成すること。書き出し・一人称の有無・文のリズム・着目点を全て変えること。
【バリエーション必須】毎回必ず語彙・文末表現・構成パターン・切り口を変えること。「美味しかった」「また行きたい」「スタッフの方が」などの定番フレーズをそのまま使わず、より具体的で独自の表現に置き換えること。同じ形容詞・接続詞・文末表現の連続使用を避けること。${(recentReviews && recentReviews.length > 0) ? `

【重複禁止】以下の口コミは直近で既に生成されています。語彙・文体・書き出し・結び・構成パターンを全て変えること。同じ文章や似た表現を一切使ってはならない。
${recentReviews.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : ""}`;

  const uiMode = String(s.ui_mode ?? "sns").toLowerCase();
  const includeHashtags = uiMode !== "review";
  const styleBlock = `【3案のペルソナ（JSONで style1, style2, style3）】
・style1: ${prompt1}
${buildLengthInstruction(len1, lang)}
・style2: ${prompt2}
${buildLengthInstruction(len2, lang)}
・style3: ${prompt3}
${buildLengthInstruction(len3, lang)}${includeHashtags ? `
【ハッシュタグ】
・内容に合ったハッシュタグを各スタイルの文末に5〜8個付けること。
・店舗側で固定タグが設定されている場合でも、毎回必ずではなく、文脈に合う場合のみ1回含めればよい。
・固定タグ以外のハッシュタグは、アンケートの内容から自然に連想できる語だけを使うこと。` : `
【ハッシュタグ】口コミサイト用のため、ハッシュタグは一切付けないこと。`}`;
  const LANG_OUTPUT: Record<Lang, string> = {
    ja: "【出力言語】口コミは必ず日本語で書くこと。",
    en: "【Output language】Write the entire review (style1, style2, style3) in English. Use natural English appropriate for review sites.",
    zh: "【Output language】Write the entire review (style1, style2, style3) in Chinese (Simplified). Use natural Chinese appropriate for review sites.",
    ko: "【Output language】Write the entire review (style1, style2, style3) in Korean. Use natural Korean appropriate for review sites.",
    es: "【Output language】Write the entire review (style1, style2, style3) in Spanish. Use natural Spanish appropriate for review sites.",
    fr: "【Output language】Write the entire review (style1, style2, style3) in French. Use natural French appropriate for review sites.",
    th: "【Output language】Write the entire review (style1, style2, style3) in Thai. Use natural Thai appropriate for review sites.",
    vi: "【Output language】Write the entire review (style1, style2, style3) in Vietnamese. Use natural Vietnamese appropriate for review sites.",
  };
  const langInstruction = LANG_OUTPUT[lang] || LANG_OUTPUT.ja;
  const baseIntro =
    lang === "ja"
      ? "あなたはプロのコピーライターです。アンケート回答から「AIが書いたとバレない」口コミを3つ作成。出力はJSON形式 {style1:\"\", style2:\"\", style3:\"\"} のみ。"
      : "You are a professional copywriter. Create 3 authentic-looking reviews from the survey answers. Output only JSON format {style1:\"\", style2:\"\", style3:\"\"}.";
  const override = String(s.system_prompt_override ?? "").trim();
  const systemPrompt = [
    baseIntro,
    langInstruction,
    override ? `\n${override}\n` : "",
    baseBlock,
    styleBlock,
  ]
    .filter(Boolean)
    .join("\n");
  return { systemPrompt };
}

/** form-engine が扱うフラットな1メニュー行（DBは1店＋items JSON の場合あり） */
type StoreMenuItemRow = {
  menu_key: string;
  name_ja?: string | null;
  name_spoken_ja?: string | null;
  category?: string | null;
  question_key?: string | null;
  answer_values?: string[] | null;
  is_active?: boolean | null;
  sort_order?: number | null;
};

function parseAnswerValuesField(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t) as unknown;
      if (Array.isArray(p)) {
        return p.map((x) => String(x).trim()).filter((s) => s.length > 0);
      }
    } catch {
      /* ignore */
    }
    return [t];
  }
  return [];
}

/** 括弧が1組だけの name_ja から口語表記を推定（手入力の name_spoken_ja より優先度は低い） */
function deriveNameSpokenJaFromMenuLabel(nameJa: string): string | null {
  const s = nameJa.trim();
  if (!s || s.length > 80) return null;
  if ((s.match(/[（(]/g) || []).length !== 1) return null;
  const m = s.match(/^([^（(]+)[（(]([^）)]+)[）)]$/u);
  if (!m) return null;
  const base = m[1].trim();
  const flavor = m[2].trim();
  if (!base || !flavor) return null;
  // 盛り・サイズ表記などは誤変換しやすいので推定しない（必要なら DB で name_spoken_ja を指定）
  if (/^(L|M|S|Ｌ|Ｍ|Ｓ|並|大|小|中|特大|単品|各種)$/i.test(flavor)) return null;

  // ラーメン類: 「味噌ラーメン」「醤油ラーメン」型
  if (/ラーメン|らーめん$/.test(base)) {
    if (/^(味噌|みそ)$/i.test(flavor)) return `味噌${base}`;
    if (/^(醤油|しょうゆ)$/i.test(flavor)) return `醤油${base}`;
    if (/^塩$/.test(flavor)) return `塩${base}`;
    if (/^(豚骨|とんこつ)$/i.test(flavor)) return `豚骨${base}`;
  }

  const fNorm = flavor.replace(/^しょうゆ$/i, "醤油");
  if (fNorm.endsWith("味")) {
    return `${fNorm}の${base}`;
  }
  return `${fNorm}味の${base}`;
}

function normalizeOneMenuItem(obj: Record<string, unknown>): StoreMenuItemRow | null {
  const mk = String(obj.menu_key ?? obj.id ?? obj.key ?? "").trim();
  if (!mk) return null;
  const av = parseAnswerValuesField(obj.answer_values);
  const sortRaw = obj.sort_order;
  const sortNum = sortRaw == null || sortRaw === "" ? null : Number(sortRaw);
  const nameJaStr = obj.name_ja != null ? String(obj.name_ja) : "";
  const spokenExplicit = obj.name_spoken_ja != null && String(obj.name_spoken_ja).trim()
    ? String(obj.name_spoken_ja).trim()
    : null;
  const spoken = spokenExplicit ?? deriveNameSpokenJaFromMenuLabel(nameJaStr);
  return {
    menu_key: mk,
    name_ja: nameJaStr,
    name_spoken_ja: spoken && spoken.length > 0 ? spoken : null,
    category: obj.category != null ? String(obj.category) : null,
    question_key: obj.question_key != null ? String(obj.question_key) : null,
    answer_values: av.length > 0 ? av : null,
    is_active: obj.is_active === false ? false : true,
    sort_order: sortNum !== null && !Number.isNaN(sortNum) ? sortNum : null,
  };
}

/**
 * store_menu_items の DB 行をフラット化。
 * - 新: 1店舗1行で `items` にメニュー配列（各要素に menu_key, name_ja, question_key, answer_values 等）
 * - 旧: 1行1メニュー（行自体に menu_key 等）
 */
function flattenStoreMenuItemsFromDb(data: unknown[] | null | undefined): StoreMenuItemRow[] {
  const rows = Array.isArray(data) ? data : [];
  const out: StoreMenuItemRow[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const items = row?.items;
    if (Array.isArray(items) && items.length > 0) {
      for (const entry of items) {
        if (entry && typeof entry === "object") {
          const m = normalizeOneMenuItem(entry as Record<string, unknown>);
          if (m) out.push(m);
        }
      }
    } else if (row.menu_key != null || row.name_ja != null) {
      const m = normalizeOneMenuItem(row);
      if (m) out.push(m);
    }
  }
  out.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  return out;
}

type ResultReview = {
  id: string;
  store_id: string;
  score: number;
  answers: Record<string, unknown>;
  review_options: Record<string, string>;
  coupon_awarded: string;
  created_at: string;
  used_at?: string | null;
  image_url?: string | null;
  improvement_feedback_sent_at?: string | null;
  improvement_feedback_text?: string | null;
  line_user_id?: string | null;
};

function buildResultHtml(params: {
  review: ResultReview;
  store: Record<string, unknown>;
  lang: Lang;
  submissionId: string;
  scoutLpBaseUrl: string;
  lineLiffId?: string | null;
  lineBotBasicId?: string | null;
  formEngineBaseUrl?: string;
  couponOnlyView?: boolean;
  cookieAlreadyUsedForStore?: boolean;
  walletData?: { total_earned: number; balance: number; scope_id: string } | null;
  dashboardUrl?: string;
}): string {
  const { review, store, lang, submissionId, scoutLpBaseUrl, lineLiffId, lineBotBasicId, formEngineBaseUrl, couponOnlyView, cookieAlreadyUsedForStore, walletData, dashboardUrl } = params;
  const themeColor = (store.theme_color as string) || "#6366f1";
  const lineAddUrl = (store.line_official_url as string) || "";
  const hasLineUrl = Boolean(lineAddUrl?.trim());
  const store_id = review.store_id;
  const review_options = review.review_options || {};
  const coupon_awarded = review.coupon_awarded || "";
  const imageUrl = review.image_url || null;
  const hasReviewContent = review_options.style1?.trim() || review_options.style2?.trim() || review_options.style3?.trim();
  const showFullReviewUI = Boolean(hasReviewContent);
  const scoreMax = Math.max(1, Number(store.score_max) || 5);
  const scoreMin = Math.max(0, Math.min(scoreMax - 1, Number(store.score_min) ?? 1));
  // score_threshold_mid が未設定の場合、scoreMax の 60% を閾値とする（5段階→3、10段階→6）
  const thresholdMid = store.score_threshold_mid != null
    ? Number(store.score_threshold_mid)
    : Math.round(scoreMax * 0.6);
  const isHighScore = review.score >= Math.max(scoreMin, scoreMax - 1);
  const isLowScore = review.score <= Math.min(scoreMax, scoreMin + 1);
  const successMessage = isHighScore
    ? t(lang, "msg_high_score")
    : isLowScore
      ? t(lang, "msg_low_score")
      : (store.success_message as string)?.trim() || "";
  const scoreAboveThreshold = review.score > thresholdMid;
  const thankYouMessage = scoreAboveThreshold ? t(lang, "msg_thank_high") : t(lang, "msg_thank_low");
  const allReviewLinks = [
    { key: "google", n: t(lang, "google_review_btn"), s: "Google", u: store.review_url_google as string, c: "#4285F4" },
    { key: "hotpepper", n: "Hotpepperに口コミを書く", s: "Hotpepper", u: store.review_url_hotpepper as string, c: "#FF3B30" },
    { key: "tabelog", n: "食べログに口コミを書く", s: "食べログ", u: store.review_url_tabelog as string, c: "#FF9500" },
    { key: "retty", n: "Rettyに口コミを書く", s: "Retty", u: store.review_url_retty as string, c: "#FF6B6B" },
    { key: "ozmall", n: "OZmallに口コミを書く", s: "OZmall", u: store.review_url_ozmall as string, c: "#E65100" },
    { key: "ikyu", n: "一休に口コミを書く", s: "一休", u: store.review_url_ikyu as string, c: "#1976D2" },
  ].filter((l) => l.u && String(l.u).trim()) as Array<{ key: string; n: string; s: string; u: string; c: string }>;
  const googleLink = allReviewLinks.find((l) => l.key === "google");
  const otherLinks = allReviewLinks.filter((l) => l.key !== "google");
  const showSuccessMessage = successMessage && (scoreAboveThreshold || successMessage !== t(lang, "msg_high_score"));
  const recruitmentUrl = (store.recruitment_url as string)?.trim() || "";
  const isCouponEnabled = store.is_coupon_enabled === true;
  const scoutProgramEnabled = store.scout_program_enabled === true;
  const scoutMode = String(store.scout_display_mode || "referral").toLowerCase();
  const scoutRecruitmentLineUrl = ((store.scout_recruitment_line_url as string) || lineAddUrl || "").trim();
  const recruitmentTypeRaw = String(store.scout_recruitment_type || "arubaito").trim();
  const recruitmentTypes = recruitmentTypeRaw ? recruitmentTypeRaw.split(/\s*,\s*/).map((s) => s.toLowerCase().trim()).filter(Boolean) : ["arubaito"];
  const recruitmentLabels = recruitmentTypes.map((ty) => t(lang, "scout_recruit_" + ty) || t(lang, "scout_recruit_arubaito"));
  const scoutRecruitTypeLabel = recruitmentLabels.length > 0 ? recruitmentLabels.join(t(lang, "scout_recruit_join") || "と") : t(lang, "scout_recruit_arubaito");
  const couponEmergencyStop = store.coupon_emergency_stop === true;
  const issuedDateStr = new Date(review.created_at).toLocaleDateString("ja-JP");
  const expiryType = String(store.coupon_expiry_type ?? "permanent").toLowerCase();
  const expiryDays = Number(store.coupon_expiry_days) || 0;
  const expiryDateRaw = store.coupon_expiry_date as string | null;
  const couponIssuedLine = (() => {
    if (expiryType === "days" && expiryDays > 0) {
      const end = new Date(new Date(review.created_at).getTime() + expiryDays * 24 * 60 * 60 * 1000);
      const endStr = end.toLocaleDateString("ja-JP");
      return issuedDateStr + " ～ " + endStr + "（発行日から" + expiryDays + "日間）";
    }
    if (expiryType === "date" && expiryDateRaw) {
      try {
        const d = new Date(expiryDateRaw);
        if (!isNaN(d.getTime())) return issuedDateStr + " ～ " + d.toLocaleDateString("ja-JP");
      } catch { /* ignore */ }
    }
    return issuedDateStr + " ～ 期限なし";
  })();
  const couponExpired = (() => {
    const now = Date.now();
    if (expiryType === "days" && expiryDays > 0) {
      const end = new Date(new Date(review.created_at).getTime() + expiryDays * 24 * 60 * 60 * 1000).getTime();
      return !isNaN(end) && now > end;
    }
    if (expiryType === "date" && expiryDateRaw) {
      const d = new Date(expiryDateRaw);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
      return !isNaN(end) && now > end;
    }
    return false;
  })();
  const couponUsableToday = store.coupon_usable_today !== false;
  const chainId = (typeof store.chain_id === "string" && store.chain_id.trim()) ? store.chain_id.trim() : null;
  const chainDisplayName = (typeof store.chain_display_name === "string" && store.chain_display_name.trim()) ? store.chain_display_name.trim() : null;
  const couponChainWide = store.coupon_chain_wide === true;
  const couponStoreName = (
    (store.store_name_ja as string)?.trim()
    || (store.store_name_jp as string)?.trim()
    || store_id
  );
  const couponScopeTextRaw = (couponChainWide && chainId)
    ? (t(lang, "coupon_scope_chain_wide") || "").replace("{chain}", chainDisplayName || chainId)
    : `${t(lang, "coupon_scope_store_only") || ""}${couponStoreName ? `（${couponStoreName}）` : ""}`;
  const couponScopeText = String(couponScopeTextRaw).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const lineAddBonusText = (store.line_add_bonus_text as string)?.trim() || "";
  const sectionOrderRaw = store.result_section_order as string[] | null | undefined;
  const sectionOrderBase = Array.isArray(sectionOrderRaw) && sectionOrderRaw.length > 0
    ? sectionOrderRaw
    : ["review", "coupon", "line", "scout"];
  // review を先頭に固定、loyalty を2番目に固定（review → 矢印 → LINE/ポイントカード の順）
  const filteredBase = sectionOrderBase.filter(k => k !== "review" && k !== "loyalty");
  const sectionOrder = ["review", "loyalty", ...filteredBase];

  const screenNavigating = t(lang, "screen_navigating");

  const hasReviewLinks = allReviewLinks.length > 0;
  const escAttr = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const postSiteButtonsForStyle = (styleKey: string): string => {
    if (!hasReviewLinks) return "";
    const reviewPts = Number(store.point_rule_google ?? 3);
    const hintEsc = String(t(lang, "post_hint_copy_then_open"))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
    const highlightClass = isHighScore && googleLink ? " post-cta-highlight" : "";
    const stepGuide = `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:12px;font-weight:800;color:#15803d;margin-bottom:8px;">🎁 口コミ投稿で＋${reviewPts}P！</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#1f2937;">
          <span style="background:#15803d;color:#fff;border-radius:50%;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;">1</span>
          <span>下のボタンをタップ <span style="color:#6b7280;">→ 口コミ文が自動コピーされます</span></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#1f2937;">
          <span style="background:#15803d;color:#fff;border-radius:50%;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;">2</span>
          <span>開いたページに貼り付けて口コミを投稿</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#1f2937;">
          <span style="background:#d97706;color:#fff;border-radius:50%;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;">3</span>
          <span><strong style="color:#d97706;">「戻る」でこのページに戻る</strong> → ポイント受け取りボタンが出ます！</span>
        </div>
      </div>
    </div>`;
    return `<div class="post-site-btns${highlightClass}">
      ${stepGuide}
      ${allReviewLinks
        .map((l) => {
          const isGoogle = l.key === "google";
          const cls = isGoogle ? "link-btn link-btn-google" : "link-btn link-btn-secondary";
          const secBg = isGoogle ? "" : `background:${themeColor};`;
          const label = String(l.n).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
          const ptsBadge = `<span style="display:inline-block;margin-left:8px;background:rgba(255,255,255,0.25);border-radius:999px;padding:1px 8px;font-size:13px;font-weight:800;">＋${reviewPts}P</span>`;
          const copyHint = `<span style="display:block;font-size:11px;opacity:0.82;margin-top:4px;font-weight:500;">&#x1F4CB; タップで口コミテキストを自動コピー → 貼り付けて投稿 → 戻るとポイントGET</span>`;
          const rawUrl = String(l.u).replace(/"/g, "&quot;");
          const onclickAttr = isGoogle
            ? `handleGoogleBtnClick(event,'${styleKey}','${rawUrl}')`
            : `handleReviewAnchorClick(event,'${styleKey}',this)`;
          return `<a href="${escAttr(String(l.u))}" class="${cls}"${secBg ? ` style="${secBg.replace(/"/g, "&quot;")}"` : ""} data-style="${styleKey}" onclick="${onclickAttr}">${label}${ptsBadge}${copyHint}</a>`;
        })
        .join("")}
    </div>`;
  };

  // sectionReview で使うため先に定義
  const surveyPointsEarly = Math.max(1, Number(store.point_rule_survey ?? 1) || 1);

  const sectionReview = `<div class="card">
    <div style="margin-bottom:16px;">
      <span style="display:inline-block;background:linear-gradient(135deg,#dbeafe,#bfdbfe);color:#1d4ed8;padding:6px 16px;border-radius:999px;font-weight:800;font-size:15px;box-shadow:0 2px 8px rgba(29,78,216,0.2);margin-bottom:8px;">＋${surveyPointsEarly}P 獲得！</span>
      <p style="margin:0;font-size:0.95rem;color:#1f2937;white-space:pre-line;line-height:1.5;">${String(thankYouMessage).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</p>
    </div>
    ${showFullReviewUI ? `
    <h2 style="text-align:center; margin-top:0;">${t(lang, "review_select_title")}</h2>
    <div class="tabs">
      <button class="tab active" data-style="style1">${t(lang, "style1_title")}</button>
      <button class="tab" data-style="style2">${t(lang, "style2_title")}</button>
      <button class="tab" data-style="style3">${t(lang, "style3_title")}</button>
    </div>
    ${["style1", "style2", "style3"].map((key, i) => `
    <div class="content ${i === 0 ? "active" : ""}" data-style="${key}">
      <div style="position:relative;">
        <div style="position:absolute;top:8px;right:8px;background:${themeColor};color:#fff;font-size:10px;font-weight:700;padding:2px 10px;border-radius:999px;pointer-events:none;z-index:1;letter-spacing:0.02em;">✏️ 編集可</div>
        <div class="review-text" id="text-${key}" contenteditable="true" data-style="${key}">${(review_options[key] || t(lang, "not_generated")).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      </div>
      <p style="font-size:12px; color:#6b7280; margin:5px 0 10px; font-weight:500;">${t(lang, "edit_hint")}</p>
      <button type="button" class="edit-options-toggle" data-style="${key}" onclick="toggleEditOptions(this)">⚙️ 文体・長さを変える ▼</button>
      <div class="edit-options-collapse" data-style="${key}">
      <div class="btn-group">
        <button class="btn-sm" onclick="refine('${key}','longer')">➕ ${t(lang, "longer_btn")}</button>
        <button class="btn-sm" onclick="refine('${key}','shorter')">➖ ${t(lang, "shorter_btn")}</button>
        <button class="btn-sm" onclick="refine('${key}','文章全体に適切な絵文字を3〜5個追加して、SNSで映える雰囲気にして')">✨ ${t(lang, "emoji_more_btn")}</button>
        <button class="btn-sm" onclick="refine('${key}','文章から絵文字や顔文字をすべて削除し、落ち着いた大人っぽい文体にして')">📝 ${t(lang, "emoji_none_btn")}</button>
      </div>
      <div class="tone-row">
        <button type="button" class="btn-sm" onclick="refineToneKeywords('${key}',{tone:'polite'})">✨ ${t(lang, "tone_polite")}</button>
        <button type="button" class="btn-sm" onclick="refineToneKeywords('${key}',{tone:'friendly'})">😊 ${t(lang, "tone_friendly")}</button>
        <button type="button" class="btn-sm" onclick="refineToneKeywords('${key}',{tone:'short'})">⚡ ${t(lang, "tone_short")}</button>
      </div>
      <div class="keywords-row">
        <input type="text" id="keywords-${key}" class="keywords-input" placeholder="${(t(lang, "keywords_placeholder") || "").replace(/"/g, "&quot;")}" data-style="${key}">
        <button type="button" class="modify-btn" onclick="refineToneKeywords('${key}',{keywords:document.getElementById('keywords-'+'${key}').value})">${t(lang, "modify_btn")}</button>
      </div>
      </div>
      ${hasReviewLinks ? postSiteButtonsForStyle(key) : `
      <div class="copy-save-row">
        <button class="copy btn-primary${scoreAboveThreshold ? " post-cta-highlight" : ""}" onclick="copy('${key}')" style="${isHighScore ? "background:" + themeColor + ";" : ""}">${t(lang, "copy_btn")}</button>
      </div>`}
    </div>
    `).join("")}
    ${review.score <= thresholdMid ? `
    <div class="store-feedback-row" style="margin-top:16px;">
      ${(() => {
        const fbPts = Number(store.point_rule_google ?? 3);
        const fbBonusPts = fbPts + 1;
        const fbEnabled = !review.improvement_feedback_sent_at;
        const fbOriginal = (t(lang, "store_feedback_btn") + ` ＋${fbBonusPts}P`).replace(/"/g, "&quot;");
        const fbDashUrl = escAttr(dashboardUrl ?? "");
        const fbSid = escAttr(submissionId ?? "");
        const fbStoreId = escAttr(store_id);
        const fbReviewId = escAttr(review.id);
        const fbAnonKey = escAttr(Deno.env.get("SUPABASE_ANON_KEY") ?? "");
        // ── 送信済みの場合はシンプルな完了表示 ──────────────────────────
        if (!fbEnabled) {
          return `<div style="background:#f0fdf4;border:2px solid #86efac;border-radius:18px;padding:18px 16px;text-align:center;">
            <div style="font-size:22px;margin-bottom:6px;">✅</div>
            <div style="font-size:14px;font-weight:800;color:#15803d;margin-bottom:4px;">${t(lang, "feedback_sent_label")}</div>
            <div style="font-size:12px;color:#16a34a;">ご意見はお店に届いています。ありがとうございました！</div>
          </div>`;
        }
        // ── 未送信: 目立つ CTA カード ─────────────────────────────────────
        const fbLabel = t(lang, "store_feedback_btn");
        return `<div style="background:linear-gradient(135deg,#fff7ed,#fef3c7);border:2.5px solid #f59e0b;border-radius:18px;padding:18px 16px 16px;box-shadow:0 4px 20px rgba(245,158,11,.2);">
          <div style="text-align:center;margin-bottom:12px;">
            <div style="font-size:14px;font-weight:800;color:#92400e;margin-bottom:4px;">💌 ご意見をお店に直接届けましょう</div>
            <div style="font-size:12px;color:#b45309;line-height:1.7;">お客様のご意見は店舗改善に活かします。<br>口コミ投稿より<strong>1P多く</strong>獲得できてお得！</div>
          </div>
          <div style="background:#f59e0b;border-radius:12px;padding:10px 12px;text-align:center;margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:#fff;letter-spacing:.06em;margin-bottom:2px;">送信で獲得できるポイント</div>
            <div style="font-size:42px;font-weight:900;color:#fff;line-height:1.1;letter-spacing:-.02em;">＋${fbBonusPts}P</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.85);margin-top:2px;">口コミ投稿（＋${fbPts}P）より 1P 多い！</div>
          </div>
          <button type="button" id="btn-store-feedback" class="btn-store-feedback store-feedback-cta-highlight" style="width:100%;padding:16px;border:none;border-radius:14px;background:#d97706;color:#fff;font-weight:800;font-size:16px;text-align:center;cursor:pointer;letter-spacing:.02em;box-shadow:0 4px 14px rgba(217,119,6,.45);" data-sent="0" data-original-text="${fbOriginal}" data-review-id="${fbReviewId}" data-store-id="${fbStoreId}" data-sub-id="${fbSid}" data-dash-url="${fbDashUrl}" data-anon-key="${fbAnonKey}">${fbLabel}</button>
        </div>
<script>(function(){var _b=document.getElementById('btn-store-feedback');if(!_b||_b.disabled)return;_b.onclick=function(){if(_b.disabled)return;_b.disabled=true;var _ot=_b.getAttribute('data-original-text')||_b.textContent||'';_b.textContent='\u9001\u4fe1\u4e2d\u2026';var _ae=document.querySelector('.content.active .review-text');var _stid=_b.getAttribute('data-store-id');var _sid=_b.getAttribute('data-sub-id');var _ak=_b.getAttribute('data-anon-key')||'';var _base=window.location.href.split('?')[0]+'?store_id='+encodeURIComponent(_stid)+(_sid?'&sid='+encodeURIComponent(_sid):'');var _hdrs={'Content-Type':'application/json'};if(_ak){_hdrs['apikey']=_ak;_hdrs['Authorization']='Bearer '+_ak;}fetch(_base,{method:'POST',headers:_hdrs,body:JSON.stringify({action:'send_improvement_feedback',review_id:_b.getAttribute('data-review-id'),store_id:_stid,text:_ae?(_ae.innerText||'').trim():''})}).then(function(r){return r.json();}).then(function(d){if(d.daily_limit){_b.textContent='\u26a0\ufe0f \u672c\u65e5\u5206\u306f\u52a0\u7b97\u6e08\u307f';_b.style.background='#f3f4f6';_b.style.color='#6b7280';if(typeof _showSimpleBanner==='function')_showSimpleBanner('\u26a0\ufe0f \u30ec\u30dd\u30fc\u30c8\u306e\u30dd\u30a4\u30f3\u30c8\u306f1\u65e51\u56de\u306e\u307f\u3067\u3059\uff08\u672c\u65e5\u5206\u306f\u52a0\u7b97\u6e08\u307f\uff09','#b45309',6000);return;}if(d.ok){var _pts=d.points_awarded||0;_b.textContent=_pts>0?('\u2705 \uff0b'+_pts+'P \u52a0\u7b97\uff01'):'\u2705 \u9001\u4fe1\u3057\u307e\u3057\u305f';if(_pts>0){var _c=document.getElementById('loyalty-point-card')||document.getElementById('loyalty-wallet-summary');if(_c&&d.balance!=null){var _big=_c.querySelector('div[style*="font-size:58px"]');if(_big)_big.innerHTML=d.balance+'<span style="font-size:18px;font-weight:600;"> P<\/span>';var _bdg=document.createElement('div');_bdg.style.cssText='text-align:center;padding:10px 0 4px;font-size:30px;font-weight:800;color:#059669;opacity:1;transition:opacity 1s;';_bdg.textContent='\uff0b'+_pts+'P';_c.insertBefore(_bdg,_c.firstChild);setTimeout(function(){_bdg.style.opacity='0';},3000);setTimeout(function(){try{_bdg.remove();}catch(e){}},4200);}(_c=_c||document.querySelector('.loyalty-card'))&&_c.scrollIntoView({behavior:'smooth',block:'center'});var _bal2=d.balance!=null?d.balance:_pts;if(typeof window._showPtsPopup==='function'){window._showPtsPopup(_pts,_bal2,'\u30d5\u30a3\u30fc\u30c9\u30d0\u30c3\u30af\u9001\u4fe1');}else if(typeof _showSimpleBanner==='function'){_showSimpleBanner('\ud83c\udf89 \u30d5\u30a3\u30fc\u30c9\u30d0\u30c3\u30af \uff0b'+_pts+'P \u52a0\u7b97\uff01','#16a34a',5000);}if(typeof window._refreshWalletDisplay==='function')window._refreshWalletDisplay();}else{if(typeof _showSimpleBanner==='function')_showSimpleBanner('\u2705 \u30d5\u30a3\u30fc\u30c9\u30d0\u30c3\u30af\u3092\u9001\u4fe1\u3057\u307e\u3057\u305f','#374151',3000);}}else{_b.disabled=false;_b.textContent=_ot;}}).catch(function(){_b.disabled=false;_b.textContent=_ot;});};})();<\/script>`;
      })()}
    </div>
    ` : ""}
    ${scoreAboveThreshold && hasReviewLinks ? "" : scoreAboveThreshold ? `
    <hr class="card-divider">
    <h4 style="margin-top:0;">📝 ${t(lang, "post_to_sites_support")}</h4>
    <p style="font-size:14px; margin:0 0 12px;">${t(lang, "post_hint")}</p>
    ` : ""}
    ` : scoreAboveThreshold ? `
    <h4>${t(lang, "post_to_sites_links")}</h4>
    <p style="font-size:14px; margin:0 0 12px;">${t(lang, "post_hint")}</p>
    ` : ""}
    ${(googleLink || otherLinks.length > 0) && !showFullReviewUI && scoreAboveThreshold ? `
    <p style="text-align:center; font-size:14px; margin:0 0 12px; color:#4b5563;">${String(t(lang, "msg_review_encourage")).replace(/&/g, "&amp;")}</p>
    ${googleLink ? `
    <div class="link-btns google-primary${isHighScore ? " post-cta-highlight" : ""}">
      <button type="button" class="link-btn link-btn-google" data-ext-url="${escAttr(String(googleLink.u))}" onclick="copyStoreNameAndOpenReview(this.getAttribute('data-ext-url'))">${String(googleLink.n).replace(/</g, "&lt;")}</button>
    </div>
    ` : ""}
    ${otherLinks.length > 0 ? `
    <div class="link-btns link-btns-other"${!googleLink ? (isHighScore ? ' class="post-cta-highlight"' : "") : " style=\"margin-top:12px;\""}>
      ${otherLinks.map((l) => `<button type="button" class="link-btn link-btn-secondary" style="background:${themeColor}" data-ext-url="${escAttr(String(l.u))}" onclick="openExternalBrowser(this.getAttribute('data-ext-url'))">${String(l.s).replace(/</g, "&lt;")}</button>`).join("")}
    </div>
    ` : ""}
    ` : ""}
  </div>
  ${imageUrl ? `
  <div class="card photo-card">
    <h4>📷 SNS用写真</h4>
    <div style="text-align:center; margin:16px 0;">
      <img src="${imageUrl.replace(/"/g, "&quot;")}" alt="投稿写真" style="max-width:100%; max-height:320px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
    </div>
    <p style="font-size:13px; color:#6b7280; margin:0 0 12px;">${t(lang, "photo_sns_hint")}</p>
    <button type="button" class="btn-main photo-download-btn" data-url="${imageUrl.replace(/"/g, "&quot;")}">${t(lang, "photo_download_btn")}</button>
  </div>
  ` : ""}`;

  const couponUniqueUrl = formEngineBaseUrl ? `${formEngineBaseUrl.replace(/\/$/, "")}?store_id=${encodeURIComponent(store_id)}&sid=${encodeURIComponent(submissionId)}&coupon_only=1` : "";
  const hasLineSaveCoupon = Boolean(couponUniqueUrl);
  const isCouponOnlyView = couponOnlyView === true;
  const couponAlreadyUsed = review.used_at != null;
  const couponReacquireEnabledRaw = store.coupon_reacquire_enabled as boolean | null | undefined;
  const couponReacquireDaysRaw = Number(store.coupon_reacquire_days);
  const couponAllowMultipleLegacy = store.coupon_allow_multiple === true;
  const couponIntervalDaysLegacy = Number(store.coupon_interval_days);
  const couponReacquireEnabled = couponReacquireEnabledRaw != null ? couponReacquireEnabledRaw === true : couponAllowMultipleLegacy;
  const couponReacquireDays = Math.max(
    1,
    Number.isFinite(couponReacquireDaysRaw) && couponReacquireDaysRaw > 0
      ? couponReacquireDaysRaw
      : (Number.isFinite(couponIntervalDaysLegacy) && couponIntervalDaysLegacy > 0 ? couponIntervalDaysLegacy : 365),
  );
  const couponBrowserLimitMsg = couponReacquireEnabled
    ? `この端末では${couponReacquireDays}日が経過してから再利用してください。`
    : "この店舗ではクーポンは1回限りのため、再利用できません。";
  const sectionCoupon = isCouponEnabled ? `
  <div class="card coupon-card" data-coupon-only="${isCouponOnlyView}">
    <h4 style="margin-bottom:4px;">🎁 ${t(lang, "coupon_title_prefix")}</h4>
    <div class="coupon-body-area">
    <p style="font-size:1.1rem; font-weight:700; color:${themeColor}; margin:0 0 12px;">【${String(coupon_awarded).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, " ")}】</p>
    <p style="font-size:12px; color:#6b7280; margin:0 0 4px;">${t(lang, "issued")}：${couponIssuedLine}</p>
    <p style="font-size:12px; color:#6b7280; margin:0 0 12px;">${couponUsableToday ? t(lang, "coupon_usable_today_hint") : t(lang, "coupon_usable_next_hint")}</p>
    <p class="coupon-use-hint">${t(lang, "coupon_usage_instructions")}</p>
    <div class="coupon-use-area${couponAlreadyUsed || cookieAlreadyUsedForStore ? " used" : ""}">
      ${couponEmergencyStop ? `
      <div class="coupon-stopped-msg">⛔ ${t(lang, "coupon_stopped")}</div>
      ` : couponAlreadyUsed ? `
      <div id="coupon-used-msg" class="coupon-used-msg">✅ ${t(lang, "used_label")}</div>
      ` : couponExpired ? `
      <div id="coupon-used-msg" class="coupon-used-msg" style="background:#f3f4f6;color:#374151;">⛔ このクーポンは有効期限切れです。</div>
      ` : cookieAlreadyUsedForStore ? `
      <div id="coupon-used-msg" class="coupon-used-msg" style="background:#fef3c7;color:#92400e;">${couponBrowserLimitMsg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      ` : `
      <button type="button" id="btn-use-coupon" class="btn-use-coupon">${t(lang, "use_coupon_btn")}</button>
      <div id="coupon-used-msg" class="coupon-used-msg" style="display:none;">✅ ${t(lang, "used_label")}</div>
      `}
    </div>
    <p style="font-size:12px; color:#6b7280; margin:8px 0 0;">${couponScopeText}</p>
    ${hasLineSaveCoupon && !isCouponOnlyView ? `
    <div class="coupon-line-save-area" style="margin-top:20px; padding-top:16px; border-top:1px solid #e5e7eb;">
      ${lineLiffId ? `
      <a href="https://liff.line.me/${String(lineLiffId).replace(/"/g, "")}?store_id=${encodeURIComponent(store_id)}&sid=${encodeURIComponent(submissionId)}&coupon_url=${encodeURIComponent(couponUniqueUrl)}&liff_id=${encodeURIComponent(String(lineLiffId))}${lineBotBasicId ? "&bot_basic_id=" + encodeURIComponent(String(lineBotBasicId).replace(/^@/, "")) : ""}" target="_blank" rel="noopener" class="btn-line-save-coupon">${t(lang, "line_save_coupon_btn")}</a>
      ` : `
      <p style="font-size:13px; color:#374151; margin:0 0 12px; font-weight:600;">${t(lang, "line_save_coupon_steps")}</p>
      <a href="${formEngineBaseUrl ? (formEngineBaseUrl.replace(/\/$/, "") + "?store_id=" + encodeURIComponent(store_id) + "&sid=" + encodeURIComponent(submissionId) + "&action=line_coupon_copy") : "#"}" target="_blank" rel="noopener" class="btn-line-save-coupon">${t(lang, "line_save_coupon_btn")}</a>
      `}
      <p style="font-size:12px; color:#6b7280; margin:12px 0 0;">${lineLiffId ? t(lang, "line_save_coupon_hint") : t(lang, "line_save_coupon_hint_copy")}</p>
    </div>
    ` : ""}
    </div>
  </div>
  ` : "";

  const sectionLine = hasLineUrl ? `
  <div class="card line-add-card">
    <h4>${t(lang, "line_add_title")}</h4>
    ${lineAddBonusText ? `<p style="font-size:14px; margin:0 0 12px;">${String(t(lang, "line_add_bonus").replace("{bonus}", lineAddBonusText)).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : ""}
    <a href="${lineAddUrl.replace(/"/g, "&quot;")}" target="_blank" rel="noopener" class="link-btn" style="background:#06C755;">${t(lang, "line_open")}</a>
  </div>
  ` : "";

  const sectionScout = scoutProgramEnabled ? (() => {
    const mode = scoutMode === "direct" ? "direct" : scoutMode === "both" ? "both" : "referral";
    const hasRecruitLine = scoutRecruitmentLineUrl.length > 0;
    if (mode === "direct") {
      const sidEsc = submissionId ? String(submissionId).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") : "";
      const lineUrlEsc = scoutRecruitmentLineUrl.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
      const recruitDetailLink = recruitmentUrl
        ? '<a href="' + recruitmentUrl.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener" class="link-btn" style="background:' + themeColor + '; margin-bottom:8px;">' + t(lang, "recruit_detail_link") + '</a>'
        : "";
      const interviewRewardText = (store.scout_direct_interview_reward_text as string)?.trim() || "";
      const interviewRewardBlock = interviewRewardText
        ? `<div class="scout-direct-interview-reward">🎁 ${String(t(lang, "scout_direct_interview_reward").replace("{reward}", interviewRewardText)).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
        : "";
      const copyAndLineBtn = hasRecruitLine && submissionId
        ? `<span id="scout-direct-sid-value" style="display:none;">${sidEsc}</span><button type="button" class="link-btn btn-copy-and-line" style="background:#06C755;" data-line-url="${lineUrlEsc}" onclick="copySidAndOpenLine(this.getAttribute('data-line-url'))">${t(lang, "line_contact_copy_and_open_btn")}</button>`
        : "";
      const introRaw = (store.scout_referral_card_text as string)?.trim() || t(lang, "scout_direct_intro");
      const introWithSid = introRaw.replace("{sid}", submissionId || "〇〇・・・・・").replace("{type}", scoutRecruitTypeLabel);
      return `
  <div class="card scout-card">
    <h4>💼 ${t(lang, "scout_direct_title")}</h4>
    <p style="font-size:14px; margin:4px 0 10px;">${introWithSid.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>
    ${interviewRewardBlock}
    <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
      ${recruitDetailLink}
      ${copyAndLineBtn}
    </div>
  </div>
  `;
    }
    if (mode === "both") {
      return `
  <div class="card scout-card">
    <h4>✨ ${t(lang, "scout_both_title")}</h4>
    <p style="font-size:14px; margin:4px 0 10px;">${((store.scout_referral_card_text as string)?.trim() || t(lang, "scout_both_intro")).replace("{type}", scoutRecruitTypeLabel).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>
    ${(store.scout_referral_reward_text as string)?.trim() ? `<p style="font-size:13px; background:#fef3c7; padding:10px; border-radius:8px; margin:8px 0;">🎁 ${t(lang, "scout_reward_prefix")}${String(store.scout_referral_reward_text).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>` : ""}
    <p style="font-size:11px; color:#6b7280; margin:0 0 10px;">${t(lang, "scout_both_note")}</p>
    ${hasRecruitLine ? '<a href="' + scoutRecruitmentLineUrl.replace(/"/g, "&quot;") + '" target="_blank" class="link-btn" style="background:#06C755; margin-bottom:10px;">' + t(lang, "scout_both_line_btn") + '</a>' : ""}
    <button type="button" class="btn-main scout-copy-btn">${t(lang, "scout_copy_btn")}</button>
  </div>
  `;
    }
    return `
  <div class="card scout-card">
    <h4>✨ ${t(lang, "scout_title")}</h4>
    <p style="font-size:14px; margin:4px 0 10px;">${((store.scout_referral_card_text as string)?.trim() || t(lang, "scout_intro")).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>
    ${(store.scout_referral_reward_text as string)?.trim() ? `<p style="font-size:13px; background:#fef3c7; padding:10px; border-radius:8px; margin:8px 0;">🎁 ${t(lang, "scout_reward_prefix")}${String(store.scout_referral_reward_text).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>` : ""}
    <p style="font-size:11px; color:#6b7280; margin:0 0 10px;">${t(lang, "scout_note")}</p>
    ${hasLineUrl ? '<a href="' + lineAddUrl.replace(/"/g, "&quot;") + '" target="_blank" class="link-btn" style="background:#06C755; margin-bottom:10px;">' + t(lang, "line_official") + '</a>' : ""}
    <button type="button" class="btn-main scout-copy-btn">${t(lang, "scout_copy_btn")}</button>
  </div>
  `;
  })() : "";

  // ── ロイヤルティポイントセクション ──────────────────────────────
  const surveyPoints = Number(store.point_rule_survey ?? 1);
  const pointThreshold = Number(store.point_threshold ?? 4);
  const pointThreshold2 = store.point_threshold_2 != null ? Number(store.point_threshold_2) : null;
  const rewardTitle1 = (store.point_reward_title_1 as string)?.trim() || "クーポン";
  const rewardTitle2 = (store.point_reward_title_2 as string)?.trim() || null;
  // coupon_tiers 優先（複数クーポン対応）
  const couponTiersArray: { name: string; points_required: number }[] | null =
    Array.isArray(store.coupon_tiers) && (store.coupon_tiers as unknown[]).length > 0
      ? (store.coupon_tiers as { name: string; points_required: number }[])
      : null;
  const hasLineBot = Boolean(lineBotBasicId?.trim());
  // oaMessage URL: 「REVIEW:${submissionId}」を事前入力 → ユーザーが「送信」 → line-webhook-coupon がポイントカード URL を返信
  // ※ /?text= 形式: 一部端末で "text=REVIEW:..." が届くが webhook 側で text= プレフィックスを除去して対処
  const lineOaMsgUrl = hasLineBot
    ? `https://line.me/R/oaMessage/@${String(lineBotBasicId).replace(/^@/, "")}/?text=${encodeURIComponent("REVIEW:" + submissionId)}`
    : "";
  // フォールバック: 友達追加 URL（新規ユーザー向け保険）
  const lineAddFriendUrl = hasLineBot
    ? `https://line.me/R/ti/p/@${String(lineBotBasicId).replace(/^@/, "")}?start=${encodeURIComponent(submissionId)}`
    : "";
  // LIFF が設定されている場合は LIFF URL を使う（自動LINE ID取得 → ポイント付与）
  // ただし ip_block_enabled=false（デモモード）の場合はLIFFをスキップして直接ウォレットへ
  const _isDemo = (store as Record<string, unknown>).ip_block_enabled === false;
  const liffLinkUrl = (lineLiffId && !_isDemo)
    ? `https://liff.line.me/${String(lineLiffId).trim()}?liff_link=1&review_id=${encodeURIComponent(String(review.id))}&store_id=${encodeURIComponent(store_id)}`
    : "";
  const lineBtnUrl = liffLinkUrl || lineOaMsgUrl || lineAddFriendUrl;

  const googlePoints = Number(store.point_rule_google ?? 3);
  const snsPoints = Number(store.point_rule_sns ?? 2);
  const snsEnabled = snsPoints > 0;
  const pointExpiryDays = Number(store.point_expiry_days) || 0;
  const feedbackBonusPoints = googlePoints + 1;
  const loyaltyPointBreakdown = snsEnabled
    ? (scoreAboveThreshold
        ? `${t(lang,"loyalty_breakdown_survey")} <strong>＋${surveyPoints}P</strong>　／　${t(lang,"loyalty_breakdown_sns")} <strong>＋${snsPoints}P</strong>　／　${t(lang,"loyalty_breakdown_google")} <strong>＋${googlePoints}P</strong>`
        : `${t(lang,"loyalty_breakdown_survey")} <strong>＋${surveyPoints}P</strong>　／　${t(lang,"loyalty_breakdown_sns")} <strong>＋${snsPoints}P</strong>　／　${t(lang,"loyalty_breakdown_feedback")} <strong>＋${feedbackBonusPoints}P</strong>`)
    : (scoreAboveThreshold
        ? `${t(lang,"loyalty_breakdown_survey")} <strong>＋${surveyPoints}P</strong>　／　${t(lang,"loyalty_breakdown_google")} <strong>＋${googlePoints}P</strong>`
        : `${t(lang,"loyalty_breakdown_survey")} <strong>＋${surveyPoints}P</strong>　／　${t(lang,"loyalty_breakdown_feedback")} <strong>＋${feedbackBonusPoints}P</strong>`);
  const loyaltyHintHtml = scoreAboveThreshold
    ? `<div id="loyalty-hint-normal" style="background:linear-gradient(135deg,#fff7ed,#fef3c7);border:2px solid #f59e0b;border-radius:12px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:800;color:#92400e;margin-bottom:10px;font-size:14px;">${t(lang,"loyalty_hint_title_high")}</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;border-radius:8px;padding:10px;margin-bottom:8px;flex-wrap:wrap;">
          <div style="text-align:center;min-width:54px;">
            <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">${t(lang,"loyalty_hint_review_label")}</div>
            <div style="font-size:22px;font-weight:800;color:#d97706;">＋${googlePoints}P</div>
          </div>
          <div style="font-size:20px;color:#f59e0b;font-weight:700;">→</div>
          <div style="text-align:center;background:#dcfce7;border-radius:8px;padding:8px 12px;">
            <div style="font-size:10px;color:#16a34a;font-weight:600;margin-bottom:2px;">${t(lang,"loyalty_hint_goal")}</div>
            <div style="font-size:15px;font-weight:800;color:#16a34a;">${t(lang,"loyalty_hint_coupon_earned")}</div>
          </div>
        </div>
        <div style="font-size:12px;color:#92400e;text-align:center;">${t(lang,"loyalty_hint_post_hint")}</div>
      </div>`
    : `<div id="loyalty-hint-normal" style="background:#fef9c3;border:1.5px solid #fde047;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#713f12;line-height:1.7;">
        ${t(lang,"loyalty_hint_low").replace(/\{fb\}/g, String(feedbackBonusPoints)).replace(/\{google\}/g, String(googlePoints))}
      </div>`;
  const sectionLoyalty = `
  <div class="card loyalty-card" style="border-left:4px solid ${themeColor};padding:20px;">
    ${walletData ? `
    <div id="loyalty-wallet-summary" style="background:#fff;border:2px solid ${themeColor};border-radius:20px;padding:20px;margin-bottom:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <div style="text-align:center;padding:10px 0 14px;">
        <div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;margin-bottom:3px;">${t(lang,"available_points")}</div>
        <div style="font-size:58px;font-weight:800;color:${themeColor};line-height:1.05;">${walletData.balance}<span style="font-size:18px;font-weight:600;"> P</span></div>
      </div>
    </div>
    ` : ""}
    ${hasLineBot ? (walletData ? `
    ${scoreAboveThreshold ? `<div style="font-size:13px;color:#374151;text-align:center;margin-bottom:12px;padding:10px;background:#f0fdf4;border-radius:10px;">${t(lang,"review_earn_point_hint").replace(/\{n\}/g, String(googlePoints))}</div>` : ``}
    ` : `
    <p id="google-bonus-msg" style="font-size:12px;color:#6b7280;margin:0 0 8px;text-align:center;min-height:16px;"></p>
    `) : `
    <p style="font-size:13px;color:#374151;margin:0 0 12px;line-height:1.6;">
      ${t(lang,"phone_register_hint").replace(/\{n\}/g, String(pointThreshold))}
    </p>
    <div id="phone-register-form">
      <div style="display:flex;gap:8px;margin-bottom:6px;">
        <input type="tel" id="loyalty-phone" placeholder="09012345678"
          style="flex:1;padding:12px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:15px;outline:none;min-width:0;">
        <button type="button" onclick="loyaltyRegisterPhone()"
          style="padding:12px 16px;background:${themeColor};color:#fff;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;">
          ${t(lang,"phone_register_btn")}
        </button>
      </div>
      <p id="loyalty-phone-msg" style="font-size:13px;min-height:18px;margin:4px 0 0;"></p>
    </div>
    <p style="font-size:11px;color:#9ca3af;margin:12px 0 0;">
      ${t(lang,"phone_register_note")}
    </p>
    `}
    ${(() => {
      const walletPageUrl = (dashboardUrl && submissionId)
        ? `${dashboardUrl}/s/${encodeURIComponent(store_id)}/wallet/${encodeURIComponent(submissionId)}`
        : "";

      // ① デモモード（ip_block_enabled=false）→ ウォレットページへ直接リンク（LIFF不要）
      if ((store as Record<string, unknown>).ip_block_enabled === false && walletPageUrl) {
        return `<a id="coupon-view-btn" href="${walletPageUrl}"
          style="display:block;width:100%;margin-top:12px;padding:16px;background:${themeColor};color:#fff;font-weight:700;font-size:16px;text-align:center;border-radius:14px;text-decoration:none;box-sizing:border-box;letter-spacing:.03em;box-shadow:0 4px 16px ${themeColor}55;">
          ${t(lang,"view_points_btn")}
        </a>`;
      }

      // ② LIFF経由（LINE認証 → ウォレットURLをLINEメッセージで送付）: LINE連携済みユーザーも未連携ユーザーも統一フロー
      if (liffLinkUrl) {
        return `<a id="coupon-view-btn" href="${liffLinkUrl}"
          style="display:block;width:100%;margin-top:12px;padding:16px;background:${themeColor};color:#fff;font-weight:700;font-size:16px;text-align:center;border-radius:14px;text-decoration:none;box-sizing:border-box;letter-spacing:.03em;box-shadow:0 4px 16px ${themeColor}55;">
          ${t(lang,"view_points_btn")}
        </a>`;
      }

      // ② LIFFなし・既にLINE連携済みの場合 → ウォレットページへ直接リンク
      if (walletPageUrl && review.line_user_id) {
        return `<a id="coupon-view-btn" href="${walletPageUrl}"
          style="display:block;width:100%;margin-top:12px;padding:16px;background:${themeColor};color:#fff;font-weight:700;font-size:16px;text-align:center;border-radius:14px;text-decoration:none;box-sizing:border-box;letter-spacing:.03em;box-shadow:0 4px 16px ${themeColor}55;">
          ${t(lang,"view_points_btn")}
        </a>`;
      }

      // ③ LINE OAメッセージURLまたはLINE追加URLへ（LINE連携済みユーザーのみ）
      if (lineAddFriendUrl && review.line_user_id) {
        return `<a id="coupon-view-btn" href="${lineAddFriendUrl}"
          style="display:block;width:100%;margin-top:12px;padding:16px;background:#06C755;color:#fff;font-weight:700;font-size:16px;text-align:center;border-radius:14px;text-decoration:none;box-sizing:border-box;letter-spacing:.03em;box-shadow:0 4px 16px rgba(6,199,85,.4);">
          ${t(lang,"view_points_line_btn")}
        </a>`;
      }

      // ④ 最終フォールバック: ウォレット直リンク（anon_idユーザー含む全員）
      if (walletPageUrl) {
        return `<a id="coupon-view-btn" href="${walletPageUrl}"
          style="display:block;width:100%;margin-top:12px;padding:16px;background:${themeColor};color:#fff;font-weight:700;font-size:16px;text-align:center;border-radius:14px;text-decoration:none;box-sizing:border-box;letter-spacing:.03em;box-shadow:0 4px 16px ${themeColor}55;">
          ${t(lang,"view_points_btn")}
        </a>`;
      }

      return "";
    })()}
  </div>`;

  // coupon・line セクションは一時停止中（コードは保持）
  const sectionMap: Record<string, string> = { review: sectionReview, coupon: /* sectionCoupon */ "", line: /* sectionLine */ "", scout: sectionScout, loyalty: sectionLoyalty };
  const arrowSeparator = `<div style="text-align:center;padding:4px 0 6px;"><div style="font-size:12px;font-weight:700;color:#6b7280;margin-bottom:2px;">${t(lang,"arrow_earn_hint")}</div><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></div>`;
  const filteredOrder = sectionOrder.filter((k) => sectionMap[k]);
  const orderedSectionsHtml = filteredOrder
    .map((k, i) => {
      const html = sectionMap[k];
      const nextKey = filteredOrder[i + 1];
      const arrow = (k === "review" && nextKey === "loyalty" && sectionMap["loyalty"]) ? arrowSeparator : "";
      return html + arrow;
    })
    .join("");

  if (isCouponOnlyView) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>クーポン</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; min-height: 100vh; background: #f2f2f7; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    .card { background: #fff; border-radius: 20px; padding: 24px; width: 100%; max-width: 480px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .card h4 { margin: 0 0 12px; }
    .coupon-use-hint { font-size: 12px; color: #6b7280; margin: 0 0 12px; line-height: 1.5; }
    .btn-use-coupon { width: 100%; padding: 14px; border: none; border-radius: 12px; background: ${themeColor}; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
    .btn-use-coupon:hover { filter: brightness(1.05); }
    .coupon-used-msg { padding: 12px; background: #d1fae5; color: #065f46; border-radius: 12px; font-weight: 600; text-align: center; }
    .coupon-stopped-msg { padding: 12px; background: #fee2e2; color: #991b1b; border-radius: 12px; font-weight: 600; text-align: center; }
  </style>
</head>
<body data-review-id="${review.id.replace(/"/g, "&quot;")}">
  ${sectionCoupon}
  <script>
    var btnUse = document.getElementById('btn-use-coupon');
    var usedMsg = document.getElementById('coupon-used-msg');
    if (btnUse && usedMsg) {
      btnUse.onclick = function() {
        if (btnUse.disabled) return;
        btnUse.disabled = true;
        btnUse.textContent = '処理中...';
        var api = window.location.origin + '/functions/v1/form-engine';
        fetch(api, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'use_coupon', review_id: document.body.dataset.reviewId || '' }) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.ok) { btnUse.style.display = 'none'; usedMsg.style.display = 'block'; }
            else if (d.already_used) { btnUse.style.display = 'none'; usedMsg.style.display = 'block'; }
            else { btnUse.disabled = false; btnUse.textContent = '${t(lang, "use_coupon_btn").replace(/'/g, "\\'")}'; }
          })
          .catch(function() { btnUse.disabled = false; btnUse.textContent = '${t(lang, "use_coupon_btn").replace(/'/g, "\\'")}'; });
      };
    }
  </script>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; min-height: 100vh; background: #f2f2f7; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .card { background: #fff; border-radius: 20px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .card h4 { margin: 0 0 12px; color: ${themeColor}; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
    .tab { flex: 1; padding: 10px; border: none; border-radius: 12px; background: #f0f0f0; cursor: pointer; font-weight: 600; }
    .tab.active { background: ${themeColor}; color: #fff; }
    .content { display: none; }
    .content.active { display: block; }
    .review-text { background: #f8f9fa; padding: 16px; border-radius: 12px; white-space: pre-wrap; line-height: 1.6; min-height: 80px; border: 1px solid transparent; transition: border-color 0.2s; }
    .review-text[contenteditable="true"]:focus { outline: none; border-color: ${themeColor}; background: #fff; }
    .btn-group { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
    .btn-sm { padding: 8px 10px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.08); background: #fff; font-size: 11px; font-weight: 600; cursor: pointer; }
    .btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
    button.copy, .btn-main { padding: 14px; border: none; border-radius: 12px; background: ${themeColor}; color: #fff; font-weight: 600; cursor: pointer; }
    .tone-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .tone-row .btn-sm { font-size: 12px; padding: 10px 6px; }
    .keywords-row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
    .keywords-row input { flex: 1; min-width: 120px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 14px; }
    .keywords-row .modify-btn { padding: 10px 16px; border-radius: 10px; background: ${themeColor}; color: #fff; border: none; font-weight: 600; white-space: nowrap; }
    .edit-options-toggle { background: #f3f4f6; border: 1.5px solid #e5e7eb; color: #374151; font-size: 13px; font-weight: 600; cursor: pointer; padding: 9px 16px; border-radius: 10px; width: 100%; text-align: center; text-decoration: none; }
    .edit-options-collapse { display: none; margin-top: 4px; }
    .edit-options-collapse[data-open="1"] { display: block !important; }
    .copy-save-row { display: flex; gap: 8px; margin-top: 8px; }
    .copy-save-row .copy { flex: 1; }
    .copy-save-row button.btn-primary { background: ${themeColor}; color: #fff; border: none; }
    .copy-save-row button.btn-primary:hover { filter: brightness(1.05); }
    .post-site-btns { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
    .post-site-btns .link-btn-google { display: block; width: 100%; padding: 18px 24px; font-size: 17px; background: #4285F4 !important; box-shadow: 0 4px 16px rgba(66,133,244,0.4); border: none; cursor: pointer; color: #fff; font-weight: 600; text-align: center; border-radius: 12px; font-family: inherit; text-decoration: none; box-sizing: border-box; }
    .post-site-btns .link-btn-google:hover { filter: brightness(1.08); }
    .post-site-btns .link-btn-secondary { display: block; width: 100%; border: none; cursor: pointer; color: #fff; font-weight: 600; font-size: 13px; text-align: center; border-radius: 12px; padding: 10px 14px; font-family: inherit; text-decoration: none; box-sizing: border-box; }
    .post-site-btns.post-cta-highlight .link-btn { box-shadow: 0 4px 14px rgba(0,0,0,0.2); animation: ctaPulse 2.5s ease-in-out infinite; }
    .btn-store-feedback:hover { filter: brightness(1.05); }
    .btn-store-feedback:disabled { opacity: 0.7; cursor: not-allowed; }
    .btn-store-feedback.store-feedback-cta-highlight { box-shadow: 0 4px 20px ${themeColor}66; animation: ctaPulse 2s ease-in-out infinite; }
    .link-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .link-btn { display: inline-block; padding: 12px 16px; border-radius: 12px; color: #fff; font-weight: 600; font-size: 14px; text-decoration: none; text-align: center; }
    .link-btns.google-primary .link-btn-google { width: 100%; padding: 18px 24px; font-size: 17px; background: #4285F4 !important; box-shadow: 0 4px 16px rgba(66,133,244,0.4); }
    .link-btns.google-primary .link-btn-google:hover { filter: brightness(1.08); }
    .link-btn-secondary { font-size: 13px; padding: 10px 14px; }
    .recruit-card { background: linear-gradient(135deg, #f5f5f7 0, #e8e8ed 100%); border: 1px solid rgba(0,0,0,0.08); }
    .scout-direct-interview-reward { font-size: 15px; font-weight: 600; background: linear-gradient(135deg, #ecfdf5 0, #d1fae5 100%); padding: 14px 16px; border-radius: 12px; margin: 12px 0 0; border: 1px solid #a7f3d0; color: #065f46; line-height: 1.5; }
    .scout-sid-value { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 600; color: #111; margin-right: 8px; }
    .btn-copy-sid { padding: 6px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb; color: #374151; font-size: 13px; cursor: pointer; }
    .btn-copy-sid:hover { background: #f3f4f6; }
    .btn-copy-and-line { display: inline-block; padding: 14px 20px; border-radius: 12px; color: #fff; font-weight: 600; font-size: 15px; text-align: center; border: none; cursor: pointer; text-decoration: none; }
    .btn-copy-and-line:hover { filter: brightness(1.08); }
    .card-divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    .coupon-use-hint { font-size: 12px; color: #6b7280; margin: 0 0 12px; line-height: 1.5; }
    .btn-use-coupon { width: 100%; padding: 14px; border: none; border-radius: 12px; background: ${themeColor}; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
    .btn-use-coupon:hover { filter: brightness(1.05); }
    .btn-use-coupon:disabled { background: #9ca3af; cursor: not-allowed; }
    .coupon-used-msg { padding: 12px; background: #d1fae5; color: #065f46; border-radius: 12px; font-weight: 600; text-align: center; }
    .coupon-stopped-msg { padding: 12px; background: #fee2e2; color: #991b1b; border-radius: 12px; font-weight: 600; text-align: center; }
    .coupon-use-area.used { opacity: 0.7; filter: grayscale(0.5); }
    .coupon-line-save-area { text-align: center; padding: 24px 0; }
    .btn-line-save-coupon { display: inline-block; width: 100%; max-width: 320px; padding: 18px 24px; border-radius: 16px; background: #06C755; color: #fff; font-size: 17px; font-weight: 700; text-decoration: none; text-align: center; box-shadow: 0 4px 16px rgba(6,199,85,0.4); }
    .btn-line-save-coupon:hover { filter: brightness(1.08); }
    .loading-refine { display: none; position: fixed; inset: 0; background: rgba(255,255,255,0.9); align-items: center; justify-content: center; z-index: 5000; }
    .loading-refine.show { display: flex; flex-direction: column; gap: 16px; }
    .sandglass { font-size: 56px; line-height: 1; animation: sandglassShake 0.8s ease-in-out infinite; }
    @keyframes sandglassShake { 0%,100% { transform: rotate(-15deg); } 50% { transform: rotate(15deg); } }
    #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 12px 24px; border-radius: 999px; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 9999; }
    #toast.show { opacity: 1; }
    #page-loading { position: fixed; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; background: #f2f2f7; z-index: 99999; }
    #page-loading.show { display: flex; }
    #page-loading .spinner { width: 48px; height: 48px; border: 4px solid #e5e7eb; border-top-color: ${themeColor}; border-radius: 50%; animation: spin 0.8s linear infinite; }
    #page-loading p { margin-top: 16px; color: #6b7280; font-size: 1rem; }
    .post-cta-highlight.copy { box-shadow: 0 4px 20px ${themeColor}66; animation: ctaPulse 2s ease-in-out infinite; }
    .link-btns.post-cta-highlight .link-btn { box-shadow: 0 4px 14px rgba(0,0,0,0.2); animation: ctaPulse 2.5s ease-in-out infinite; }
    @keyframes ctaPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.02); opacity: 0.95; } }
  </style>
</head>
<body>
  <div id="page-loading">
    <div class="spinner"></div>
    <p>${screenNavigating}</p>
  </div>
  ${orderedSectionsHtml}
  <div id="toast">${t(lang, "toast_copied")}</div>
  <div id="loading-refine" class="loading-refine">
    <span class="sandglass">⏳</span>
    <span id="loading-refine-text" style="font-size:14px;color:#6b7280;">${t(lang, "loading_refine")}</span>
  </div>
  <script>
    const REVIEW_ID = "${review.id}";
    const STORE_ID = "${store_id}";
    const STORE_NAME = ${JSON.stringify(couponStoreName)};
    const SUBMISSION_ID = "${submissionId}";
    const API_URL = window.location.href.split('?')[0];
    const SCOUT_LP_BASE = "${scoutLpBaseUrl.replace(/"/g, "\\\"")}";
    const DASHBOARD_URL = "${(dashboardUrl ?? "").replace(/"/g, "\\\"")}";
    const TOAST_COPIED = ${JSON.stringify(t(lang, "toast_copied"))};
    const TOAST_SAVED = ${JSON.stringify(t(lang, "toast_saved"))};
    const SCOUT_TOAST_COPIED = ${JSON.stringify(t(lang, "scout_toast_copied"))};
    const LOADING_MODIFY = ${JSON.stringify(t(lang, "loading_modify"))};
    const FEEDBACK_SENT_LABEL = ${JSON.stringify(t(lang, "feedback_sent_label"))};
    const USE_COUPON_BTN = ${JSON.stringify(t(lang, "use_coupon_btn"))};

    function _showSimpleBanner(msg, bg, dur) {
      var b = document.createElement('div');
      b.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);max-width:calc(100vw - 32px);min-width:220px;padding:14px 22px;border-radius:14px;font-size:15px;font-weight:700;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.28);z-index:99999;transition:transform .4s cubic-bezier(.34,1.56,.64,1),opacity .4s;opacity:0;pointer-events:none;background:' + (bg||'#1f2937') + ';color:#fff;';
      b.textContent = msg;
      document.body.appendChild(b);
      requestAnimationFrame(function(){ b.style.opacity='1'; b.style.transform='translateX(-50%) translateY(0)'; });
      setTimeout(function(){ b.style.opacity='0'; b.style.transform='translateX(-50%) translateY(80px)'; setTimeout(function(){try{b.remove();}catch(e){}},400); }, dur||4000);
    }

    async function sendImprovementFeedback() {
      var btn = document.getElementById('btn-store-feedback');
      if (!btn || btn.disabled) return;
      var activeEl = document.querySelector('.content.active .review-text');
      var text = activeEl ? (activeEl.innerText || '').trim() : '';
      btn.disabled = true;
      btn.textContent = FEEDBACK_SENT_LABEL;
      try {
        var base = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
        var res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send_improvement_feedback', review_id: REVIEW_ID, store_id: STORE_ID, text: text })
        });
        var data = await res.json();
        if (data.ok) {
          var pts = data.points_awarded || 0;
          if (pts > 0) {
            var _bal = data.balance != null ? data.balance : pts;
            if (typeof window._showPtsPopup === 'function') {
              window._showPtsPopup(pts, _bal, 'フィードバック送信');
            } else {
              _showSimpleBanner('🎉 フィードバック ＋' + pts + 'P 加算！', '#16a34a', 5000);
            }
          } else {
            _showSimpleBanner('✅ フィードバックを送信しました', '#374151', 3000);
          }
          // ポイント残高カードをリアルタイム更新
          if (typeof window._refreshWalletDisplay === 'function') window._refreshWalletDisplay();
        } else {
          btn.disabled = false;
          btn.textContent = btn.getAttribute('data-original-text') || '';
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = btn.getAttribute('data-original-text') || '';
      }
    }

    // sendImprovementFeedback を window に公開 + addEventListener でフォールバック登録
    window.sendImprovementFeedback = sendImprovementFeedback;
    (function() {
      var fbBtn = document.getElementById('btn-store-feedback');
      if (fbBtn) {
        fbBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          sendImprovementFeedback();
        });
      }
    })();

    if (SUBMISSION_ID) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('store_id', STORE_ID);
        u.searchParams.set('sid', SUBMISSION_ID);
        u.searchParams.delete('vid');
        history.replaceState(null, '', u.toString());
      } catch (e) {}
    }

    document.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.content').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.querySelector('.content[data-style="' + t.dataset.style + '"]').classList.add('active');
      };
    });

    // ── 文体・長さを変える トグル ──────────────────────────────────
    function _doToggleCollapse(btn) {
      try {
        var styleKey = btn.getAttribute('data-style');
        var collapse = styleKey
          ? document.querySelector('.edit-options-collapse[data-style="' + styleKey + '"]')
          : btn.nextElementSibling;
        if (!collapse) return;
        var isOpen = collapse.getAttribute('data-open') === '1';
        if (isOpen) {
          collapse.setAttribute('data-open', '0');
          collapse.style.setProperty('display', 'none', 'important');
        } else {
          collapse.setAttribute('data-open', '1');
          collapse.style.setProperty('display', 'block', 'important');
        }
        var txt = (btn.textContent || '').replace(/\s*[\u25bc\u25b2\u25be\u25b8▼▲]\s*$/, '').trim();
        btn.textContent = txt + (isOpen ? ' \u25bc' : ' \u25b2');
      } catch(e) { console.error('toggleEditOptions:', e); }
    }
    window.toggleEditOptions = _doToggleCollapse;

    async function refine(k, ins) {
      var el = document.getElementById('text-' + k);
      var overlay = document.getElementById('loading-refine');
      if (overlay) overlay.classList.add('show');
      try {
        var base = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
        var res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refine', review_id: REVIEW_ID, style_key: k, instruction: ins })
        });
        var data = await res.json();
        if (data.newText) el.textContent = data.newText;
      } catch (e) { alert('調整に失敗しました'); }
      if (overlay) overlay.classList.remove('show');
    }

    async function refineToneKeywords(styleKey, opts) {
      var el = document.getElementById('text-' + styleKey);
      var overlay = document.getElementById('loading-refine');
      var loadingText = document.getElementById('loading-refine-text');
      var hasTone = opts.tone && (opts.tone === 'polite' || opts.tone === 'friendly' || opts.tone === 'short');
      var hasKeywords = opts.keywords != null && String(opts.keywords).trim();
      if (!hasTone && !hasKeywords) return;
      if (loadingText) loadingText.textContent = LOADING_MODIFY;
      if (overlay) overlay.classList.add('show');
      try {
        var body = { action: 'refine_tone_keywords', review_id: REVIEW_ID, style_key: styleKey };
        if (opts.tone) body.tone = opts.tone;
        if (opts.keywords != null && String(opts.keywords).trim()) body.keywords = String(opts.keywords).trim();
        var base = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
        var res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = await res.json();
        if (data.newText) el.textContent = data.newText;
        if (data.error) alert(data.error);
      } catch (e) { alert('修正に失敗しました'); }
      if (overlay) overlay.classList.remove('show');
    }

    function copy(k) {
      navigator.clipboard.writeText(document.getElementById('text-' + k).innerText);
      var el = document.getElementById('toast');
      el.textContent = TOAST_COPIED;
      el.classList.add('show');
      setTimeout(function() { el.classList.remove('show'); }, 2000);
    }
    function showCopiedToast() {
      var el = document.getElementById('toast');
      if (!el) return;
      el.textContent = TOAST_COPIED;
      el.classList.add('show');
      setTimeout(function() { el.classList.remove('show'); }, 2000);
    }
    function copyTextFromReviewEl(el) {
      return el ? String(el.innerText || el.textContent || '') : '';
    }

    // ── <a href> ベースの口コミリンク処理 ──────────────────────────────
    // 全ブラウザで preventDefault してコピーを先に確実に実行してからリンクを開く。
    // （target="_blank" の自然遷移ではページフォーカスが外れ clipboard API が失敗するため）
    function handleReviewAnchorClick(e, styleKey, el) {
      var url = el && el.getAttribute('href');
      var ua = navigator.userAgent || '';
      // ★ 常に preventDefault（フォーカス維持のため）
      e.preventDefault();
      // クリック記録
      try { localStorage.setItem('fe_rv_' + STORE_ID, JSON.stringify({ t: Date.now(), sid: SUBMISSION_ID })); } catch(ex) {}
      // ★ 口コミリンク押下後はフィードバック送信ボタンを無効化
      (function() {
        var _fbBtn = document.getElementById('btn-store-feedback');
        if (_fbBtn && !_fbBtn.disabled) {
          _fbBtn.disabled = true;
          _fbBtn.style.opacity = '0.35';
          _fbBtn.style.cursor = 'not-allowed';
          _fbBtn.title = '口コミを投稿後にご利用ください';
        }
      })();
      // ★ テキストコピー（ページフォーカスが外れる前に同期的に実行）
      if (styleKey) {
        var textEl = document.getElementById('text-' + styleKey);
        var text = copyTextFromReviewEl(textEl);
        if (text) {
          // 同期的 execCommand でコピー（フォーカス中に確実に動作）
          var copied = false;
          try {
            var ta = document.createElement('textarea');
            ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;';
            document.body.appendChild(ta); ta.focus(); ta.select();
            if (document.execCommand('copy')) { copied = true; }
            document.body.removeChild(ta);
          } catch(ex1) {}
          // execCommand 失敗時は Clipboard API（preventDefault 済でフォーカス維持中）
          if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function(){ showCopiedToast(); }).catch(function(){});
            copied = true;
          }
          if (copied) showCopiedToast();
        }
      }
      // ★ スライドインバー: DOM に即時追加 → CSS animation-delay:2s で自動スライドイン
      // visibilitychange / requestAnimationFrame / setTimeout に依存しない
      // CSS animation は背景タブ・外部ブラウザが開いていても確実に動作する
      (function() {
        var barId = 'review-return-bar';
        if (document.getElementById(barId)) return;
        if (!document.getElementById('_rbar_kf')) {
          var s = document.createElement('style');
          s.id = '_rbar_kf';
          s.textContent = '@keyframes _rbar_in{from{transform:translateY(100%)}to{transform:translateY(0)}}';
          document.head.appendChild(s);
        }
        var bar = document.createElement('div');
        bar.id = barId;
        bar.style.cssText = [
          'position:fixed;bottom:0;left:0;right:0',
          'background:#1f2937;padding:16px 20px 24px',
          'z-index:99998;box-shadow:0 -4px 20px rgba(0,0,0,.3)',
          'animation:_rbar_in 0.35s ease 2s both'
        ].join(';');
        bar.innerHTML =
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
            '<span style="font-size:26px;flex-shrink:0;">📝</span>' +
            '<div>' +
              '<div style="color:#fff;font-weight:800;font-size:14px;line-height:1.3;">口コミ投稿ページを開きました！</div>' +
              '<div style="color:#9ca3af;font-size:12px;margin-top:3px;">投稿後は「戻る」でこのページに戻ってタップ</div>' +
            '</div>' +
          '</div>' +
          '<button id="review-return-claim-btn" style="display:block;width:100%;padding:16px;background:linear-gradient(135deg,#16a34a,#15803d);border:none;border-radius:14px;color:#fff;font-size:17px;font-weight:800;cursor:pointer;box-sizing:border-box;box-shadow:0 4px 14px rgba(22,163,74,0.5);">🎁 ＋' + googlePts + 'P　ポイントを受け取る</button>';
        document.body.appendChild(bar);
        // ボタン押下で upgradeBtn を呼ぶ（window._upgradeBtn はIIFE内で公開済み）
        var claimBtnR = document.getElementById('review-return-claim-btn');
        if (claimBtnR) {
          claimBtnR.onclick = function() {
            this.textContent = '⏳ 確認中...';
            this.disabled = true;
            if (typeof window._upgradeBtn === 'function') window._upgradeBtn();
          };
        }
      })();
      // ★ リンクを開く（LINE は外部ブラウザ誘導、それ以外は window.open）
      if (ua.toLowerCase().indexOf('line/') !== -1) {
        try {
          if (typeof liff !== 'undefined' && typeof liff.isInClient === 'function' && liff.isInClient()) {
            liff.openWindow({ url: url, external: true });
          } else if (typeof window._showLineExtModal === 'function') {
            window._showLineExtModal(url);
          }
        } catch(ex) {
          if (typeof window._showLineExtModal === 'function') window._showLineExtModal(url);
        }
      } else {
        // 通常ブラウザ: 同一ウィンドウで移動（戻るボタンでポイント受け取りページに戻れる）
        if (url) {
          window.location.href = url;
        }
      }
    }
    // ★ グローバルに公開（IIFE 内の showLineExternalModal を後で紐付け）
    window.handleReviewAnchorClick = handleReviewAnchorClick;

    // ★ Google口コミボタン専用: コピーとページ移動を同時実行（モーダルなし）
    window.handleGoogleBtnClick = function(event, styleKey, url) {
      if (event) event.preventDefault();
      if (!url) return;
      // 1. クリック記録
      try { localStorage.setItem('fe_rv_' + STORE_ID, JSON.stringify({ t: Date.now(), sid: SUBMISSION_ID })); } catch(ex) {}
      // 2. ★ 口コミテキストをコピー（ページ遷移前に確実に実行）
      // ※ window.location.href 後はページがアンロードされてクリップボード操作が失敗するため、必ずナビゲート前に実行する
      var textEl = document.getElementById('text-' + styleKey);
      var text = textEl ? (textEl.innerText || textEl.textContent || '').trim() : '';
      if (text) {
        var copied = false;
        try {
          var ta = document.createElement('textarea');
          ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;';
          document.body.appendChild(ta); ta.focus(); ta.select();
          if (document.execCommand('copy')) { copied = true; }
          document.body.removeChild(ta);
        } catch(ex3) {}
        if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function() {});
        }
        if (typeof _showSimpleBanner === 'function') {
          _showSimpleBanner('📋 口コミをコピーしました！投稿画面に貼り付けてください', '#15803d', 4000);
        }
      }
      // 3. ★ ポイントをページ遷移前に確実に送信
      // sendBeacon はページアンロード後も配信保証あり（LINEブラウザのページ遷移でfetchがキャンセルされる問題を回避）
      try {
        var _claimUrl = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
        var _claimBody = JSON.stringify({ action: 'claim_google_bonus', review_id: REVIEW_ID });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(_claimUrl, new Blob([_claimBody], { type: 'application/json' }));
        } else {
          claimGoogleBonus(); // sendBeacon非対応ブラウザはkeepalive fetchで代替
        }
      } catch(e) {}
      // 4. ページ移動（ユーザージェスチャー内で即時実行 → ポップアップブロッカー回避）
      try {
        if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
          liff.openWindow({ url: url, external: true });
        } else {
          // 通常ブラウザ: 同一ウィンドウで移動（戻るボタンでポイント受け取りページに戻れる）
          window.location.href = url;
        }
      } catch(ex2) {
        window.location.href = url;
      }
    };

    function copyAndOpenReview(styleKey, btn) {
      var url = btn && btn.getAttribute('data-url');
      // 口コミリンクのクリック記録（ポイントボタン有効化用）
      try { localStorage.setItem('fe_rv_' + STORE_ID, JSON.stringify({ t: Date.now(), sid: SUBMISSION_ID })); } catch(e) {}

      // ★ URLはクリックイベントの同期スコープ内で即座に開く
      // （非同期コールバック内から window.open するとポップアップブロッカーに遮断される）
      if (url && url !== 'null' && url !== 'undefined') {
        openExternalBrowser(url);
      }

      // クリップボードコピーは非同期でOK（URL開封の後でも機能する）
      var el = document.getElementById('text-' + styleKey);
      var text = copyTextFromReviewEl(el);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          showCopiedToast();
        }).catch(function() {
          try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:-9999px;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showCopiedToast();
          } catch (e) { /* ignore */ }
        });
      } else {
        try {
          var ta2 = document.createElement('textarea');
          ta2.value = text;
          ta2.setAttribute('readonly', '');
          ta2.style.cssText = 'position:fixed;left:-9999px;';
          document.body.appendChild(ta2);
          ta2.select();
          document.execCommand('copy');
          document.body.removeChild(ta2);
          showCopiedToast();
        } catch (e2) { /* ignore */ }
      }
    }
    function copySid() {
      var sidEl = document.getElementById('scout-direct-sid-value');
      if (sidEl && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sidEl.textContent).then(function() {
          var t = document.getElementById('toast');
          if (t) { t.textContent = TOAST_COPIED; t.classList.add('show'); setTimeout(function() { t.classList.remove('show'); }, 2000); }
        });
      }
    }
    function copySidAndOpenLine(url) {
      var sidEl = document.getElementById('scout-direct-sid-value');
      if (sidEl && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sidEl.textContent).then(function() {
          var t = document.getElementById('toast');
          if (t) { t.textContent = TOAST_COPIED; t.classList.add('show'); setTimeout(function() { t.classList.remove('show'); }, 2000); }
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        });
      } else if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }

    async function saveText(k) {
      var el = document.getElementById('text-' + k);
      var text = el.innerText.trim();
      var t = document.getElementById('toast');
      try {
        var base = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
        var res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_review_text', review_id: REVIEW_ID, style_key: k, text: text })
        });
        var data = await res.json();
        if (data.ok) {
          t.textContent = TOAST_SAVED;
          t.classList.add('show');
          setTimeout(function() { t.classList.remove('show'); }, 2000);
        } else { alert('保存に失敗しました'); }
      } catch (e) { alert('保存に失敗しました'); }
    }

    var btnUse = document.getElementById('btn-use-coupon');
    var usedMsg = document.getElementById('coupon-used-msg');
    if (btnUse && usedMsg) {
      btnUse.onclick = function() {
        if (btnUse.disabled) return;
        btnUse.disabled = true;
        btnUse.textContent = '処理中...';
        var base = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
        fetch(base, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'use_coupon', review_id: REVIEW_ID })
        }).then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok || data.already_used) {
              btnUse.style.display = 'none';
              usedMsg.style.display = 'block';
              var area = document.querySelector('.coupon-use-area');
              if (area) area.classList.add('used');
              if (data.already_used && data.message) usedMsg.textContent = '✅ ' + data.message;
            } else if (data.expired) {
              btnUse.style.display = 'none';
              usedMsg.style.display = 'block';
              usedMsg.textContent = '⛔ ' + (data.message || 'このクーポンは有効期限切れです。');
            } else {
              btnUse.disabled = false;
              btnUse.textContent = USE_COUPON_BTN;
              if (data.error === 'coupon_stopped') alert('クーポンは現在停止中です');
            }
          })
          .catch(function() {
            btnUse.disabled = false;
            btnUse.textContent = USE_COUPON_BTN;
          });
      };
    }

    var scoutBtn = document.querySelector('.scout-copy-btn');
    if (scoutBtn) {
      scoutBtn.onclick = async function() {
        try {
          var base = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
          var res = await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create_ref', review_id: REVIEW_ID })
          });
          var text = await res.text();
          var data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch (parseErr) {
            console.error('create_ref: response is not JSON', res.status, text);
            throw new Error('サーバー応答の解析に失敗しました');
          }
          if (!res.ok) {
            var errMsg = (data && data.message) || data.error || ('HTTP ' + res.status);
            console.error('create_ref failed:', res.status, data);
            throw new Error(errMsg);
          }
          if (!data.ref_token) throw new Error('発行失敗');
          var url = data.referral_url || (SCOUT_LP_BASE + '?ref=' + encodeURIComponent(data.ref_token) + '&store=' + encodeURIComponent(STORE_ID));
          var msg = '【' + document.title + '】スカウト紹介のご案内\\n\\nいつもお世話になっているお店から、「将来の店長候補になってくれそうな方をご紹介いただけませんか？」という相談を受けました。\\n\\n興味があればこちらから：\\n' + url + '\\n\\n※このリンクには私専用の紹介IDが含まれています。';
          await navigator.clipboard.writeText(msg);
          var t = document.getElementById('toast');
          if (t) { t.textContent = SCOUT_TOAST_COPIED; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); t.textContent = TOAST_COPIED; }, 2200); }
        } catch (e) {
          console.error('create_ref error:', e);
          alert('紹介URLの発行に失敗しました: ' + (e && e.message ? e.message : String(e)));
        }
      };
    }
    var photoDownloadBtn = document.querySelector('.photo-download-btn');
    if (photoDownloadBtn && photoDownloadBtn.dataset.url) {
      photoDownloadBtn.onclick = function() {
        var url = photoDownloadBtn.dataset.url;
        if (!url) return;
        fetch(url, { mode: 'cors' }).then(function(r) { return r.blob(); }).then(function(blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'review-photo.jpg';
          a.click();
          URL.revokeObjectURL(a.href);
        }).catch(function() { window.open(url, '_blank'); });
      };
    }
    // ── ポイントカード発行 + 口コミ後アップグレード ──
    (function() {
      var storeKey = 'fe_rv_' + ${JSON.stringify(store_id)};
      var LINE_LIFF_URL = ${JSON.stringify(liffLinkUrl ?? "")};
      var surveyPts = ${surveyPoints};
      var googlePts = ${googlePoints};
      var themeColorP = ${JSON.stringify(themeColor)};
      var ptThreshold = ${pointThreshold};
      var REWARD_TITLE_1 = ${JSON.stringify(rewardTitle1 || "クーポン")};
      var REWARD_TITLE_2 = ${JSON.stringify(rewardTitle2 ?? null)};
      var PT_THRESHOLD_2 = ${JSON.stringify(pointThreshold2 ?? null)};
      var COUPON_TIERS = ${JSON.stringify(couponTiersArray)};
      var POINT_EXPIRY_DAYS = ${pointExpiryDays};
      var MIN_AWAY_MS = 3000;
      var bonusBtn = document.getElementById('google-bonus-btn');
      var bonusMsg = document.getElementById('google-bonus-msg');
      var _btnHref = bonusBtn ? bonusBtn.getAttribute('href') : 'N/A';
      console.log('[fe] IIFE loaded. bonusBtn:', bonusBtn ? 'found' : 'NOT FOUND', 'LIFF:', LINE_LIFF_URL || '(none)');
      console.log('[fe] LINE button href:', _btnHref);
      var hintNormal = document.getElementById('loyalty-hint-normal');
      var upgraded = false;       // 口コミページ訪問済みフラグ
      var lineButtonPressed = false; // LINEボタンを先に押した場合のフラグ
      var _walletPollingStarted = false; // ポーリング二重起動防止
      // ★ LINE連携済みフラグ: checkReturn() より前に確定させる（変数ホイスティングバグ対策）
      var LINE_ALREADY_FOLLOWED = ${review.line_user_id ? "true" : "false"};

      // ── 画面下部に固定バナー通知 ────────────────────────────────────────
      function showFloatBanner(msg, bgColor, durationMs) {
        var id = 'float-pts-banner';
        var el = document.getElementById(id);
        if (!el) {
          el = document.createElement('div');
          el.id = id;
          el.style.cssText = [
            'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px)',
            'max-width:calc(100vw - 32px);width:auto;min-width:220px',
            'padding:14px 22px;border-radius:14px',
            'font-size:15px;font-weight:700;text-align:center',
            'box-shadow:0 6px 24px rgba(0,0,0,.28)',
            'z-index:99999;transition:transform .4s cubic-bezier(.34,1.56,.64,1),opacity .4s',
            'opacity:0;pointer-events:none;'
          ].join(';');
          document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.background = bgColor || '#1f2937';
        el.style.color = '#fff';
        // アニメーション表示
        requestAnimationFrame(function() {
          el.style.opacity = '1';
          el.style.transform = 'translateX(-50%) translateY(0)';
        });
        // 自動非表示
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(function() {
          el.style.opacity = '0';
          el.style.transform = 'translateX(-50%) translateY(80px)';
        }, durationMs || 4000);
      }

      // ── ポイント獲得ポップアップ（大きく目立つモーダル）────────────────
      function showPointsEarnedPopup(pts, newBal, actionLabel) {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:24px;padding:28px 24px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);';
        var walletHref = (DASHBOARD_URL && SUBMISSION_ID)
          ? DASHBOARD_URL + '/s/' + encodeURIComponent(STORE_ID) + '/wallet/' + encodeURIComponent(SUBMISSION_ID)
          : '';
        box.innerHTML =
          '<div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:2px solid #6ee7b7;border-radius:18px;padding:18px 16px 14px;margin-bottom:16px;">'
          + '<div style="font-size:11px;font-weight:800;color:#065f46;letter-spacing:.09em;margin-bottom:4px;">🎉 ' + actionLabel + '完了</div>'
          + '<div style="font-size:76px;font-weight:900;color:#059669;line-height:1;letter-spacing:-.02em;">＋' + pts + 'P</div>'
          + '<div style="font-size:13px;font-weight:700;color:#065f46;margin-top:6px;">獲得しました！</div>'
          + '</div>'
          + '<div style="font-size:14px;color:#374151;margin-bottom:16px;">利用可能ポイント: <span style="font-weight:800;color:' + themeColorP + ';">' + newBal + 'P</span></div>'
          + '<button onclick="this.parentNode.parentNode.remove()" style="display:block;width:100%;padding:13px;background:' + themeColorP + ';color:#fff;font-size:15px;font-weight:800;border-radius:12px;border:none;cursor:pointer;">とじる</button>';
        ov.appendChild(box);
        ov.addEventListener('click', function(e) { if (e.target === ov) { ov.remove(); } });
        document.body.appendChild(ov);
      }
      // グローバルに公開（sendImprovementFeedback など IIFE 外から利用）
      window._showPtsPopup = showPointsEarnedPopup;
      // check_wallet を呼んで残高カードを最新に更新（ポイント付与後に呼ぶ）
      window._refreshWalletDisplay = async function() {
        if (!SUBMISSION_ID) return;
        try {
          var _cw = await fetch(API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + '&sid=' + encodeURIComponent(SUBMISSION_ID) + '&action=check_wallet&_nc=' + Date.now());
          var _cd = await _cw.json();
          if (_cd.ready && _cd.balance != null) {
            var _exMs3 = _cd.expires_at ? new Date(_cd.expires_at).getTime() : null;
            injectPointCard(_cd.total_earned, _cd.balance, ptThreshold, themeColorP, 0, buildCoupons(_cd.balance), _exMs3);
          }
        } catch(e) {}
      };

      // ── Google口コミポイント付与 ──────────────────────────────────────
      async function claimGoogleBonus() {
        showFloatBanner('⏳ 口コミポイントを加算中…', '#374151', 8000);
        try {
          var res = await fetch(API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'claim_google_bonus', review_id: REVIEW_ID }),
            keepalive: true
          });
          var data = await res.json();
          if (data.ok && !data.skipped) {
            var newTotal = data.total_points;
            var newBal = data.balance != null ? data.balance : newTotal;
            showFloatBanner('🎉 口コミ ＋' + googlePts + 'P 加算！', '#16a34a', 3000);
            if (bonusMsg) { bonusMsg.style.color = '#16a34a'; bonusMsg.textContent = '✅ 口コミポイント ＋' + googlePts + 'P を加算しました！'; }
            // ★ ポイントカード表示を最新値に更新
            var _exMs = POINT_EXPIRY_DAYS > 0 ? Date.now() + POINT_EXPIRY_DAYS * 86400000 : null;
            if (newBal != null) { injectPointCard(newTotal, newBal, ptThreshold, themeColorP, googlePts, buildCoupons(newBal), _exMs); }
            // ★ リダイレクトの代わりに目立つポップアップを表示
            showPointsEarnedPopup(googlePts, newBal, '口コミ投稿');
            try { localStorage.setItem('fe_google_done_' + SUBMISSION_ID, '1'); } catch(e) {}
            if (typeof window._refreshWalletDisplay === 'function') window._refreshWalletDisplay();
          } else if (data.skipped) {
            showFloatBanner('⚠️ 口コミポイントは1日1回のみ加算されます（本日分は加算済み）', '#b45309', 5000);
            if (bonusMsg) { bonusMsg.style.color = '#b45309'; bonusMsg.textContent = '⚠️ 口コミポイントは1日1回のみです（本日分は加算済み）'; }
            // ★ 加算済みでもポップアップ表示（check_wallet失敗時はgooglePtsをフォールバック）
            var _skipBal = googlePts;
            try {
              var cwRes = await fetch(API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + '&sid=' + encodeURIComponent(SUBMISSION_ID) + '&action=check_wallet');
              var cwData = await cwRes.json();
              if (cwData.ready && cwData.balance != null) { _skipBal = cwData.balance; }
            } catch(ce) {}
            showPointsEarnedPopup(googlePts, _skipBal, '口コミ投稿');
            try { localStorage.setItem('fe_google_done_' + SUBMISSION_ID, '1'); } catch(e) {}
          } else {
            // ★ NO_IDENTITY等のエラー時も感謝ポップアップ表示（LINE未連携ユーザー向け）
            showPointsEarnedPopup(googlePts, googlePts, '口コミ投稿');
            showFloatBanner('✅ 口コミへのご協力ありがとうございます！', '#16a34a', 4000);
          }
        } catch(e) {
          // ★ 通信エラー時も感謝ポップアップ
          showPointsEarnedPopup(googlePts, googlePts, '口コミ投稿');
        }
        if (bonusBtn) bonusBtn.style.display = 'none';
      }

      // ── LINE 連携ポーリング ───────────────────────────────────────────
      function startWalletPolling() {
        if (_walletPollingStarted) return; // 二重起動防止
        _walletPollingStarted = true;
        var checkUrl = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + '&sid=' + encodeURIComponent(SUBMISSION_ID) + '&action=check_wallet';
        var tries = 0;
        var maxTries = 40; // 最大2分間
        var timer = setInterval(async function() {
          tries++;
          if (tries > maxTries) {
            clearInterval(timer);
            // ★ タイムアウト: ボタンとフラグをリセットして再クリック可能に
            try { localStorage.removeItem('fe_line_' + STORE_ID); } catch(ex) {}
            lineButtonPressed = false;
            _walletPollingStarted = false;
            bonusDone = false;
            if (bonusBtn) { bonusBtn.style.opacity = '1'; bonusBtn.style.pointerEvents = 'auto'; bonusBtn.style.background = '#06C755'; bonusBtn.textContent = '🎴 ポイント確認・特典（クーポン）交換はこちら'; }
            if (bonusMsg) { bonusMsg.style.color = '#ef4444'; bonusMsg.textContent = '⚠️ 検出できませんでした。もう一度タップしてください。'; }
            return;
          }
          try {
            var res = await fetch(checkUrl);
            var data = await res.json();
            if (data.ready) {
              clearInterval(timer);
              try { localStorage.removeItem('fe_line_' + STORE_ID); } catch(ex) {}
              // ★ LINE連携で何Pもらったか明示（アンケート+LINE=通常2P）
              var lineEarned = data.total_earned;
              var lineDelta = lineEarned - (_formCurrentPts || 0);
              var lineMsg = lineDelta > 0
                ? '🎉 LINE連携完了！アンケート＋LINE連携で ＋' + lineDelta + 'P 獲得（累計 ' + lineEarned + 'P）'
                : '🎉 LINE連携完了！';
              if (bonusMsg) { bonusMsg.style.color = '#16a34a'; bonusMsg.textContent = lineMsg; }
              // ★ インラインカードを最新値に更新（常に）
              var _lineExMs = data.expires_at ? new Date(data.expires_at).getTime() : (POINT_EXPIRY_DAYS > 0 ? Date.now() + POINT_EXPIRY_DAYS * 86400000 : null);
              injectPointCard(lineEarned, data.balance, ptThreshold || data.point_threshold, themeColorP, lineDelta > 0 ? lineDelta : 0, buildCoupons(lineEarned), _lineExMs);
              if (DASHBOARD_URL && SUBMISSION_ID) {
                // ウォレット画面へのリンクをバナーで表示（自動リダイレクトなし）
                if (upgraded) {
                  claimGoogleBonus();
                } else {
                  showFloatBanner(lineMsg, '#16a34a', 5000);
                  var _wBanner = document.createElement('div');
                  _wBanner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#16a34a;padding:14px 20px 20px;z-index:99999;box-shadow:0 -4px 20px rgba(0,0,0,.25);text-align:center;';
                  _wBanner.innerHTML = '<div style="font-size:13px;color:#dcfce7;margin-bottom:8px;">' + (lineDelta > 0 ? '✅ ＋' + lineDelta + 'P獲得！累計 ' + lineEarned + 'P　口コミを書いてさらに＋' + googlePts + 'P👇' : '✅ LINE連携完了！') + '</div>'
                    + '<button onclick="this.parentNode.remove()" style="display:inline-block;padding:12px 32px;background:#fff;color:#16a34a;font-weight:800;font-size:15px;border-radius:10px;border:none;cursor:pointer;">とじる</button>';
                  document.body.appendChild(_wBanner);
                }
              } else {
                // DASHBOARD_URL 未設定時はインライン表示（フォールバック）
                if (!upgraded) { showReviewPromptPopup(); } else { claimGoogleBonus(); }
              }
            }
          } catch(e) {}
        }, 3000);
      }

      // ── 口コミ後「投稿しました」ボタンバー ──────────────────────────────
      function showReviewReturnBar() {
        // ★ 口コミリンクをクリックした記録がない場合はバーを表示しない
        // （記録なし＝このセッションで口コミリンクを押していない → ボタンを覆って邪魔にならないよう）
        if (upgraded) return;
        // ポイント付与ポップアップを既に1回表示済みなら再表示しない
        try { if (localStorage.getItem('fe_google_done_' + SUBMISSION_ID)) return; } catch(e) {}
        var _savedForBar = null;
        try { _savedForBar = localStorage.getItem(storeKey); } catch(e2) {}
        if (!_savedForBar) return;
        var barId = 'review-return-bar';
        if (document.getElementById(barId)) return;
        if (!document.getElementById('_rbar_kf')) {
          var s = document.createElement('style');
          s.id = '_rbar_kf';
          s.textContent = '@keyframes _rbar_in{from{transform:translateY(100%)}to{transform:translateY(0)}}';
          document.head.appendChild(s);
        }
        var bar = document.createElement('div');
        bar.id = barId;
        bar.style.cssText = [
          'position:fixed;bottom:0;left:0;right:0',
          'background:#1f2937;padding:16px 20px 24px',
          'z-index:99998;box-shadow:0 -4px 20px rgba(0,0,0,.3)',
          'animation:_rbar_in 0.35s ease 2s both'
        ].join(';');
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
        header.innerHTML =
          '<span style="font-size:26px;flex-shrink:0;">🎉</span>' +
          '<div>' +
            '<div style="color:#fff;font-weight:800;font-size:14px;line-height:1.3;">口コミ投稿ありがとうございます！</div>' +
            '<div style="color:#9ca3af;font-size:12px;margin-top:3px;">下のボタンをタップしてポイントを受け取ってください</div>' +
          '</div>';
        var claimBarBtn = document.createElement('button');
        claimBarBtn.style.cssText = 'display:block;width:100%;padding:16px;background:linear-gradient(135deg,#16a34a,#15803d);border:none;border-radius:14px;color:#fff;font-size:17px;font-weight:800;cursor:pointer;box-sizing:border-box;box-shadow:0 4px 14px rgba(22,163,74,0.5);';
        claimBarBtn.textContent = '🎁 ＋' + googlePts + 'P　ポイントを受け取る';
        claimBarBtn.onclick = function() {
          claimBarBtn.textContent = '⏳ 確認中...';
          claimBarBtn.disabled = true;
          upgradeBtn();
        };
        bar.appendChild(header);
        bar.appendChild(claimBarBtn);
        document.body.appendChild(bar);
      }

      // ── 口コミページからの帰還検出 ────────────────────────────────────
      function upgradeBtn() {
        if (upgraded) return;
        // ポイント付与ポップアップを既に1回表示済みなら再表示しない
        try { if (localStorage.getItem('fe_google_done_' + SUBMISSION_ID)) return; } catch(e) {}
        upgraded = true;
        try { localStorage.removeItem(storeKey); } catch(ex) {}
        clearTimeout(_barShownTimer);
        var rrBar = document.getElementById('review-return-bar');
        if (rrBar) { try { rrBar.remove(); } catch(e) {} }
        if (hintNormal) hintNormal.style.display = 'none';
        if (bonusMsg) { bonusMsg.style.color = '#6b7280'; bonusMsg.textContent = '⏳ ポイントを確認中…'; }
        // ★ LINE連携・非連携に関わらず常に口コミポイントを付与
        // （line_user_id / anon_id のどちらかで add-loyalty-point が処理する）
        claimGoogleBonus();
      }

      function checkReturn() {
        if (upgraded) return;
        // ポイント付与ポップアップを既に1回表示済みなら再表示しない
        try { if (localStorage.getItem('fe_google_done_' + SUBMISSION_ID)) return; } catch(e) {}
        var raw = localStorage.getItem(storeKey);
        if (!raw) return;
        try {
          var saved = JSON.parse(raw);
          // ★ sid が一致しないか未設定（旧形式）のエントリは削除して無視
          if (!saved.sid || saved.sid !== SUBMISSION_ID) {
            try { localStorage.removeItem(storeKey); } catch(ex) {}
            return;
          }
          var elapsed = Date.now() - (saved.t || 0);
          if (elapsed >= MIN_AWAY_MS) {
            upgradeBtn();
          } else {
            setTimeout(upgradeBtn, MIN_AWAY_MS - elapsed + 200);
          }
        } catch(e) {}
      }

      // 口コミリンクのクリック記録 + LINE連携済みなら即時バックグラウンドでポイント付与
      // ★ ボタンクリック時に upgraded をリセット（ページロード時の checkReturn で
      //    upgraded=true になっていても再クレームできるようにする）
      function markReviewClick() {
        upgraded = false; // ★ ページロード残留フラグをリセット
        try { localStorage.setItem(storeKey, JSON.stringify({ t: Date.now(), sid: SUBMISSION_ID })); } catch(e) {}
        if (LINE_ALREADY_FOLLOWED) {
          (async function() {
            try {
              var res = await fetch(API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim_google_bonus', review_id: REVIEW_ID }),
                keepalive: true
              });
              var d = await res.json();
              if (d.ok && !d.skipped && d.balance != null) {
                // ポイントカードを即時更新（ユーザーが戻る前に反映しておく）
                var _crExMs = d.expires_at ? new Date(d.expires_at).getTime() : (POINT_EXPIRY_DAYS > 0 ? Date.now() + POINT_EXPIRY_DAYS * 86400000 : null);
                injectPointCard(d.total_points, d.balance, ptThreshold, themeColorP, googlePts, buildCoupons(d.balance), _crExMs);
              }
            } catch(e3) {}
          })();
        }
        // ★ バーを即時生成（_barShownTimer は T=2s で空振り済みのため手動呼び出し）
        showReviewReturnBar();
        // ★ 5秒後に自動でポイント付与＋ポップアップ
        // upgradeBtn()（checkReturn経由・バーボタン経由）が先に呼ばれた場合は
        // upgraded=true になっているのでスキップ。まだなら強制実行。
        setTimeout(function() {
          if (upgraded) return; // upgradeBtn() が既に処理済み → スキップ
          upgradeBtn(); // ★ upgradeBtn 経由で統一（claimGoogleBonus も呼ばれる）
        }, 5000);
      }
      document.querySelectorAll('a[href]').forEach(function(el) {
        var href = String(el.getAttribute('href') || '');
        if (/google\.com|tabelog|hotpepper|retty|ikyu|ozmall/.test(href)) {
          el.addEventListener('click', markReviewClick);
        }
      });
      document.querySelectorAll('button[data-url], .link-btn-google, .link-btn-secondary').forEach(function(el) {
        el.addEventListener('click', markReviewClick);
      });

      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') { checkReturn(); }
      });
      // bfcache 復元（スマホ戻るボタン）
      window.addEventListener('pageshow', function(e) { checkReturn(); });
      window.addEventListener('focus', function() { checkReturn(); });
      // Android WebView / iOS バックグラウンドからの復帰
      document.addEventListener('resume', function() { checkReturn(); });
      // ★ ポーリング間隔を短くして戻り検出を速くする（1秒）
      var pollTimer = setInterval(function() {
        if (upgraded) { clearInterval(pollTimer); return; }
        checkReturn();
      }, 1000);
      // ★ setTimeout(0) で IIFE 完了後に実行（LINE_ALREADY_FOLLOWED 確定後に評価される）
      setTimeout(checkReturn, 0);

      // ★ ページロード2秒後に口コミ戻りバーを表示
      // upgradeBtn() が先に呼ばれた場合は clearTimeout でキャンセルする
      var _barShownTimer = setTimeout(showReviewReturnBar, 2000);

      // LINE ボタン押下 → ポーリング開始（ページ上で自動検出）
      if (bonusBtn) {
        var bonusDone = false;
        bonusBtn.onclick = function() {
          if (bonusDone) return;
          var href = bonusBtn.getAttribute('href');
          console.log('[fe] LINE button clicked. href:', href);
          bonusDone = true;
          lineButtonPressed = true;
          try { localStorage.setItem('fe_line_' + STORE_ID, '1'); } catch(ex) {}
          if (LINE_LIFF_URL) {
            if (bonusMsg) { bonusMsg.style.color = '#1d4ed8'; bonusMsg.style.fontWeight = '700'; bonusMsg.textContent = '⏳ LINEで自動登録中…完了後URLが届きます'; }
          } else {
            if (bonusMsg) { bonusMsg.style.color = '#1d4ed8'; bonusMsg.style.fontWeight = '700'; bonusMsg.textContent = '📲 LINEが開きました。メッセージを「送信」するとポイントカードURLが届きます！'; }
          }
          setTimeout(function() { if (bonusBtn) { bonusBtn.style.opacity = '0.6'; bonusBtn.style.pointerEvents = 'none'; bonusBtn.textContent = '✅ LINEを開きました'; } }, 500);
          startWalletPolling();
          // <a> の href（oaMessage URL）ナビに任せる
        };
      }

      window.GOOGLE_REVIEW_URL = ${JSON.stringify(googleLink ? String(googleLink.u) : "")};
      window.GOOGLE_PTS_LABEL = ${JSON.stringify(`＋${googlePoints}P`)};

      // ── 外部ブラウザで口コミURLを開くユーティリティ ──────────────────
      // LINE内WebViewでは liff.openWindow({external:true}) を使わないと
      // Google ログイン画面（Gmail）に飛んで離脱する原因になる
      window.openExternalBrowser = function(url) {
        if (!url) return;
        // LIFF SDK があり、LINE クライアント内ならネイティブ外部ブラウザへ
        try {
          if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
            liff.openWindow({ url: url, external: true });
            return;
          }
        } catch(e) {}
        // LIFF なし / LINE ブラウザ検出時 → 手順モーダルを出す
        var ua = navigator.userAgent || '';
        if (ua.toLowerCase().indexOf('line/') !== -1) {
          showLineExternalModal(url);
          return;
        }
        // 通常ブラウザ：<a>クリックは popup blocker に遮断されない
        try {
          var _a = document.createElement('a');
          _a.href = url; _a.target = '_blank'; _a.rel = 'noopener noreferrer';
          _a.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
          document.body.appendChild(_a);
          _a.click();
          setTimeout(function() { try { document.body.removeChild(_a); } catch(e) {} }, 200);
        } catch(e2) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      };

      // ★ 口コミボタン: 店名をクリップボードにコピーしてからURLを開く（モーダルなし・直接遷移）
      window.copyStoreNameAndOpenReview = function(url) {
        if (!url) return;
        // ★ ポイントをページ遷移前に確実に送信（sendBeacon でページアンロード後も配信保証）
        try {
          var _csUrl = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
          var _csBody = JSON.stringify({ action: 'claim_google_bonus', review_id: REVIEW_ID });
          if (navigator.sendBeacon) {
            navigator.sendBeacon(_csUrl, new Blob([_csBody], { type: 'application/json' }));
          } else {
            claimGoogleBonus();
          }
        } catch(e) {}
        // まず URL を直接開く（ユーザージェスチャー内・モーダルなし）
        try {
          if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
            liff.openWindow({ url: url, external: true });
          } else {
            var w = window.open(url, '_blank', 'noopener,noreferrer');
            if (!w) { window.location.href = url; }
          }
        } catch(ex) {
          window.location.href = url;
        }
        // クリップボードコピー（非同期OK）
        var name = typeof STORE_NAME !== 'undefined' ? STORE_NAME : '';
        if (!name) return;
        function doToast() {
          _showSimpleBanner('✅ 店名をコピーしました！口コミに貼り付けて投稿できます', '#15803d', 3500);
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(name).then(doToast).catch(function() {
              try {
                var ta = document.createElement('textarea');
                ta.value = name; ta.setAttribute('readonly','');
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                document.body.removeChild(ta); doToast();
              } catch(e) {}
            });
          } else {
            var ta2 = document.createElement('textarea');
            ta2.value = name; ta2.setAttribute('readonly','');
            ta2.style.cssText = 'position:fixed;left:-9999px;';
            document.body.appendChild(ta2); ta2.select(); document.execCommand('copy');
            document.body.removeChild(ta2); doToast();
          }
        } catch(e) {}
      };

      // ★ handleReviewAnchorClick から参照できるようグローバルに公開
      window._showLineExtModal = function(url) { showLineExternalModal(url); };
      window._showReviewReturnBar = showReviewReturnBar;
      window._upgradeBtn = upgradeBtn;

      function showLineExternalModal(url) {
        var existing = document.getElementById('line-ext-modal');
        if (existing) { existing.remove(); }
        var overlay = document.createElement('div');
        overlay.id = 'line-ext-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
        overlay.onclick = function(e) { if(e.target===overlay) overlay.remove(); };
        var card = document.createElement('div');
        card.style.cssText = 'background:#fff;border-radius:18px;padding:24px 20px 20px;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.25);';
        card.innerHTML =
          '<div style="font-size:36px;margin-bottom:10px;">🌐</div>' +
          '<div style="font-size:15px;font-weight:800;color:#1f2937;margin-bottom:6px;">Safariで開いてください</div>' +
          '<div style="font-size:12px;color:#6b7280;line-height:1.7;margin-bottom:14px;">Googleマップへの口コミ投稿は<br>LINEアプリ内では開けません。<br>外部ブラウザをご利用ください。</div>' +
          '<div style="background:#f1f5f9;border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:#334155;line-height:1.7;text-align:left;">' +
            '📱 <strong>iPhoneの場合</strong>：右下 ・・・ → 「ブラウザで開く」<br>' +
            '🤖 <strong>Androidの場合</strong>：右上 ・・・ → 「外部ブラウザで開く」' +
          '</div>' +
          '<button id="line-ext-copy-btn" style="display:block;width:100%;padding:12px;background:#1f2937;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:8px;">🔗 URLをコピー</button>' +
          '<button onclick="document.getElementById(\\'line-ext-modal\\').remove();" style="display:block;width:100%;padding:10px;background:transparent;color:#9ca3af;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;cursor:pointer;">閉じる</button>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        // コピーボタン
        document.getElementById('line-ext-copy-btn').onclick = function() {
          var btn = this;
          var fallback = function() {
            var ta = document.createElement('textarea');
            ta.value = url; ta.setAttribute('readonly','');
            ta.style.cssText = 'position:fixed;left:-9999px;';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            btn.textContent = 'コピーしました ✓';
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function() {
              btn.textContent = 'コピーしました ✓';
            }).catch(fallback);
          } else { fallback(); }
        };
      }

      function showReviewPromptPopup() {
        var existing = document.getElementById('review-prompt-popup');
        if (existing) return;
        var overlay = document.createElement('div');
        overlay.id = 'review-prompt-popup';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity 0.35s;';
        overlay.onclick = function(e) { if(e.target===overlay) closeReviewPrompt(); };
        var card = document.createElement('div');
        card.style.cssText = 'background:#fff;border-radius:22px;padding:24px 20px 20px;max-width:320px;width:100%;box-shadow:0 12px 48px rgba(0,0,0,0.22);transform:translateY(24px);transition:transform 0.35s;text-align:center;';
        card.innerHTML =
          '<div style="font-size:36px;margin-bottom:8px;">🎉</div>' +
          '<div style="font-size:16px;font-weight:800;color:#111;margin-bottom:6px;">LINE連携できました！</div>' +
          '<div style="font-size:13px;color:#6b7280;margin-bottom:18px;line-height:1.6;">次は口コミを書いてさらにポイントを獲得しましょう</div>' +
          '<div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:12px 16px;margin-bottom:18px;display:flex;align-items:center;justify-content:center;gap:8px;">' +
            '<span style="font-size:20px;">✍️</span>' +
            '<span style="font-size:14px;color:#92400e;">口コミを書くと <strong style="font-size:18px;color:#d97706;">' + GOOGLE_PTS_LABEL + '</strong> 獲得！</span>' +
          '</div>' +
          (GOOGLE_REVIEW_URL
            ? '<button onclick="closeReviewPrompt();copyStoreNameAndOpenReview(GOOGLE_REVIEW_URL);" style="display:block;width:100%;padding:13px;background:#4285F4;color:#fff;font-weight:700;font-size:14px;border-radius:12px;border:none;cursor:pointer;margin-bottom:10px;">📝 口コミを書く（＋' + googlePts + 'P）</button>'
            : '') +
          '<button onclick="closeReviewPrompt()" style="display:block;width:100%;padding:11px;background:transparent;color:#9ca3af;border:1px solid #e5e7eb;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;">あとで</button>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        requestAnimationFrame(function() {
          overlay.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        });
      }

      window.closeReviewPrompt = function() {
        var el = document.getElementById('review-prompt-popup');
        if (!el) return;
        el.style.opacity = '0';
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
      };

      // クーポン配列を生成（earned = 累計P）
      function buildCoupons(earned) {
        // coupon_tiers がある場合は全件使用（複数クーポン対応）
        if (COUPON_TIERS && COUPON_TIERS.length > 0) {
          return COUPON_TIERS.map(function(t) {
            return { title: t.name, required: t.points_required, achieved: earned >= t.points_required };
          });
        }
        // フォールバック: 旧 point_reward_title_1/2 フィールド
        var list = [];
        if (REWARD_TITLE_1) list.push({ title: REWARD_TITLE_1, required: ptThreshold, achieved: earned >= ptThreshold });
        if (REWARD_TITLE_2 && PT_THRESHOLD_2) list.push({ title: REWARD_TITLE_2, required: PT_THRESHOLD_2, achieved: earned >= PT_THRESHOLD_2 });
        return list;
      }

      // クーポン名 → 表示名
      function couponActionName(t) {
        var m = { survey: 'アンケート', google: 'Google口コミ', sns: 'SNS拡散', line: 'LINE連携', visit: '来店' };
        return m[t] || t;
      }

      // ポイントカード描画（今回獲得P + 累計Pのみ — クーポンはモーダルで表示）
      function injectPointCard(earned, balance, threshold, tc, earnedToday, coupons, expiresAtMs) {
        var existing = document.getElementById('loyalty-point-card');
        if (existing) existing.remove();
        // サーバー描画のウォレットサマリーを隠す（JS版に置き換え）
        var ss = document.getElementById('loyalty-wallet-summary');
        if (ss) ss.style.display = 'none';
        var card = document.createElement('div');
        card.id = 'loyalty-point-card';
        var todayHtml = (earnedToday > 0)
          ? '<div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-radius:14px;padding:16px;text-align:center;margin-bottom:12px;">'
            + '<div style="font-size:11px;font-weight:700;color:#065f46;letter-spacing:.08em;margin-bottom:3px;">今回獲得</div>'
            + '<div style="font-size:46px;font-weight:800;color:#059669;line-height:1.1;">＋' + earnedToday + '<span style="font-size:18px;font-weight:600;"> P</span></div>'
            + '</div>'
          : '';
        // ── 有効期限表示 ────────────────────────────────────────────────
        var expiryHtml = '';
        if (POINT_EXPIRY_DAYS > 0 && expiresAtMs) {
          var _ed = new Date(expiresAtMs);
          var _exStr = _ed.getFullYear() + '年' + (_ed.getMonth() + 1) + '月' + _ed.getDate() + '日';
          if (Date.now() > expiresAtMs) {
            expiryHtml = '<div style="font-size:12px;font-weight:700;color:#dc2626;margin-top:4px;padding:6px 10px;background:#fef2f2;border-radius:8px;display:inline-block;">⚠️ 期限切れ: ' + _exStr + '（ポイント失効）</div>';
          } else {
            expiryHtml = '<div style="font-size:12px;color:#6b7280;margin-top:4px;">有効期限: ' + _exStr + 'まで</div>';
          }
        }
        var totalHtml =
          '<div style="text-align:center;padding:14px 0 12px;">'
          + '<div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;margin-bottom:3px;">利用可能ポイント</div>'
          + '<div style="font-size:58px;font-weight:800;color:' + tc + ';line-height:1.05;">' + balance + '<span style="font-size:18px;font-weight:600;"> P</span></div>'
          + expiryHtml
          + '</div>';
        card.innerHTML =
          '<div style="background:#fff;border:2px solid ' + tc + ';border-radius:20px;padding:20px;margin-bottom:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);">'
          + todayHtml + totalHtml
          + '</div>';
        var loyaltyCard = document.querySelector('.loyalty-card');
        if (loyaltyCard) loyaltyCard.insertBefore(card, loyaltyCard.firstChild);
      }

      // クーポン使用 sub-modal（スタッフ提示 → スタッフ確認 → API記録）
      function showUseSubModal(title, parentOv) {
        var sub = document.createElement('div');
        sub.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:100000;padding:24px;box-sizing:border-box;';
        var inner = document.createElement('div');
        inner.style.cssText = 'background:#fff;border-radius:24px;padding:32px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);';

        function renderPresent() {
          inner.innerHTML =
            '<div style="font-size:52px;margin-bottom:10px;">🎁</div>'
            + '<div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:.06em;margin-bottom:6px;">使用するクーポン</div>'
            + '<div style="font-size:20px;font-weight:800;color:#15803d;margin-bottom:16px;">' + title + '</div>'
            + '<div style="background:#f0fdf4;border:2px solid #86efac;border-radius:14px;padding:16px;margin-bottom:18px;">'
            + '<div style="font-size:14px;color:#166534;line-height:1.7;">スタッフにこの画面を<br>ご提示ください</div>'
            + '</div>';
          var staffBtn = document.createElement('button');
          staffBtn.textContent = '✅ スタッフが使用済みにする';
          staffBtn.style.cssText = 'width:100%;padding:14px;background:#16a34a;color:#fff;font-weight:700;font-size:14px;border-radius:12px;border:none;cursor:pointer;margin-bottom:10px;';
          staffBtn.addEventListener('click', function() { doUse(staffBtn); });
          inner.appendChild(staffBtn);
          var closeBtn = document.createElement('button');
          closeBtn.textContent = 'キャンセル';
          closeBtn.style.cssText = 'width:100%;padding:12px;background:transparent;color:#9ca3af;border:1px solid #e5e7eb;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;';
          closeBtn.addEventListener('click', function() { sub.remove(); });
          inner.appendChild(closeBtn);
        }

        async function doUse(btn) {
          btn.disabled = true;
          btn.textContent = '処理中...';
          try {
            var url = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + (SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '');
            var res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'use_loyalty_coupon', coupon_title: title })
            });
            var data = await res.json();
            if (data.ok || data.already_used) {
              // ★ 残高を差し引いた最新値でポイントカードを更新
              if (!data.already_used && data.newBalance != null) {
                injectPointCard(data.newBalance, data.newBalance, ptThreshold, themeColorP, 0, buildCoupons(data.newBalance), null);
              }
              renderDone(data.already_used);
            } else {
              btn.disabled = false;
              btn.textContent = '✅ スタッフが使用済みにする';
              alert(data.error || '処理に失敗しました');
            }
          } catch(e) {
            btn.disabled = false;
            btn.textContent = '✅ スタッフが使用済みにする';
          }
        }

        function renderDone(alreadyUsed) {
          inner.innerHTML =
            '<div style="font-size:52px;margin-bottom:10px;">✅</div>'
            + '<div style="font-size:18px;font-weight:800;color:#1f2937;margin-bottom:8px;">' + (alreadyUsed ? 'すでに使用済みです' : '使用済みにしました') + '</div>'
            + '<div style="font-size:14px;font-weight:700;color:#15803d;margin-bottom:16px;">' + title + '</div>'
            + '<div style="font-size:13px;color:#6b7280;margin-bottom:22px;">ご利用ありがとうございます</div>';
          var doneBtn = document.createElement('button');
          doneBtn.textContent = '閉じる';
          doneBtn.style.cssText = 'width:100%;padding:14px;background:#16a34a;color:#fff;font-weight:700;font-size:15px;border-radius:12px;border:none;cursor:pointer;';
          doneBtn.addEventListener('click', function() { sub.remove(); if (parentOv) parentOv.remove(); });
          inner.appendChild(doneBtn);
        }

        renderPresent();
        sub.appendChild(inner);
        sub.addEventListener('click', function(e) { if (e.target === sub) sub.remove(); });
        document.body.appendChild(sub);
      }

      // クーポンを見るモーダル（APIから最新データ取得）
      window.showCouponModal = async function() {
        var existing = document.getElementById('coupon-modal-ov');
        if (existing) existing.remove();
        var ov = document.createElement('div');
        ov.id = 'coupon-modal-ov';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:flex-end;justify-content:center;z-index:99999;padding:0;box-sizing:border-box;';
        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:22px 22px 0 0;padding:24px 20px 40px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:0 -8px 40px rgba(0,0,0,.2);';
        box.innerHTML = '<div style="text-align:center;padding:20px 0;"><div style="font-size:28px;">⏳</div><div style="font-size:13px;color:#6b7280;margin-top:8px;">読み込み中…</div></div>';
        ov.appendChild(box);
        ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);

        // ヘッダー描画ヘルパ
        function buildHeader() {
          var hdr = document.createElement('div');
          hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';
          var t = document.createElement('div');
          t.textContent = '🎴 ポイントカード';
          t.style.cssText = 'font-size:17px;font-weight:800;color:#1f2937;';
          var x = document.createElement('button');
          x.textContent = '✕';
          x.style.cssText = 'background:none;border:none;font-size:20px;color:#9ca3af;cursor:pointer;padding:4px 8px;line-height:1;';
          x.addEventListener('click', function() { ov.remove(); });
          hdr.appendChild(t); hdr.appendChild(x);
          return hdr;
        }

        // クーポン一覧描画ヘルパ
        function buildCouponList(coupons, earned, usedTitles) {
          var sec = document.createElement('div');

          if (!coupons || coupons.length === 0) {
            var none = document.createElement('div');
            none.style.cssText = 'font-size:13px;color:#9ca3af;text-align:center;padding:12px 0;';
            none.textContent = '特典はまだありません';
            sec.appendChild(none);
            return sec;
          }

          for (var i = 0; i < coupons.length; i++) {
            var c = coupons[i];
            var isUsed = usedTitles && usedTitles.indexOf(c.title) >= 0;
            var cEl = document.createElement('div');
            if (isUsed) {
              cEl.style.cssText = 'background:#f3f4f6;border:1.5px solid #d1d5db;border-radius:14px;padding:14px 16px;margin-bottom:10px;opacity:0.7;';
              cEl.innerHTML =
                '<div style="font-size:14px;font-weight:700;color:#9ca3af;margin-bottom:2px;">✅ ' + c.title + '</div>'
                + '<div style="font-size:12px;color:#9ca3af;">使用済み</div>';
            } else if (c.achieved) {
              cEl.style.cssText = 'background:#f0fdf4;border:2px solid #86efac;border-radius:14px;padding:16px;margin-bottom:10px;';
              var titleDiv = document.createElement('div');
              titleDiv.style.cssText = 'font-size:15px;font-weight:800;color:#15803d;margin-bottom:10px;';
              titleDiv.textContent = '🎁 ' + c.title;
              cEl.appendChild(titleDiv);
              var useBtn = document.createElement('button');
              useBtn.textContent = 'このクーポンを使う';
              useBtn.style.cssText = 'width:100%;padding:12px;background:#16a34a;color:#fff;font-weight:700;font-size:14px;border-radius:10px;border:none;cursor:pointer;letter-spacing:.02em;';
              useBtn.addEventListener('click', (function(ctitle) {
                return function() { showUseSubModal(ctitle, ov); };
              })(c.title));
              cEl.appendChild(useBtn);
            } else {
              cEl.style.cssText = 'background:#fafafa;border:1.5px solid #e5e7eb;border-radius:14px;padding:14px;margin-bottom:10px;';
              cEl.innerHTML =
                '<div style="font-size:14px;font-weight:700;color:#9ca3af;margin-bottom:4px;">🎁 ' + c.title + '</div>'
                + '<div style="font-size:12px;color:#d97706;font-weight:600;">あと ' + Math.max(0, c.required - earned) + 'P で使用可能（目標 ' + c.required + 'P）</div>';
            }
            sec.appendChild(cEl);
          }
          return sec;
        }

        try {
          var sidPart = SUBMISSION_ID ? '&sid=' + encodeURIComponent(SUBMISSION_ID) : '';
          var checkUrl = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + sidPart + '&action=check_wallet';
          var res = await fetch(checkUrl);
          var data = await res.json();

          box.innerHTML = '';
          box.appendChild(buildHeader());

          if (!data.ready) {
            // ── LINE未連携: LINEボタン + クーポン情報 ──
            var _pollStatus = document.createElement('p');
            _pollStatus.style.cssText = 'font-size:13px;color:#6b7280;text-align:center;margin:0 0 14px;min-height:18px;';
            _pollStatus.textContent = 'LINEと連携するとポイントが貯まります';

            if (LINE_LIFF_URL) {
              var _lineConnBtn = document.createElement('a');
              _lineConnBtn.href = LINE_LIFF_URL;
              _lineConnBtn.target = '_blank';
              _lineConnBtn.rel = 'noopener';
              _lineConnBtn.style.cssText = 'display:block;padding:16px;background:#06C755;color:#fff;font-weight:800;font-size:15px;border-radius:14px;text-align:center;text-decoration:none;margin-bottom:10px;box-shadow:0 4px 14px rgba(6,199,85,.3);letter-spacing:.02em;';
              _lineConnBtn.textContent = '📲 LINEでポイントを連携する';
              _lineConnBtn.addEventListener('click', function() {
                _pollStatus.textContent = '🔄 LINE連携を確認中…';
                _lineConnBtn.style.opacity = '0.6';
                _lineConnBtn.style.pointerEvents = 'none';
                var _tries = 0;
                var _pollTimer = setInterval(async function() {
                  _tries++;
                  if (_tries > 40 || !document.getElementById('coupon-modal-ov')) {
                    clearInterval(_pollTimer);
                    if (_tries > 40) {
                      _pollStatus.textContent = '⚠️ 確認できませんでした。もう一度タップしてください。';
                      _lineConnBtn.style.opacity = '1';
                      _lineConnBtn.style.pointerEvents = 'auto';
                    }
                    return;
                  }
                  try {
                    var _pr = await fetch(checkUrl);
                    var _pd = await _pr.json();
                    if (_pd.ready) {
                      clearInterval(_pollTimer);
                      // LINE連携完了: モーダルを最新データで再描画
                      window.showCouponModal();
                    }
                  } catch(e) {}
                }, 3000);
              });
              box.appendChild(_lineConnBtn);
            }

            box.appendChild(_pollStatus);
            box.appendChild(buildCouponList(buildCoupons(0), 0, []));
          } else {
            var earned = data.total_earned || 0;
            var bal = data.balance != null ? data.balance : earned;
            var coupons = (data.coupons && data.coupons.length > 0) ? data.coupons : buildCoupons(bal);
            var recent = data.recent_additions || [];
            var usedTitles = data.used_coupon_titles || [];

            // 利用可能ポイント
            var ptBlock = document.createElement('div');
            ptBlock.style.cssText = 'background:#fff;border:2px solid ' + themeColorP + ';border-radius:18px;padding:20px;text-align:center;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);';
            ptBlock.innerHTML =
              '<div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;margin-bottom:4px;">利用可能ポイント</div>'
              + '<div style="font-size:64px;font-weight:800;color:' + themeColorP + ';line-height:1.0;">' + bal + '<span style="font-size:20px;font-weight:600;"> P</span></div>';
            box.appendChild(ptBlock);

            // 前回の加算
            if (recent.length > 0) {
              var last = recent[0];
              var dt = new Date(last.created_at);
              var dStr = dt.getFullYear() + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0')
                + ' ' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
              var recentBlock = document.createElement('div');
              recentBlock.style.cssText = 'background:#f8fafc;border-radius:12px;padding:14px 16px;margin-bottom:16px;';
              recentBlock.innerHTML =
                '<div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.06em;margin-bottom:6px;">前回の加算</div>'
                + '<div style="display:flex;justify-content:space-between;align-items:center;">'
                + '<div style="font-size:16px;font-weight:800;color:#059669;">＋' + last.points_delta + 'P <span style="font-size:12px;font-weight:600;color:#6b7280;">（' + couponActionName(last.action_type) + '）</span></div>'
                + '<div style="font-size:12px;color:#9ca3af;">' + dStr + '</div>'
                + '</div>';
              box.appendChild(recentBlock);
            }

            box.appendChild(buildCouponList(coupons, bal, usedTitles));
          }
        } catch(e) {
          box.innerHTML = '';
          box.appendChild(buildHeader());
          var errDiv = document.createElement('div');
          errDiv.style.cssText = 'text-align:center;padding:24px 0;';
          errDiv.innerHTML = '<div style="font-size:32px;">⚠️</div>'
            + '<div style="font-size:14px;color:#dc2626;margin-top:8px;">データの取得に失敗しました</div>';
          box.appendChild(errDiv);
          // ローカル変数でフォールバック表示
          box.appendChild(buildCouponList(buildCoupons(0), 0, []));
        }
      };

      // ── ポイントを確認するボタン（href がウォレットページ URL を指すため click リスナー不要）──
      var couponViewBtn = document.getElementById('coupon-view-btn');
      // ※ e.preventDefault() + showCouponModal() は廃止。リンクの href に従って直接ウォレットページへ遷移する。

      // ── LINE連携済みの場合、ポイント確認ボタンを「確認済み」表示に ──
      // LINE_ALREADY_FOLLOWED は IIFE先頭で定義済み（再代入不要だが明示的に確認）
      var WALLET_ALREADY_SHOWN = ${walletData ? "true" : "false"};
      if (LINE_ALREADY_FOLLOWED) {
        // LINE連携済み: ポイントカードがすでに発行済みを示す
        if (couponViewBtn && !WALLET_ALREADY_SHOWN) {
          couponViewBtn.style.background = '#16a34a';
        }
        if (bonusMsg) { bonusMsg.style.color = '#16a34a'; bonusMsg.textContent = '✅ ポイントカード発行済み'; }
        try { localStorage.removeItem('fe_line_' + STORE_ID); } catch(ex) {}
      }

      // ── リアルタイムポイント更新（初回即時 + 30秒ポーリング）─────────
      // LINE連携済みかつ sid がある場合のみ動作
      if (LINE_ALREADY_FOLLOWED && SUBMISSION_ID) {
        var _ptPollTimer = null;
        var _ptPollCheckUrl = API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + '&sid=' + encodeURIComponent(SUBMISSION_ID) + '&action=check_wallet';
        // ★ 初回即時実行（アンケートポイントをページ表示直後にすぐ反映）
        (async function() {
          try {
            var _pr = await fetch(_ptPollCheckUrl + '&_nc=' + Date.now());
            var _pd = await _pr.json();
            if (_pd.ready && _pd.balance != null) {
              var _pollExMs = _pd.expires_at ? new Date(_pd.expires_at).getTime() : null;
              injectPointCard(_pd.total_earned, _pd.balance, ptThreshold, themeColorP, 0, buildCoupons(_pd.balance), _pollExMs);
            }
          } catch(e) {}
        })();
        // ★ 以降は30秒ごとに更新
        _ptPollTimer = setInterval(async function() {
          if (document.hidden) return; // バックグラウンド時はスキップ
          try {
            var _pr = await fetch(_ptPollCheckUrl + '&_nc=' + Date.now());
            var _pd = await _pr.json();
            if (_pd.ready && _pd.balance != null) {
              var _pollExMs2 = _pd.expires_at ? new Date(_pd.expires_at).getTime() : null;
              injectPointCard(_pd.total_earned, _pd.balance, ptThreshold, themeColorP, 0, buildCoupons(_pd.balance), _pollExMs2);
            }
          } catch(e) {}
        }, 30000); // 30秒ごと
        // ページ離脱時にポーリング停止
        window.addEventListener('pagehide', function() { clearInterval(_ptPollTimer); });
      }
    })();
    // ── ロイヤルティ電話番号登録 ──
    window.loyaltyRegisterPhone = async function() {
      var input = document.getElementById('loyalty-phone');
      var msg = document.getElementById('loyalty-phone-msg');
      var btn = document.querySelector('#phone-register-form button');
      if (!input || !msg) return;
      var phone = input.value.replace(/[^\d]/g, '');
      if (phone.length < 10) {
        msg.style.color = '#ef4444';
        msg.textContent = '正しい電話番号を入力してください';
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }
      msg.style.color = '#6b7280';
      msg.textContent = '登録中...';
      try {
        var api = window.location.origin + '/functions/v1/form-engine';
        var res = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'register_phone', review_id: ${JSON.stringify(review.id)}, phone: input.value.trim() })
        });
        var data = await res.json();
        if (data.ok) {
          msg.style.color = '#16a34a';
          msg.textContent = data.skipped
            ? '✅ すでに登録済みです'
            : '✅ 登録完了！ポイントが加算されました（累計 ' + (data.total_points ?? '') + 'P）';
          input.disabled = true;
          if (btn) { btn.disabled = true; btn.textContent = '登録済み'; }
        } else {
          msg.style.color = '#ef4444';
          msg.textContent = '登録に失敗しました: ' + (data.error ?? '不明なエラー');
          if (btn) { btn.disabled = false; btn.textContent = '登録する'; }
        }
      } catch(e) {
        msg.style.color = '#ef4444';
        msg.textContent = '通信エラーが発生しました';
        if (btn) { btn.disabled = false; btn.textContent = '登録する'; }
      }
    };
  </script>

  <!-- ポイントカードポップアップ -->
  ${(() => {
    const closeJs = `var _po=document.getElementById('pts-popup-overlay');if(_po){_po.style.opacity='0';_po.style.display='none';}var el=document.querySelector('.card');if(el){el.scrollIntoView({behavior:'smooth'});}`;

    // ── 再来店ユーザー（LINE連携済み・過去ポイントあり）──────────────
    if (walletData && walletData.total_earned > surveyPoints) {
      return `
  <div id="pts-popup-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:none;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity 0.35s;" onclick="${closeJs}">
    <div style="background:#fff;border-radius:22px;padding:24px 20px 20px;max-width:340px;width:100%;box-shadow:0 12px 48px rgba(0,0,0,0.22);transform:translateY(24px);transition:transform 0.35s;text-align:center;" onclick="event.stopPropagation();" id="pts-popup-card">
      <!-- ★ アンケートポイント強調 -->
      <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:2px solid #6ee7b7;border-radius:18px;padding:18px 16px 14px;text-align:center;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:#065f46;letter-spacing:.09em;margin-bottom:4px;">🎉 アンケート回答完了</div>
        <div style="font-size:76px;font-weight:900;color:#059669;line-height:1;letter-spacing:-.02em;">＋${surveyPoints}P</div>
        <div style="font-size:13px;font-weight:700;color:#065f46;margin-top:6px;">獲得しました！</div>
      </div>
      <!-- 残高 -->
      <div style="background:#f8fafc;border-radius:12px;padding:10px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:#6b7280;font-weight:600;">現在の利用可能残高</span>
        <span style="font-size:20px;font-weight:800;color:${themeColor};">${walletData.balance}P</span>
      </div>
      <!-- 口コミヒント -->
      <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:8px 14px;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">✍️</span>
        <span style="font-size:13px;color:#92400e;text-align:left;">口コミ投稿で <strong style="color:#d97706;">＋${googlePoints}P</strong> 獲得！</span>
      </div>
      <button onclick="${closeJs}" style="display:block;width:100%;padding:14px;background:${themeColor};color:#fff;border:none;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;">
        口コミを生成する →
      </button>
    </div>
  </div>
  <script>
    (function() {
      var _svKey = 'fe_sv_' + SUBMISSION_ID;
      try { if (sessionStorage.getItem(_svKey)) return; sessionStorage.setItem(_svKey, '1'); } catch(e) {}
      setTimeout(function() {
        var o = document.getElementById('pts-popup-overlay');
        var c = document.getElementById('pts-popup-card');
        if (o) { o.style.display = 'flex'; requestAnimationFrame(function(){ o.style.opacity = '1'; if(c) c.style.transform = 'translateY(0)'; }); }
      }, 600);
    })();
  </script>`;
    }

    // ── 初回 / LINE未連携ユーザー → スタンプカードポップアップ ────────
    const stampTotal = Math.min(Math.max(pointThreshold, 1), 20);
    const filledRaw = walletData ? walletData.balance : surveyPoints;
    const stampFilled = Math.min(filledRaw, stampTotal);
    // ハンコ（スタンプ）スタイルの格子
    const stamps = Array.from({ length: stampTotal }, (_, i) => {
      const filled = i < stampFilled;
      const isGoal = i === stampTotal - 1;
      const innerHtml = filled
        ? `<div style="width:30px;height:30px;border-radius:50%;background:${themeColor};display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;font-weight:900;box-shadow:0 2px 8px rgba(0,0,0,0.2);">✓</div>`
        : `<div style="width:28px;height:28px;border-radius:50%;border:1.5px dashed ${isGoal ? themeColor : '#d1d5db'};"></div>`;
      const goalBadge = isGoal
        ? `<div style="position:absolute;top:-6px;right:-6px;background:${filled ? themeColor : '#f59e0b'};color:#fff;font-size:8px;font-weight:800;border-radius:999px;padding:1px 4px;border:1.5px solid #fff;line-height:1.4;">🎁</div>`
        : "";
      return `<div style="width:40px;height:40px;border:2px ${filled ? "solid" : "dashed"} ${filled ? themeColor : (isGoal ? themeColor : "#d1d5db")};border-radius:8px;background:${filled ? "#fff" : "#fafafa"};display:flex;align-items:center;justify-content:center;position:relative;">${innerHtml}${goalBadge}</div>`;
    }).join("");
    const couponRows = (() => {
      const rawT = Array.isArray(store.coupon_tiers) && (store.coupon_tiers as unknown[]).length > 0
        ? (store.coupon_tiers as { name: string; points_required: number }[])
        : (() => {
            const list: { name: string; points_required: number }[] = [];
            if (rewardTitle1) list.push({ name: rewardTitle1, points_required: pointThreshold });
            if (rewardTitle2 && pointThreshold2) list.push({ name: rewardTitle2, points_required: pointThreshold2 });
            return list;
          })();
      const popupEarned = walletData ? walletData.balance : surveyPoints;
      return rawT.map((c) => {
        const popupRemain = Math.max(0, c.points_required - popupEarned);
        const popupAchieved = popupEarned >= c.points_required;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:${popupAchieved ? '#dcfce7' : '#f9fafb'};border-radius:8px;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;color:#374151;">🎁 ${escAttr(c.name)}</span>
          <span style="font-size:12px;font-weight:800;color:${popupAchieved ? '#16a34a' : themeColor};background:${popupAchieved ? '#dcfce7' : '#eff6ff'};padding:2px 10px;border-radius:999px;">${popupAchieved ? '達成 ✅' : `あと${popupRemain}pt！`}</span>
        </div>`;
      }).join("");
    })();
    const earnedLabel = walletData
      ? `残高 <strong style="color:${themeColor};font-size:22px;">${walletData.balance}P</strong>`
      : `今回 <strong style="color:${themeColor};font-size:22px;">＋${surveyPoints}P</strong>`;
    return `
  <div id="pts-popup-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:none;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity 0.35s;" onclick="${closeJs}">
    <div style="background:#fff;border-radius:22px;padding:24px 20px 20px;max-width:340px;width:100%;box-shadow:0 12px 48px rgba(0,0,0,0.22);transform:translateY(24px);transition:transform 0.35s;" onclick="event.stopPropagation();" id="pts-popup-card">
      ${hasLineBot && !walletData ? `
      <!-- ★ アンケートポイント強調（LINE未連携） -->
      <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:2px solid #6ee7b7;border-radius:18px;padding:18px 16px 14px;text-align:center;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:#065f46;letter-spacing:.09em;margin-bottom:4px;">🎉 アンケート回答完了</div>
        <div style="font-size:76px;font-weight:900;color:#059669;line-height:1;letter-spacing:-.02em;">＋${surveyPoints}P</div>
        <div style="font-size:13px;font-weight:700;color:#065f46;margin-top:6px;">獲得しました！</div>
      </div>
      <div style="text-align:center;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:800;color:#1f2937;margin-bottom:4px;">📲 LINEでポイントを保存する</div>
        <div style="font-size:12px;color:#6b7280;line-height:1.6;">友達追加するとポイントが保存され、<br>次回来店でもクーポンと交換できます。</div>
      </div>
      ${couponRows ? `<div style="margin-bottom:12px;">${couponRows}</div>` : ""}
      <a href="${lineAddFriendUrl}" target="_blank" rel="noopener" style="display:block;width:100%;padding:15px;background:#06C755;color:#fff;border-radius:14px;font-weight:800;font-size:16px;text-align:center;text-decoration:none;box-sizing:border-box;margin-bottom:10px;box-shadow:0 4px 14px rgba(6,199,85,.3);">
        📲 LINE友達追加してポイントを保存
      </a>
      <button onclick="${closeJs}" style="display:block;width:100%;padding:12px;background:transparent;color:#9ca3af;border:1px solid #e5e7eb;border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;">
        ✅ すでに友達追加済みの方 → 口コミを見る
      </button>
      ` : `
      <!-- ★ アンケートポイント強調（LINE連携済み） -->
      <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:2px solid #6ee7b7;border-radius:18px;padding:18px 16px 14px;text-align:center;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:#065f46;letter-spacing:.09em;margin-bottom:4px;">🎉 アンケート回答完了</div>
        <div style="font-size:76px;font-weight:900;color:#059669;line-height:1;letter-spacing:-.02em;">＋${surveyPoints}P</div>
        <div style="font-size:13px;font-weight:700;color:#065f46;margin-top:6px;">獲得しました！</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,40px);gap:6px;justify-content:center;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
        ${stamps}
      </div>
      <div style="margin-bottom:12px;">${couponRows || '<div style="text-align:center;font-size:12px;color:#9ca3af;">特典はまだ設定されていません</div>'}</div>
      <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:8px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🎁</span>
        <span style="font-size:13px;color:#92400e;">口コミ投稿で <strong style="font-size:15px;color:#d97706;">＋${googlePoints}P</strong> 獲得！</span>
      </div>
      <button onclick="${closeJs}" style="display:block;width:100%;padding:14px;background:${themeColor};color:#fff;border:none;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;">
        閉じる
      </button>
      `}
    </div>
  </div>
  <script>
    (function() {
      var _svKey = 'fe_sv_' + SUBMISSION_ID;
      try { if (sessionStorage.getItem(_svKey)) return; sessionStorage.setItem(_svKey, '1'); } catch(e) {}
      setTimeout(function() {
        var o = document.getElementById('pts-popup-overlay');
        var c = document.getElementById('pts-popup-card');
        if (o) { o.style.display = 'flex'; requestAnimationFrame(function(){ o.style.opacity = '1'; if(c) c.style.transform = 'translateY(0)'; }); }
      }, 600);
    })();
  </script>`;
  })()}
</body>
</html>`;
}

// ========== メイン ==========
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(null) });

  // supabase.co URL からのGETアクセスはカスタムドメインへリダイレクト
  // Edge Function 内からはドメインを判別できないため _nc=1 センチネルで無限ループを防ぐ
  // action パラメータ付き（check_wallet等）は API コールなのでリダイレクト対象外
  const customDomainBase = (Deno.env.get("FORM_ENGINE_BASE_URL") ?? "").replace(/\/$/, "");
  if (req.method === "GET" && customDomainBase) {
    const reqUrl = new URL(req.url);
    const ncParam = reqUrl.searchParams.get("_nc");
    const actionCheck = reqUrl.searchParams.get("action");
    const liffLinkCheck = reqUrl.searchParams.get("liff_link"); // LIFF ページはリダイレクト対象外
    // wallet_check も LIFF ページなのでリダイレクト対象外（liff.state 内も考慮）
    let walletCheckSkip = reqUrl.searchParams.get("wallet_check");
    if (!walletCheckSkip) {
      const _lsRaw = reqUrl.searchParams.get("liff.state");
      if (_lsRaw) {
        try {
          const _lsDec = _lsRaw.startsWith("?") ? _lsRaw.slice(1) : _lsRaw;
          walletCheckSkip = new URLSearchParams(_lsDec).get("wallet_check");
        } catch (_) {}
      }
    }
    if (!ncParam && !actionCheck && !liffLinkCheck && !walletCheckSkip) {
      const redirectParams = new URLSearchParams();
      reqUrl.searchParams.forEach((v, k) => { if (k !== "_nc") redirectParams.set(k, v); });
      redirectParams.set("_nc", "1");
      const redirectUrl = `${customDomainBase}/form-engine?${redirectParams.toString()}`;
      return new Response(null, {
        status: 302,
        headers: { "Location": redirectUrl, "Cache-Control": "no-store, no-cache" },
      });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
  const url = new URL(req.url);
  const storeId = url.searchParams.get("store_id")?.trim();
  const sidParam = url.searchParams.get("sid")?.trim();
  const actionParam = url.searchParams.get("action")?.trim();

  // ---------- liff.state 解析（LIFF認証リダイレクト後にパラメーターが liff.state に移動する）----------
  let _liffStateParams: URLSearchParams | null = null;
  const _rawLiffState = url.searchParams.get("liff.state");
  if (_rawLiffState) {
    try {
      const _decoded = _rawLiffState.startsWith("?") ? _rawLiffState.slice(1) : _rawLiffState;
      _liffStateParams = new URLSearchParams(_decoded);
    } catch(_e) {}
  }
  const _p = (key: string) => url.searchParams.get(key) || _liffStateParams?.get(key) || null;

  // ---------- GET: LIFF リンクページ（LINE友達ID自動取得 → レビュー紐付け）----------
  if (req.method === "GET" && (_p("liff_link") === "1")) {
    const liffReviewId = (_p("review_id") ?? "").trim();
    const liffStoreId  = (_p("store_id") ?? storeId ?? "").trim();
    // LIFF ID を store_line_credentials / store_profiles から取得
    const { data: liffCredsRow } = await supabase
      .from("store_line_credentials").select("line_liff_id").eq("store_id", liffStoreId).maybeSingle();
    const { data: liffStoreRow } = await supabase
      .from("store_profiles").select("line_liff_id").eq("store_id", liffStoreId).maybeSingle();
    const liffAppId = ((liffCredsRow as { line_liff_id?: string } | null)?.line_liff_id
      || (liffStoreRow as { line_liff_id?: string } | null)?.line_liff_id || "").trim();
    const apiOrigin = new URL(req.url).origin;
    const resultBase2 = customDomainBase || `${apiOrigin}/functions/v1`;
    const liffHtml = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ポイント登録中...</title>
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/versions/2.22.3/sdk.js"></script>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0fdf4;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;}.wrap{max-width:320px;}.icon{font-size:52px;margin-bottom:16px;}.title{font-size:18px;font-weight:800;color:#1f2937;margin-bottom:8px;}.sub{font-size:13px;color:#6b7280;line-height:1.6;}</style>
</head><body>
<div class="wrap"><div class="icon" id="icon">⏳</div><div class="title" id="title">ポイントを登録中…</div><div class="sub" id="sub">少々お待ちください</div></div>
<script>
var REVIEW_ID=${JSON.stringify(liffReviewId)};
var STORE_ID=${JSON.stringify(liffStoreId)};
var LIFF_ID=${JSON.stringify(liffAppId)};
var API_URL=${JSON.stringify(resultBase2+"/form-engine")};
function setUI(ic,ti,sb){document.getElementById("icon").textContent=ic;document.getElementById("title").textContent=ti;document.getElementById("sub").textContent=sb||"";}
liff.init({liffId:LIFF_ID}).then(async function(){
  if(!liff.isLoggedIn()){liff.login({redirectUri:window.location.href});return;}
  try{
    var prof=await liff.getProfile();
    var uid=prof.userId;
    var res=await fetch(API_URL+"?store_id="+encodeURIComponent(STORE_ID),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"liff_link_review",review_id:REVIEW_ID,line_user_id:uid})});
    var data=await res.json();
    if(data.ok||data.already_linked){
      if(data.wallet_url){
        setUI("✅","ポイントカードを確認中…","そのまましばらくお待ちください");
        setTimeout(function(){
          try{
            // LIFF 内外いずれでも window.location.href で遷移を試みる
            window.location.href=data.wallet_url;
          }catch(e){
            // フォールバック: LINE 内ブラウザで外部 URL として開く
            try{liff.openWindow({url:data.wallet_url,external:true});}catch(e2){}
          }
        },600);
      }else{
        // wallet_url がない場合のみ「URLが届きます」表示（フォールバック）
        setUI("✅","ポイントカードを発行しました！","LINEにURLが届きます。タップしてご確認ください");
        setTimeout(function(){try{liff.closeWindow();}catch(e){}},2500);
      }
    }else{setUI("⚠️","エラーが発生しました",data.error||"もう一度お試しください");}
  }catch(e){setUI("❌","エラー",e.message||"通信に失敗しました");}
}).catch(function(err){setUI("❌","初期化エラー",err.message||"LIFF初期化に失敗しました");});
</script>
</body></html>`;
    return createHtmlResponse(liffHtml);
  }

  // ---------- GET: ウォレット直接アクセス用 LIFF ページ（QR → LINE認証 → ウォレットへ）----------
  if (req.method === "GET" && (_p("wallet_check") === "1")) {
    const wcStoreId = (_p("store_id") ?? storeId ?? "").trim();
    const { data: wcCredsRow } = await supabase
      .from("store_line_credentials").select("line_liff_id").eq("store_id", wcStoreId).maybeSingle();
    const { data: wcStoreRow } = await supabase
      .from("store_profiles").select("line_liff_id, store_name_jp").eq("store_id", wcStoreId).maybeSingle();
    const wcLiffId = ((wcCredsRow as { line_liff_id?: string } | null)?.line_liff_id
      || (wcStoreRow as { line_liff_id?: string } | null)?.line_liff_id || "").trim();
    const wcStoreName = (wcStoreRow as { store_name_jp?: string } | null)?.store_name_jp ?? "お店";
    const wcApiOrigin = new URL(req.url).origin;
    const wcApiBase = customDomainBase || `${wcApiOrigin}/functions/v1`;
    const wcHtml = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${wcStoreName} ポイントカード</title>
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/versions/2.22.3/sdk.js"></script>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0fdf4;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;}.wrap{max-width:320px;}.icon{font-size:52px;margin-bottom:16px;}.title{font-size:18px;font-weight:800;color:#1f2937;margin-bottom:8px;}.sub{font-size:13px;color:#6b7280;line-height:1.6;}</style>
</head><body>
<div class="wrap"><div class="icon" id="icon">⏳</div><div class="title" id="title">ポイントカードを確認中…</div><div class="sub" id="sub">少々お待ちください</div></div>
<script>
var STORE_ID=${JSON.stringify(wcStoreId)};
var LIFF_ID=${JSON.stringify(wcLiffId)};
var API_URL=${JSON.stringify(wcApiBase+"/form-engine")};
function setUI(ic,ti,sb){document.getElementById("icon").textContent=ic;document.getElementById("title").textContent=ti;document.getElementById("sub").textContent=sb||"";}
liff.init({liffId:LIFF_ID}).then(async function(){
  if(!liff.isLoggedIn()){liff.login({redirectUri:window.location.href});return;}
  try{
    var prof=await liff.getProfile();
    var uid=prof.userId;
    var res=await fetch(API_URL+"?store_id="+encodeURIComponent(STORE_ID),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"wallet_check_redirect",line_user_id:uid,store_id:STORE_ID})});
    var data=await res.json();
    if(data.wallet_url){
      setUI("✅","ポイントカードを表示します","そのまましばらくお待ちください");
      setTimeout(function(){
        try{window.location.href=data.wallet_url;}catch(e){
          try{liff.openWindow({url:data.wallet_url,external:true});}catch(e2){}
        }
      },400);
    }else if(data.survey_url){
      setUI("📝","アンケートへご案内します","初回はアンケートへのご回答をお願いします");
      setTimeout(function(){
        try{window.location.href=data.survey_url;}catch(e){
          try{liff.openWindow({url:data.survey_url,external:true});}catch(e2){}
        }
      },1200);
    }else{
      setUI("⚠️","見つかりませんでした",data.error||"スタッフにお声がけください");
    }
  }catch(e){setUI("❌","エラー",e.message||"通信に失敗しました");}
}).catch(function(err){setUI("❌","初期化エラー",err.message||"LIFF初期化に失敗しました");});
</script>
</body></html>`;
    return createHtmlResponse(wcHtml);
  }

  // ---------- GET: ポイントウォレット確認（ポーリング用） ----------
  if (req.method === "GET" && actionParam === "check_wallet" && storeId && sidParam) {
    const { data: rev } = await supabase
      .from("reviews")
      .select("line_user_id, store_id")
      .eq("submission_id", sidParam)
      .eq("store_id", storeId)
      .maybeSingle();
    if (!rev) {
      return new Response(JSON.stringify({ ready: false }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
    }
    const { data: st } = await supabase.from("store_profiles").select("points_scope, chain_id, point_threshold, point_threshold_2, point_reward_title_1, point_reward_title_2, point_rule_survey, point_rule_google, coupon_tiers, point_expiry_days").eq("store_id", rev.store_id).maybeSingle();
    const scopeType = ((st as Record<string,unknown>)?.points_scope as string) === "chain" && (st as Record<string,unknown>)?.chain_id ? "chain" : "store";
    const scopeId = scopeType === "chain" ? String((st as Record<string,unknown>).chain_id) : rev.store_id;
    // identity 解決: line_user_id → 直接 / anon → ledger.source_ref で逆引き
    let identity: { id: string } | null = null;
    if (rev.line_user_id) {
      const { data: idByLine } = await supabase.from("customer_identity").select("id").eq("line_user_id", rev.line_user_id).maybeSingle();
      identity = idByLine;
    }
    if (!identity) {
      // ★ Bug fix: store_id フィルタを追加して他店舗のSIDが混入しないようにする
      const { data: ledgerForCw } = await supabase.from("customer_points_ledger").select("identity_id").eq("source_ref", sidParam).eq("store_id", rev.store_id).limit(1).maybeSingle();
      if (ledgerForCw?.identity_id) identity = { id: ledgerForCw.identity_id as string };
    }
    if (!identity) {
      return new Response(JSON.stringify({ ready: false }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
    }
    // ウォレットテーブルから total_spent のみ取得（残高はレジャーから再集計）
    // wallet がなくても total_spent=0 で続行（page.tsx と同一ロジック）
    const { data: wallet } = await supabase.from("customer_points_wallet").select("total_spent").eq("identity_id", identity.id).eq("scope_type", scopeType).eq("scope_id", scopeId).maybeSingle();
    // レジャーから獲得ポイントを集計（ウォレットページ・結果ページと同一ロジック）
    const { data: ledgerRowsCw } = await supabase
      .from("customer_points_ledger")
      .select("points_delta, created_at")
      .eq("identity_id", identity.id)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .gt("points_delta", 0);
    const teFromLedger = (ledgerRowsCw ?? []).reduce(
      (sum: number, r: Record<string, unknown>) => sum + Number(r.points_delta ?? 0), 0
    );
    // 有効期限計算（point_expiry_days > 0 の場合のみ）
    const pointExpiryDaysCw = Number((st as Record<string,unknown>)?.point_expiry_days ?? 0);
    let expiresAtCw: string | null = null;
    if (pointExpiryDaysCw > 0 && (ledgerRowsCw ?? []).length > 0) {
      // 最新の獲得日から expiry 日数後を期限とする（ローリング方式）
      const latestCreatedAt = (ledgerRowsCw ?? [])
        .map((r: Record<string,unknown>) => String(r.created_at ?? ""))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
      if (latestCreatedAt) {
        const expiryMs = new Date(latestCreatedAt).getTime() + pointExpiryDaysCw * 24 * 60 * 60 * 1000;
        expiresAtCw = new Date(expiryMs).toISOString();
      }
    }
    // totalSpentCw / balanceFromLedger は redeemHistoryCw 取得後に計算
    // （wallet.total_spent は競合で乖離するため使わない — sync/route.ts と同一ロジック）
    let totalSpentCw = 0;
    let balanceFromLedger = 0;
    // 最近の獲得ポイント履歴（最新50件）
    const { data: recentLedger } = await supabase
      .from("customer_points_ledger")
      .select("action_type, points_delta, created_at")
      .eq("identity_id", identity.id)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .order("created_at", { ascending: false })
      .limit(50);
    // クーポン使用履歴（points_redemption）— scope フィルタで他店舗の履歴を除外
    // ★ H1 fix: limit(50)を削除（50件超のユーザーでtotalSpentが過小計算されバランス不正になるバグを修正）
    // mergedRecentCw の .slice(0, 50) で表示件数は引き続き制限される
    const { data: redeemHistoryCw } = await supabase
      .from("points_redemption")
      .select("spent_points, used_at")
      .eq("identity_id", identity.id)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .eq("status", "used")
      .gt("spent_points", 0)
      .order("used_at", { ascending: false });
    // ★ Bug fix: wallet.total_spent ではなく points_redemption から残高を再集計（sync/route.ts と同一ロジック）
    totalSpentCw = (redeemHistoryCw ?? []).reduce(
      (s: number, r: Record<string,unknown>) => s + Number(r.spent_points ?? 0), 0
    );
    balanceFromLedger = Math.max(0, teFromLedger - totalSpentCw);
    const redeemItemsCw = (redeemHistoryCw ?? []).map((r: Record<string,unknown>) => ({
      action_type: "redeem",
      points_delta: -Number(r.spent_points ?? 0),
      created_at: String(r.used_at ?? ""),
    }));
    // 獲得＋使用をマージして日時降順ソート
    const mergedRecentCw = [...(recentLedger ?? []), ...redeemItemsCw]
      .sort((a: Record<string,unknown>, b: Record<string,unknown>) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      )
      .slice(0, 50);
    // 使用済みクーポンを「今日（JST）」だけで判定 → 翌日に自動リセット
    const jstMidnightCw = new Date(
      Math.floor((Date.now() + 9 * 3600 * 1000) / 86400000) * 86400000 - 9 * 3600 * 1000
    );
    const { data: legacyRedemptions } = await supabase
      .from("points_redemption")
      .select("metadata, status, created_at")
      .eq("identity_id", identity.id)
      .eq("store_id", storeId)
      .is("reward_id", null)
      .eq("status", "used")
      .gte("used_at", jstMidnightCw.toISOString())
      .order("created_at", { ascending: false });
    const legacyUsedTitles: string[] = (legacyRedemptions ?? [])
      .map((r: Record<string,unknown>) => {
        const meta = r.metadata as Record<string,unknown> | null;
        return (meta?.coupon_title as string) ?? "";
      })
      .filter(Boolean);

    // reward_id あり → store_point_rewards から reward_title を引く（今日のみ）
    const { data: newRedemptions } = await supabase
      .from("points_redemption")
      .select("reward_id")
      .eq("identity_id", identity.id)
      .eq("store_id", storeId)
      .not("reward_id", "is", null)
      .eq("status", "used")
      .gte("used_at", jstMidnightCw.toISOString());
    let newUsedTitles: string[] = [];
    if ((newRedemptions ?? []).length > 0) {
      const rwdIds = [...new Set((newRedemptions ?? []).map((r: Record<string,unknown>) => String(r.reward_id)))];
      const { data: rwdRows } = await supabase
        .from("store_point_rewards")
        .select("id, reward_title")
        .in("id", rwdIds);
      const rwdMap = new Map((rwdRows ?? []).map((r: Record<string,unknown>) => [String(r.id), String(r.reward_title ?? "")]));
      newUsedTitles = (newRedemptions ?? [])
        .map((r: Record<string,unknown>) => rwdMap.get(String(r.reward_id)) ?? "")
        .filter(Boolean);
    }
    const usedCouponTitles: string[] = [...legacyUsedTitles, ...newUsedTitles];
    const ptT1 = Number((st as Record<string,unknown>)?.point_threshold ?? 4);
    const ptT2 = (st as Record<string,unknown>)?.point_threshold_2 != null ? Number((st as Record<string,unknown>).point_threshold_2) : null;
    const tt1 = ((st as Record<string,unknown>)?.point_reward_title_1 as string)?.trim() || "クーポン";
    const tt2 = ((st as Record<string,unknown>)?.point_reward_title_2 as string)?.trim() || null;
    const te = teFromLedger;
    // coupon_tiers 優先（複数クーポン対応）、なければ legacy 2 フィールド
    const rawTiers = Array.isArray((st as Record<string,unknown>)?.coupon_tiers) && ((st as Record<string,unknown>).coupon_tiers as unknown[]).length > 0
      ? ((st as Record<string,unknown>).coupon_tiers as { name: string; points_required: number }[])
      : null;
    const couponsData: {title:string;required:number;achieved:boolean}[] = rawTiers
      ? rawTiers.map((t) => ({ title: t.name, required: t.points_required, achieved: balanceFromLedger >= t.points_required }))
      : ((): {title:string;required:number;achieved:boolean}[] => {
          const arr: {title:string;required:number;achieved:boolean}[] = [{ title: tt1, required: ptT1, achieved: balanceFromLedger >= ptT1 }];
          if (tt2 && ptT2) arr.push({ title: tt2, required: ptT2, achieved: balanceFromLedger >= ptT2 });
          return arr;
        })();
    return new Response(JSON.stringify({
      ready: true,
      total_earned: teFromLedger,
      balance: balanceFromLedger,
      point_threshold: ptT1,
      point_threshold_2: ptT2,
      reward_title_1: tt1,
      reward_title_2: tt2,
      coupons: couponsData,
      recent_additions: mergedRecentCw,
      used_coupon_titles: usedCouponTitles,
      expires_at: expiresAtCw,
    }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
  }

  // ---------- GET: ロイヤルティ顧客一覧（管理画面用） ----------
  // store_id のみで参照可能。データはマスク済みの集計値のみ返す。
  if (req.method === "GET" && actionParam === "loyalty_customers" && storeId) {
    // 店舗設定
    const { data: stLc } = await supabase.from("store_profiles")
      .select("points_scope, chain_id, point_threshold, point_reward_title_1, point_threshold_2, point_reward_title_2")
      .eq("store_id", storeId).maybeSingle();
    const scopeTypeLc = ((stLc as Record<string,unknown>)?.points_scope as string) === "chain" && (stLc as Record<string,unknown>)?.chain_id ? "chain" : "store";
    const scopeIdLc = scopeTypeLc === "chain" ? String((stLc as Record<string,unknown>).chain_id) : storeId;
    // ウォレット一覧（このスコープの全顧客）
    const { data: wallets } = await supabase
      .from("customer_points_wallet")
      .select("identity_id, total_earned, balance, updated_at")
      .eq("scope_type", scopeTypeLc)
      .eq("scope_id", scopeIdLc)
      .order("total_earned", { ascending: false })
      .limit(500);
    if (!wallets || wallets.length === 0) {
      return new Response(JSON.stringify({ customers: [], total: 0 }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
    }
    const identityIds = wallets.map((w: Record<string,unknown>) => w.identity_id as string);
    // 顧客識別子（LINE ID → マスク表示 / anon_id → 匿名）
    const { data: identities } = await supabase
      .from("customer_identity")
      .select("id, line_user_id, anon_id, first_store_id, created_at")
      .in("id", identityIds);
    // クーポン使用カウント
    const { data: redemptionCounts } = await supabase
      .from("points_redemption")
      .select("identity_id, status")
      .eq("store_id", storeId)
      .in("identity_id", identityIds);
    const usedCountMap: Record<string, number> = {};
    for (const r of (redemptionCounts ?? []) as Array<{identity_id:string;status:string}>) {
      if (r.status === "used") usedCountMap[r.identity_id] = (usedCountMap[r.identity_id] ?? 0) + 1;
    }
    const identityMap: Record<string, Record<string,unknown>> = {};
    for (const id of (identities ?? []) as Array<Record<string,unknown>>) {
      identityMap[id.id as string] = id;
    }
    const customers = wallets.map((w: Record<string,unknown>) => {
      const ident = identityMap[w.identity_id as string] ?? {};
      const lineId = ident.line_user_id as string | null;
      const anonId = ident.anon_id as string | null;
      const label = lineId ? ("LINE:" + lineId.slice(0, 14) + "…") : (anonId ? ("匿名:" + anonId.slice(0, 14) + "…") : "不明");
      return {
        identity_id: w.identity_id,
        display_label: label,
        has_line: !!lineId,
        total_earned: w.total_earned,
        balance: w.balance,
        coupon_used_count: usedCountMap[w.identity_id as string] ?? 0,
        last_activity: w.updated_at,
        joined_at: ident.created_at ?? null,
      };
    });
    return new Response(JSON.stringify({ customers, total: customers.length }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
  }

  // ---------- GET: 不正利用レポート（管理画面用） ----------
  if (req.method === "GET" && actionParam === "fraud_report" && storeId) {
    // 店舗スコープ取得
    const { data: stFr } = await supabase.from("store_profiles")
      .select("points_scope, chain_id").eq("store_id", storeId).maybeSingle();
    const stFrD = stFr as Record<string,unknown> | null;
    const scopeTypeFr = (stFrD?.points_scope as string) === "chain" && stFrD?.chain_id ? "chain" : "store";
    const scopeIdFr = scopeTypeFr === "chain" ? String(stFrD!.chain_id) : storeId;

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();

    // 30日間のsurveyポイント履歴
    const { data: surveyLedger } = await supabase
      .from("customer_points_ledger")
      .select("identity_id, created_at")
      .eq("store_id", storeId)
      .eq("action_type", "survey")
      .gte("created_at", since30d);

    // 全ウォレット
    const { data: allWallets } = await supabase
      .from("customer_points_wallet")
      .select("identity_id, total_earned, updated_at")
      .eq("scope_type", scopeTypeFr)
      .eq("scope_id", scopeIdFr)
      .order("total_earned", { ascending: false })
      .limit(500);

    // 関連identity一覧
    const relevantIds = [...new Set([
      ...(surveyLedger ?? []).map((r: Record<string,unknown>) => r.identity_id as string),
      ...(allWallets   ?? []).map((w: Record<string,unknown>) => w.identity_id as string),
    ])].slice(0, 500);

    const { data: allIdentities } = relevantIds.length > 0
      ? await supabase.from("customer_identity")
          .select("id, line_user_id, anon_id, created_at")
          .in("id", relevantIds)
      : { data: [] };

    // ── シグナル計算 ────────────────────────────────────────────
    type FraudReason = { code: string; label: string; detail: string; severity: "high"|"medium"|"low" };
    const fraudMap: Record<string, FraudReason[]> = {};
    const addReason = (id: string, r: FraudReason) => {
      if (!fraudMap[id]) fraudMap[id] = [];
      // 同じコードは重複追加しない
      if (!fraudMap[id].find(x => x.code === r.code)) fraudMap[id].push(r);
    };

    // Signal 1: 1日に複数survey
    const surveyByDay: Record<string, Record<string, number>> = {};
    for (const row of (surveyLedger ?? []) as Array<{identity_id:string;created_at:string}>) {
      const jstDate = new Date(new Date(row.created_at).getTime() + 9*60*60*1000)
        .toISOString().slice(0, 10);
      if (!surveyByDay[row.identity_id]) surveyByDay[row.identity_id] = {};
      surveyByDay[row.identity_id][jstDate] = (surveyByDay[row.identity_id][jstDate] ?? 0) + 1;
    }
    for (const [id, days] of Object.entries(surveyByDay)) {
      const multiDays = Object.entries(days).filter(([, cnt]) => cnt > 1);
      if (multiDays.length > 0) {
        addReason(id, {
          code: "multi_survey_per_day",
          label: "1日複数回アンケート",
          detail: multiDays.map(([d, cnt]) => `${d}: ${cnt}回`).join("、"),
          severity: "high",
        });
      }
    }

    // Signal 2: 7日間で3回以上survey
    const survey7dCount: Record<string, number> = {};
    for (const row of (surveyLedger ?? []) as Array<{identity_id:string;created_at:string}>) {
      if (row.created_at >= since7d) {
        survey7dCount[row.identity_id] = (survey7dCount[row.identity_id] ?? 0) + 1;
      }
    }
    for (const [id, cnt] of Object.entries(survey7dCount)) {
      if (cnt >= 3) {
        addReason(id, {
          code: "high_survey_frequency",
          label: "7日間で頻繁なアンケート回答",
          detail: `直近7日間で${cnt}回回答`,
          severity: cnt >= 5 ? "high" : "medium",
        });
      }
    }

    // Signal 3: 深夜・早朝送信（JST 0〜9時）
    for (const row of (surveyLedger ?? []) as Array<{identity_id:string;created_at:string}>) {
      const jstHour = (new Date(row.created_at).getUTCHours() + 9) % 24;
      if (jstHour < 9) {
        addReason(row.identity_id, {
          code: "odd_hours",
          label: "営業時間外の送信",
          detail: `深夜〜早朝（JST ${jstHour}時台）にアンケートを送信`,
          severity: "medium",
        });
      }
    }

    // Signal 4: 同一anon_idが複数identityに紐づく
    const anonToIds: Record<string, string[]> = {};
    for (const ident of (allIdentities ?? []) as Array<{id:string;anon_id:string|null}>) {
      if (ident.anon_id) {
        if (!anonToIds[ident.anon_id]) anonToIds[ident.anon_id] = [];
        anonToIds[ident.anon_id].push(ident.id);
      }
    }
    for (const ids of Object.values(anonToIds)) {
      if (ids.length > 1) {
        for (const id of ids) {
          addReason(id, {
            code: "shared_device",
            label: "同一デバイスで複数アカウント",
            detail: `同じデバイスから${ids.length}つのアカウントが作成されています`,
            severity: "high",
          });
        }
      }
    }

    // Signal 5: 累計ポイントが平均の4倍超（かつ10P以上）
    const walletMap: Record<string, number> = {};
    let earnedSum = 0, earnedCount = 0;
    for (const w of (allWallets ?? []) as Array<{identity_id:string;total_earned:number}>) {
      walletMap[w.identity_id] = Number(w.total_earned);
      earnedSum += Number(w.total_earned);
      earnedCount++;
    }
    const avgEarned = earnedCount > 1 ? earnedSum / earnedCount : 0;
    if (avgEarned > 0) {
      for (const [id, earned] of Object.entries(walletMap)) {
        if (earned > avgEarned * 4 && earned > 10) {
          addReason(id, {
            code: "high_earner_outlier",
            label: "累計ポイントが平均の4倍超",
            detail: `累計${earned}P（店舗平均${Math.round(avgEarned)}P）`,
            severity: "low",
          });
        }
      }
    }

    // ── レスポンス構築 ───────────────────────────────────────────
    const identityLookup: Record<string, {line_user_id:string|null;anon_id:string|null;created_at:string}> = {};
    for (const ident of (allIdentities ?? []) as Array<{id:string;line_user_id:string|null;anon_id:string|null;created_at:string}>) {
      identityLookup[ident.id] = ident;
    }

    const fraudUsers = Object.entries(fraudMap)
      .map(([id, reasons]) => {
        const ident = identityLookup[id] ?? {};
        const lineId = (ident as Record<string,unknown>).line_user_id as string | null;
        const anonId = (ident as Record<string,unknown>).anon_id   as string | null;
        const label = lineId
          ? "LINE:" + lineId.slice(0, 14) + "…"
          : anonId ? "匿名:" + anonId.slice(0, 14) + "…" : "不明";
        const scoreVal = Math.max(...reasons.map(r => r.severity === "high" ? 3 : r.severity === "medium" ? 2 : 1));
        return {
          identity_id:   id,
          display_label: label,
          total_earned:  walletMap[id] ?? 0,
          fraud_score:   scoreVal,
          reasons,
          joined_at: (ident as Record<string,unknown>).created_at ?? null,
        };
      })
      .sort((a, b) => b.fraud_score - a.fraud_score || b.total_earned - a.total_earned);

    return new Response(JSON.stringify({ users: fraudUsers, total: fraudUsers.length }),
      { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
  }

  // ---------- GET: フォーム画面用ポイント取得 ----------
  if (req.method === "GET" && actionParam === "get_points" && storeId) {
    const lineUserIdGp = url.searchParams.get("line_user_id")?.trim();
    const { data: stGp } = await supabase.from("store_profiles")
      .select("points_scope, chain_id, point_threshold, point_rule_survey")
      .eq("store_id", storeId).maybeSingle();
    const ptThresholdGp = Number((stGp as Record<string,unknown>)?.point_threshold ?? 4);
    const ptSurveyGp = Number((stGp as Record<string,unknown>)?.point_rule_survey ?? 1);
    if (!lineUserIdGp) {
      return new Response(JSON.stringify({ points: 0, point_threshold: ptThresholdGp, survey_points: ptSurveyGp }),
        { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
    }
    const scopeTypeGp = ((stGp as Record<string,unknown>)?.points_scope as string) === "chain" && (stGp as Record<string,unknown>)?.chain_id ? "chain" : "store";
    const scopeIdGp = scopeTypeGp === "chain" ? String((stGp as Record<string,unknown>).chain_id) : storeId;
    const { data: identityGp } = await supabase.from("customer_identity").select("id").eq("line_user_id", lineUserIdGp).maybeSingle();
    if (!identityGp) {
      return new Response(JSON.stringify({ points: 0, point_threshold: ptThresholdGp, survey_points: ptSurveyGp }),
        { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
    }
    const { data: walletGp } = await supabase.from("customer_points_wallet").select("total_earned")
      .eq("identity_id", (identityGp as Record<string,unknown>).id).eq("scope_type", scopeTypeGp).eq("scope_id", scopeIdGp).maybeSingle();
    return new Response(JSON.stringify({
      points: Number((walletGp as Record<string,unknown>)?.total_earned ?? 0),
      point_threshold: ptThresholdGp,
      survey_points: ptSurveyGp,
    }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
  }

  // ---------- GET/POST: 来店チェックインポイント ----------
  if (actionParam === "checkin" && storeId) {
    const SNS_WORKER_SECRET_VAL = Deno.env.get("SNS_WORKER_SECRET") ?? "";
    const addPointUrl = `${Deno.env.get("SUPABASE_URL") ?? url.origin}/functions/v1/add-loyalty-point`;

    // 店舗情報取得（point_rule_visit は ADD COLUMN IF NOT EXISTS で追加済みでなければ null になる）
    const { data: ciStore } = await supabase
      .from("store_profiles")
      .select("store_name_jp, theme_color, line_bot_basic_id, point_threshold, point_reward_title_1, revisit_point_enabled")
      .eq("store_id", storeId)
      .maybeSingle();
    if (!ciStore) return createHtmlResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;padding:24px;"><p>店舗が見つかりません。</p></body></html>`);

    const _d = ciStore as Record<string, unknown>;

    // revisit_point_enabled=false の店舗はチェックイン機能を無効化
    if (_d.revisit_point_enabled === false) {
      return createHtmlResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;"><div style="background:#fff;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1);"><div style="font-size:48px;margin-bottom:16px;">🚫</div><h2 style="font-size:18px;font-weight:800;color:#111;margin:0 0 10px;">この機能は利用できません</h2><p style="font-size:13px;color:#6b7280;line-height:1.7;margin:0;">この店舗では再来店ポイントを提供していません。</p></div></body></html>`);
    }
    const _esc = (s: string) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const ciStoreName   = _esc(String(_d.store_name_jp ?? ""));
    const ciThemeColor  = String(_d.theme_color ?? "#f97316").replace(/[^#a-zA-Z0-9(),. %]/g, "");
    const ciVisitPts    = 1; // DBにpoint_rule_visitカラム追加後はクエリから取得
    const ciBotId       = String(_d.line_bot_basic_id ?? "").trim().replace(/^@/, "");
    const ciRewardTitle = _esc(String(_d.point_reward_title_1 ?? "クーポン"));
    const ciThreshold   = Number(_d.point_threshold ?? 4);

    // POST: ポイント付与処理
    if (req.method === "POST") {
      let ciBody: Record<string, unknown> = {};
      try { ciBody = await req.json(); } catch { /**/ }
      const ciAnonId    = String(ciBody.anon_id ?? "") || null;
      const ciLiffId    = String(ciBody.line_user_id ?? "") || null;
      const ciDate      = new Date().toISOString().slice(0, 10);
      const ciSourceRef = `visit_${storeId}_${ciDate}`;

      if (!ciAnonId && !ciLiffId) {
        return new Response(JSON.stringify({ error: "NO_IDENTITY" }), {
          status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" },
        });
      }

      const _ciAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const ptRes = await fetchWithTimeout(addPointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": SNS_WORKER_SECRET_VAL, ...(_ciAnonKey ? { "apikey": _ciAnonKey, "Authorization": `Bearer ${_ciAnonKey}` } : {}) },
        body: JSON.stringify({
          store_id: storeId,
          action_type: "visit",
          source_ref: ciSourceRef,
          ...(ciLiffId ? { line_user_id: ciLiffId } : {}),
          ...(ciAnonId ? { anon_id: ciAnonId } : {}),
        }),
      });
      const ptData = await ptRes.json();
      return new Response(JSON.stringify(ptData), {
        status: ptRes.ok ? 200 : ptRes.status,
        headers: { ...corsHeaders(null), "Content-Type": "application/json" },
      });
    }

    // GET: チェックインUI
    const ciLineAddUrl = ciBotId
      ? `https://line.me/R/ti/p/@${ciBotId}?start=checkin_${encodeURIComponent(storeId)}`
      : "";
    const ciHtml = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ciStoreName} &mdash; 来店ポイント</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f4f6;min-height:100vh;display:flex;flex-direction:column}
.header{background:${ciThemeColor};color:#fff;padding:18px 20px 24px;}
.header h1{font-size:18px;font-weight:800;margin-top:4px;}
.header p{font-size:12px;opacity:.8;margin-bottom:4px;}
.body{padding:0 16px;margin-top:-12px;flex:1;}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:14px;}
.pts-big{font-size:52px;font-weight:900;color:${ciThemeColor};line-height:1;}
.pts-label{font-size:14px;color:#9ca3af;margin-top:2px;}
.info-banner{background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:10px;}
.info-banner .icon{font-size:18px;flex-shrink:0;line-height:1.3;}
.info-banner .text{font-size:12px;color:#15803d;line-height:1.7;}
.info-banner strong{font-weight:700;}
.btn-line{display:block;width:100%;padding:15px;background:#06C755;color:#fff;font-weight:800;font-size:16px;text-align:center;border-radius:14px;text-decoration:none;margin-bottom:10px;box-shadow:0 4px 14px rgba(6,199,85,.3);}
.btn-anon{display:block;width:100%;padding:13px;background:${ciThemeColor};color:#fff;font-weight:700;font-size:15px;text-align:center;border-radius:14px;border:none;cursor:pointer;}
.btn-anon:disabled{opacity:.6;cursor:not-allowed;}
.note{font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;line-height:1.6;}
.done-card{background:#fff;border-radius:16px;padding:28px 20px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;margin-bottom:14px;}
.done-pts{font-size:40px;font-weight:900;color:#16a34a;margin-bottom:6px;}
.done-msg{font-size:14px;color:#374151;line-height:1.6;}
.done-sub{font-size:12px;color:#9ca3af;margin-top:8px;line-height:1.6;}
.first-visit-card{background:#fff;border-radius:16px;padding:28px 20px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;margin-bottom:14px;}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;}
.toast.show{opacity:1;}
</style>
</head><body>
<div class="header">
  <p>${ciStoreName}</p>
  <h1>📍 来店ポイントを受け取る</h1>
</div>
<div class="body">
  <div class="card" id="main-card">
    <div class="pts-big">＋${ciVisitPts}P</div>
    <div class="pts-label">来店ポイント（2回目から）</div>

    <div class="info-banner" style="margin-top:14px;">
      <span class="icon">ℹ️</span>
      <div class="text">
        <strong>初回来店はアンケートでポイントカードをゲット！</strong><br>
        アンケート回答後にLINE友達追加でポイントカードが発行されます。<br>
        <strong>2回目のご来店からこのQRで来店ポイントが付与されます。</strong>
      </div>
    </div>

    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.6;">
      ${ciRewardTitle}まで <strong>${ciThreshold}P</strong> 貯まるとクーポンが使えます。
    </p>
    ${ciLineAddUrl ? `
    <a href="${ciLineAddUrl}" class="btn-line" id="line-btn">
      📲 LINEで受け取る（おすすめ）
    </a>
    <p style="font-size:11px;color:#6b7280;text-align:center;margin:-4px 0 12px;">LINEに紐づけると次回来店でも引き継ぎできます</p>
    <div style="display:flex;align-items:center;gap:8px;margin:8px 0 12px;">
      <div style="flex:1;height:1px;background:#e5e7eb;"></div>
      <span style="font-size:12px;color:#9ca3af;">または</span>
      <div style="flex:1;height:1px;background:#e5e7eb;"></div>
    </div>
    ` : ""}
    <button class="btn-anon" id="anon-btn">このブラウザで受け取る</button>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:6px;">
      ※ブラウザを変えると引き継ぎされません。LINEでの受け取りを推奨します。
    </p>
  </div>

  <!-- 通常付与完了 -->
  <div class="done-card" id="done-card" style="display:none;">
    <div style="font-size:44px;margin-bottom:10px;">🎉</div>
    <div class="done-pts">＋${ciVisitPts}P</div>
    <div class="done-msg">来店ポイントが付与されました！</div>
    <div class="done-sub">ポイントを貯めてクーポンと交換しよう♪<br>ポイントカードはLINEで確認できます。</div>
  </div>

  <!-- 初回来店（ポイントなし） -->
  <div class="first-visit-card" id="first-visit-card" style="display:none;">
    <div style="font-size:44px;margin-bottom:10px;">👋</div>
    <div style="font-size:20px;font-weight:800;color:#1a1815;margin-bottom:8px;">ご来店ありがとうございます！</div>
    <div style="font-size:14px;color:#374151;line-height:1.7;">
      初回来店はアンケート回答でポイントカードをゲットしてください。<br><br>
      <strong style="color:${ciThemeColor};">2回目のご来店からこのQRで<br>＋${ciVisitPts}P の来店ポイントが付与されます！</strong>
    </div>
    <div style="margin-top:16px;font-size:12px;color:#9ca3af;">
      ポイントカードをお持ちの方は次回タップするだけで<br>自動的にポイントが貯まります。
    </div>
  </div>

  <p class="note">
    来店ポイントは1日1回まで付与されます。<br>
    ポイントはLINEアカウントに紐づいて管理されます。
  </p>
</div>
<div id="toast" class="toast"></div>
<script>
var STORE_ID = ${JSON.stringify(storeId)};
var API_URL = window.location.href.split('?')[0];

function getOrCreateAnonId() {
  try {
    var id = localStorage.getItem('fe_anon_global');
    if (!id) { id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('fe_anon_global', id); }
    return id;
  } catch(e) { return 'a' + Date.now().toString(36); }
}

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2800);
}

function showDone() {
  document.getElementById('main-card').style.display = 'none';
  document.getElementById('done-card').style.display = 'block';
}

function showFirstVisit() {
  document.getElementById('main-card').style.display = 'none';
  document.getElementById('first-visit-card').style.display = 'block';
}

function showAlreadyDone() {
  document.getElementById('main-card').style.display = 'none';
  var dc = document.getElementById('done-card');
  dc.style.display = 'block';
  dc.querySelector('.done-pts').textContent = '✓';
  dc.querySelector('.done-pts').style.fontSize = '36px';
  dc.querySelector('.done-msg').textContent = '本日の来店ポイントは付与済みです';
  dc.querySelector('.done-sub').textContent = 'また明日来店ポイントが貯まります！';
}

// LINE ボタンクリック: anon_id を localStorage に保存しておく（後でマージ用）
var lineBtn = document.getElementById('line-btn');
if (lineBtn) {
  lineBtn.addEventListener('click', function() {
    try { localStorage.setItem('fe_checkin_store', STORE_ID); } catch(e){}
  });
}

// ブラウザで受け取る（anon_id）
document.getElementById('anon-btn').addEventListener('click', async function() {
  var btn = this;
  btn.disabled = true;
  btn.textContent = '処理中…';
  var anonId = getOrCreateAnonId();
  try {
    var res = await fetch(API_URL + '?store_id=' + encodeURIComponent(STORE_ID) + '&action=checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anon_id: anonId }),
    });
    var data = await res.json();
    if (data.ok && data.first_visit) {
      showFirstVisit();
    } else if (data.ok && !data.skipped) {
      showDone();
    } else if (data.skipped || data.error === 'DAILY_LIMIT_EXCEEDED') {
      showAlreadyDone();
    } else {
      showToast('エラーが発生しました。もう一度お試しください');
      btn.disabled = false;
      btn.textContent = 'このブラウザで受け取る';
    }
  } catch(e) {
    showToast('通信エラーが発生しました');
    btn.disabled = false;
    btn.textContent = 'このブラウザで受け取る';
  }
});
</script>
</body></html>`;
    return createHtmlResponse(ciHtml, 200);
  }

  // ---------- GET: LINEでクーポンURLをコピー（友だち追加必須＋URLコピー） ----------
  if (req.method === "GET" && (actionParam === "line_coupon_code" || actionParam === "line_coupon_copy") && storeId && sidParam) {
    const { data: rev } = await supabase
      .from("reviews")
      .select("store_id, submission_id")
      .eq("submission_id", sidParam)
      .eq("store_id", storeId)
      .maybeSingle();
    if (!rev) {
      return createHtmlResponse(`<!DOCTYPE html><html><body style="padding:20px;font-family:sans-serif;"><p>不正なリクエストです。</p></body></html>`, 400);
    }
    const { data: st } = await supabase.from("store_profiles").select("line_bot_basic_id").eq("store_id", storeId).maybeSingle();
    const { data: creds } = await supabase.from("store_line_credentials").select("line_bot_basic_id").eq("store_id", storeId).maybeSingle();
    const botBasicId = (st as { line_bot_basic_id?: string } | null)?.line_bot_basic_id?.trim()?.replace(/^@/, "") || (creds as { line_bot_basic_id?: string } | null)?.line_bot_basic_id?.trim()?.replace(/^@/, "") || "";
    const formEngineBaseUrl = `${url.origin}/functions/v1/form-engine`;
    const couponUrl = `${formEngineBaseUrl.replace(/\/$/, "")}?store_id=${encodeURIComponent(storeId)}&sid=${encodeURIComponent(sidParam)}&coupon_only=1`;
    const addFriendUrl = botBasicId ? `https://line.me/R/ti/p/@${botBasicId}` : "";
    // 1人1回だけクーポンを受け取れるよう、識別コードを発行する（このコードをLINEで送信したときだけURLを返す）
    const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 32]).join("");
    let accessCode = genCode();
    let { error: insertErr } = await supabase.from("coupon_follow_pending").insert({ store_id: storeId, coupon_url: couponUrl, access_code: accessCode });
    if (insertErr?.message?.includes("unique") || insertErr?.message?.includes("duplicate")) {
      accessCode = genCode();
      const retry = await supabase.from("coupon_follow_pending").insert({ store_id: storeId, coupon_url: couponUrl, access_code: accessCode });
      insertErr = retry.error;
    }
    if (insertErr) console.error("[form-engine] coupon_follow_pending insert failed", { storeId, err: insertErr?.message });
    // 友だちの方: LINEのURLスキームで識別コードを入力済みにして開く（パス形式でテキストを渡す）
    const sendMessageUrl = botBasicId ? `https://line.me/R/msg/text/${encodeURIComponent(accessCode)}` : "";
    const actionBlock = botBasicId ? `
  <p class="code-hint">LINEで「<strong class="access-code">${accessCode.replace(/</g, "&lt;")}</strong>」と送信するとクーポンが届きます（1回限り）</p>
  <div class="btn-row">
    <a href="${addFriendUrl.replace(/"/g, "&quot;")}" target="_blank" rel="noopener" class="btn-action btn-friend">友だち未追加</a>
    <a href="${sendMessageUrl.replace(/"/g, "&quot;")}" target="_blank" rel="noopener" class="btn-action btn-already">友だちの方</a>
  </div>
  <p class="already-hint">※友だちの方は、クリック後に該当のアカウントを選択して上記コードを送信してください</p>
` : "";
    const descText = botBasicId
      ? "該当するボタンを押してください"
      : "URLをコピーしてLINEに貼り付けて保存してください";
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;padding:20px;font-family:-apple-system,sans-serif;background:#f2f2f7;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border-radius:20px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h2{margin:0 0 16px}
.desc{font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6}
.btn-row{display:flex;gap:12px;margin:0 0 18px}
.btn-action{flex:1;display:inline-block;padding:14px 12px;border-radius:14px;color:#fff;font-weight:800;font-size:15px;text-decoration:none;text-align:center}
.btn-friend{background:#06C755}
.btn-already{background:#111827}
.code-hint{font-size:14px;color:#374151;margin:0 0 14px;line-height:1.6}
.access-code{font-family:ui-monospace,monospace;background:#f3f4f6;padding:2px 8px;border-radius:6px;letter-spacing:.05em}
.already-hint{font-size:12px;color:#6b7280;margin:0 0 20px;line-height:1.5}
.copy-hint{font-size:13px;color:#6b7280;margin:10px 0 6px;line-height:1.5}
.copy-after{font-size:12px;color:#9ca3af;margin:8px 0 0}
.copy-btn{display:inline-block;padding:18px 32px;border-radius:14px;background:#6366f1;color:#fff;font-weight:700;font-size:17px;border:none;cursor:pointer;margin:12px 0 20px}
.copy-btn:active{opacity:.9}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:12px 24px;border-radius:999px;font-size:14px;opacity:0;transition:opacity .3s;text-align:center;max-width:90%}
.toast.show{opacity:1}
</style></head>
<body>
<div class="card">
  <h2>🎁 LINEでクーポンを保存</h2>
  <p class="desc">${descText}</p>${actionBlock}
  <div class="copy-hint">クーポンが届かない場合は、下のボタンでURLをコピーして保存してください</div>
  <button type="button" class="copy-btn" id="copyBtn">URLをコピーする</button>
  <p class="copy-after">※クーポンを使用する時は、コピーしたURLを開いてください</p>
</div>
<div id="toast" class="toast">コピーしました。クーポンを使用する時はコピーしたURLを開いてください</div>
<script>
var couponUrl=${JSON.stringify(couponUrl)};
var toast=document.getElementById('toast');
var toastMsg='コピーしました。クーポンを使用する時はコピーしたURLを開いてください';
document.getElementById('copyBtn').onclick=function(){
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(couponUrl).then(function(){
      toast.textContent=toastMsg;
      toast.classList.add('show');
      setTimeout(function(){toast.classList.remove('show');},4000);
    });
  }else{toast.textContent='コピーに失敗しました';toast.classList.add('show');setTimeout(function(){toast.classList.remove('show');},2000);}
};
</script>
</body></html>`;
    return createHtmlResponse(html);
  }

  // ---------- GET: sid 指定時は結果ページを表示 ----------
  if (req.method === "GET" && sidParam && storeId) {
    const lang = getPreferredLang(req);
    const couponOnlyParam = url.searchParams.get("coupon_only") === "1";
    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookieAlreadyUsedForStore = ((): boolean => {
      const key = "fe_cu_" + storeId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const re = new RegExp("(?:^|;\\s*)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)");
      const m = cookieHeader.match(re);
      return Boolean(m && m[1]?.trim());
    })();
    const { data: rev } = await supabase
      .from("reviews")
      .select("id, store_id, submission_id, score, answers, review_options, coupon_awarded, created_at, used_at, image_url, improvement_feedback_sent_at, improvement_feedback_text, line_user_id")
      .eq("submission_id", sidParam)
      .eq("store_id", storeId)
      .maybeSingle();
    if (rev) {
      const { data: st } = await supabase
        .from("store_profiles")
        .select("*")
        .eq("store_id", rev.store_id)
        .maybeSingle();
      if (st) {
        const { data: lineCreds } = await supabase
          .from("store_line_credentials")
          .select("line_liff_id, line_bot_basic_id")
          .eq("store_id", rev.store_id)
          .maybeSingle();
        const lineLiffIdRaw = lineCreds?.line_liff_id ?? (st as { line_liff_id?: string } | null)?.line_liff_id ?? null;
        const lineLiffId = (typeof lineLiffIdRaw === "string" && lineLiffIdRaw.trim()) ? lineLiffIdRaw.trim() : null;
        const lineBotBasicIdRaw = lineCreds?.line_bot_basic_id ?? (st as { line_bot_basic_id?: string } | null)?.line_bot_basic_id ?? null;
        let lineBotBasicId = (typeof lineBotBasicIdRaw === "string" && lineBotBasicIdRaw.trim()) ? lineBotBasicIdRaw.trim().replace(/^@/, "") : null;
        // フォールバック: line_official_url から ID を自動抽出
        // 対応形式: https://page.line.me/ID  /  https://line.me/R/ti/p/@ID  /  https://line.me/@ID
        if (!lineBotBasicId) {
          const lineOfficialUrl = String((st as Record<string,unknown>).line_official_url ?? "");
          const atMatch   = lineOfficialUrl.match(/@([A-Za-z0-9_.-]+)/);
          const pageMatch = lineOfficialUrl.match(/page\.line\.me\/([A-Za-z0-9_.-]+)/);
          if (atMatch)   lineBotBasicId = atMatch[1];
          else if (pageMatch) lineBotBasicId = pageMatch[1];
        }
        const formEngineBaseUrl = `${url.origin}/functions/v1/form-engine`;

        // ── ポイントウォレット取得（LINE登録済みユーザーのみ）──────
        let walletData: { total_earned: number; balance: number; scope_id: string } | null = null;
        if (rev.line_user_id) {
          const scopeType = ((st as Record<string,unknown>).points_scope as string) === "chain" && (st as Record<string,unknown>).chain_id
            ? "chain" : "store";
          const scopeId = scopeType === "chain"
            ? String((st as Record<string,unknown>).chain_id)
            : rev.store_id;
          const { data: identity } = await supabase
            .from("customer_identity")
            .select("id")
            .eq("line_user_id", rev.line_user_id)
            .maybeSingle();
          if (identity) {
            // レジャーから獲得ポイントを集計（ウォレットテーブルは古い可能性があるため）
            const { data: ledgerRows } = await supabase
              .from("customer_points_ledger")
              .select("points_delta")
              .eq("identity_id", identity.id)
              .eq("scope_type", scopeType)
              .eq("scope_id", scopeId)
              .gt("points_delta", 0);
            const totalEarned = (ledgerRows ?? []).reduce(
              (sum: number, r: Record<string, unknown>) => sum + Number(r.points_delta ?? 0), 0
            );
            const { data: wallet } = await supabase
              .from("customer_points_wallet")
              .select("total_spent")
              .eq("identity_id", identity.id)
              .eq("scope_type", scopeType)
              .eq("scope_id", scopeId)
              .maybeSingle();
            const totalSpent = Number((wallet as Record<string, unknown> | null)?.total_spent ?? 0);
            walletData = { total_earned: totalEarned, balance: Math.max(0, totalEarned - totalSpent), scope_id: scopeId };
          }
        }

        const reviewForResult: ResultReview = {
          id: rev.id,
          store_id: rev.store_id,
          score: rev.score,
          answers: rev.answers || {},
          review_options: rev.review_options || {},
          coupon_awarded: rev.coupon_awarded || "",
          created_at: rev.created_at || new Date().toISOString(),
          used_at: rev.used_at ?? null,
          image_url: rev.image_url || null,
          improvement_feedback_sent_at: rev.improvement_feedback_sent_at ?? null,
          improvement_feedback_text: rev.improvement_feedback_text ?? null,
          line_user_id: rev.line_user_id ?? null,
        };
        const scoutLpBaseUrl = Deno.env.get("SCOUT_LP_BASE_URL")?.trim() || "https://scout-lp.com/join";
        const dashboardUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
        const resultHtml = buildResultHtml({
          review: reviewForResult,
          store: st,
          lang,
          submissionId: rev.submission_id,
          scoutLpBaseUrl,
          lineLiffId,
          lineBotBasicId,
          formEngineBaseUrl,
          couponOnlyView: couponOnlyParam,
          cookieAlreadyUsedForStore,
          walletData,
          dashboardUrl: dashboardUrl || undefined,
        });
        return createHtmlResponse(resultHtml);
      }
    }
  }

  // ---------- GET: フォーム表示 ----------
  if (req.method === "GET") {
    const lang = getPreferredLang(req);
    if (!storeId) {
      return createHtmlResponse(
        `<!DOCTYPE html><html><body><p>${t(lang, "need_store_id")}</p></body></html>`
      );
    }

    const { data: store } = await supabase
      .from("store_profiles")
      .select("*")
      .eq("store_id", storeId)
      .maybeSingle();
    if (!store) {
      return createHtmlResponse(
        `<!DOCTYPE html><html><body><p>${t(lang, "store_not_found")}</p></body></html>`
      );
    }

    const { data: questionsRaw } = await supabase
      .from("form_questions")
      .select("*")
      .eq("store_id", storeId);
    const questions = (questionsRaw || [])
      .filter((q) => q.question_type !== "hidden")
      .sort((a, b) => (Number(a.step_number ?? a.sort_order) || 0) - (Number(b.step_number ?? b.sort_order) || 0));

    if (!questions?.length) {
      return createHtmlResponse(
        `<!DOCTYPE html><html><body style="padding:20px;font-family:sans-serif;"><p>${t(lang, "no_questions")}</p><p>form_questions: store_id="${storeId}"</p></body></html>`
      );
    }

    // プリセットがあれば読み込み（全店舗共通テンプレート用）
    let preset: Record<string, unknown> | null = null;
    const presetId = (store.form_preset_id as string)?.trim();
    if (presetId) {
      const { data: p } = await supabase
        .from("form_display_presets")
        .select("*")
        .eq("id", presetId)
        .maybeSingle();
      preset = p as Record<string, unknown> | null;
    }

    const themeColor = (store.theme_color as string) || "#6366f1";
    const bgPath =
      (store.cover_image_path as string) ||
      (store.logo_image_path as string) ||
      "";
    const bgUrl = bgPath
      ? supabase.storage.from("assets").getPublicUrl(bgPath).data.publicUrl
      : "";

    const bgStyle = bgUrl
      ? `background-image: url('${bgUrl.replace(/'/g, "\\'")}'); background-size: cover; background-position: center; background-attachment: fixed;`
      : "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);";

    const themeColorEsc = (themeColor || "#6366f1").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const escHtml = (s: string) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const storeNameJa = (typeof store.form_display_name === "string" && store.form_display_name.trim())
      ? store.form_display_name.trim()
      : (store.store_name_ja as string) || (store.store_name_jp as string) || storeId;
    const formGreeting = (store.form_greeting as string)?.trim() || "";

    // サブタイトル・説明文・強調（プリセット優先、なければ店舗独自）
    const subtitle = ((preset?.subtitle ?? store.form_subtitle) as string)?.trim() || "";
    const description =
      ((preset?.description ?? store.form_description) as string)?.trim() ||
      formGreeting;
    const subtitleHighlights = (preset?.subtitle_highlights ?? store.form_subtitle_highlights) as Array<{ text: string; color: string }> | undefined;
    const descHighlights = (preset?.description_highlights ?? store.form_description_highlights) as Array<{ text: string; color: string }> | undefined;

    function applyHighlights(text: string, highlights: Array<{ text: string; color: string }> | undefined): string {
      if (!text) return "";
      let out = String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      if (Array.isArray(highlights)) {
        for (const h of highlights) {
          const t = String(h?.text ?? "").trim();
          if (!t) continue;
          const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
          const color = String(h?.color ?? "#6366f1").replace(/"/g, "&quot;");
          out = out.split(esc).join(`<span style="color:${color};font-weight:600;">${esc}</span>`);
        }
      }
      return out;
    }

    const subtitleHtml = subtitle ? applyHighlights(subtitle, subtitleHighlights) : "";
    const descriptionHtml = description ? applyHighlights(description, descHighlights) : "";

    // クーポン一覧を箇条書きで構築（coupon_tiers 優先、なければ legacy 2カラム）
    const rawCouponTiers = Array.isArray(store.coupon_tiers) && (store.coupon_tiers as unknown[]).length > 0
      ? (store.coupon_tiers as { name: string; points_required: number }[])
      : (() => {
          const list: { name: string; points_required: number }[] = [];
          const t1 = (store.point_reward_title_1 as string)?.trim();
          const t2 = (store.point_reward_title_2 as string)?.trim();
          if (t1) list.push({ name: t1, points_required: Number(store.point_threshold) || 0 });
          if (t2) list.push({ name: t2, points_required: Number(store.point_threshold_2) || 0 });
          return list;
        })();
    const formDisplayCouponIdx = Math.min(Number((store.form_display_coupon_idx as number) ?? 0), rawCouponTiers.length - 1);
    const formDisplayCoupon = rawCouponTiers[formDisplayCouponIdx] ?? rawCouponTiers[0];
    const formCouponListHtml = rawCouponTiers.length > 0
      ? rawCouponTiers.map((c) =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;margin-bottom:6px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);border-radius:10px;backdrop-filter:blur(4px);">
            <span style="font-size:14px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.2);">🎁 ${escHtml(c.name)}</span>
            <span style="font-size:13px;font-weight:800;color:#fff;background:rgba(255,255,255,0.25);padding:3px 10px;border-radius:999px;white-space:nowrap;margin-left:10px;">${c.points_required}pt</span>
          </div>`
        ).join("")
      : "";

    // LIFF ID を取得（line_user_id 自動収集用）
    const { data: lineCreds } = await supabase
      .from("store_line_credentials")
      .select("line_liff_id")
      .eq("store_id", storeId)
      .maybeSingle();
    const formLiffId = (lineCreds?.line_liff_id as string | null)?.trim() || (store.line_liff_id as string | null)?.trim() || null;
    const formSurveyPts = Number((store.point_rule_survey as number) ?? 1);
    const formGooglePts = Number((store.point_rule_google as number) ?? 3);
    const formPointThresholdVal = Number((store.point_threshold as number) ?? 4);
    const formPointThreshold2 = store.point_threshold_2 != null ? Number(store.point_threshold_2) : null;
    const formRewardTitle1 = (store.point_reward_title_1 as string)?.trim() || "クーポン";
    const formRewardTitle2 = (store.point_reward_title_2 as string)?.trim() || null;
    const formLineBotId = ((store.line_bot_basic_id as string) || "").trim();

    const formTier2Html = formPointThreshold2 && formRewardTitle2
      ? `<div style="position:absolute;top:-18px;right:0;font-size:10px;color:#f59e0b;white-space:nowrap;font-weight:600;">${formPointThreshold2}P ⭐${formRewardTitle2}</div>`
      : "";
    const formTier2MarkerPct = formPointThreshold2
      ? Math.min(100, Math.round((formPointThreshold2 / Math.max(formPointThreshold2, formPointThresholdVal)) * 100))
      : null;
    const formTier2MarkerHtml = formPointThreshold2
      ? `<div style="position:absolute;left:${formTier2MarkerPct}%;top:0;bottom:0;width:2px;background:#f59e0b;border-radius:1px;"></div>`
      : "";

    // 全ティア一覧HTML（アコーディオン内で表示）
    const formAllTiersHtml = (() => {
      const tiers: { name: string; points_required: number }[] = rawCouponTiers.length > 0
        ? rawCouponTiers
        : [
            ...(formRewardTitle1 ? [{ name: formRewardTitle1, points_required: formPointThresholdVal }] : []),
            ...(formRewardTitle2 && formPointThreshold2 ? [{ name: formRewardTitle2, points_required: formPointThreshold2 }] : []),
          ];
      if (tiers.length === 0) return "";
      return tiers.map((t) =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;margin-bottom:5px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;">
          <span style="font-size:13px;font-weight:600;color:#166534;">🎁 ${escHtml(t.name)}</span>
          <span style="font-size:12px;font-weight:800;color:#16a34a;background:#dcfce7;padding:2px 10px;border-radius:999px;white-space:nowrap;margin-left:8px;">${t.points_required}P〜</span>
        </div>`
      ).join("");
    })();

    const formHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(storeNameJa)} ${escHtml(t(lang, "survey_title_suffix"))}</title>
  ${formLiffId ? `<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>` : ""}
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; ${bgStyle} font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2937; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .glass { background: rgba(255,255,255,0.25); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 20px; border: 1px solid rgba(255,255,255,0.3); padding: 32px; max-width: 520px; width: 100%; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
    .form-label { margin: 0 0 4px; font-size: 0.85rem; color: rgba(255,255,255,0.9); text-transform: uppercase; letter-spacing: 0.05em; }
    h1 { margin: 0 0 12px; font-size: 1.5rem; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2); }
    .form-subtitle { margin: 0 0 8px; font-size: 1rem; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2); }
    .form-description { margin: 0 0 20px; font-size: 0.95rem; color: rgba(255,255,255,0.95); line-height: 1.5; text-shadow: 0 1px 1px rgba(0,0,0,0.15); }
    .q-card { background: rgba(255,255,255,0.95); border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border-left: 4px solid ${themeColor}; }
    .q-card.hidden { display: none !important; }
    .q-card.visible { animation: fadeIn 0.4s ease forwards; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .q-card label.q-label { display: block; margin-bottom: 12px; font-weight: 600; color: #1f2937; font-size: 1rem; }
    .q-card input[type="text"], .q-card textarea, .q-card select { width: 100%; padding: 12px 16px; border-radius: 10px; border: 2px solid #e5e7eb; background: #fff; font-size: 1rem; transition: border-color 0.2s, box-shadow 0.2s; }
    .q-card input:focus, .q-card textarea:focus, .q-card select:focus { outline: none; border-color: ${themeColor}; box-shadow: 0 0 0 3px rgba(99,102,241,0.2); }
    .q-card textarea { min-height: 100px; resize: vertical; }
    .q-options { display: flex; flex-wrap: wrap; gap: 10px; }
    .q-options label { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #f9fafb; border-radius: 10px; cursor: pointer; margin: 0; border: 2px solid transparent; transition: border-color 0.2s, background 0.2s; }
    .q-options label:has(input:checked) { border-color: ${themeColor}; background: rgba(99,102,241,0.08); }
    .q-options input { width: auto; }
    .rating-stars { display: flex; gap: 8px; font-size: 2rem; }
    .rating-stars label { cursor: pointer; color: #d1d5db; transition: color 0.2s; margin: 0; }
    .rating-stars input { display: none; }
    .rating-stars label.checked { color: ${themeColor}; }
    .progress-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.3); border-radius: 999px; margin-bottom: 20px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: ${themeColor}; border-radius: 999px; transition: width 0.4s ease; }
    button[type="submit"] { width: 100%; padding: 16px; border: none; border-radius: 12px; background: ${themeColor}; color: #fff; font-size: 1.1rem; font-weight: 600; cursor: pointer; transition: transform 0.1s, box-shadow 0.2s; margin-top: 8px; }
    button[type="submit"]:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
    button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; transform: none; pointer-events: none; }
    #loading { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); align-items: center; justify-content: center; z-index: 9999; opacity: 0; transition: opacity 0.4s; }
    #loading.show { display: flex; opacity: 1; }
    #loading > div { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    #loading .spinner { width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading p { color: #fff; margin-top: 16px; font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="glass">
    <p class="form-label">${escHtml(t(lang, "survey_title_suffix"))}</p>
    <h1>${escHtml(storeNameJa)}</h1>
    ${subtitleHtml ? `<p class="form-subtitle">${subtitleHtml}</p>` : ""}
    <div style="background:rgba(255,255,255,0.95);border-radius:14px;margin-bottom:20px;box-shadow:0 4px 16px rgba(0,0,0,0.12);overflow:hidden;">
      <div style="padding:14px 16px 16px;">
        <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:10px;text-align:center;letter-spacing:0.05em;">STEPでポイントを貯めよう</div>
        <div id="form-pts-widget" style="opacity:0.45;transition:opacity 0.5s;">
          <div style="display:flex;gap:6px;margin-bottom:${formAllTiersHtml ? "14" : "4"}px;">
            <div style="flex:1;background:#f0f9ff;border:1.5px solid ${themeColorEsc};border-radius:10px;padding:8px;text-align:center;">
              <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">① アンケート</div>
              <div style="font-size:20px;font-weight:800;color:${themeColorEsc};line-height:1;">＋${formSurveyPts}P</div>
            </div>
            <div style="display:flex;align-items:center;color:#d1d5db;font-weight:700;">＋</div>
            <div style="flex:1;background:#fff7ed;border:1.5px solid #f59e0b;border-radius:10px;padding:8px;text-align:center;">
              <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">② 口コミ投稿</div>
              <div style="font-size:20px;font-weight:800;color:#d97706;line-height:1;">＋${formGooglePts}P</div>
            </div>
          </div>
        </div>
        ${formAllTiersHtml ? `
        <div style="border-top:1px solid #f3f4f6;padding-top:10px;">
          <div style="font-size:11px;color:#6b7280;font-weight:600;margin-bottom:7px;">🏷️ 特典一覧</div>
          ${formAllTiersHtml}
        </div>` : ""}
      </div>
    </div>
    <div class="progress-bar"><div class="progress-bar-fill" id="progress-fill" style="width:0%"></div></div>
    <form id="form" method="POST" action="">
      <input type="hidden" name="store_id" value="${storeId}">
      <input type="hidden" name="vid" id="vid" value="">
      <input type="hidden" name="line_user_id" id="line_user_id" value="">
      <input type="hidden" name="anon_id" id="anon_id" value="">
      ${(store.point_rule_referral as number) > 0 ? `
      <div class="q-card" style="margin-bottom:12px;border:2px dashed #fbbf24;background:#fffbeb;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:20px;">🎟️</span>
          <label style="font-size:14px;font-weight:700;color:#92400e;">紹介コードをお持ちの方</label>
        </div>
        <input type="text" name="referral_code" id="referral_code_input"
          placeholder="紹介コードを入力（任意）"
          style="width:100%;padding:10px 14px;border-radius:8px;border:1.5px solid #fcd34d;background:#fff;font-size:15px;letter-spacing:2px;text-transform:uppercase;"
          autocomplete="off" spellcheck="false" maxlength="20">
        <p style="font-size:11px;color:#b45309;margin-top:6px;">ご紹介いただいた方のコードを入力すると紹介者にポイントが付与されます</p>
      </div>` : ""}
      <div id="questions-root"></div>
      <button type="submit" id="submit-btn">${escHtml(t(lang, "submit_btn"))}</button>
    </form>
  </div>
  <div id="loading"><div><div class="spinner"></div><p>${escHtml(t(lang, "loading_ai"))}</p></div></div>
  <script>
    window.__LANG = ${JSON.stringify(lang)};
    window.__T = ${JSON.stringify(TRANSLATIONS[lang])};
    const QUESTIONS = ${JSON.stringify(questions || [])};
    const THEME_COLOR = "${themeColorEsc}";
    var FORM_SURVEY_PTS = ${formSurveyPts};
    var FORM_PT_THRESHOLD = ${formPointThresholdVal};
    var _formCurrentPts = 0;
    function updateFormPtsWidget(current, animate) {
      _formCurrentPts = current;
      var el = document.getElementById('form-pts-widget');
      var curEl = document.getElementById('form-pts-current');
      var fillEl = document.getElementById('form-pts-fill');
      var labelEl = document.getElementById('form-pts-label');
      if (curEl) curEl.textContent = current;
      var pct = Math.min(100, Math.round((current / FORM_PT_THRESHOLD) * 100));
      if (fillEl) fillEl.style.width = pct + '%';
      var rem = Math.max(0, FORM_PT_THRESHOLD - current);
      if (labelEl) labelEl.textContent = rem > 0 ? ('あと' + rem + 'Pでクーポン！') : '🎁 クーポン交換可能！';
      if (el && animate) { el.style.opacity = '1'; }
    }
    updateFormPtsWidget(0, false);
    const form = document.getElementById('form');
    const root = document.getElementById('questions-root');
    const loading = document.getElementById('loading');

    // anon_id を常に生成（LIFF未設定・失敗時のフォールバック）
    (function() {
      try {
        var _aid = localStorage.getItem('_anon_id_v1');
        if (!_aid) {
          _aid = 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
          localStorage.setItem('_anon_id_v1', _aid);
        }
        var _ai = document.getElementById('anon_id');
        if (_ai) _ai.value = _aid;
      } catch(e) {
        // localStorage 不可時（プライベートブラウジング等）: セッション一時IDを使用
        var _ai2 = document.getElementById('anon_id');
        if (_ai2 && !_ai2.value) _ai2.value = 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      }
    })();

    // LIFF で LINE userId を取得して hidden field にセット
    ${formLiffId ? `
    (async function() {
      try {
        await liff.init({ liffId: ${JSON.stringify(formLiffId)} });
        if (!liff.isLoggedIn()) { updateFormPtsWidget(0, true); return; } // 認証強制しない
        const profile = await liff.getProfile();
        if (profile && profile.userId) {
          document.getElementById('line_user_id').value = profile.userId;
          // 既存ポイントを取得してウィジェット更新
          try {
            var ptUrl = window.location.href.split('?')[0] + '?store_id=' + encodeURIComponent('${storeId}') + '&action=get_points&line_user_id=' + encodeURIComponent(profile.userId);
            var ptRes = await fetch(ptUrl);
            var ptData = await ptRes.json();
            if (typeof ptData.points === 'number') {
              FORM_PT_THRESHOLD = ptData.point_threshold || FORM_PT_THRESHOLD;
              FORM_SURVEY_PTS = ptData.survey_points || FORM_SURVEY_PTS;
              updateFormPtsWidget(ptData.points, true);
            }
          } catch(pe) { updateFormPtsWidget(0, true); }
        }
      } catch(e) {
        console.warn('[form-engine] LIFF init failed:', e);
        updateFormPtsWidget(0, true);
      }
    })();
    ` : `setTimeout(function() { updateFormPtsWidget(0, true); }, 300);`}

    function evalShowIf(cond, answers) {
      if (!cond || !cond.depends_on) return true;
      const dep = cond.depends_on;
      const val = answers[dep];
      if (val === undefined || val === '') return false;
      const target = cond.value;
      if (Array.isArray(target)) return target.includes(String(val)) || target.includes(Number(val));
      return String(val) === String(target);
    }

    function sanitizeAnswers(answers) {
      const out = Object.assign({}, answers);
      QUESTIONS.forEach(function(q) {
        if (!q.logic_show_if || !q.logic_show_if.depends_on) return;
        if (!evalShowIf(q.logic_show_if, answers)) delete out[q.question_key];
      });
      return out;
    }

    function renderQuestions(answers) {
      root.innerHTML = '';
      QUESTIONS.forEach((q, i) => {
        if (q.question_type === 'hidden') return;
        const show = evalShowIf(q.logic_show_if, answers);
        const div = document.createElement('div');
        div.className = 'q-card' + (show ? ' visible' : ' hidden');
        div.dataset.key = q.question_key;
        if (q.logic_show_if) div.dataset.logic = JSON.stringify(q.logic_show_if);
        let html = '<label class="q-label">' + (q.required ? '*' : '') + q.label + '</label>';
        if (q.question_type === 'text') {
          const val = (answers[q.question_key] ?? '').toString().replace(/"/g, '&quot;').replace(/</g, '&lt;');
          html += '<input type="text" name="' + q.question_key + '" placeholder="' + (q.placeholder || '') + '" value="' + val + '">';
        } else if (q.question_type === 'textarea') {
          const val = (answers[q.question_key] ?? '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += '<textarea name="' + q.question_key + '" placeholder="' + (q.placeholder || '') + '">' + val + '</textarea>';
        } else if (q.question_type === 'rating') {
          const max = Number(q.options?.max) || 5;
          const cur = Number(answers[q.question_key]) || 0;
          html += '<div class="rating-stars">';
          for (let s = 1; s <= max; s++) {
            const chk = cur >= s ? ' checked' : '';
            const cls = cur >= s ? ' checked' : '';
            html += '<label class="' + cls + '" data-value="' + s + '"><input type="radio" name="' + q.question_key + '" value="' + s + '"' + chk + '>★</label>';
          }
          html += '</div>';
        } else if ((q.question_type === 'radio' || q.question_type === 'select') && q.options) {
          const opts = Array.isArray(q.options) ? q.options : [];
          const curVal = answers[q.question_key];
          const curStr = curVal !== undefined && curVal !== null ? String(curVal) : '';
          if (q.question_type === 'radio') {
            html += '<div class="q-options">';
            opts.forEach(o => {
              const id = o.id ?? o.value ?? o;
              const text = o.text ?? o.label ?? o;
              const chk = curStr === String(id) ? ' checked' : '';
              html += '<label><input type="radio" name="' + q.question_key + '" value="' + id + '"' + chk + '> ' + text + '</label>';
            });
            html += '</div>';
          } else {
            html += '<select name="' + q.question_key + '"><option value="">' + (window.__T && window.__T.select_placeholder || '選択してください') + '</option>';
            opts.forEach(o => {
              const id = o.id ?? o.value ?? o;
              const text = o.text ?? o.label ?? o;
              const sel = curStr === String(id) ? ' selected' : '';
              html += '<option value="' + id + '"' + sel + '>' + text + '</option>';
            });
            html += '</select>';
          }
        } else if (q.question_type === 'checkbox' && q.options) {
          const curVal = answers[q.question_key];
          const curArr = curVal ? (typeof curVal === 'string' ? curVal.split(',').map(s=>s.trim()) : []) : [];
          html += '<div class="q-options">';
          (Array.isArray(q.options) ? q.options : []).forEach(o => {
            const id = o.id ?? o.value ?? o;
            const text = o.text ?? o.label ?? o;
            const chk = curArr.includes(String(id)) ? ' checked' : '';
            html += '<label><input type="checkbox" name="' + q.question_key + '" value="' + id + '"' + chk + '> ' + text + '</label>';
          });
          html += '</div>';
        } else {
          const val = (answers[q.question_key] ?? '').toString().replace(/"/g, '&quot;');
          html += '<input type="text" name="' + q.question_key + '" value="' + val + '">';
        }
        div.innerHTML = html;
        root.appendChild(div);
        if (q.question_type === 'rating') {
          var ratingKey = q.question_key;
          var starsWrap = div.querySelector('.rating-stars');
          var restoreStars = function() {
            var checked = starsWrap.querySelector('input:checked');
            var cur = checked ? Number(checked.value) : 0;
            starsWrap.querySelectorAll('label').forEach(function(x) {
              x.classList.toggle('checked', Number(x.dataset.value) <= cur);
            });
          };
          starsWrap.addEventListener('mouseleave', restoreStars);
          div.querySelectorAll('.rating-stars label').forEach(function(lab) {
            lab.addEventListener('mouseenter', function() {
              var hoverVal = Number(this.dataset.value) || 0;
              starsWrap.querySelectorAll('label').forEach(function(x) {
                x.classList.toggle('checked', Number(x.dataset.value) <= hoverVal);
              });
            });
            lab.addEventListener('click', function(e) {
              e.preventDefault();
              var val = Number(this.dataset.value) || 0;
              var inp = div.querySelector('input[name="' + ratingKey + '"][value="' + val + '"]');
              if (inp) inp.checked = true;
              starsWrap.querySelectorAll('label').forEach(function(x) {
                x.classList.toggle('checked', Number(x.dataset.value) <= val);
              });
              refresh();
            });
          });
        }
      });
    }

    function collectAnswers(visibleOnly) {
      visibleOnly = !!visibleOnly;
      const o = {};
      const els = form.querySelectorAll('input, select, textarea');
      els.forEach(function(e) {
        const k = e.name;
        if (!k || k === 'store_id') return;
        if (visibleOnly) {
          var card = e.closest('.q-card');
          if (!card || card.classList.contains('hidden')) return;
        }
        if (e.type === 'radio' || e.type === 'checkbox') {
          if (e.checked) o[k] = e.type === 'checkbox' ? ((o[k] || []).concat([e.value])) : e.value;
        } else {
          var v = e.value;
          if (v !== undefined && v !== '') o[k] = v;
        }
      });
      Object.keys(o).forEach(function(k) { if (Array.isArray(o[k])) o[k] = o[k].join(', '); });
      return o;
    }

    function collectVisibleAnswers() {
      return sanitizeAnswers(collectAnswers(true));
    }

    function canSubmit(answers) {
      const visible = QUESTIONS.filter(q => q.question_type !== 'hidden' && evalShowIf(q.logic_show_if, answers));
      const required = visible.filter(q => q.required === true);
      return required.every(q => {
        const v = answers[q.question_key];
        return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
      });
    }

    function updateProgress(answers) {
      const visible = QUESTIONS.filter(q => q.question_type !== 'hidden' && evalShowIf(q.logic_show_if, answers));
      const answered = visible.filter(q => {
        const v = answers[q.question_key];
        return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
      });
      const pct = visible.length ? Math.round((answered.length / visible.length) * 100) : 0;
      const fill = document.getElementById('progress-fill');
      if (fill) fill.style.width = pct + '%';
      var submitBtn = document.getElementById('submit-btn');
      if (submitBtn) submitBtn.disabled = !canSubmit(answers);
    }

    function refresh() {
      const raw = collectAnswers();
      const a = sanitizeAnswers(raw);
      renderQuestions(a);
      updateProgress(a);
    }

    root.addEventListener('change', refresh);
    root.addEventListener('input', function() {
      var raw = collectAnswers();
      var a = sanitizeAnswers(raw);
      updateProgress(a);
    });

    (function initVid() {
      var params = new URLSearchParams(window.location.search);
      var vid = params.get('vid');
      if (!vid) {
        vid = Math.random().toString(36).slice(2, 14);
        var u = new URL(window.location.href);
        u.searchParams.set('vid', vid);
        history.replaceState(null, '', u.toString());
      }
      var el = document.getElementById('vid');
      if (el) el.value = vid;
    })();

    renderQuestions({});
    updateProgress({});

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      var raw = collectAnswers();
      var a = sanitizeAnswers(raw);
      if (!canSubmit(a)) return;
      // ポイント+1アニメーション
      (function() {
        var curEl = document.getElementById('form-pts-current');
        var fillEl = document.getElementById('form-pts-fill');
        var widget = document.getElementById('form-pts-widget');
        var newPts = _formCurrentPts + FORM_SURVEY_PTS;
        if (curEl) {
          curEl.textContent = newPts;
          curEl.style.transition = 'all 0.3s';
          curEl.style.color = THEME_COLOR;
        }
        if (widget) widget.style.opacity = '1';
        var pct = Math.min(100, Math.round((newPts / FORM_PT_THRESHOLD) * 100));
        if (fillEl) fillEl.style.width = pct + '%';
        var widget = document.getElementById('form-pts-widget');
        if (widget) widget.style.opacity = '1';
      })();
      loading.classList.add('show');
      var rcInput = form.querySelector('input[name="referral_code"]');
      var payload = {
        store_id: form.querySelector('input[name="store_id"]').value,
        vid: (form.querySelector('#vid') || {}).value || null,
        answers: collectVisibleAnswers(),
        anon_id: (form.querySelector('#anon_id') || {}).value || null,
        line_user_id: (form.querySelector('#line_user_id') || {}).value || null,
        referral_code: rcInput ? ((rcInput.value || '').trim().toUpperCase() || null) : null,
      };
      var res = await fetch(window.location.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      // LINE WebView 対策: document.write はインラインスクリプトが実行されない場合がある。
      // X-Submission-Id ヘッダーが返ってきた場合は location.replace() でGET遷移（安定）。
      var sid = res.headers.get('X-Submission-Id');
      if (sid) {
        var u = new URL(window.location.href);
        u.searchParams.set('store_id', payload.store_id || '');
        u.searchParams.set('sid', sid);
        u.searchParams.delete('vid');
        u.searchParams.delete('_nc');
        window.location.replace(u.toString());
      } else {
        var html = await res.text();
        document.open();
        document.write(html);
        document.close();
        window.scrollTo(0, 0);
      }
    });
  </script>
</body>
</html>`;

    return createHtmlResponse(formHtml);
  }

  // ---------- POST: 送信・保存・AI生成・結果表示 ----------
  if (req.method === "POST") {
    const lang = getPreferredLang(req);
    let storeIdFromForm = "";
    let vidFromForm: string | null = null;
    let lineUserIdFromForm: string | null = null;
    let anonIdFromForm: string | null = null;
    let referralCodeFromForm: string | null = null;
    let photoBase64FromForm: string | null = null;
    const answers: Record<string, string | number | boolean> = {};
    let score = 5;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await req.json()) as {
          action?: string;
          store_id?: string;
          vid?: string | null;
          answers?: Record<string, unknown>;
          photo_base64?: string | null;
          review_id?: string;
          style_key?: string;
          instruction?: string;
          text?: string;
          tone?: string;
          keywords?: string;
          anon_id?: string | null;
        };
        if (body.action === "create_ref") {
          try {
            const { review_id } = body;
            if (!review_id) {
              return new Response(
                JSON.stringify({ error: "review_id_required", message: "review_id required" }),
                { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
              );
            }
            const { data: rev, error: fetchError } = await supabase
              .from("reviews")
              .select("id, store_id, submission_id, ref_token, is_scouter")
              .eq("id", review_id)
              .single();
            if (fetchError) {
              console.error("[form-engine create_ref] supabase fetch error:", fetchError);
              return new Response(
                JSON.stringify({ error: "db_error", message: String(fetchError.message) }),
                { status: 500, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
              );
            }
            if (!rev) {
              return new Response(
                JSON.stringify({ error: "review_not_found", message: "review not found" }),
                { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
              );
            }
            let token = (rev as { ref_token?: string | null }).ref_token;
            if (!token) {
              const base = (rev as { submission_id?: string | null }).submission_id;
              const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
              token = base ? `r_${base}_${randomPart}` : `r_${randomPart}`;
              const { error: updateError } = await supabase
                .from("reviews")
                .update({ ref_token: token, is_scouter: true })
                .eq("id", review_id);
              if (updateError) {
                console.error("[form-engine create_ref] supabase update error:", updateError);
                return new Response(
                  JSON.stringify({ error: "db_error", message: String(updateError.message) }),
                  { status: 500, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
                );
              }
            } else if (!(rev as { is_scouter?: boolean }).is_scouter) {
              await supabase.from("reviews").update({ is_scouter: true }).eq("id", review_id);
            }
            const scoutLpBase = Deno.env.get("SCOUT_LP_BASE_URL")?.trim() || "https://scout-lp.com/join";
            const referralUrl = scoutLpBase + "?ref=" + encodeURIComponent(token) + "&store=" + encodeURIComponent((rev as { store_id?: string }).store_id || "");
            return new Response(
              JSON.stringify({ ref_token: token, referral_url: referralUrl }),
              { headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          } catch (e) {
            console.error("[form-engine create_ref] unexpected error:", e);
            return new Response(
              JSON.stringify({ error: "internal_error", message: String((e as Error).message) }),
              { status: 500, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
        }
        if (body.action === "use_coupon") {
          const { review_id } = body;
          if (!review_id) {
            return new Response(
              JSON.stringify({ error: "review_id required" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const { data: rev } = await supabase
            .from("reviews")
            .select("id, used_at, store_id, created_at")
            .eq("id", review_id)
            .single();
          if (!rev) {
            return new Response(
              JSON.stringify({ error: "review not found" }),
              { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const storeIdForCookie = (rev as { store_id?: string }).store_id ?? "";
          const { data: st } = await supabase
            .from("store_profiles")
            .select("coupon_emergency_stop, coupon_interval_days, coupon_allow_multiple, coupon_reacquire_enabled, coupon_reacquire_days, coupon_expiry_type, coupon_expiry_days, coupon_expiry_date")
            .eq("store_id", storeIdForCookie)
            .maybeSingle();
          if ((st as { coupon_emergency_stop?: boolean })?.coupon_emergency_stop === true) {
            return new Response(
              JSON.stringify({ error: "coupon_stopped", ok: false, message: "クーポンは現在停止中です" }),
              { status: 403, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const expiryType = String((st as { coupon_expiry_type?: string })?.coupon_expiry_type ?? "permanent").toLowerCase();
          const expiryDays = Number((st as { coupon_expiry_days?: number })?.coupon_expiry_days) || 0;
          const expiryDateRaw = (st as { coupon_expiry_date?: string | null })?.coupon_expiry_date ?? null;
          const createdAt = (rev as { created_at?: string | null })?.created_at ?? null;
          const isExpired = (() => {
            const now = Date.now();
            if (expiryType === "days" && expiryDays > 0 && createdAt) {
              const end = new Date(new Date(createdAt).getTime() + expiryDays * 24 * 60 * 60 * 1000).getTime();
              return !isNaN(end) && now > end;
            }
            if (expiryType === "date" && expiryDateRaw) {
              const d = new Date(expiryDateRaw);
              const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
              return !isNaN(end) && now > end;
            }
            return false;
          })();
          if (isExpired) {
            return new Response(
              JSON.stringify({ ok: false, expired: true, message: "このクーポンは有効期限切れです。" }),
              { status: 200, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const alreadyUsed = (rev as { used_at?: string | null }).used_at != null;
          if (alreadyUsed) {
            return new Response(
              JSON.stringify({ ok: false, already_used: true, message: "このクーポンはすでに使用済みです。" }),
              { status: 200, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const reacquireEnabledRaw = (st as { coupon_reacquire_enabled?: boolean | null })?.coupon_reacquire_enabled;
          const reacquireDaysRaw = Number((st as { coupon_reacquire_days?: number | null })?.coupon_reacquire_days);
          const allowMultipleLegacy = (st as { coupon_allow_multiple?: boolean | null })?.coupon_allow_multiple === true;
          const intervalDaysLegacy = Number((st as { coupon_interval_days?: number | null })?.coupon_interval_days);
          const reacquireEnabled = reacquireEnabledRaw != null ? reacquireEnabledRaw === true : allowMultipleLegacy;
          const intervalDays = Math.max(
            1,
            Number.isFinite(reacquireDaysRaw) && reacquireDaysRaw > 0
              ? reacquireDaysRaw
              : (Number.isFinite(intervalDaysLegacy) && intervalDaysLegacy > 0 ? intervalDaysLegacy : 365),
          );
          const cookieName = "fe_cu_" + storeIdForCookie.replace(/[^a-zA-Z0-9_-]/g, "_");
          const cookieHeader = req.headers.get("cookie") || "";
          const hasStoreCookie = cookieHeader
            .split(";")
            .map((s) => s.trim())
            .some((p) => p === `${cookieName}=1` || p.startsWith(`${cookieName}=1;`));
          if (hasStoreCookie) {
            const blockedMsg = reacquireEnabled
              ? `${intervalDays}日が経過してから再利用してください。`
              : "この店舗ではクーポンは1回限りのため、再利用できません。";
            return new Response(
              JSON.stringify({ ok: false, already_used: true, message: blockedMsg }),
              { status: 200, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const nowIso = new Date().toISOString();
          const { data: updated } = await supabase
            .from("reviews")
            .update({ used_at: nowIso })
            .eq("id", review_id)
            .is("used_at", null)
            .select("id")
            .maybeSingle();
          if (!updated) {
            return new Response(
              JSON.stringify({ ok: false, already_used: true, message: "このクーポンはすでに使用済みです。" }),
              { status: 200, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const cookieMaxAge = intervalDays * 24 * 60 * 60;
          const setCookie = `${cookieName}=1; Max-Age=${cookieMaxAge}; Path=/; SameSite=Lax`;
          return new Response(
            JSON.stringify({ ok: true, used: true }),
            { headers: { ...corsHeaders(null), "Content-Type": "application/json", "Set-Cookie": setCookie } }
          );
        }
        if (body.action === "claim_survey_line") {
          // アンケート1P をLINE登録時に加算（survey action）
          const { review_id } = body;
          if (!review_id) {
            return new Response(JSON.stringify({ error: "review_id required" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          const { data: rev } = await supabase
            .from("reviews")
            .select("submission_id, store_id, line_user_id")
            .eq("id", review_id)
            .maybeSingle();
          if (!rev) {
            return new Response(JSON.stringify({ error: "review_not_found" }), { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          const workerSecret = Deno.env.get("SNS_WORKER_SECRET") ?? "";
          const _apAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
          const _apHeaders = { "Content-Type": "application/json", "x-worker-secret": workerSecret, ...(_apAnonKey ? { "apikey": _apAnonKey, "Authorization": `Bearer ${_apAnonKey}` } : {}) };
          const addPointUrl = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
          const ptRes = await fetchWithTimeout(addPointUrl, {
            method: "POST",
            headers: _apHeaders,
            body: JSON.stringify({
              store_id: rev.store_id,
              action_type: "survey",
              source_ref: rev.submission_id,
              ...(rev.line_user_id ? { line_user_id: rev.line_user_id } : {}),
            }),
          });
          const ptData = await ptRes.json().catch(() => ({ error: "parse_error" }));

          // LINE友達追加ポイント（既存LINE友達が初回利用時にも付与。source_ref重複チェックで2回目以降はスキップ）
          // ★ Bug fix: "line" は add-loyalty-point の許可リストにないため "sns" を使用
          if (rev.line_user_id) {
            fetch(addPointUrl, {
              method: "POST",
              headers: _apHeaders,
              body: JSON.stringify({
                store_id: rev.store_id,
                action_type: "sns",
                source_ref: "line_follow",
                line_user_id: rev.line_user_id,
              }),
            }).catch(() => {});
          }

          return new Response(JSON.stringify(ptData), { status: ptRes.ok ? 200 : ptRes.status, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
        }
        // ── QR→LIFF ウォレット直アクセス ──────────────────────────────────────
        if (body.action === "wallet_check_redirect") {
          const wcUid = String(body.line_user_id ?? "").trim() || null;
          const wcSid = String(body.store_id ?? storeId ?? "").trim() || null;
          if (!wcUid || !wcSid) {
            return new Response(JSON.stringify({ error: "line_user_id and store_id required" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          const wcDashUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");

          // ── wcSid のスコープを解決（chain 対応）──────────────────────────────
          const { data: wcStoreProfile } = await supabase
            .from("store_profiles")
            .select("points_scope, chain_id")
            .eq("store_id", wcSid)
            .maybeSingle();
          const wcScopeType = ((wcStoreProfile as Record<string,unknown>)?.points_scope as string) === "chain" && (wcStoreProfile as Record<string,unknown>)?.chain_id
            ? "chain" : "store";
          const wcScopeId = wcScopeType === "chain"
            ? String((wcStoreProfile as Record<string,unknown>).chain_id)
            : wcSid;

          // ── ① customer_points_ledger から submission_id を探す ─────────────
          // scope_id でフィルタ（chain対応）。他店舗の submission_id が混入しないよう store_id も確認
          const { data: wcIdent } = await supabase.from("customer_identity").select("id").eq("line_user_id", wcUid).maybeSingle();
          let wcSubId: string | null = null;
          // ★ H6 fix: チェーン他店舗のレビューを使う場合はその store_id を wallet URL に使用
          let wcWalletStoreId: string = wcSid;
          if (wcIdent?.id) {
            const { data: wcLedger } = await supabase
              .from("customer_points_ledger")
              .select("source_ref, store_id")
              .eq("identity_id", wcIdent.id as string)
              .eq("scope_type", wcScopeType)
              .eq("scope_id", wcScopeId)
              .not("source_ref", "is", null)
              .filter("source_ref", "~", "^[0-9a-f]{12}$")
              .order("occurred_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            wcSubId = (wcLedger?.source_ref as string) ?? null;
            // ★ Bug fix: scope_id が一致しても store_id が異なる場合（chain内他店舗）は
            //   submission_id が本当にこの scope に属するか reviews で確認
            if (wcSubId && (wcLedger as Record<string,unknown>)?.store_id !== wcSid && wcScopeType === "store") {
              wcSubId = null; // store スコープで他店舗の submission は使わない
            }
          }

          // ── ② reviews.line_user_id で直接検索（liff_link_review 経由のユーザー）────
          // ★ Bug fix: 必ず store_id フィルタを適用。他店舗の submission_id を返さない
          if (!wcSubId) {
            const { data: wcRevDirect } = await supabase
              .from("reviews")
              .select("submission_id")
              .eq("line_user_id", wcUid)
              .eq("store_id", wcSid)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            wcSubId = (wcRevDirect?.submission_id as string) ?? null;
            // chain スコープの場合のみ、同chain内の他店舗も検索
            if (!wcSubId && wcScopeType === "chain") {
              const { data: wcChainStores } = await supabase
                .from("store_profiles")
                .select("store_id")
                .eq("chain_id", wcScopeId);
              const chainStoreIds = (wcChainStores ?? []).map((s: Record<string,unknown>) => String(s.store_id));
              if (chainStoreIds.length > 0) {
                const { data: wcRevChain } = await supabase
                  .from("reviews")
                  .select("submission_id, store_id")
                  .eq("line_user_id", wcUid)
                  .in("store_id", chainStoreIds)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                wcSubId = (wcRevChain?.submission_id as string) ?? null;
                // ★ H6 fix: チェーン他店舗のレビューから取得した場合はその store_id を wallet URL に使用
                if (wcSubId) wcWalletStoreId = String((wcRevChain as Record<string,unknown>)?.store_id ?? wcSid);
              }
            }
          }

          // ── ③ coupon_follow_pending.used_by_user_id → coupon_url の sid を取得 ─
          // ★ Bug fix: 必ず store_id フィルタを適用
          if (!wcSubId) {
            const { data: wcPending } = await supabase
              .from("coupon_follow_pending")
              .select("coupon_url")
              .eq("used_by_user_id", wcUid)
              .eq("store_id", wcSid)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (wcPending?.coupon_url) {
              try {
                wcSubId = new URL(wcPending.coupon_url as string).searchParams.get("sid") ?? null;
              } catch (_) {}
            }
          }

          // ★ M6 fix: LINE webhook がまだ used_by_user_id を書き込んでいない場合の対策
          // 直近2分以内に used_by_user_id=NULL のペンディングレコードが存在する場合は
          // pending_follow を返してクライアントにリトライを促す（survey_url へ飛ばさない）
          if (!wcSubId) {
            const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { data: wcPendingNull } = await supabase
              .from("coupon_follow_pending")
              .select("id")
              .eq("store_id", wcSid)
              .is("used_by_user_id", null)
              .gte("created_at", twoMinsAgo)
              .limit(1)
              .maybeSingle();
            if (wcPendingNull) {
              return new Response(JSON.stringify({ ok: false, pending_follow: true }), {
                headers: { ...corsHeaders(null), "Content-Type": "application/json" },
              });
            }
          }

          if (wcSubId && wcDashUrl) {
            // ★ H6 fix: チェーン他店舗のレビューから取得した場合は wcWalletStoreId (review の store_id) を使用
            const walletUrl = `${wcDashUrl}/s/${encodeURIComponent(wcWalletStoreId)}/wallet/${encodeURIComponent(wcSubId)}`;
            return new Response(JSON.stringify({ ok: true, wallet_url: walletUrl }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          } else if (wcSubId) {
            // DASHBOARD_URL 未設定フォールバック
            const wcFormBase = (Deno.env.get("FORM_ENGINE_BASE_URL") ?? "").replace(/\/$/, "") || (new URL(req.url).origin + "/functions/v1");
            const walletUrl = `${wcFormBase}/form-engine?store_id=${encodeURIComponent(wcWalletStoreId)}&sid=${encodeURIComponent(wcSubId)}&_nc=1`;
            return new Response(JSON.stringify({ ok: true, wallet_url: walletUrl }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          } else {
            // 未回答ユーザー → アンケートへ案内
            const wcFormBase2 = (Deno.env.get("FORM_ENGINE_BASE_URL") ?? "").replace(/\/$/, "") || (new URL(req.url).origin + "/functions/v1");
            const surveyUrl = `${wcFormBase2}/form-engine?store_id=${encodeURIComponent(wcSid)}`;
            return new Response(JSON.stringify({ ok: false, survey_url: surveyUrl, error: "no_wallet_found" }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
        }

        if (body.action === "liff_link_review") {
          // LIFF 経由で LINE user ID とレビューを紐付け（既存友達も自動対応）
          const { review_id: liffRevId, line_user_id: liffUid } = body as { review_id?: string; line_user_id?: string };
          if (!liffRevId || !liffUid) {
            return new Response(JSON.stringify({ error: "review_id and line_user_id required" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          // ★ C4 Security fix: store_id フィルタを追加して他店舗のreview_idを使ったID乗っ取りを防ぐ
          const { data: revLiff } = await supabase
            .from("reviews").select("id, store_id, submission_id, line_user_id")
            .eq("id", liffRevId).eq("store_id", storeId).maybeSingle();
          if (!revLiff) {
            return new Response(JSON.stringify({ error: "review_not_found" }), { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          const existingUid = (revLiff as any).line_user_id as string | null;
          // ★ M3 fix: 既存の LINE UID がある場合は上書きしない（異なる UID で乗っ取りを防止）
          // LINE UID が未設定（null）の場合のみ LIFF 認証ユーザーで初期化する
          if (!existingUid) {
            await supabase.from("reviews").update({ line_user_id: liffUid }).eq("id", liffRevId);
          }
          // 実際に使用する LINE UID は常に LIFF 認証ユーザー
          const effectiveUid = liffUid;
          const workerSecretLiff = Deno.env.get("SNS_WORKER_SECRET") ?? "";
          const _liffAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
          const _liffApHeaders = { "Content-Type": "application/json", "x-worker-secret": workerSecretLiff, ...(_liffAnonKey ? { "apikey": _liffAnonKey, "Authorization": `Bearer ${_liffAnonKey}` } : {}) };
          const addPointUrlLiff = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
          // ★ split identity 防止: 既存 anon identity に LINE user ID を紐付ける
          // liff_link_review 呼び出し時点で customer_identity に line_user_id が未登録の場合、
          // add-loyalty-point が新規 identity を作成してしまうのを防ぐ
          {
            const subId = (revLiff as any).submission_id as string | null;
            if (subId) {
              // ★ Bug fix: store_id フィルタを追加して他店舗のSIDが混入しないようにする
              const { data: existingLedger } = await supabase
                .from("customer_points_ledger")
                .select("identity_id")
                .eq("source_ref", subId)
                .eq("store_id", String((revLiff as any).store_id))
                .limit(1)
                .maybeSingle();
              if (existingLedger?.identity_id) {
                await supabase.from("customer_identity")
                  .update({ line_user_id: effectiveUid })
                  .eq("id", existingLedger.identity_id as string)
                  .is("line_user_id", null); // 未リンクの場合のみ更新（既存リンクを上書きしない）
              }
            }
          }
          // ★ アンケートポイント（already_linked でも呼ぶ — add-loyalty-point の source_ref 重複チェックで二重付与を防ぐ）
          await fetchWithTimeout(addPointUrlLiff, {
            method: "POST",
            headers: _liffApHeaders,
            body: JSON.stringify({ store_id: (revLiff as any).store_id, action_type: "survey", source_ref: (revLiff as any).submission_id, line_user_id: effectiveUid }),
          }).catch(console.error);
          // LINE友達追加ポイント（生涯1回 — source_ref="line_follow" で重複防止）
          // ★ Bug fix: "line" は add-loyalty-point の許可リストにないため "sns" を使用
          await fetchWithTimeout(addPointUrlLiff, {
            method: "POST",
            headers: _liffApHeaders,
            body: JSON.stringify({ store_id: (revLiff as any).store_id, action_type: "sns", source_ref: "line_follow", line_user_id: effectiveUid }),
          }).catch(console.error);
          // LINE Push: ポイントカードURLをLINEに送信
          const liffDashboardUrl = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
          const liffFormBase = (Deno.env.get("FORM_ENGINE_BASE_URL") ?? "").replace(/\/$/, "") || (new URL(req.url).origin + "/functions/v1");
          const liffResultUrl = liffDashboardUrl
            ? `${liffDashboardUrl}/s/${encodeURIComponent((revLiff as any).store_id)}/wallet/${encodeURIComponent((revLiff as any).submission_id)}`
            : `${liffFormBase}/form-engine?store_id=${encodeURIComponent((revLiff as any).store_id)}&sid=${encodeURIComponent((revLiff as any).submission_id)}&_nc=1`;
          // LIFF 経由は wallet_url への直接リダイレクトで完結するため LINE push は送信しない。
          // LINE push は LINE bot OAメッセージ経由（lineOaMsgUrl フロー）でのみ行う。
          return new Response(JSON.stringify({ ok: true, wallet_url: liffResultUrl }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
        }
        if (body.action === "get_line_code") {
          // LINEコード発行（oaMessage URL に埋め込む用）
          const { review_id } = body as { review_id?: string };
          if (!review_id) return new Response(JSON.stringify({ error: "review_id required" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          const { data: revForCode } = await supabase.from("reviews").select("id, store_id, line_user_id").eq("id", review_id).maybeSingle();
          if (!revForCode) return new Response(JSON.stringify({ error: "review_not_found" }), { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          if ((revForCode as any).line_user_id) return new Response(JSON.stringify({ already_linked: true }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          // 既存コードがあれば再利用
          const { data: existingCode } = await supabase.from("coupon_pending_codes").select("code").eq("coupon_url", "REVIEW:" + review_id).gt("expires_at", new Date().toISOString()).maybeSingle();
          if (existingCode?.code) return new Response(JSON.stringify({ code: existingCode.code }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          // 4文字コード生成（O/0/1/I除く）
          const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
          const genCode = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
          let newCode = genCode();
          const { error: codeErr } = await supabase.from("coupon_pending_codes").insert({ code: newCode, store_id: (revForCode as any).store_id, coupon_url: "REVIEW:" + review_id, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
          if (codeErr) { newCode = genCode() + genCode()[0]; await supabase.from("coupon_pending_codes").insert({ code: newCode, store_id: (revForCode as any).store_id, coupon_url: "REVIEW:" + review_id, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }); }
          return new Response(JSON.stringify({ code: newCode }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
        }
        // ── スタッフがクーポンを使用済みにする ──────────────────────────────────
        if (body.action === "use_loyalty_coupon") {
          const { coupon_title } = body as { coupon_title?: string };
          if (!coupon_title) {
            return new Response(JSON.stringify({ error: "coupon_title required" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          // sidParam または review_id から identity を解決
          // ★ C5 Security fix: sid は URL パラメータからのみ受け取る（body からの上書きを禁止してポイント不正消費を防ぐ）
          const sidForUse = sidParam || "";
          let lineUserIdForUse: string | null = null;
          let storeIdForUse = storeId;
          if (sidForUse) {
            const { data: revUc } = await supabase.from("reviews")
              .select("line_user_id, store_id").eq("submission_id", sidForUse).maybeSingle();
            lineUserIdForUse = (revUc?.line_user_id as string) ?? null;
            if (revUc?.store_id) storeIdForUse = revUc.store_id as string;
          }
          let identityIdUc: string | null = null;
          if (lineUserIdForUse) {
            const { data: identUc } = await supabase.from("customer_identity")
              .select("id").eq("line_user_id", lineUserIdForUse).maybeSingle();
            identityIdUc = (identUc?.id as string) ?? null;
          }
          // anon_id フォールバック: ledger の source_ref = sid から identity を逆引き（store_id フィルタで他店舗を除外）
          if (!identityIdUc && sidForUse) {
            const { data: ledgerEntryUc } = await supabase.from("customer_points_ledger")
              .select("identity_id").eq("source_ref", sidForUse).eq("store_id", storeIdForUse).limit(1).maybeSingle();
            identityIdUc = (ledgerEntryUc?.identity_id as string) ?? null;
          }
          if (!identityIdUc) {
            return new Response(JSON.stringify({ error: "identity_not_found" }), { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          // 店舗スコープ取得
          const { data: stUc } = await supabase.from("store_profiles")
            .select("points_scope, chain_id").eq("store_id", storeIdForUse).maybeSingle();
          const scopeTypeUc = ((stUc as Record<string,unknown>)?.points_scope as string) === "chain" && (stUc as Record<string,unknown>)?.chain_id ? "chain" : "store";
          const scopeIdUc = scopeTypeUc === "chain" ? String((stUc as Record<string,unknown>).chain_id) : storeIdForUse;

          // store_point_rewards から coupon_title に一致する特典を検索
          // coupon_tiers / store_profiles を正として required_points を同期する
          let rewardIdUc: string | null = null;
          let spentPtsUc: number = 0;
          {
            // ① coupon_tiers から正規の required_points を取得（こちらを正とする）
            const { data: stForCoupon } = await supabase.from("store_profiles")
              .select("coupon_tiers, point_threshold, point_threshold_2, point_reward_title_1, point_reward_title_2")
              .eq("store_id", storeIdForUse).maybeSingle();
            let authoritativePts: number | null = null;
            const allTiers: Array<{name: string; pts: number}> = [];
            if (stForCoupon) {
              const sd = stForCoupon as Record<string,unknown>;
              if (Array.isArray(sd.coupon_tiers) && (sd.coupon_tiers as unknown[]).length > 0) {
                for (const t of sd.coupon_tiers as Array<{name:string; points_required:number}>) {
                  if (t.name) {
                    const pts = Number(t.points_required) || 0;
                    allTiers.push({ name: t.name, pts });
                    if (t.name === String(coupon_title)) authoritativePts = pts;
                  }
                }
              } else {
                if (sd.point_reward_title_1) {
                  const pts = Number(sd.point_threshold) || 4;
                  allTiers.push({ name: String(sd.point_reward_title_1), pts });
                  if (String(sd.point_reward_title_1) === String(coupon_title)) authoritativePts = pts;
                }
                if (sd.point_reward_title_2) {
                  const pts = Number(sd.point_threshold_2) || 8;
                  allTiers.push({ name: String(sd.point_reward_title_2), pts });
                  if (String(sd.point_reward_title_2) === String(coupon_title)) authoritativePts = pts;
                }
              }
            }

            // ② store_point_rewards を検索（存在しなければ全 tier を一括作成）
            const { data: rewardByTitle } = await supabase.from("store_point_rewards")
              .select("id, required_points")
              .eq("store_id", storeIdForUse)
              .eq("reward_title", String(coupon_title))
              .limit(1).maybeSingle();

            if (rewardByTitle) {
              rewardIdUc = String((rewardByTitle as Record<string,unknown>).id);
              const storedPts = Number((rewardByTitle as Record<string,unknown>).required_points ?? 0);
              // authoritativePts > 0 の場合のみ DB を修正（0 による上書きを防ぐ）
              // coupon_tiers.points_required = 0 は誤設定とみなし storedPts を優先する
              if (authoritativePts != null && authoritativePts > 0 && storedPts !== authoritativePts) {
                await supabase.from("store_point_rewards")
                  .update({ required_points: authoritativePts })
                  .eq("id", rewardIdUc);
                spentPtsUc = authoritativePts;
              } else {
                // authoritativePts が 0 または null → storedPts を使用（DBの正規値を尊重）
                spentPtsUc = (authoritativePts != null && authoritativePts > 0) ? authoritativePts : storedPts;
              }
            } else {
              // 未登録分のみ挿入
              const { data: existingRwds } = await supabase.from("store_point_rewards")
                .select("reward_title").eq("store_id", storeIdForUse);
              const existingTitleSet = new Set((existingRwds ?? []).map(r => String((r as Record<string,unknown>).reward_title)));
              for (const tier of allTiers) {
                if (!existingTitleSet.has(tier.name)) {
                  await supabase.from("store_point_rewards").insert({
                    store_id: storeIdForUse,
                    reward_title: tier.name,
                    reward_detail: "",
                    required_points: tier.pts,
                    is_active: true,
                  });
                }
              }
              // 挿入後に再取得
              const { data: targetRwd } = await supabase.from("store_point_rewards")
                .select("id, required_points")
                .eq("store_id", storeIdForUse)
                .eq("reward_title", String(coupon_title))
                .limit(1).maybeSingle();
              if (targetRwd) {
                rewardIdUc = String((targetRwd as Record<string,unknown>).id);
                spentPtsUc = authoritativePts ?? Number((targetRwd as Record<string,unknown>).required_points ?? 0);
              }
            }
          }

          // rewardIdUc がない場合（自動作成も失敗）は処理続行不可
          if (!rewardIdUc) {
            return new Response(JSON.stringify({ error: "REWARD_NOT_FOUND", detail: "特典が見つかりません" }), { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }

          // daily_limit チェック（metadata.daily_limit を使用）
          const { data: rewardDefUc } = await supabase.from("store_point_rewards")
            .select("metadata").eq("id", rewardIdUc).maybeSingle();
          const metaUc = ((rewardDefUc as Record<string,unknown> | null)?.metadata ?? {}) as Record<string,unknown>;
          // デフォルト 1（1日1回）。store_point_rewards.metadata.daily_limit で店舗ごとに変更可能
          // 0 または負の値を設定すると無制限になる
          const dailyLimitUc = metaUc.daily_limit != null ? Number(metaUc.daily_limit) : 1;
          if (dailyLimitUc > 0) { // 0 = 無制限、1以上 = 1日の上限回数
            const nowMs = Date.now();
            const jstMidnightUc = new Date(Math.floor((nowMs + 9 * 3600 * 1000) / 86400000) * 86400000 - 9 * 3600 * 1000);
            const { count: todayCountUc } = await supabase.from("points_redemption")
              .select("id", { count: "exact", head: true })
              .eq("identity_id", identityIdUc)
              .eq("reward_id", rewardIdUc)
              .gte("used_at", jstMidnightUc.toISOString());
            if ((todayCountUc ?? 0) >= dailyLimitUc) {
              return new Response(JSON.stringify({ error: "DAILY_LIMIT_EXCEEDED" }), { status: 429, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
            }
          }

          // ★ H5 fix: wallet.balance は競合で乖離するため常に ledger+redemption から正確な残高を計算
          // wallet 行の有無のみ取得（後続の update vs insert 判断用）
          const { data: walletUcPre } = await supabase.from("customer_points_wallet")
            .select("identity_id")
            .eq("identity_id", identityIdUc).eq("scope_type", scopeTypeUc).eq("scope_id", scopeIdUc)
            .maybeSingle();
          const [{ data: ledgerForUcBal }, { data: redemptionForUcBal }] = await Promise.all([
            supabase.from("customer_points_ledger").select("points_delta")
              .eq("identity_id", identityIdUc).eq("scope_type", scopeTypeUc).eq("scope_id", scopeIdUc)
              .gt("points_delta", 0),
            supabase.from("points_redemption").select("spent_points")
              .eq("identity_id", identityIdUc).eq("scope_type", scopeTypeUc).eq("scope_id", scopeIdUc)
              .eq("status", "used").gt("spent_points", 0),
          ]);
          const currentBalanceUc = Math.max(0,
            (ledgerForUcBal ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.points_delta ?? 0), 0) -
            (redemptionForUcBal ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.spent_points ?? 0), 0)
          );
          console.log(`[use_loyalty_coupon] spentPtsUc=${spentPtsUc}, currentBalanceUc=${currentBalanceUc}, authoritativePts=${authoritativePts}, walletExists=${!!walletUcPre}`);
          if (spentPtsUc > 0 && currentBalanceUc < spentPtsUc) {
            return new Response(JSON.stringify({ error: "INSUFFICIENT_BALANCE" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }

          // 毎回新規 INSERT — ★ C1 fix: IDを取得してTOCTOUロールバックに備える
          const { data: insertedRowsUc, error: useInsertErr } = await supabase.from("points_redemption").insert({
            identity_id: identityIdUc,
            store_id: storeIdForUse,
            reward_id: rewardIdUc,
            scope_type: scopeTypeUc,
            scope_id: scopeIdUc,
            spent_points: spentPtsUc,
            status: "used",
            used_at: new Date().toISOString(),
            issued_code: null,
            metadata: {},
          }).select("id");
          if (useInsertErr) {
            console.error("[use_loyalty_coupon] insert error:", useInsertErr);
            return new Response(JSON.stringify({ error: "INSERT_FAILED", detail: useInsertErr.message }), { status: 500, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }

          // ウォレット残高を更新（INSERT後にledger・redemption から再集計）
          if (spentPtsUc > 0) {
            // ★ C1/C2 fix: INSERT後に再集計して二重消費チェック + wallet更新値を正確に算出
            const [{ data: ledgerRowsUcPost }, { data: redemptionRowsUcPost }] = await Promise.all([
              supabase.from("customer_points_ledger").select("points_delta")
                .eq("identity_id", identityIdUc).eq("scope_type", scopeTypeUc).eq("scope_id", scopeIdUc)
                .gt("points_delta", 0),
              supabase.from("points_redemption").select("spent_points")
                .eq("identity_id", identityIdUc).eq("scope_type", scopeTypeUc).eq("scope_id", scopeIdUc)
                .eq("status", "used").gt("spent_points", 0),
            ]);
            const totalEarnedUcPost = (ledgerRowsUcPost ?? []).reduce(
              (sum: number, r: Record<string, unknown>) => sum + Number(r.points_delta ?? 0), 0
            );
            // ★ C2 fix: wallet.total_spent ではなく points_redemption から再集計（INSERT後の正確な値）
            const totalSpentUcPost = (redemptionRowsUcPost ?? []).reduce(
              (sum: number, r: Record<string, unknown>) => sum + Number(r.spent_points ?? 0), 0
            );
            // ★ C1 fix: 後検証 — 並行リクエストで二重消費になった場合はINSERTをロールバック
            if (totalSpentUcPost > totalEarnedUcPost && (insertedRowsUc as any)?.[0]?.id) {
              await supabase.from("points_redemption").delete().eq("id", (insertedRowsUc as any)[0].id);
              console.warn(`[use_loyalty_coupon] TOCTOU rollback: earned=${totalEarnedUcPost}, spent=${totalSpentUcPost}`);
              return new Response(JSON.stringify({ error: "INSUFFICIENT_BALANCE" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
            }
            const newBalanceUc = Math.max(0, totalEarnedUcPost - totalSpentUcPost);
            const walletPayloadUc = {
              total_spent: totalSpentUcPost,
              total_earned: totalEarnedUcPost,
              balance: newBalanceUc,
              updated_at: new Date().toISOString(),
            };
            if (walletUcPre) {
              const { error: walletUpdateErr } = await supabase.from("customer_points_wallet").update(walletPayloadUc)
                .eq("identity_id", identityIdUc).eq("scope_type", scopeTypeUc).eq("scope_id", scopeIdUc);
              if (walletUpdateErr) {
                console.error("[use_loyalty_coupon] wallet update error:", walletUpdateErr);
              }
            } else {
              await supabase.from("customer_points_wallet").insert({
                identity_id: identityIdUc,
                scope_type: scopeTypeUc,
                scope_id: scopeIdUc,
                ...walletPayloadUc,
              });
            }
            return new Response(JSON.stringify({ ok: true, newBalance: newBalanceUc }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }

          return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
        }

        if (body.action === "claim_google_bonus") {
          const { review_id } = body;
          if (!review_id) {
            return new Response(JSON.stringify({ error: "review_id required" }), { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }
          // ★ C3 Security fix: store_id フィルタを追加して他店舗のreview_idを使った不正ポイント付与を防ぐ
          const { data: rev } = await supabase
            .from("reviews")
            .select("submission_id, store_id, line_user_id")
            .eq("id", review_id)
            .eq("store_id", storeId)
            .maybeSingle();
          if (!rev) {
            return new Response(JSON.stringify({ error: "review_not_found" }), { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }

          // ── identity 解決: reviews に line_user_id がない場合は
          // submission_id → customer_points_ledger から identity_id を逆引き ──
          let gbLineUserId: string | null = (rev.line_user_id as string | null) ?? null;
          let directIdentityId: string | null = null;

          if (!gbLineUserId && rev.submission_id) {
            // ★ Bug fix: store_id フィルタを追加して他店舗のSIDが混入しないようにする
            const { data: ledgerEntry } = await supabase
              .from("customer_points_ledger")
              .select("identity_id")
              .eq("source_ref", String(rev.submission_id))
              .eq("store_id", String(rev.store_id))
              .limit(1)
              .maybeSingle();
            if (ledgerEntry?.identity_id) {
              directIdentityId = ledgerEntry.identity_id as string;
            }
          }

          const workerSecret = Deno.env.get("SNS_WORKER_SECRET") ?? "";
          const _gbAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
          const addPointUrl = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
          const sourceRef = `${rev.submission_id}_google`;

          // identity_id が直接わかった場合はポイントをここで直接書き込み
          if (directIdentityId && !gbLineUserId) {
            // 重複チェック（source_ref）
            const { data: dup } = await supabase
              .from("customer_points_ledger")
              .select("id")
              .eq("identity_id", directIdentityId)
              .eq("action_type", "google")
              .eq("source_ref", sourceRef)
              .maybeSingle();
            if (dup) {
              return new Response(JSON.stringify({ ok: true, skipped: true, reason: "duplicate_source_ref" }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
            }
            // 1日1回チェック（JST）
            const _gbNowJstMs = Date.now() + 9 * 60 * 60 * 1000;
            const _gbNowJst   = new Date(_gbNowJstMs);
            const _gbJstDate  = _gbNowJst.toISOString().slice(0, 10);
            const _gbDayStart = new Date(`${_gbJstDate}T00:00:00+09:00`);
            const _gbDayEnd   = new Date(`${_gbJstDate}T23:59:59.999+09:00`);
            const { count: _gbTodayCount } = await supabase
              .from("customer_points_ledger")
              .select("id", { count: "exact", head: true })
              .eq("identity_id", directIdentityId)
              .eq("action_type", "google")
              .gte("created_at", _gbDayStart.toISOString())
              .lte("created_at", _gbDayEnd.toISOString());
            if ((_gbTodayCount ?? 0) >= 1) {
              return new Response(JSON.stringify({ ok: true, skipped: true, reason: "daily_limit_exceeded" }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
            }
            // 店舗設定取得
            const { data: storeForGb } = await supabase
              .from("store_profiles")
              .select("points_scope, chain_id, point_rule_google")
              .eq("store_id", rev.store_id)
              .maybeSingle();
            const s = (storeForGb ?? {}) as Record<string, unknown>;
            const gbScopeType = (s.points_scope as string) === "chain" && s.chain_id ? "chain" : "store";
            const gbScopeId = gbScopeType === "chain" ? String(s.chain_id) : String(rev.store_id);
            const gbPts = Number(s.point_rule_google ?? 3);
            // ledger INSERT
            await supabase.from("customer_points_ledger").insert({
              identity_id: directIdentityId,
              store_id: rev.store_id,
              chain_id: s.chain_id ?? null,
              scope_type: gbScopeType,
              scope_id: gbScopeId,
              action_type: "google",
              points_delta: gbPts,
              source_ref: sourceRef,
              metadata: {},
            });
            // wallet 再集計
            const { data: allGbRows } = await supabase
              .from("customer_points_ledger")
              .select("points_delta")
              .eq("identity_id", directIdentityId)
              .eq("scope_type", gbScopeType)
              .eq("scope_id", gbScopeId)
              .gt("points_delta", 0);
            const gbTotal = (allGbRows ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.points_delta ?? 0), 0);
            const { data: gbWallet } = await supabase
              .from("customer_points_wallet")
              .select("total_spent")
              .eq("identity_id", directIdentityId)
              .eq("scope_type", gbScopeType)
              .eq("scope_id", gbScopeId)
              .maybeSingle();
            const gbSpent = (gbWallet?.total_spent as number) ?? 0;
            await supabase.from("customer_points_wallet").upsert({
              identity_id: directIdentityId, scope_type: gbScopeType, scope_id: gbScopeId,
              total_earned: gbTotal, total_spent: gbSpent, balance: Math.max(0, gbTotal - gbSpent),
              updated_at: new Date().toISOString(),
            }, { onConflict: "identity_id,scope_type,scope_id" });
            return new Response(JSON.stringify({ ok: true, points_awarded: gbPts, total_points: gbTotal, balance: Math.max(0, gbTotal - gbSpent) }), { headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
          }

          // 通常パス: add-loyalty-point 経由
          const ptRes = await fetchWithTimeout(addPointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret, ...(_gbAnonKey ? { "apikey": _gbAnonKey, "Authorization": `Bearer ${_gbAnonKey}` } : {}) },
            body: JSON.stringify({
              store_id: rev.store_id,
              action_type: "google",
              source_ref: sourceRef,
              ...(gbLineUserId ? { line_user_id: gbLineUserId } : {}),
            }),
          });
          const ptData = await ptRes.json().catch(() => ({ error: "parse_error" }));
          return new Response(JSON.stringify(ptData), { status: ptRes.ok ? 200 : ptRes.status, headers: { ...corsHeaders(null), "Content-Type": "application/json" } });
        }
        if (body.action === "register_phone") {
          const { review_id, phone } = body;
          if (!review_id || !phone) {
            return new Response(
              JSON.stringify({ error: "review_id and phone are required" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const { data: rev } = await supabase
            .from("reviews")
            .select("submission_id, store_id")
            .eq("id", review_id)
            .maybeSingle();
          if (!rev) {
            return new Response(
              JSON.stringify({ error: "review_not_found" }),
              { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const workerSecret = Deno.env.get("SNS_WORKER_SECRET") ?? "";
          const _rpAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
          const addPointUrl = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
          const ptRes = await fetchWithTimeout(addPointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret, ...(_rpAnonKey ? { "apikey": _rpAnonKey, "Authorization": `Bearer ${_rpAnonKey}` } : {}) },
            body: JSON.stringify({
              store_id: rev.store_id,
              action_type: "survey",
              source_ref: rev.submission_id,
              phone: String(phone),
            }),
          });
          const ptData = await ptRes.json().catch(() => ({ error: "parse_error" }));
          return new Response(
            JSON.stringify(ptData),
            { status: ptRes.ok ? 200 : ptRes.status, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
          );
        }
        if (body.action === "save_review_text") {
          const { review_id, style_key, text } = body;
          if (!review_id || !style_key || text === undefined) {
            return new Response(
              JSON.stringify({ error: "review_id, style_key, text required" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const { data: rev } = await supabase
            .from("reviews")
            .select("id, review_options")
            .eq("id", review_id)
            .single();
          if (!rev || !(rev as any).review_options) {
            return new Response(
              JSON.stringify({ error: "review not found" }),
              { status: 404, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const opts = { ...(rev as any).review_options, [style_key]: String(text) };
          await supabase
            .from("reviews")
            .update({ review_options: opts })
            .eq("id", review_id);
          return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
          );
        }
        if (body.action === "send_improvement_feedback") {
          const { review_id, store_id: body_store_id, text: feedback_text } = body;
          if (!review_id) {
            return new Response(
              JSON.stringify({ error: "review_id required" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          // Fetch review for identity + store info
          const { data: revFb } = await supabase
            .from("reviews")
            .select("submission_id, store_id, line_user_id, score")
            .eq("id", review_id)
            .maybeSingle();
          const { error: updateError } = await supabase
            .from("reviews")
            .update({
              improvement_feedback_sent_at: new Date().toISOString(),
              improvement_feedback_text: feedback_text != null ? String(feedback_text) : null,
            })
            .eq("id", review_id);
          if (updateError) {
            return new Response(
              JSON.stringify({ error: "update_failed", message: String(updateError.message) }),
              { status: 500, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          // レポート送信時は常にポイントを付与（スコア条件なし・LINE/anon両対応）
          let pointsAwarded = 0;
          let ptData: Record<string, unknown> = {};
          if (revFb) {
            // line_user_id がない場合は ledger から anon_id を逆引き
            let fbLineUserId: string | null = revFb.line_user_id as string | null;
            let fbAnonId: string | null = null;
            let fbIdentityId: string | null = null;
            if (!fbLineUserId && revFb.submission_id) {
              // ★ Bug fix: store_id フィルタを追加して他店舗のSIDが混入しないようにする
              const { data: ledgerForFb } = await supabase
                .from("customer_points_ledger")
                .select("identity_id")
                .eq("source_ref", revFb.submission_id)
                .eq("store_id", String(revFb.store_id))
                .limit(1)
                .maybeSingle();
              if (ledgerForFb?.identity_id) {
                fbIdentityId = ledgerForFb.identity_id as string;
                const { data: identForFb } = await supabase
                  .from("customer_identity")
                  .select("anon_id")
                  .eq("id", fbIdentityId)
                  .maybeSingle();
                fbAnonId = (identForFb?.anon_id as string) ?? null;
              }
            } else if (fbLineUserId) {
              const { data: identForFbLine } = await supabase
                .from("customer_identity")
                .select("id")
                .eq("line_user_id", fbLineUserId)
                .maybeSingle();
              fbIdentityId = (identForFbLine?.id as string) ?? null;
            }

            // 1日1回チェック（feedback）
            if (fbIdentityId) {
              const _fbNowJstMs = Date.now() + 9 * 60 * 60 * 1000;
              const _fbJstDate  = new Date(_fbNowJstMs).toISOString().slice(0, 10);
              const _fbDayStart = new Date(`${_fbJstDate}T00:00:00+09:00`);
              const _fbDayEnd   = new Date(`${_fbJstDate}T23:59:59.999+09:00`);
              const { count: _fbTodayCount } = await supabase
                .from("customer_points_ledger")
                .select("id", { count: "exact", head: true })
                .eq("identity_id", fbIdentityId)
                .eq("action_type", "feedback")
                .gte("created_at", _fbDayStart.toISOString())
                .lte("created_at", _fbDayEnd.toISOString());
              if ((_fbTodayCount ?? 0) >= 1) {
                return new Response(
                  JSON.stringify({ ok: false, daily_limit: true, message: "レポートのポイントは1日1回のみ加算されます（本日分は加算済みです）" }),
                  { headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
                );
              }
            }

            if (fbLineUserId || fbAnonId) {
              const { data: storeForPt } = await supabase
                .from("store_profiles")
                .select("point_rule_google")
                .eq("store_id", revFb.store_id)
                .maybeSingle();
              const ptGoogle = Number((storeForPt as any)?.point_rule_google ?? 3);
              const workerSecret = Deno.env.get("SNS_WORKER_SECRET") ?? "";
              const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
              const addPointUrl = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
              const ptRes = await fetchWithTimeout(addPointUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-worker-secret": workerSecret,
                  ...(anonKey ? { "apikey": anonKey, "Authorization": `Bearer ${anonKey}` } : {}),
                },
                body: JSON.stringify({
                  store_id: revFb.store_id,
                  action_type: "feedback",
                  source_ref: `${revFb.submission_id}_feedback`,
                  points_override: ptGoogle + 1,
                  ...(fbLineUserId ? { line_user_id: fbLineUserId } : { anon_id: fbAnonId }),
                }),
              }).catch(() => null);
              ptData = ptRes ? await ptRes.json().catch(() => ({})) : {};
              if ((ptData as any)?.ok && !(ptData as any)?.skipped) pointsAwarded = ptGoogle + 1;
            }
          }
          return new Response(
            JSON.stringify({ ok: true, points_awarded: pointsAwarded, total_points: (ptData as any)?.total_points ?? null, balance: (ptData as any)?.balance ?? null }),
            { headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
          );
        }
        if (body.action === "refine") {
          const refineLang = getPreferredLang(req);
          const { review_id, style_key, instruction } = body;
          if (!review_id || !style_key || !instruction) {
            return new Response(
              JSON.stringify({ error: "review_id, style_key, instruction required" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const { data: rev } = await supabase
            .from("reviews")
            .select("*, store_profiles(*)")
            .eq("id", review_id)
            .single();
          if (!rev || !(rev as any).review_options) {
            return new Response(
              JSON.stringify({ error: "review not found" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const opts = (rev as any).review_options || {};
          const currentText = opts[style_key] || "";
          const storeProfile = (rev as any).store_profiles || {};
          const hashtags = (storeProfile.hashtags_fixed as string) || "";
          const refineUiMode = String(storeProfile.ui_mode ?? "sns").toLowerCase();
          const refineIncludeHashtags = refineUiMode !== "review";
          const len = currentText.length;
          const longerLo = Math.round(len * 1.1);
          const longerHi = Math.round(len * 1.35);
          const shorterLo = Math.max(20, Math.round(len * 0.65));
          const shorterHi = Math.max(shorterLo + 1, Math.round(len * 0.9));
          const LONGER_MSG: Record<Lang, string> = {
            ja: `現在の文章をやや長くしてください。目安の文字数帯はおおよそ${longerLo}〜${longerHi}文字（元の約±10〜35%の幅。厳密に合わせない）。体験の流れや具体を足してもよいが、同義の繰り返しや薄い文での水増しは禁止。`,
            en: `Lengthen the text slightly. Aim for roughly ${longerLo}–${longerHi} characters (a flexible band; do not pad to hit an exact count). Add real detail if it fits; no filler or repetition.`,
            zh: `将文本适当加长。字数大致在${longerLo}〜${longerHi}字之间（宽松范围，勿硬凑）。可补充真实细节，禁止空话和同义重复。`,
            ko: `텍스트를 약간 길게. 대략 ${longerLo}〜${longerHi}자 안팎(유연한 범위). 의미 없는 반복·불필요한 문장 추가 금지.`,
            es: `Alarga un poco el texto. Guía ~${longerLo}–${longerHi} caracteres (flexible). Sin relleno ni repetición.`,
            fr: `Allongez légèrement. Fourchette indicative ${longerLo}–${longerHi} caractères (souple). Pas de remplissage.`,
            th: `ขยายความเล็กน้อย ช่วงประมาณ ${longerLo}–${longerHi} ตัวอักษร (ยืดหยุ่น) ห้ามต่อคำซ้ำๆ`,
            vi: `Làm dài nhẹ. Khoảng ${longerLo}–${longerHi} ký tự (linh hoạt). Không thêm câu rỗng.`,
          };
          const SHORTER_MSG: Record<Lang, string> = {
            ja: `現在の文章をやや短く要約してください。目安の文字数帯はおおよそ${shorterLo}〜${shorterHi}文字（元の約65〜90%前後。厳密に合わせない）。要点は保ち、削れる冗長だけ削る。`,
            en: `Shorten the text. Aim for roughly ${shorterLo}–${shorterHi} characters (flexible band). Keep key facts; cut redundancy only.`,
            zh: `适当缩短。字数大致${shorterLo}〜${shorterHi}字（宽松范围）。保留要点，删冗余。`,
            ko: `약간 짧게. 대략 ${shorterLo}〜${shorterHi}자(유연). 핵심만 남기고 군더더기 삭제.`,
            es: `Acorta un poco. Guía ~${shorterLo}–${shorterHi} caracteres (flexible).`,
            fr: `Raccourcissez un peu. Fourchette ~${shorterLo}–${shorterHi} caractères (souple).`,
            th: `ย่อเล็กน้อย ช่วง ~${shorterLo}–${shorterHi} ตัวอักษร`,
            vi: `Rút gọn nhẹ. Khoảng ${shorterLo}–${shorterHi} ký tự.`,
          };
          const REFINE_LANG_COND_HASHTAG: Record<Lang, string> = {
            ja: `「ですます」調で。文末にハッシュタグ5個と固定タグ「${hashtags}」を含めて。現在の文に含まれる事実以外を創作してはいけない。`,
            en: `Output in English. Use 5 hashtags at the end plus fixed tag "${hashtags}". Do not invent facts not in the current text.`,
            zh: `用简体中文输出。文末加5个话题标签和固定标签「${hashtags}」。不要编造文中没有的事实。`,
            ko: `한국어로 출력. 문장 끝에 해시태그 5개와 고정 태그 "${hashtags}" 포함. 현재 문에 없는 사실을 만들지 마세요.`,
            es: `Output in Spanish. Use 5 hashtags at the end plus fixed tag "${hashtags}". Do not invent facts.`,
            fr: `Output in French. Use 5 hashtags at the end plus fixed tag "${hashtags}". Do not invent facts.`,
            th: `Output in Thai. Use 5 hashtags at the end plus fixed tag "${hashtags}". Do not invent facts.`,
            vi: `Output in Vietnamese. Use 5 hashtags at the end plus fixed tag "${hashtags}". Do not invent facts.`,
          };
          const REFINE_LANG_COND_NO_HASHTAG: Record<Lang, string> = {
            ja: `「ですます」調で。ハッシュタグは付けないこと。現在の文に含まれる事実以外を創作してはいけない。`,
            en: `Output in English. Do not add any hashtags. Do not invent facts not in the current text.`,
            zh: `用简体中文输出。不要添加话题标签。不要编造文中没有的事实。`,
            ko: `한국어로 출력. 해시태그 넣지 마세요. 현재 문에 없는 사실을 만들지 마세요.`,
            es: `Output in Spanish. Do not add hashtags. Do not invent facts.`,
            fr: `Output in French. Ne pas ajouter de hashtags. Do not invent facts.`,
            th: `Output in Thai. อย่าใส่แฮชแท็ก. Do not invent facts.`,
            vi: `Output in Vietnamese. Không thêm hashtag. Do not invent facts.`,
          };
          const REFINE_LANG_COND = refineIncludeHashtags ? REFINE_LANG_COND_HASHTAG : REFINE_LANG_COND_NO_HASHTAG;
          const instructionText =
            instruction === "longer"
              ? (LONGER_MSG[refineLang] || LONGER_MSG.en)
              : instruction === "shorter"
                ? (SHORTER_MSG[refineLang] || SHORTER_MSG.en)
                : String(instruction);
          const langCond = REFINE_LANG_COND[refineLang] || REFINE_LANG_COND.en;
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: `Instruction: ${instructionText}\nConditions: ${langCond}\nCurrent text: ${currentText}`,
              },
            ],
          });
          const newText = completion.choices[0]?.message?.content?.trim() || "";
          await supabase
            .from("reviews")
            .update({ review_options: { ...opts, [style_key]: newText } })
            .eq("id", review_id);
          return new Response(JSON.stringify({ newText }), {
            headers: { ...corsHeaders(null), "Content-Type": "application/json" },
          });
        }
        if (body.action === "refine_tone_keywords") {
          const refineLang = getPreferredLang(req);
          const { review_id, style_key, tone, keywords } = body;
          if (!review_id || !style_key) {
            return new Response(
              JSON.stringify({ error: "review_id, style_key required" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const { data: rev } = await supabase
            .from("reviews")
            .select("*, store_profiles(*)")
            .eq("id", review_id)
            .single();
          if (!rev || !(rev as any).review_options) {
            return new Response(
              JSON.stringify({ error: "review not found" }),
              { status: 400, headers: { ...corsHeaders(null), "Content-Type": "application/json" } }
            );
          }
          const opts = (rev as any).review_options || {};
          const currentText = opts[style_key] || "";
          const storeProfileTone = (rev as any).store_profiles || {};
          const hashtagsTone = (storeProfileTone.hashtags_fixed as string) || "";
          const toneUiMode = String(storeProfileTone.ui_mode ?? "sns").toLowerCase();
          const toneIncludeHashtags = toneUiMode !== "review";
          const TONE_JA: Record<string, string> = {
            polite: "接客やお店への敬意を込めた、フォーマルで丁寧・誠実な表現に書き換えてください。",
            friendly: "友達に勧めるような、親しみやすくカジュアルな表現に書き換えてください。",
            short: "要点だけを抑えた、サクッと読める短め・シンプルな表現に書き換えてください。",
          };
          const TONE_EN: Record<string, string> = {
            polite: "Rewrite in a formal, polite and sincere tone, showing respect to the staff and the store.",
            friendly: "Rewrite in a friendly, casual tone as if recommending to a friend.",
            short: "Rewrite in a short, simple style that gets to the point quickly.",
          };
          const toneInstruction =
            tone && (TONE_JA[tone] || TONE_EN[tone])
              ? refineLang === "ja"
                ? TONE_JA[tone] || TONE_EN[tone]
                : TONE_EN[tone] || TONE_JA[tone]
              : "";
          const keywordsTrimmed = (keywords && String(keywords).trim()) || "";
          const keywordsInstruction = keywordsTrimmed
            ? (refineLang === "ja"
                ? `以下のキーワードを文章の文脈に合わせて自然に組み込んでください。箇条書きにせず、文章の一部として溶け込ませること。キーワード：${keywordsTrimmed}`
                : `Incorporate these keywords naturally into the text to fit the context. Do not list them; weave them into the sentences. Keywords: ${keywordsTrimmed}`)
            : "";
          const instructions = [toneInstruction, keywordsInstruction].filter(Boolean);
          const instructionText = instructions.length
            ? instructions.join("\n")
            : refineLang === "ja"
              ? "現在の文章を自然な形で微調整してください。"
              : "Slightly refine the current text naturally.";
          const TONE_REFINE_LANG_HASHTAG: Record<Lang, string> = {
            ja: `「ですます」調で。文末にハッシュタグ5個と固定タグ「${hashtagsTone}」を含めて。現在の文に含まれる事実以外を創作してはいけない。`,
            en: `Output in English. Use 5 hashtags at the end plus fixed tag "${hashtagsTone}". Do not invent facts not in the current text.`,
            zh: `用简体中文输出。文末加5个话题标签和固定标签「${hashtagsTone}」。不要编造文中没有的事实。`,
            ko: `한국어로 출력. 문장 끝에 해시태그 5개와 고정 태그 "${hashtagsTone}" 포함. 현재 문에 없는 사실을 만들지 마세요.`,
            es: `Output in Spanish. Use 5 hashtags at the end plus fixed tag "${hashtagsTone}". Do not invent facts.`,
            fr: `Output in French. Use 5 hashtags at the end plus fixed tag "${hashtagsTone}". Do not invent facts.`,
            th: `Output in Thai. Use 5 hashtags at the end plus fixed tag "${hashtagsTone}". Do not invent facts.`,
            vi: `Output in Vietnamese. Use 5 hashtags at the end plus fixed tag "${hashtagsTone}". Do not invent facts.`,
          };
          const TONE_REFINE_LANG_NO_HASHTAG: Record<Lang, string> = {
            ja: `「ですます」調で。ハッシュタグは付けないこと。現在の文に含まれる事実以外を創作してはいけない。`,
            en: `Output in English. Do not add any hashtags. Do not invent facts not in the current text.`,
            zh: `用简体中文输出。不要添加话题标签。不要编造文中没有的事实。`,
            ko: `한국어로 출력. 해시태그 넣지 마세요. 현재 문에 없는 사실을 만들지 마세요.`,
            es: `Output in Spanish. Do not add hashtags. Do not invent facts.`,
            fr: `Output in French. Ne pas ajouter de hashtags. Do not invent facts.`,
            th: `Output in Thai. อย่าใส่แฮชแท็ก. Do not invent facts.`,
            vi: `Output in Vietnamese. Không thêm hashtag. Do not invent facts.`,
          };
          const TONE_REFINE_LANG_COND = toneIncludeHashtags ? TONE_REFINE_LANG_HASHTAG : TONE_REFINE_LANG_NO_HASHTAG;
          const langCond = TONE_REFINE_LANG_COND[refineLang] || TONE_REFINE_LANG_COND.en;
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: `Instruction: ${instructionText}\nConditions: ${langCond}\nCurrent text: ${currentText}`,
              },
            ],
          });
          const newText = completion.choices[0]?.message?.content?.trim() || "";
          await supabase
            .from("reviews")
            .update({ review_options: { ...opts, [style_key]: newText } })
            .eq("id", review_id);
          return new Response(JSON.stringify({ newText }), {
            headers: { ...corsHeaders(null), "Content-Type": "application/json" },
          });
        }
        storeIdFromForm = (body.store_id as string) || "";
        vidFromForm = (body.vid as string) || null;
        lineUserIdFromForm = (body.line_user_id as string) || null;
        anonIdFromForm = (body.anon_id as string) || null;
        photoBase64FromForm = (body.photo_base64 as string) || null;
        const raw = (body.answers as Record<string, unknown>) || {};
        // referral_code を body トップレベルまたは answers 内から取得
        referralCodeFromForm = (
          (body.referral_code as string) || (raw.referral_code as string) || ""
        ).trim().toUpperCase() || null;
        Object.entries(raw).forEach(([k, val]) => {
          if (k === "store_id" || k === "referral_code") return;
          const v = val === undefined || val === null ? "" : String(val);
          if (v === "") return;
          const num = Number(v);
          answers[k] = Number.isNaN(num) ? v : num;
          if (/rating|score|満足度|satisfaction/.test(k)) score = Number.isNaN(num) ? score : num;
        });
      } catch {
        return createHtmlResponse("<p>JSONデータの解析に失敗しました。</p>");
      }
    } else {
      try {
        const fd = await req.formData();
        storeIdFromForm = (fd.get("store_id") as string) || "";
        vidFromForm = (fd.get("vid") as string) || null;
        lineUserIdFromForm = (fd.get("line_user_id") as string) || null;
        anonIdFromForm = (fd.get("anon_id") as string) || null;
        referralCodeFromForm = ((fd.get("referral_code") as string) || "").trim().toUpperCase() || null;
        const multiValues: Record<string, string[]> = {};
        fd.forEach((v, k) => {
          if (k === "store_id" || k === "referral_code") return;
          const val = typeof v === "string" ? v : (v as File).name;
          if (val === undefined || val === "") return;
          if (multiValues[k]) multiValues[k].push(val);
          else multiValues[k] = [val];
        });
        Object.entries(multiValues).forEach(([k, arr]) => {
          const val = arr.length === 1 ? arr[0] : arr.join(", ");
          const num = Number(val);
          answers[k] = Number.isNaN(num) ? val : num;
          if (/rating|score|満足度|satisfaction/.test(k)) score = Number.isNaN(num) ? score : num;
        });
      } catch {
        return createHtmlResponse("<p>フォームデータの解析に失敗しました。</p>");
      }
    }

    const store_id = storeIdFromForm || storeId || "";
    if (!store_id) {
      return createHtmlResponse("<p>store_id がありません。</p>");
    }

    const { data: store } = await supabase
      .from("store_profiles")
      .select("*")
      .eq("store_id", store_id)
      .maybeSingle();
    if (!store) {
      return createHtmlResponse("<p>店舗が見つかりません。</p>");
    }

    // ── IP ハッシュ生成（送信元識別用） ─────────────────────────────
    const _rawIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
      || req.headers.get("cf-connecting-ip")
      || req.headers.get("x-real-ip")
      || "unknown";
    const _ipBuf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(_rawIp + "_salt_v1"));
    const _ipHash = Array.from(new Uint8Array(_ipBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);

    // ── 営業時間チェック ─────────────────────────────────────────────
    const _openTime  = (store.business_open_time  as string | null) ?? null;
    const _closeTime = (store.business_close_time as string | null) ?? null;
    if (_openTime && _closeTime) {
      const _nowJstMs = Date.now() + 9 * 60 * 60 * 1000;
      const _nowJst   = new Date(_nowJstMs);
      const _curMin   = _nowJst.getUTCHours() * 60 + _nowJst.getUTCMinutes();
      const [_oh, _om] = _openTime.split(":").map(Number);
      const [_ch, _cm] = _closeTime.split(":").map(Number);
      const _openMin  = (_oh ?? 0) * 60 + (_om ?? 0);
      const _closeMin = (_ch ?? 0) * 60 + (_cm ?? 0);
      // 深夜またぎ考慮（例: 22:00〜02:00）
      const _isOpen = _closeMin > _openMin
        ? _curMin >= _openMin && _curMin <= _closeMin
        : _curMin >= _openMin || _curMin <= _closeMin;
      if (!_isOpen) {
        return createHtmlResponse(`
          <div style="min-height:100vh;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;">
            <div style="background:#fff;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1);">
              <div style="font-size:52px;margin-bottom:16px;">🕐</div>
              <h2 style="font-size:18px;font-weight:800;color:#111;margin:0 0 10px;">現在は営業時間外です</h2>
              <p style="font-size:13px;color:#6b7280;line-height:1.7;margin:0 0 20px;">アンケートは営業時間内のみ受け付けています。</p>
              <div style="background:#fefce8;border:1.5px solid #fde047;border-radius:12px;padding:12px 16px;">
                <span style="font-size:14px;font-weight:800;color:#854d0e;">🕐 受付時間：${_openTime}〜${_closeTime}</span>
              </div>
            </div>
          </div>
        `);
      }
    }

    // ── IP レート制限（同一回線から1日1回まで）────────────────────────
    // ip_block_enabled が false の場合はスキップ（デフォルト true）
    if ((store as Record<string, unknown>).ip_block_enabled !== false) {
      const _ipNowJstMs = Date.now() + 9 * 60 * 60 * 1000;
      const _ipJstDate  = new Date(_ipNowJstMs).toISOString().slice(0, 10);
      const _ipDayStart = new Date(`${_ipJstDate}T00:00:00+09:00`);
      const { count: _ipTodayCount } = await supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store_id)
        .eq("ip_hash", _ipHash)
        .gte("created_at", _ipDayStart.toISOString());
      if ((_ipTodayCount ?? 0) >= 1) {
        return createHtmlResponse(`
          <div style="min-height:100vh;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;">
            <div style="background:#fff;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1);">
              <div style="font-size:52px;margin-bottom:16px;">⚠️</div>
              <h2 style="font-size:18px;font-weight:800;color:#111;margin:0 0 10px;">本日はすでに送信済みです</h2>
              <p style="font-size:13px;color:#6b7280;line-height:1.7;margin:0 0 20px;">同じ回線から本日すでにアンケートが送信されています。<br>アンケートは<strong>1日1回</strong>のみご利用いただけます。</p>
              <div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;padding:12px 16px;">
                <span style="font-size:13px;color:#dc2626;font-weight:700;">また明日のご来店をお待ちしております！</span>
              </div>
            </div>
          </div>
        `);
      }
    }

    // rating 質問キーを form_questions から取得してスコアを再確定
    // （question_key 名が regex に頼らず確実にスコアを拾う）
    const { data: formQsForScore } = await supabase
      .from("form_questions")
      .select("question_key, question_type, label")
      .eq("store_id", store_id);
    const ratingQuestionKeys = new Set(
      (formQsForScore || [])
        .filter((q) => q.question_type === "rating")
        .map((q) => q.question_key as string)
    );
    // answers から rating 質問の値でスコアを上書き
    for (const [k, v] of Object.entries(answers)) {
      if (ratingQuestionKeys.has(k)) {
        const n = Number(v);
        if (!Number.isNaN(n)) { score = n; break; }
      }
    }

    // この店舗の公式メニュー一覧（存在しないメニューを口コミに出さないため）
    // メニュー情報は store_menu_items に集約し、store_profiles では管理しない
    const { data: storeMenuDbRows } = await supabase
      .from("store_menu_items")
      .select("*")
      .eq("store_id", store_id);
    const menuItems: StoreMenuItemRow[] = flattenStoreMenuItemsFromDb(storeMenuDbRows || []);

    // アンケート回答から「今回のメインカテゴリ」を推定する
    // 共通で main_menu 質問をメインメニューとして扱い、store_menu_items.question_key / answer_values でカテゴリをひも付ける
    const MAIN_MENU_KEY = "main_menu";
    const mainRaw = (answers as Record<string, unknown>)[MAIN_MENU_KEY];
    const mainValue = mainRaw == null ? "" : String(mainRaw);
    /** アンケート回答値と answer_values の照合（mainCategory / usedMenuKeys で共通利用） */
    const answerMatchesList = (av: string[] | null | undefined, raw: unknown): boolean => {
      const arr = Array.isArray(av) ? av : [];
      const v = raw == null ? "" : String(raw).trim();
      if (!v) return false;
      return arr.some((x) => String(x).trim() === v);
    };

    const mainCategory: string | null = (() => {
      if (!mainValue || !menuItems || menuItems.length === 0) return null;
      for (const m of menuItems) {
        if ((m.question_key || "") !== MAIN_MENU_KEY) continue;
        const arr = Array.isArray(m.answer_values) ? m.answer_values : [];
        if (answerMatchesList(arr, mainRaw)) {
          return m.category || null;
        }
      }
      return null;
    })();

    /** アンケート回答内の文字列値を収集（メニュー候補の突合に使用） */
    const collectAnswerStrings = (obj: Record<string, unknown>): Set<string> => {
      const out = new Set<string>();
      const walk = (v: unknown) => {
        if (v === null || v === undefined) return;
        if (typeof v === "string" && v.trim()) out.add(v.trim());
        if (typeof v === "number") out.add(String(v));
        if (Array.isArray(v)) v.forEach(walk);
      };
      Object.values(obj).forEach(walk);
      return out;
    };

    /**
     * 今回の回答から「具体名として口コミに出してよい」menu_key
     * - 非 main の質問（sub_menu_* 等）: question_key と answers[question_key]（通常は選択肢の id）を answer_values と照合
     * - main_menu: 上記に加え、サブが無い店舗向けに main_menu 行も照合
     * - DB例（1店舗1行・items jsonb）: items に
     *   {"menu_key":"takoyaki_so-su","name_ja":"たこ焼き（ソース）","name_spoken_ja":"ソース味のたこ焼き",
     *    "question_key":"sub_menu_takoyaki","answer_values":["takoyaki_so-su"],"category":"たこ焼き","sort_order":10}
     *   （フォームは radio の value=id を保存するため answer_values は id を含める。id が menu_key と同じなら menu_key を同じに）
     * - sub_menu 等で1件以上マッチした場合、main_menu 行だけで紐づいた「親カテゴリ」キーは候補から外し、具体度を優先する
     */
    const usedMenuKeys: Set<string> = (() => {
      const keys = new Set<string>();
      /** 回答値に menu_key 文字列が直接含まれる、または main 以外の質問で照合できたキー */
      const fromSpecificOrDirect = new Set<string>();
      /** main_menu 行の answer_values 照合でだけ付いたキー */
      const fromMainMenuRowOnly = new Set<string>();
      const list = menuItems;
      const answerStrs = collectAnswerStrings(answers as Record<string, unknown>);
      for (const m of list) {
        if (m.is_active === false) continue;
        const mk = m.menu_key.trim();
        if (answerStrs.has(mk)) {
          keys.add(mk);
          fromSpecificOrDirect.add(mk);
        }
      }
      for (const m of list) {
        if (m.is_active === false) continue;
        const mk = m.menu_key.trim();
        const qk = String(m.question_key ?? "").trim();
        if (!qk || qk === MAIN_MENU_KEY) continue;
        const av = Array.isArray(m.answer_values) ? m.answer_values : [];
        const avRaw = (answers as Record<string, unknown>)[qk];
        if (answerMatchesList(av, avRaw)) {
          keys.add(mk);
          fromSpecificOrDirect.add(mk);
        }
      }
      for (const m of list) {
        if (m.is_active === false) continue;
        const mk = m.menu_key.trim();
        const qk = String(m.question_key ?? "").trim();
        if (qk !== MAIN_MENU_KEY) continue;
        const av = Array.isArray(m.answer_values) ? m.answer_values : [];
        if (answerMatchesList(av, mainRaw)) {
          keys.add(mk);
          if (!fromSpecificOrDirect.has(mk)) fromMainMenuRowOnly.add(mk);
        }
      }
      if (fromSpecificOrDirect.size > 0) {
        for (const mk of fromMainMenuRowOnly) {
          keys.delete(mk);
        }
      }
      return keys;
    })();

    const thresholdHigh = Number(store.score_threshold_high ?? 9);
    const thresholdMid = Number(store.score_threshold_mid ?? 7);
    const scoreMax = Math.max(1, Number(store.score_max) || 5);
    const scoreMin = Math.max(0, Math.min(scoreMax - 1, Number(store.score_min) ?? 1));
    const shouldGenerate = true;

    // store_menu_items 未設定の店舗向け：自由記述で料理名が書かれていれば抽出
    const FOOD_TEXTAREA_PATTERN = /favorite|food|dish|menu|料理|メニュー|食べ|美味|うまい|oishi/i;
    const freeTextDishAnswers: string[] = [];
    if (usedMenuKeys.size === 0) {
      for (const q of (formQsForScore || [])) {
        if (q.question_type !== "textarea") continue;
        const keyMatch = FOOD_TEXTAREA_PATTERN.test(String(q.question_key ?? ""));
        const labelMatch = FOOD_TEXTAREA_PATTERN.test(String(q.label ?? ""));
        if (!keyMatch && !labelMatch) continue;
        const ans = String((answers as Record<string, unknown>)[q.question_key] ?? "").trim();
        if (ans) freeTextDishAnswers.push(ans);
      }
    }

    // 直近の口コミを取得してバリエーションに使用（最大5件）
    const { data: recentReviewsData } = await supabase
      .from("reviews")
      .select("review_options")
      .eq("store_id", store_id)
      .not("review_options", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);
    const recentReviewTexts: string[] = [];
    for (const row of (recentReviewsData || [])) {
      const opts = row.review_options as Record<string, string> | null;
      if (opts) {
        if (opts.style1) recentReviewTexts.push(opts.style1);
        if (opts.style2) recentReviewTexts.push(opts.style2);
      }
    }

    let review_options: Record<string, string> = {};
    if (shouldGenerate) {
      const { systemPrompt } = buildPromptConfig(store as StorePromptRow, score, lang, recentReviewTexts);
      const SURVEY_LABEL: Record<Lang, string> = {
        ja: "今回のアンケート回答：", en: "Survey answers:", zh: "问卷回答：", ko: "설문 답변:", es: "Respuestas:", fr: "Réponses:", th: "คำตอบ:", vi: "Câu trả lời:",
      };
      const STORE_LABEL: Record<Lang, string> = {
        ja: "店舗名: ", en: "Store name: ", zh: "店铺名: ", ko: "매장명: ", es: "Tienda: ", fr: "Magasin: ", th: "ร้าน: ", vi: "Cửa hàng: ",
      };
      const HASHTAG_LABEL: Record<Lang, string> = {
        ja: "\n【固定タグ】\n", en: "\n【Fixed hashtags】\n", zh: "\n【固定标签】\n", ko: "\n【고정 해시태그】\n", es: "\n【Hashtags fijos】\n", fr: "\n【Hashtags fixes】\n", th: "\n【แฮชแท็ก】\n", vi: "\n【Hashtag】\n",
      };
      const OUTPUT_INSTR: Record<Lang, string> = {
        ja: "\nJSON形式 {style1:\"\", style2:\"\", style3:\"\"} で口コミ本文のみ出力してください。",
        en: "\nOutput the review body only in JSON format {style1:\"\", style2:\"\", style3:\"\"}.",
        zh: "\n仅以 JSON 格式 {style1:\"\", style2:\"\", style3:\"\"} 输出评价正文。",
        ko: "\nJSON 형식 {style1:\"\", style2:\"\", style3:\"\"}으로 리뷰 본문만 출력하세요.",
        es: "\nOutput the review body only in JSON format {style1:\"\", style2:\"\", style3:\"\"}.",
        fr: "\nOutput the review body only in JSON format {style1:\"\", style2:\"\", style3:\"\"}.",
        th: "\nOutput the review body only in JSON format {style1:\"\", style2:\"\", style3:\"\"}.",
        vi: "\nOutput the review body only in JSON format {style1:\"\", style2:\"\", style3:\"\"}.",
      };
      // 今回のメインカテゴリに基づき、他カテゴリの具体的な商品名を出さないよう制約をかける（店舗共通ルール）
      const CATEGORY_RULE_TEXT: Record<Lang, string> = {
        ja: mainCategory
          ? `\n【今回の利用カテゴリ】\nお客様が今回選んだメインカテゴリ: ${mainCategory}\n\n【厳守ルール（カテゴリ）】\n・今回選ばれたカテゴリ（${mainCategory}）に属するメニューだけ、具体的な商品名として書いてよい。\n・それ以外のカテゴリに属するメニュー名（たとえば今回注文していないカテゴリのメニュー名）は一切書いてはいけない。\n・他カテゴリについて言及したくなった場合も、「他のメニュー」「別のメニュー」など一般表現に言い換えること。\n`
          : "",
        en: mainCategory
          ? `\n[Current main category]\nThe customer chose this main category: ${mainCategory}\n\n[Strict category rules]\n- You may mention concrete dish names ONLY for menu items that belong to this category (${mainCategory}).\n- Do NOT mention concrete dish names from any other categories.\n- If you want to refer to other categories, use generic phrases like "other menu items" instead of specific dish names.\n`
          : "",
        zh: mainCategory
          ? `\n【本次使用的主类别】\n顾客本次选择的主类别: ${mainCategory}\n\n【严格类别规则】\n- 只能对该类别（${mainCategory}）下的菜单使用具体菜名。\n- 其他类别的具体菜名一律不得写出。\n- 若需提及其他类别，仅以“其他菜单”等泛化表述代替具体菜名。\n`
          : "",
        ko: mainCategory
          ? `\n[이번 이용 카테고리]\n손님이 이번에 선택한 메인 카테고리: ${mainCategory}\n\n[엄수 규칙(카테고리)]\n- 이번에 선택된 카테고리(${mainCategory})에 속하는 메뉴만 구체적인 메뉴 이름으로 언급할 수 있습니다.\n- 그 외 카테고리에 속하는 메뉴 이름은 절대로 쓰면 안 됩니다.\n- 다른 카테고리를 언급하고 싶을 때는 '다른 메뉴'처럼 일반적인 표현으로 바꾸세요.\n`
          : "",
        es: mainCategory
          ? `\n[Categoría principal de esta visita]\nCategoría principal elegida por el cliente: ${mainCategory}\n\n[Reglas estrictas por categoría]\n- Solo puedes mencionar por su nombre concreto los platos que pertenezcan a esta categoría (${mainCategory}).\n- No debes mencionar el nombre concreto de platos de otras categorías.\n- Si quieres hablar de otras categorías, usa expresiones genéricas como \"otros menús\".\n`
          : "",
        fr: mainCategory
          ? `\n[Catégorie principale de cette visite]\nCatégorie principale choisie par le client : ${mainCategory}\n\n[Règles strictes par catégorie]\n- Vous ne pouvez citer par leur nom précis que les plats appartenant à cette catégorie (${mainCategory}).\n- Ne citez jamais le nom précis de plats d’autres catégories.\n- Si vous souhaitez évoquer d’autres catégories, utilisez des expressions génériques comme « autres menus ».\n`
          : "",
        th: mainCategory
          ? `\n[หมวดหมู่หลักที่ใช้ในครั้งนี้]\nหมวดหมู่หลักที่ลูกค้าเลือก: ${mainCategory}\n\n[กฎเข้มงวดตามหมวดหมู่]\n- ให้พูดชื่อเมนูแบบเจาะจงได้เฉพาะเมนูที่อยู่ในหมวดหมู่ (${mainCategory}) เท่านั้น\n- ห้ามเขียนชื่อเมนูแบบเจาะจงของหมวดหมู่อื่นโดยเด็ดขาด\n- หากอยากพูดถึงหมวดอื่น ให้ใช้คำทั่วไป เช่น “เมนูอื่นๆ” แทนชื่อเมนู\n`
          : "",
        vi: mainCategory
          ? `\n[Danh mục chính trong lần ghé này]\nDanh mục chính khách hàng đã chọn: ${mainCategory}\n\n[Quy tắc nghiêm ngặt theo danh mục]\n- Chỉ được phép nêu tên món cụ thể thuộc danh mục này (${mainCategory}).\n- Không được nêu tên món cụ thể thuộc các danh mục khác.\n- Nếu muốn nhắc đến danh mục khác, hãy dùng cách nói chung chung như \"các món khác\" thay vì tên món cụ thể.\n`
          : "",
      };
      const SURVEY_MENU_RULE: Record<Lang, string> = {
        ja: "\n【アンケート回答との整合（メニュー）】\n・今回のアンケート回答（上記JSON）の値として登場していないメニュー名は、口コミに書かないこと。\n・公式メニュー一覧に含まれていても、回答に現れないメニューは「今回食べていない」として具体名を出さないこと。\n",
        en: "\n[Alignment with survey answers (menus)]\n- Do NOT mention any concrete menu/dish name that does not appear as a value in the survey JSON above.\n- Even if a name appears on the official menu list, if it does not appear in the answers, treat it as NOT ordered this visit and do not use it as a concrete name.\n",
        zh: "\n【与问卷一致（菜单）】\n- 不得写出未出现在上述问卷JSON值中的具体菜名。\n- 即使菜名在官方菜单列表中，若未出现在回答中，也视为本次未点，不得作为具体菜名写出。\n",
        ko: "\n[설문 답변과의 일치(메뉴)]\n- 위 설문 JSON 값에 등장하지 않은 메뉴 이름은 리뷰에 쓰지 마세요.\n- 공식 메뉴 목록에 있어도 답변에 없으면 이번에 주문하지 않은 것으로 보고 구체적 이름을 쓰지 마세요.\n",
        es: "\n[Coherencia con la encuesta (menús)]\n- NO menciones ningún nombre concreto de plato que no aparezca como valor en el JSON de la encuesta.\n- Aunque esté en la lista oficial, si no está en las respuestas, no lo trates como pedido en esta visita.\n",
        fr: "\n[Cohérence avec le questionnaire (menus)]\n- N’utilisez aucun nom de plat concret qui n’apparaît pas comme valeur dans le JSON du questionnaire.\n- Même s’il figure sur la liste officielle, s’il n’apparaît pas dans les réponses, ne le citez pas comme plat consommé cette fois-ci.\n",
        th: "\n[สอดคล้องกับแบบสอบถาม (เมนู)]\n- ห้ามเขียนชื่อเมนูเฉพาะที่ไม่ปรากฏเป็นค่าใน JSON ของแบบสอบถามด้านบน\n- แม้อยู่ในรายการเมนูทางการ หากไม่อยู่ในคำตอบ ถือว่าไม่ได้สั่งในครั้งนี้\n",
        vi: "\n[Khớp với khảo sát (thực đơn)]\n- KHÔNG được nhắc tên món cụ thể không xuất hiện trong giá trị JSON khảo sát phía trên.\n- Dù có trong danh sách chính thức, nếu không có trong câu trả lời thì coi như không gọi lần này.\n",
      };
      const DISH_NAME_MANDATORY: Record<Lang, string> = {
        ja: "\n【具体メニュー名の必須（候補があるとき）】\n・上記【今回の利用メニュー候補】に1件でも載っている場合、味・満足・おすすめに触れる各案（style1〜3）すべてで **必ずその料理を本文に明示** すること。\n・一覧に「口コミ本文はこの言い方を優先」がある行は **必ずその口語表記で書く**（例: ソース味のたこ焼き）。**ない行**は「:」右の公式名をそのまま羅列せず、**口コミ向けの自然な話し言葉**に言い換えてよい。例:「たこ焼き（ソース）」→「ソース味のたこ焼き」、「△△（しょうゆ）」→「醤油味の△△」のように、括弧内は味・き方・トッピングとして読みやすく前後に伸ばす。別の料理に取り違えないこと。内部コード（:の左のキー）だけをそのまま本文に出さない。\n・「今回の料理が美味しかった」など **何を食べたか分からない言い方だけ** にしてはいけない。\n・候補が複数ある場合は **少なくとも1品**を必ず明示し、可能なら回答に最も合う品を主に書くこと。\n",
        en: "\n[MUST name the dish when candidates exist]\nIf [Menus likely ordered this visit] lists any items, EVERY review variant (style1–3) that mentions taste/satisfaction MUST name at least one dish clearly.\nIf a line includes a preferred natural phrasing (e.g. in Japanese 「…」), use that in the body (adapt to the output language when writing non‑Japanese). Otherwise paraphrase the name after “:” into natural spoken wording instead of stiff menu-board style; never output only the internal code before “:”. Do NOT only say “the food was great” without naming WHAT was great.\nIf several candidates apply, name at least one explicitly.\n",
        zh: "\n【有候选时必须写出具体菜名】\n若上方「本次可能点的菜」非空，则凡提到口味/满意度的每个方案（style1–3）都必须在正文中写出至少一道菜的**顾客可见名称**（列表中冒号后的名称）。禁止只用「菜很好吃」而不说是什么菜。多项候选时至少写清一个具体名称。\n",
        ko: "\n[후보가 있을 때 메뉴명 필수]\n위 ‘이번 방문 메뉴’ 목록이 비어 있지 않으면, 맛·만족을 언급하는 style1~3 각각에서 **고객에게 보이는 메뉴명을 본문에 반드시 명시**하세요. ‘음식이 맛있었다’만 쓰고 무엇인지 알 수 없게 쓰지 마세요. 여러 후보가 있으면 최소 1개 이상 구체적 이름을 넣으세요.\n",
        es: "\n[OBLIGATORIO nombrar el plato si hay candidatos]\nSi la lista de menús probables no está vacía, cada estilo (style1–3) que mencione el sabor/debe incluir AL MENOS un nombre de plato visible para el cliente. No diga solo «la comida estaba rica» sin decir qué plato.\n",
        fr: "\n[NOM OBLIGATOIRE du plat si des candidats existent]\nSi la liste des menus probables n’est pas vide, chaque variante (style1–3) qui évoque le goût/la satisfaction DOIT mentionner au moins un nom de plat compréhensible pour le client. Ne dites pas seulement « c’était délicieux » sans préciser quoi.\n",
        th: "\n[บังคับใส่ชื่อเมนูเมื่อมีรายการ]\nหากมีรายการเมนูที่เป็นไปได้ข้างบน ทุกแบบ (style1–3) ที่พูดถึงรสชาติ/ความพึงพอใจ **ต้องระบุชื่อเมนูที่ลูกค้าเข้าใจ** อย่างน้อยหนึ่งรายการ ห้ามบอกแค่ว่าอาหารอร่อยโดยไม่บอกว่าคือเมนูใด\n",
        vi: "\n[BẮT BUỘC ghi tên món khi có danh sách]\nNếu phần menu có thể gọi không trống, mỗi phiên bản (style1–3) khi nhắc hương vị/sự hài lòng **phải ghi rõ ít nhất một tên món** mà khách hiểu được. Không được chỉ nói “món ăn ngon” mà không nói món gì.\n",
      };
      const USED_MENU_HEADER: Record<Lang, string> = {
        ja: "\n【今回の利用メニュー候補】\n今回のアンケート回答から、今回利用した可能性が高いメニューは次のみです。**この一覧に含まれる料理だけ**を口コミに具体的に触れてよい。公式名が括弧付きでも、本文では口語・自然な言い回しにしてよい（行に口語優先があればそれに従う）。一覧にないメニューは今回具体名を出さないこと。\n",
        en: "\n[Menus likely ordered this visit]\nOnly the items below are inferred from the survey as likely ordered. **You may use ONLY these as concrete dish names in the review.** Do not name other dishes from the full official list.\n",
        zh: "\n【本次可能点的菜】\n以下仅根据问卷推断为本轮可能点的菜。**只有这些可以作为具体菜名写入评价。** 官方列表中有但未列于此的，本次不要写具体名。\n",
        ko: "\n[이번 방문에서 주문했을 가능성이 있는 메뉴]\n아래만 설문으로 추정됩니다. **구체적 메뉴명으로 쓸 수 있는 것은 이 목록뿐입니다.**\n",
        es: "\n[Menús probables en esta visita]\nSolo los siguientes se infieren del cuestionario. **Solo estos pueden citarse por nombre concreto.**\n",
        fr: "\n[Menus probables pour cette visite]\nSeuls les éléments ci-dessous sont déduits du questionnaire. **Seuls ceux-ci peuvent être cités par nom précis.**\n",
        th: "\n[เมนูที่น่าจะสั่งในครั้งนี้]\nรายการด้านล่างสรุปจากแบบสอบถามเท่านั้น **ใช้ชื่อเฉพาะได้เฉพาะรายการนี้**\n",
        vi: "\n[Menu có thể đã gọi lần này]\nChỉ các mục dưới đây được suy ra từ khảo sát. **Chỉ được dùng tên cụ thể cho các mục này.**\n",
      };
      const USED_MENU_EMPTY: Record<Lang, string> = {
        ja: "（回答からは特定のメニューを1件も特定できませんでした。）\n**いかなる具体メニュー名（公式メニュー一覧にあるものも含む）も口コミに書かないこと。**「いただいた料理」「注文したメニュー」など一般表現のみ使うこと。\n",
        en: "(No specific menu could be inferred from the answers.)\n**Do not write ANY concrete dish name (including names on the official list).** Use only generic phrases like \"the dish we ordered\".\n",
        zh: "（未能从回答中确定任何具体菜品。）\n**不要写出任何具体菜名（含官方列表中的）。** 仅用「点的菜」等泛称。\n",
        ko: "(답변으로 특정 메뉴를 특정하지 못했습니다.)\n**구체적 메뉴명은 쓰지 마세요.**\n",
        es: "(No se pudo inferir ningún menú concreto.)\n**No escribas ningún nombre de plato concreto.**\n",
        fr: "(Aucun menu précis n’a pu être déduit.)\n**N’écrivez aucun nom de plat précis.**\n",
        th: "(ไม่สามารถระบุเมนูเฉพาะได้)\n**ห้ามเขียนชื่อเมนูเฉพาะใดๆ**\n",
        vi: "(Không suy ra được món cụ thể.)\n**Không viết tên món cụ thể nào.**\n",
      };
      const MENU_HEADER: Record<Lang, string> = {
        ja: "\n【この店舗の公式メニュー一覧（参考・存在チェック用）】\n以下は店舗で扱うことのあるメニューの参考です。架空のメニュー名は作らないこと。**口コミ本文に固有名詞として使ってよいのは、上記【今回の利用メニュー候補】に含まれるものだけ。** 一覧にあっても候補にないメニューは今回食べていないものとして具体名を出さないこと。候補が空のときは具体メニュー名は一切使わないこと。\n",
        en: "\n[Official menu list — reference only]\nThis list shows dishes the store may offer; do not invent new names. **You may only use concrete dish names that appear in [Menus likely ordered this visit] above.** Even if listed here, if not in that subset, do not name them for this visit. If that subset is empty, use no concrete dish names.\n",
        zh: "\n【官方菜单（仅供参考）】\n不得编造新菜名。**只有「本次可能点的菜」中的才可写具体名。**\n",
        ko: "\n[공식 메뉴 목록 — 참고용]\n새 메뉴명을 만들지 마세요. **구체적 이름은 위 ‘이번 방문 메뉴’에 있는 것만.**\n",
        es: "\n[Lista oficial — solo referencia]\nNo inventes nombres. **Solo nombres concretos de la sección de menús probables de esta visita.**\n",
        fr: "\n[Liste officielle — référence]\nN’inventez pas de noms. **Noms précis autorisés uniquement dans la section menus probables ci-dessus.**\n",
        th: "\n[รายการเมนูทางการ — อ้างอิง]\nห้ามสร้างชื่อใหม่ **ใช้ชื่อเฉพาะเฉพาะที่อยู่ในส่วนเมนูครั้งนี้**\n",
        vi: "\n[Danh sách chính thức — tham khảo]\nKhông bịa tên. **Chỉ tên cụ thể trong phần menu lần này.**\n",
      };
      const formatMenuLine = (m: {
        menu_key?: string | null;
        name_ja?: string | null;
        name_spoken_ja?: string | null;
        category?: string | null;
      }) => {
        const key = String(m.menu_key ?? "").trim();
        const name = String(m.name_ja ?? "").trim();
        const spoken = String(m.name_spoken_ja ?? "").trim();
        const cat = m.category ? String(m.category) : "";
        let base = key ? `${key}: ${name}` : name;
        if (spoken) {
          base +=
            lang === "ja"
              ? ` （口コミ本文はこの言い方を優先:「${spoken.replace(/\r?\n/g, " ").trim()}」）`
              : ` (prefer this natural phrasing in the review body: 「${spoken.replace(/\r?\n/g, " ").trim()}」 — adapt to output language if needed)`;
        }
        if (!base.trim()) return "";
        return cat ? `${base} （カテゴリ: ${cat}）` : base;
      };
      const MENU_LIST_TEXT = (() => {
        if (!menuItems || menuItems.length === 0) return "";
        const rows = menuItems
          .filter((m) => m.is_active !== false)
          .map((m) => formatMenuLine(m))
          .filter((line) => line.trim().length > 0);
        return rows.length ? rows.join("\n") + "\n" : "";
      })();
      const USED_MENU_LIST_TEXT = (() => {
        if (!menuItems || menuItems.length === 0 || usedMenuKeys.size === 0) return "";
        const rows = menuItems
          .filter((m) => m.is_active !== false && usedMenuKeys.has(m.menu_key.trim()))
          .map((m) => formatMenuLine(m))
          .filter((line) => line.trim().length > 0);
        return rows.length ? rows.join("\n") + "\n" : "";
      })();
      // 自由記述の料理名ブロック（store_menu_items未設定でも料理名を口コミに反映）
      const FREE_TEXT_DISH_HEADER: Record<string, string> = {
        ja: "\n【お客様が記述した料理名（必須）】\nお客様がアンケートで自由記述した料理名です。この料理名を口コミの各スタイル（style1〜3）すべてに必ず自然に組み込み、具体的に言及すること。「料理が美味しかった」など何を食べたか分からない抽象表現だけにしてはいけない。\n",
        en: "\n[Customer-described dish (REQUIRED)]\nThe customer wrote this dish name in the free-text survey field. You MUST naturally incorporate this specific dish name into every review style. Do not use only generic phrases like \"the food was delicious\" without naming the dish.\n",
        zh: "\n【顾客填写的菜名（必须）】\n顾客在问卷自由填写了这道菜的名称。必须在所有风格（style1〜3）中自然地提到该具体菜名，不得只用模糊表达（如仅写菜很好吃）。\n",
        ko: "\n[고객이 기재한 요리명(필수)]\n고객이 설문 자유 기재란에 요리명을 입력했습니다. 모든 스타일(style1〜3)에 반드시 이 요리명을 자연스럽게 포함하세요. 무엇을 먹었는지 알 수 없는 표현만으로는 안 됩니다.\n",
      };
      const usedMenuListBody =
        usedMenuKeys.size > 0
          ? USED_MENU_LIST_TEXT.trim()
            ? USED_MENU_LIST_TEXT
            : [...usedMenuKeys].sort().join("\n") + "\n"
          : "";
      const usedMenuBlock =
        usedMenuKeys.size > 0
          ? (USED_MENU_HEADER[lang] || USED_MENU_HEADER.en) + usedMenuListBody
          : freeTextDishAnswers.length > 0
          ? (FREE_TEXT_DISH_HEADER[lang] || FREE_TEXT_DISH_HEADER.ja) + freeTextDishAnswers.join("\n") + "\n"
          : (USED_MENU_HEADER[lang] || USED_MENU_HEADER.en) + (USED_MENU_EMPTY[lang] || USED_MENU_EMPTY.en);
      const storeUiMode = String(store.ui_mode ?? "sns").toLowerCase();
      const includeHashtagsInUser = storeUiMode !== "review";
      const userContent = [
        (SURVEY_LABEL[lang] || SURVEY_LABEL.en),
        JSON.stringify(answers),
        SURVEY_MENU_RULE[lang] || SURVEY_MENU_RULE.en,
        "\n" + (STORE_LABEL[lang] || STORE_LABEL.en) + ((typeof store.form_display_name === "string" && store.form_display_name.trim()) ? store.form_display_name.trim() : (store.store_name_ja as string) || (store.store_name_jp as string) || store_id),
        includeHashtagsInUser && (store.hashtags_fixed as string)?.trim()
          ? (HASHTAG_LABEL[lang] || HASHTAG_LABEL.en) + store.hashtags_fixed
          : "",
        CATEGORY_RULE_TEXT[lang] || CATEGORY_RULE_TEXT.en,
        usedMenuBlock,
        (usedMenuKeys.size > 0 || freeTextDishAnswers.length > 0) ? (DISH_NAME_MANDATORY[lang] || DISH_NAME_MANDATORY.en) : "",
        MENU_HEADER[lang] || MENU_HEADER.en,
        MENU_LIST_TEXT,
        OUTPUT_INSTR[lang] || OUTPUT_INSTR.en,
      ]
        .filter(Boolean)
        .join("\n");

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      review_options = {
        style1: String(parsed.style1 ?? ""),
        style2: String(parsed.style2 ?? ""),
        style3: String(parsed.style3 ?? ""),
      };
    }

    const coupon_awarded = (() => {
      const base =
        score >= thresholdHigh
          ? (store.coupon_high_score as string)?.trim() || "スタッフまでお尋ねください"
          : (store.coupon_low_score as string)?.trim() || "スタッフまでお尋ねください";
      if (store.coupon_special_active && (store.coupon_special as string)?.trim()) {
        if (store.coupon_special_active_dup) return `${base}\n\n${store.coupon_special}`;
        return String(store.coupon_special);
      }
      return base;
    })();

    // ── アンケート回数制限チェック（1日1回 or 1ユーザー1回限り） ────────
    // ip_block_enabled === false または test_mode === true の店舗はスキップ
    if ((store as Record<string, unknown>).ip_block_enabled === false || (store as Record<string, unknown>).test_mode === true) { /* skip survey count check */ } else
    {
      const _surveyOncePerUser = !!(store.survey_once_per_user as boolean | null);
      let _surveyCheckId: string | null = null;
      if (lineUserIdFromForm) {
        const { data: _ci } = await supabase.from("customer_identity").select("id").eq("line_user_id", lineUserIdFromForm).maybeSingle();
        _surveyCheckId = (_ci?.id as string) ?? null;
      }
      if (!_surveyCheckId && anonIdFromForm) {
        const { data: _ci } = await supabase.from("customer_identity").select("id").eq("anon_id", anonIdFromForm).maybeSingle();
        _surveyCheckId = (_ci?.id as string) ?? null;
      }
      if (_surveyCheckId) {
        let _surveyQuery = supabase
          .from("customer_points_ledger")
          .select("id", { count: "exact", head: true })
          .eq("identity_id", _surveyCheckId)
          .eq("action_type", "survey");
        if (!_surveyOncePerUser) {
          // 1日1回モード：今日の分だけ確認
          const _nowJstMs = Date.now() + 9 * 60 * 60 * 1000;
          const _jstDate  = new Date(_nowJstMs).toISOString().slice(0, 10);
          const _dayStart = new Date(`${_jstDate}T00:00:00+09:00`);
          const _dayEnd   = new Date(`${_jstDate}T23:59:59.999+09:00`);
          _surveyQuery = _surveyQuery
            .gte("created_at", _dayStart.toISOString())
            .lte("created_at", _dayEnd.toISOString());
        }
        // _surveyOncePerUser === true の場合は日付フィルタなし → 過去すべてチェック
        const { count: _surveyCount } = await _surveyQuery;
        if ((_surveyCount ?? 0) >= 1) {
          if (_surveyOncePerUser) {
            // 1ユーザー1回限りモード
            const _revisitEnabled = (store as Record<string, unknown>).revisit_point_enabled !== false;
            const _bodyText = _revisitEnabled
              ? `すでにご回答いただいております。<br>ポイントは<strong>ご来店のたびに</strong>貯めることができます。<br>またのご来店をお待ちしております！`
              : `すでにご回答いただいております。<br>またのご来店をお待ちしております！`;
            const _revisitBox = _revisitEnabled
              ? `<div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:14px 16px;">
                    <span style="font-size:13px;color:#1d4ed8;font-weight:700;">📍 来店ポイントでポイントを貯めよう</span>
                  </div>`
              : ``;
            return createHtmlResponse(`
              <div style="min-height:100vh;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;">
                <div style="background:#fff;border-radius:20px;padding:36px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1);">
                  <div style="font-size:56px;margin-bottom:16px;">📋</div>
                  <h2 style="font-size:19px;font-weight:800;color:#111;margin:0 0 12px;">アンケートは<br>おひとり様1回限りです</h2>
                  <p style="font-size:13px;color:#6b7280;line-height:1.8;margin:0 0 20px;">${_bodyText}</p>
                  ${_revisitBox}
                </div>
              </div>
            `);
          } else {
            // 1日1回モード: 今日の送信済みサーベイを探して口コミ・フィードバック動線を継続提供
            const _nowJstMs2 = Date.now() + 9 * 60 * 60 * 1000;
            const _jstDate2  = new Date(_nowJstMs2).toISOString().slice(0, 10);
            const _dayStart2 = new Date(`${_jstDate2}T00:00:00+09:00`);
            const _dayEnd2   = new Date(`${_jstDate2}T23:59:59.999+09:00`);
            const { data: _latestSurveyEntry } = await supabase
              .from("customer_points_ledger")
              .select("source_ref")
              .eq("identity_id", _surveyCheckId as string)
              .eq("action_type", "survey")
              .gte("created_at", _dayStart2.toISOString())
              .lte("created_at", _dayEnd2.toISOString())
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const _todaySid = (_latestSurveyEntry?.source_ref as string) ?? null;
            let _todayRev: { id: string; line_user_id: string | null; review_options: Record<string, string> | null } | null = null;
            if (_todaySid) {
              const { data: _rRow } = await supabase
                .from("reviews")
                .select("id, line_user_id, review_options")
                .eq("submission_id", _todaySid)
                .eq("store_id", store_id)
                .maybeSingle();
              _todayRev = (_rRow as { id: string; line_user_id: string | null; review_options: Record<string, string> | null }) ?? null;
            }
            const _gPts  = Number((store as Record<string, unknown>).point_rule_google ?? 3);
            const _fbPts = _gPts + 1;
            const _tc    = String((store as Record<string, unknown>).theme_color ?? "#6366f1");
            const _apiBase = new URL(req.url).origin + "/functions/v1/form-engine";
            // 初回生成画面と同じサイトリンクリストを構築
            const _allSiteLinks = [
              { n: "⭐ Googleに口コミを書く",    u: String((store as Record<string,unknown>).review_url_google    ?? (store as Record<string,unknown>).google_url    ?? ""), c: "#4285F4" },
              { n: "🍽 Hotpepperに口コミを書く",  u: String((store as Record<string,unknown>).review_url_hotpepper ?? ""), c: "#FF3B30" },
              { n: "🍜 食べログに口コミを書く",    u: String((store as Record<string,unknown>).review_url_tabelog   ?? ""), c: "#FF9500" },
              { n: "👥 Rettyに口コミを書く",      u: String((store as Record<string,unknown>).review_url_retty     ?? ""), c: "#FF6B6B" },
              { n: "💎 OZmallに口コミを書く",     u: String((store as Record<string,unknown>).review_url_ozmall    ?? ""), c: "#E65100" },
              { n: "🏨 一休に口コミを書く",        u: String((store as Record<string,unknown>).review_url_ikyu      ?? ""), c: "#1976D2" },
            ].filter(l => l.u && l.u !== "null" && l.u.startsWith("http"));
            if (_todayRev && _allSiteLinks.length > 0) {
              // 口コミ・フィードバック動線を継続表示（今日のセッションの続き）
              const _opts = _todayRev.review_options ?? {};
              // style1 → style2 → style3 の順で最初に中身があるものを使用
              const _reviewComment = ((_opts.style1 || _opts.style2 || _opts.style3) ?? "").trim();
              const _hasReview = _reviewComment.length > 0;
              // サイトボタン HTML（コピー＋開くボタン）
              const _siteBtns = _allSiteLinks.map((l, i) =>
                `<a href="${l.u}" target="_blank" rel="noopener"
                  onclick="(function(el){window._siteClicked=true;if(window._rvtxtVal&&navigator.clipboard){navigator.clipboard.writeText(window._rvtxtVal).catch(function(){});}setTimeout(function(){var b=document.getElementById('_rcclaim');if(b&&!window._gcDone)b.style.display='block';},3000);})(this)"
                  style="display:block;width:100%;padding:12px;background:${l.c};color:#fff;font-weight:700;font-size:13px;text-align:center;border-radius:10px;text-decoration:none;box-sizing:border-box;margin-bottom:8px;">${l.n}</a>`
              ).join("");
              return createHtmlResponse(`<div style="min-height:100vh;background:#f9fafb;display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px 16px;padding-top:36px;">
<div style="width:100%;max-width:400px;">
<div style="text-align:center;margin-bottom:22px;">
<div style="font-size:44px;margin-bottom:10px;">✅</div>
<h2 style="font-size:18px;font-weight:800;color:#111;margin:0 0 6px;">本日のアンケートは送信済みです</h2>
<p style="font-size:13px;color:#6b7280;margin:0;">口コミやフィードバックでさらにポイントを獲得できます</p>
</div>
<div style="background:#fff;border-radius:16px;padding:18px;margin-bottom:12px;box-shadow:0 2px 10px rgba(0,0,0,.07);">
<div style="font-size:14px;font-weight:700;color:#111;margin-bottom:8px;">📝 口コミでポイントを獲得</div>
<p style="font-size:12px;color:#6b7280;margin:0 0 10px;">口コミを投稿すると <strong>＋${_gPts}P</strong> 加算されます。</p>
${_hasReview ? `<div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:12px;font-size:13px;color:#1e3a5f;line-height:1.75;margin-bottom:10px;white-space:pre-wrap;word-break:break-word;" id="_rvtxt">${_reviewComment.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
<button id="_cpybtn" onclick="(function(){var t=document.getElementById('_rvtxt');if(!t)return;var txt=t.innerText;window._rvtxtVal=txt;if(navigator.clipboard){navigator.clipboard.writeText(txt).then(function(){var b=document.getElementById('_cpybtn');b.textContent='✅ コピーしました！';b.style.background='#15803d';setTimeout(function(){b.textContent='📋 口コミ文をコピーする';b.style.background='#0284c7';},2500);});}else{var r=document.createRange();r.selectNodeContents(t);window.getSelection().removeAllRanges();window.getSelection().addRange(r);document.execCommand('copy');}})()" style="width:100%;padding:11px;background:#0284c7;color:#fff;font-weight:700;font-size:13px;border:none;border-radius:10px;cursor:pointer;box-sizing:border-box;margin-bottom:12px;">📋 口コミ文をコピーする</button>` : ''}
${_siteBtns}
<button id="_rcclaim" style="display:none;width:100%;padding:13px;background:#16a34a;color:#fff;font-weight:700;font-size:14px;border:none;border-radius:12px;cursor:pointer;box-sizing:border-box;margin-top:4px;">✅ 書きました！ ＋${_gPts}P 受け取る</button>
<div id="_rcstatus" style="font-size:12px;color:#6b7280;text-align:center;margin-top:6px;min-height:16px;"></div>
</div>
<div style="background:#fff;border-radius:16px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.07);">
<div style="font-size:14px;font-weight:700;color:#111;margin-bottom:8px;">💬 レポートを送る</div>
<p style="font-size:12px;color:#6b7280;margin:0 0 10px;">今日の感想を送ると <strong>＋${_fbPts}P</strong> 加算されます。</p>
<textarea id="_fbtxt" rows="3" placeholder="今日の感想を教えてください…" style="width:100%;border:1.5px solid #e5e7eb;border-radius:10px;padding:10px;font-size:13px;font-family:inherit;box-sizing:border-box;resize:none;"></textarea>
<button id="_fbsend" style="margin-top:8px;width:100%;padding:13px;background:#f59e0b;color:#fff;font-weight:700;font-size:14px;border:none;border-radius:12px;cursor:pointer;box-sizing:border-box;">📤 フィードバックを送る ＋${_fbPts}P</button>
<div id="_fbstatus" style="font-size:12px;color:#6b7280;text-align:center;margin-top:6px;min-height:16px;"></div>
</div>
</div>
<script>(function(){
var API=${JSON.stringify(_apiBase)},SID=${JSON.stringify(store_id)},RID=${JSON.stringify(_todayRev.id)},QSID=${JSON.stringify(_todaySid)};
window._gcDone=false;window._siteClicked=false;window._rvtxtVal=${JSON.stringify(_reviewComment)};
document.getElementById('_rcclaim').onclick=async function(){
  if(window._gcDone)return;
  var btn=this,st=document.getElementById('_rcstatus');
  btn.disabled=true;btn.textContent='⏳ 確認中…';
  try{
    var r=await fetch(API+'?store_id='+encodeURIComponent(SID)+(QSID?'&sid='+encodeURIComponent(QSID):''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim_google_bonus',review_id:RID})});
    var d=await r.json();
    if(d.ok&&!d.skipped){window._gcDone=true;btn.textContent='✅ ＋${_gPts}P 加算しました！';btn.style.background='#15803d';if(st)st.textContent='口コミポイントを加算しました';}
    else if(d.skipped){window._gcDone=true;btn.textContent='✅ 本日分は加算済みです';btn.style.background='#6b7280';}
    else{btn.disabled=false;btn.textContent='✅ 書きました！ ＋${_gPts}P 受け取る';}
  }catch(e){btn.disabled=false;btn.textContent='✅ 書きました！ ＋${_gPts}P 受け取る';}
};
document.getElementById('_fbsend').onclick=async function(){
  if(window._fbDone)return;
  var txt=(document.getElementById('_fbtxt')||{}).value||'';
  if(!txt.trim()){alert('感想を入力してください');return;}
  var btn=this,st=document.getElementById('_fbstatus');
  btn.disabled=true;btn.textContent='⏳ 送信中…';
  try{
    var r=await fetch(API+'?store_id='+encodeURIComponent(SID)+(QSID?'&sid='+encodeURIComponent(QSID):''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send_improvement_feedback',review_id:RID,store_id:SID,text:txt.trim()})});
    var d=await r.json();
    if(d.ok){window._fbDone=true;btn.textContent='✅ フィードバックを送りました！';if(st)st.textContent=d.points_awarded>0?'＋'+d.points_awarded+'P 加算しました！':'送信しました';}
    else if(d.daily_limit){window._fbDone=true;btn.textContent='✅ 本日分は送信済みです';btn.style.background='#6b7280';}
    else{btn.disabled=false;btn.textContent='📤 フィードバックを送る ＋${_fbPts}P';}
  }catch(e){btn.disabled=false;btn.textContent='📤 フィードバックを送る ＋${_fbPts}P';}
};
})();</script></div>`);
            }
            // google_url 未設定またはレビュー不明の場合はシンプル表示
            return createHtmlResponse(`
              <div style="min-height:100vh;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;">
                <div style="background:#fff;border-radius:20px;padding:36px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1);">
                  <div style="font-size:56px;margin-bottom:16px;">📝</div>
                  <h2 style="font-size:19px;font-weight:800;color:#111;margin:0 0 12px;">本日のアンケートは<br>送信済みです</h2>
                  <p style="font-size:13px;color:#6b7280;line-height:1.8;margin:0 0 20px;">アンケートのポイントは<strong>1日1回</strong>のみ加算されます。<br>また明日のご来店をお待ちしております！</p>
                  <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:14px 16px;">
                    <span style="font-size:13px;color:#15803d;font-weight:700;">✅ 本日分は受付済みです</span>
                  </div>
                </div>
              </div>
            `);
          }
        }
      }
    }

    const submission_id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    let imageUrl: string | null = null;
    if (photoBase64FromForm && photoBase64FromForm.startsWith("data:image/")) {
      try {
        const m = photoBase64FromForm.match(/^data:image\/(\w+);base64,(.+)$/);
        if (m) {
          const ext = m[1] === "jpeg" || m[1] === "jpg" ? "jpg" : m[1] === "png" ? "png" : "webp";
          const buf = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          const path = `reviews/${store_id}/${submission_id}.${ext}`;
          const { error } = await supabase.storage
            .from("assets")
            .upload(path, buf, { contentType: `image/${ext}`, upsert: true });
          if (!error) {
            const { data: urlData } = supabase.storage.from("assets").getPublicUrl(path);
            imageUrl = urlData?.publicUrl || null;
          }
        }
      } catch (e) {
        console.error("[form-engine] photo upload failed:", e);
      }
    }
    const { data: inserted } = await supabase
      .from("reviews")
      .insert({
        submission_id,
        store_id,
        score,
        comment: (answers.comment as string) || (answers.コメント as string) || null,
        answers,
        review_options,
        coupon_awarded,
        ref_token: null,
        is_scouter: false,
        image_url: imageUrl,
        ip_hash: _ipHash,
        raw_data: {
          source: "form-engine",
          form: answers,
          ...(vidFromForm ? { vid: vidFromForm } : {}),
        },
        used_at: null,
        ...(lineUserIdFromForm ? { line_user_id: lineUserIdFromForm } : {}),
      })
      .select("id")
      .single();

    const review = inserted
      ? {
          id: inserted.id,
          store_id,
          score,
          answers,
          review_options,
          coupon_awarded,
          created_at: new Date().toISOString(),
          image_url: imageUrl,
        }
      : null;

    if (!review) {
      return createHtmlResponse("<p>保存に失敗しました。</p>");
    }

    // ── 紹介コード処理 ─────────────────────────────────────────────
    if (referralCodeFromForm && (store.point_rule_referral as number) > 0) {
      try {
        const refPts = Number(store.point_rule_referral);
        const { data: refCodeRow, error: refCodeErr } = await supabase
          .from("referral_codes")
          .select("id, identity_id")
          .eq("code", referralCodeFromForm)
          .eq("store_id", store_id)
          .maybeSingle();
        if (refCodeErr) console.error("[form-engine] referral_codes lookup failed:", refCodeErr.message);
        if (refCodeRow) {
          // ── referee identity を先に解決（重複チェックの精度向上） ──
          let refereeIdentityId: string | null = null;
          if (lineUserIdFromForm) {
            const { data: rId } = await supabase.from("customer_identity").select("id")
              .eq("line_user_id", lineUserIdFromForm).maybeSingle();
            refereeIdentityId = (rId?.id as string) ?? null;
          }
          if (!refereeIdentityId && anonIdFromForm) {
            const { data: rId } = await supabase.from("customer_identity").select("id")
              .eq("anon_id", anonIdFromForm).maybeSingle();
            refereeIdentityId = (rId?.id as string) ?? null;
          }

          // ── 重複チェック（referee_identity_id ベース → sourceRef フォールバック） ──
          let isDup = false;
          if (refereeIdentityId) {
            // 同一店舗で既に referral を受けた referee かチェック（コード違いも含む）
            const { data: existingEntry } = await supabase
              .from("referral_entries")
              .select("id")
              .eq("store_id", store_id)
              .eq("referee_identity_id", refereeIdentityId)
              .maybeSingle();
            isDup = !!existingEntry;
          }
          if (!isDup) {
            // identity が未解決の場合は旧 sourceRef フォールバック
            const refereeSig = lineUserIdFromForm || anonIdFromForm || submission_id;
            const sourceRefCheck = `referral_${referralCodeFromForm}_${refereeSig}`;
            const { data: dupLedger } = await supabase
              .from("customer_points_ledger")
              .select("id")
              .eq("identity_id", refCodeRow.identity_id)
              .eq("source_ref", sourceRefCheck)
              .maybeSingle();
            isDup = !!dupLedger;
          }

          if (!isDup) {
            const refereeSig = lineUserIdFromForm || anonIdFromForm || submission_id;
            const sourceRef = `referral_${referralCodeFromForm}_${refereeSig}`;
            // referral_entries に記録
            const expiryDays = Number((store.referral_expiry_days as number) ?? 30);
            const { error: reErr } = await supabase.from("referral_entries").insert({
              store_id,
              referral_code: referralCodeFromForm,
              referrer_identity_id: refCodeRow.identity_id,
              referee_identity_id: refereeIdentityId || null,
              referee_line_user_id: lineUserIdFromForm || null,
              status: "completed",
              points_awarded: refPts,
              completed_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + expiryDays * 86400000).toISOString(),
            });
            if (reErr) console.error("[form-engine] referral_entries insert failed:", reErr.message);
            // 紹介者へポイント直接付与
            const { error: ptErr } = await supabase.from("customer_points_ledger").insert({
              identity_id: refCodeRow.identity_id,
              store_id,
              scope_type: "store",
              scope_id: store_id,
              action_type: "referral",
              points_delta: refPts,
              source_ref: sourceRef,
              occurred_at: new Date().toISOString(),
              metadata: { referee_submission_id: submission_id },
            });
            if (ptErr) console.error("[form-engine] referral points insert failed:", ptErr.message);
            else console.log("[form-engine] referral points awarded:", refPts, "to identity:", refCodeRow.identity_id);

            // 被紹介者へポイント付与（LINE認証済み or anon identity が解決済みの場合）
            const effectiveRefereeId = refereeIdentityId;
            if (effectiveRefereeId) {
              const refereeSourceRef = `ref-referee-${effectiveRefereeId}-${store_id}`;
              // 重複チェック（ウォレットページで先に使用済みの場合はスキップ）
              const { data: refereeDup } = await supabase
                .from("customer_points_ledger")
                .select("id")
                .eq("identity_id", effectiveRefereeId)
                .eq("action_type", "referral")
                .eq("source_ref", refereeSourceRef)
                .maybeSingle();
              if (!refereeDup) {
                const { error: refereeErr } = await supabase.from("customer_points_ledger").insert({
                  identity_id: effectiveRefereeId,
                  store_id,
                  scope_type: "store",
                  scope_id: store_id,
                  action_type: "referral",
                  points_delta: refPts,
                  source_ref: refereeSourceRef,
                  occurred_at: new Date().toISOString(),
                  metadata: { referral_code: referralCodeFromForm },
                });
                if (refereeErr) console.error("[form-engine] referee referral points insert failed:", refereeErr.message);
                else console.log("[form-engine] referee referral points awarded:", refPts, "to identity:", effectiveRefereeId);
              }
            }
          } else {
            console.log("[form-engine] referral duplicate skipped for code:", referralCodeFromForm, "referee:", refereeIdentityId ?? anonIdFromForm);
          }
        } else {
          console.log("[form-engine] referral code not found:", referralCodeFromForm, "store:", store_id);
        }
      } catch (e) {
        console.error("[form-engine] referral processing unexpected error:", e);
      }
    }

    // anon_id でポイント付与（LIFF未設定店舗のフォールバック）
    if (anonIdFromForm && !lineUserIdFromForm) {
      const workerSecretAnon = Deno.env.get("SNS_WORKER_SECRET") ?? "";
      const anonKeyForPt = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const addPtUrlAnon = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
      try {
        const ptAbort = new AbortController();
        const ptTimer = setTimeout(() => ptAbort.abort(), 15000); // 15s timeout
        let ptRes: Response;
        try {
          ptRes = await fetch(addPtUrlAnon, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-worker-secret": workerSecretAnon,
              ...(anonKeyForPt ? { "apikey": anonKeyForPt, "Authorization": `Bearer ${anonKeyForPt}` } : {}),
            },
            body: JSON.stringify({ store_id, action_type: "survey", source_ref: submission_id, anon_id: anonIdFromForm }),
            signal: ptAbort.signal,
          });
        } finally {
          clearTimeout(ptTimer);
        }
        // DAILY_LIMIT_EXCEEDED: ウォレットが source_ref=sid で identity を引けるよう 0P センチネルを挿入
        if (ptRes.status === 429) {
          const { data: existingIdentity } = await supabase
            .from("customer_identity")
            .select("id")
            .eq("anon_id", anonIdFromForm)
            .maybeSingle();
          if (existingIdentity?.id) {
            await supabase.from("customer_points_ledger").insert({
              identity_id: existingIdentity.id,
              store_id,
              scope_type: "store",
              scope_id: store_id,
              action_type: "survey",
              points_delta: 0,
              source_ref: submission_id,
              occurred_at: new Date().toISOString(),
              metadata: { skipped: "daily_limit_exceeded" },
            });
          }
        }
      } catch (e) {
        console.error("[form-engine] anon add-loyalty-point failed:", e);
      }
    }

    // LINE ユーザー + デモモード（ip_block_enabled=false）の場合は直接 add-loyalty-point を呼ぶ
    // 通常モードでは LIFF → LINE メッセージ → webhook 経由でポイント付与されるが、
    // デモモードは LIFF を無効化しているため webhook が発火せずポイントが付かない
    if (lineUserIdFromForm && (store as Record<string, unknown>).ip_block_enabled === false) {
      const workerSecretLine = Deno.env.get("SNS_WORKER_SECRET") ?? "";
      const anonKeyForPtLine = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const addPtUrlLine = (Deno.env.get("SUPABASE_URL") ?? new URL(req.url).origin) + "/functions/v1/add-loyalty-point";
      try {
        const ptAbortLine = new AbortController();
        const ptTimerLine = setTimeout(() => ptAbortLine.abort(), 15000);
        let ptResLine: Response;
        try {
          ptResLine = await fetch(addPtUrlLine, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-worker-secret": workerSecretLine,
              ...(anonKeyForPtLine ? { "apikey": anonKeyForPtLine, "Authorization": `Bearer ${anonKeyForPtLine}` } : {}),
            },
            body: JSON.stringify({ store_id, action_type: "survey", source_ref: submission_id, line_user_id: lineUserIdFromForm }),
            signal: ptAbortLine.signal,
          });
        } finally {
          clearTimeout(ptTimerLine);
        }
        const ptBodyLine = await ptResLine.json().catch(() => ({}));
        console.log("[form-engine] demo LINE add-loyalty-point:", ptResLine.status, ptBodyLine);
      } catch (e) {
        console.error("[form-engine] demo LINE add-loyalty-point failed:", e);
      }
    }

    // ── アンケート完了後に referral code を即時生成（wallet ロード前でもコードが確定） ──
    if ((store.point_rule_referral as number) > 0) {
      try {
        let autoIdentityId: string | null = null;
        if (lineUserIdFromForm) {
          const { data: lid } = await supabase.from("customer_identity").select("id")
            .eq("line_user_id", lineUserIdFromForm).maybeSingle();
          autoIdentityId = (lid?.id as string) ?? null;
        } else if (anonIdFromForm) {
          const { data: aid } = await supabase.from("customer_identity").select("id")
            .eq("anon_id", anonIdFromForm).maybeSingle();
          autoIdentityId = (aid?.id as string) ?? null;
        }
        if (autoIdentityId) {
          const { data: existingRc } = await supabase.from("referral_codes").select("code")
            .eq("identity_id", autoIdentityId).eq("store_id", store_id).maybeSingle();
          if (!existingRc?.code) {
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            let rc = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
            for (let i = 0; i < 3; i++) {
              const { error: rcErr } = await supabase.from("referral_codes").insert({
                identity_id: autoIdentityId, store_id, code: rc,
              });
              if (!rcErr) { console.log("[form-engine] referral code generated:", rc, "for identity:", autoIdentityId); break; }
              rc = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
            }
          }
        }
      } catch (e) {
        console.error("[form-engine] referral code auto-generation failed:", e);
      }
    }

    const { data: lineCredsPost } = await supabase
      .from("store_line_credentials")
      .select("line_liff_id, line_bot_basic_id")
      .eq("store_id", store_id)
      .maybeSingle();
    const lineLiffIdRawPost = lineCredsPost?.line_liff_id ?? (store as { line_liff_id?: string } | null)?.line_liff_id ?? null;
    const lineLiffIdPost = (typeof lineLiffIdRawPost === "string" && lineLiffIdRawPost.trim()) ? lineLiffIdRawPost.trim() : null;
    const lineBotBasicIdRawPost = lineCredsPost?.line_bot_basic_id ?? (store as { line_bot_basic_id?: string } | null)?.line_bot_basic_id ?? null;
    const lineBotBasicIdPost = (typeof lineBotBasicIdRawPost === "string" && lineBotBasicIdRawPost.trim()) ? lineBotBasicIdRawPost.trim() : null;
    const formEngineBaseUrlPost = new URL(req.url).origin + "/functions/v1/form-engine";
    const scoutLpBaseUrl = Deno.env.get("SCOUT_LP_BASE_URL")?.trim() || "https://scout-lp.com/join";
    const dashboardUrlPost = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
    const resultHtml = buildResultHtml({
      review: {
        id: review.id,
        store_id: review.store_id,
        score: review.score,
        answers: review.answers,
        review_options: review.review_options,
        coupon_awarded: review.coupon_awarded,
        created_at: review.created_at!,
        image_url: review.image_url,
        improvement_feedback_sent_at: null,
        improvement_feedback_text: null,
        line_user_id: lineUserIdFromForm ?? null,
      },
      store,
      lang,
      submissionId: submission_id,
      scoutLpBaseUrl,
      // LIFFリンクはLINE連携済みユーザーのみに使用（anon_idユーザーは直接walletページへ）
      lineLiffId: lineUserIdFromForm ? lineLiffIdPost : null,
      lineBotBasicId: lineBotBasicIdPost,
      formEngineBaseUrl: formEngineBaseUrlPost,
      dashboardUrl: dashboardUrlPost || undefined,
    });

    // X-Submission-Id を返してクライアントが location.replace() で GET 遷移できるようにする
    // → LINE WebView の document.write() スクリプト非実行問題を回避
    return new Response(resultHtml, {
      headers: {
        ...corsHeaders(null),
        "Content-Type": "text/html; charset=utf-8",
        "X-Submission-Id": submission_id,
      },
    });
  }

  return new Response("Not Found", { status: 404 });
});
