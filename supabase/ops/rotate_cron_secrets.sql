-- ============================================================================
-- pg_cron が使う秘密のローテーション — 値を人が「貼らずに済む」手順（2026-09-23）
--
-- 背景: レポミール本番（oahnmyfalnhdkoihrswh）の pg_cron ジョブと reviews の INSERT トリガーは、以前は
--       秘密を平文で持っていた。2026-09-23 に Vault へ移し、どちらも Vault 参照になった。値そのものは
--       長く平文で存在したので、この手順で新しい値に入れ替える。
--
-- 使い方（対象 A〜D ごとに、Supabase Dashboard → SQL Editor で順に実行）
--   STEP 1  DB が新しい値を作って Vault に「次の値」として保存し、結果グリッドに 1 回だけ表示する
--           → 表示された値を Dashboard の Edge Functions → Secrets の該当キーに貼って保存する
--             （Vercel の環境変数も要る対象 C/D は、Vercel にも貼る）
--   STEP 2  Vault の本体を「次の値」に切り替える（旧値は _prev として控える）。1 つの DO ブロックで、
--           途中で失敗したら何も変わらない（全か無か）
--   STEP 3  動作確認（値は出ない）。直近の HTTP 応答を時間で絞って status_code を見る。
--           判定: STEP 2 の後の行が 200 で、401 が無いこと。401 が出ていたら秘密が合っていない
--   STEP 4  数日問題が無ければ _prev を消す
--
-- 秘密の対応表
--   A  cron_keyword_classify_secret → Secret KEYWORD_CRON_SECRET（keyword-classify のみ、5 分ごと）      … 影響: 小
--   B  cron_healthcheck_secret      → Secret HEALTHCHECK_SECRET（grant-healthcheck のみ、毎時 10 分）      … 影響: 小
--   C  cron_marketing_trigger_secret と cron_marketing_bearer（同じ値）
--                                   → Secret MARKETING_TRIGGER_SECRET（marketing-trigger-runner / -queue-processor /
--                                     -blast-runner / -recurring-runner / -profile-backfill）
--                                     ＋ Vercel restaurant-dashboard の環境変数 MARKETING_TRIGGER_SECRET（Redeploy 必要） … 影響: 中
--   D  cron_fraud_worker_secret     → Secret SNS_WORKER_SECRET（fraud-cron / add-loyalty-point / gbp-insights-fetch /
--                                     line-webhook-coupon / form-engine の内部呼び出し）
--                                     ＋ Vercel restaurant-dashboard の環境変数 SNS_WORKER_SECRET（Redeploy 必要）
--                                     … 影響: 大（ポイント付与・紹介・チェックイン・LINE 連携が通る経路）
--      送り手は 3 つ: pg_cron の fraud-check-daily（毎日 00:00 UTC）、DB トリガー trigger_loyalty_on_review_insert
--      （口コミ投稿ごと。2026-09-23 に Vault 参照化済みなので D-2 で cron と同時に切り替わる）、Vercel の
--      restaurant-dashboard（apply-referral / checkin / wallet ページ）。
--      GitHub Actions 用の gbp-insights-cron.yml は 2026-09-23 時点でどのリポにも配置されていない
--      （全リポの Secrets に SNS_WORKER_SECRET 無し）。配置したらそのリポの Secrets も更新する
--
-- 注意
--   - 値は STEP 1 の結果グリッドにだけ出る。貼り終えたらその結果を閉じる（ターミナルやチャットには貼らない）
--   - SQL Editor は複数文を一度に流すと「最後に行を返した文」の結果しか表示しない。
--     STEP 1 は最後の SELECT が値、STEP 2 は DO 1 文、STEP 3 は SELECT 1 文なので、そのままコピーして実行できる
--   - 途中で止めた／もう一度やり直したいときは STEP 1 から流し直してよい（STEP 1 は _next を作り直し、
--     STEP 2 は _prev を作り直す）。STEP 2 を 2 回流すと「_next が無い」で止まる（それは正常）
--   - Dashboard に保存してから STEP 2 までの間、cron は旧値を送るので 401 になる（A は最大 5 分、B は最大 1 時間）。
--     どちらも次回実行で回復する。C/D は Dashboard 保存 → STEP 2 → Vercel Redeploy を続けて行い、
--     その数分間は紹介申請（apply-referral）とマイページのポイント遡及が失敗する
--     （紹介は申請者がやり直せば通る）。深夜など利用の少ない時間に行う
--   - STEP 3 の結果に出る 429 DAILY_LIMIT_EXCEEDED は 1 日 1 回制限で正常。status_code が空（timeout）は
--     応答未取得で判定不能なので、次の実行を待つ
--   - 新しい値は 64 桁の hex（extensions.gen_random_bytes → 256 bit）
-- ============================================================================


-- ############################################################################
-- A. keyword-classify（KEYWORD_CRON_SECRET）
-- ############################################################################

-- A-1（何度流してもよい: _next を作り直して表示する）
delete from vault.secrets where name = 'cron_keyword_classify_secret_next';
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
  'cron_keyword_classify_secret_next', 'ローテーション中の次の値（STEP 2 で本体に反映して削除）');
select decrypted_secret as "KEYWORD_CRON_SECRET の新しい値（Dashboard に貼ったらこの結果を閉じる）"
  from vault.decrypted_secrets where name = 'cron_keyword_classify_secret_next';

-- A-2（Dashboard の Edge Functions → Secrets → KEYWORD_CRON_SECRET を保存した直後に）
do $$
declare
  c_bodies constant text[] := array['cron_keyword_classify_secret'];
  c_next   constant text   := 'cron_keyword_classify_secret_next';
  c_prev   constant text   := 'cron_keyword_classify_secret_prev';
  v_next text; v_now text; v_id uuid; b text;
begin
  select decrypted_secret into v_next from vault.decrypted_secrets where name = c_next;
  if v_next is null then raise exception '% が無い（STEP 2 済みか、STEP 1 が未実行）', c_next; end if;
  select decrypted_secret into v_now from vault.decrypted_secrets where name = c_bodies[1];
  if v_now is null then raise exception '% が Vault に無い', c_bodies[1]; end if;
  delete from vault.secrets where name = c_prev;
  perform vault.create_secret(v_now, c_prev, 'ローテーション前の値の控え（数日問題なければ削除）');
  foreach b in array c_bodies loop
    select id into v_id from vault.secrets where name = b;
    if v_id is null then raise exception '% が Vault に無い', b; end if;
    perform vault.update_secret(v_id, v_next);
    if (select decrypted_secret from vault.decrypted_secrets where name = b) is distinct from v_next then
      raise exception '% の更新に失敗（何も変えずに戻した）', b;
    end if;
  end loop;
  delete from vault.secrets where name = c_next;
end $$;

-- A-3（STEP 2 の 5〜10 分後）: keyword-classify（毎時 :00/:05/…）の行が 200 で、401 が無いこと
select created, status_code,
       case when status_code = 401 then '★ 401（秘密が合っていない）'
            when status_code is null then 'timeout（判定不能）'
            when content like '%"mode":"all"%' then 'A keyword-classify'
            else '' end as who,
       left(content, 60) as body
  from net._http_response
 where created > now() - interval '15 minutes'
   and (status_code is distinct from 200 or content like '%"mode":"all"%')
 order by created desc;

-- A-4（数日後）
delete from vault.secrets where name = 'cron_keyword_classify_secret_prev';


-- ############################################################################
-- B. grant-healthcheck（HEALTHCHECK_SECRET）
-- ############################################################################

-- B-1（何度流してもよい）
delete from vault.secrets where name = 'cron_healthcheck_secret_next';
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
  'cron_healthcheck_secret_next', 'ローテーション中の次の値（STEP 2 で本体に反映して削除）');
select decrypted_secret as "HEALTHCHECK_SECRET の新しい値（Dashboard に貼ったらこの結果を閉じる）"
  from vault.decrypted_secrets where name = 'cron_healthcheck_secret_next';

-- B-2（Dashboard に保存した直後に）
do $$
declare
  c_bodies constant text[] := array['cron_healthcheck_secret'];
  c_next   constant text   := 'cron_healthcheck_secret_next';
  c_prev   constant text   := 'cron_healthcheck_secret_prev';
  v_next text; v_now text; v_id uuid; b text;
begin
  select decrypted_secret into v_next from vault.decrypted_secrets where name = c_next;
  if v_next is null then raise exception '% が無い（STEP 2 済みか、STEP 1 が未実行）', c_next; end if;
  select decrypted_secret into v_now from vault.decrypted_secrets where name = c_bodies[1];
  if v_now is null then raise exception '% が Vault に無い', c_bodies[1]; end if;
  delete from vault.secrets where name = c_prev;
  perform vault.create_secret(v_now, c_prev, 'ローテーション前の値の控え（数日問題なければ削除）');
  foreach b in array c_bodies loop
    select id into v_id from vault.secrets where name = b;
    if v_id is null then raise exception '% が Vault に無い', b; end if;
    perform vault.update_secret(v_id, v_next);
    if (select decrypted_secret from vault.decrypted_secrets where name = b) is distinct from v_next then
      raise exception '% の更新に失敗（何も変えずに戻した）', b;
    end if;
  end loop;
  delete from vault.secrets where name = c_next;
end $$;

-- B-3（次の毎時 10 分の実行後。最大 1 時間待つ）: grant-healthcheck の行が 200 で、401 が無いこと
select created, status_code,
       case when status_code = 401 then '★ 401（秘密が合っていない）'
            when status_code is null then 'timeout（判定不能）'
            when content like '%"abnormal"%' then 'B grant-healthcheck'
            else '' end as who,
       left(content, 60) as body
  from net._http_response
 where created > now() - interval '70 minutes'
   and (status_code is distinct from 200 or content like '%"abnormal"%')
 order by created desc;

-- B-4（数日後）
delete from vault.secrets where name = 'cron_healthcheck_secret_prev';


-- ############################################################################
-- C. marketing 系（MARKETING_TRIGGER_SECRET）— Edge Function 5 本 ＋ Vercel（restaurant-dashboard）
-- ############################################################################

-- C-1（何度流してもよい）
delete from vault.secrets where name = 'cron_marketing_secret_next';
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
  'cron_marketing_secret_next', 'ローテーション中の次の値（STEP 2 で trigger と bearer の両方に反映して削除）');
select decrypted_secret as "MARKETING_TRIGGER_SECRET の新しい値（Dashboard と Vercel に貼ったらこの結果を閉じる）"
  from vault.decrypted_secrets where name = 'cron_marketing_secret_next';

-- C-2（順番: Vercel の環境変数を保存（Redeploy はまだ）→ Dashboard の Secret を保存 → すぐこれ → すぐ Vercel Redeploy）
do $$
declare
  c_bodies constant text[] := array['cron_marketing_trigger_secret', 'cron_marketing_bearer'];
  c_next   constant text   := 'cron_marketing_secret_next';
  c_prev   constant text   := 'cron_marketing_secret_prev';
  v_next text; v_now text; v_id uuid; b text;
begin
  select decrypted_secret into v_next from vault.decrypted_secrets where name = c_next;
  if v_next is null then raise exception '% が無い（STEP 2 済みか、STEP 1 が未実行）', c_next; end if;
  select decrypted_secret into v_now from vault.decrypted_secrets where name = c_bodies[1];
  if v_now is null then raise exception '% が Vault に無い', c_bodies[1]; end if;
  delete from vault.secrets where name = c_prev;
  perform vault.create_secret(v_now, c_prev, 'ローテーション前の値の控え（数日問題なければ削除）');
  foreach b in array c_bodies loop
    select id into v_id from vault.secrets where name = b;
    if v_id is null then raise exception '% が Vault に無い', b; end if;
    perform vault.update_secret(v_id, v_next);
    if (select decrypted_secret from vault.decrypted_secrets where name = b) is distinct from v_next then
      raise exception '% の更新に失敗（何も変えずに戻した）', b;
    end if;
  end loop;
  delete from vault.secrets where name = c_next;
end $$;

-- C-3（STEP 2 の 2〜3 分後）: 毎分の blast/recurring と 5 分ごとの queue の行が 200 で、401 が無いこと
--     （marketing-triggers-daily は毎日 15:00 UTC = 翌 0:00 JST。翌日にこの文をもう一度流して 200 を見る）
select created, status_code,
       case when status_code = 401 then '★ 401（秘密が合っていない）'
            when status_code is null then 'timeout（判定不能）'
            when content like '%"fired"%' or content like '%"followups"%' or content like '%"skipped"%' then 'C marketing'
            else '' end as who,
       left(content, 60) as body
  from net._http_response
 where created > now() - interval '10 minutes'
   and (status_code is distinct from 200
        or content like '%"fired"%' or content like '%"followups"%' or content like '%"skipped"%')
 order by created desc;

-- C-4（数日後）
delete from vault.secrets where name = 'cron_marketing_secret_prev';


-- ############################################################################
-- D. SNS_WORKER_SECRET（fraud-cron / 口コミ投稿ごとのポイント付与 / Vercel）— 影響が広いので深夜に、続けて実行する
-- ############################################################################

-- D-1（何度流してもよい）
delete from vault.secrets where name = 'cron_fraud_worker_secret_next';
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
  'cron_fraud_worker_secret_next', 'ローテーション中の次の値（STEP 2 で本体に反映して削除）');
select decrypted_secret as "SNS_WORKER_SECRET の新しい値（Dashboard と Vercel に貼ったらこの結果を閉じる）"
  from vault.decrypted_secrets where name = 'cron_fraud_worker_secret_next';

-- D-2（順番: Vercel の環境変数を保存（Redeploy はまだ）→ Dashboard の Secret を保存 → すぐこれ → すぐ Vercel Redeploy）
--     これで fraud-check-daily と trigger_loyalty_on_review_insert の両方が新しい値を送るようになる
do $$
declare
  c_bodies constant text[] := array['cron_fraud_worker_secret'];
  c_next   constant text   := 'cron_fraud_worker_secret_next';
  c_prev   constant text   := 'cron_fraud_worker_secret_prev';
  v_next text; v_now text; v_id uuid; b text;
begin
  select decrypted_secret into v_next from vault.decrypted_secrets where name = c_next;
  if v_next is null then raise exception '% が無い（STEP 2 済みか、STEP 1 が未実行）', c_next; end if;
  select decrypted_secret into v_now from vault.decrypted_secrets where name = c_bodies[1];
  if v_now is null then raise exception '% が Vault に無い', c_bodies[1]; end if;
  delete from vault.secrets where name = c_prev;
  perform vault.create_secret(v_now, c_prev, 'ローテーション前の値の控え（数日問題なければ削除）');
  foreach b in array c_bodies loop
    select id into v_id from vault.secrets where name = b;
    if v_id is null then raise exception '% が Vault に無い', b; end if;
    perform vault.update_secret(v_id, v_next);
    if (select decrypted_secret from vault.decrypted_secrets where name = b) is distinct from v_next then
      raise exception '% の更新に失敗（何も変えずに戻した）', b;
    end if;
  end loop;
  delete from vault.secrets where name = c_next;
end $$;

-- D-3a（当日）: 口コミ投稿（LINE 連携あり）が入るたびに add-loyalty-point の行が出る。200 で、401 が無いこと。
--      行が出ないのは口コミが無かっただけ（付与ヘルスチェックの毎時メールは 3 時間に 2 件以上の漏れで鳴るので、
--      「メールが来ない」は確認にならない。この文で能動的に見る）
select created, status_code,
       case when status_code = 401 then '★ 401（秘密が合っていない）'
            when status_code is null then 'timeout（判定不能）'
            when content like '%identity_id%' or content like '%DAILY_LIMIT%' then 'D add-loyalty-point（トリガー）'
            else '' end as who,
       left(content, 60) as body
  from net._http_response
 where created > now() - interval '6 hours'
   and (status_code is distinct from 200 or content like '%identity_id%' or content like '%DAILY_LIMIT%')
 order by created desc;

-- D-3b（翌日 09:00〜15:00 JST の間に）: fraud-check-daily（00:00 UTC = 09:00 JST）の応答が 200 で、401 が無いこと
--      （応答は 6 時間で消えるので 15:00 JST までに見る。このジョブは待ち時間が既定の 5 秒しかなく、応答が
--        間に合わず status_code が空になることがある（2026-09-23 も DNS で timeout）。空のときは
--        Dashboard → Edge Functions → fraud-cron → Logs で 09:00 JST の呼び出しが 200 か 401 かを見る）
select created, status_code,
       case when status_code = 401 then '★ 401（秘密が合っていない）'
            when status_code is null then 'timeout（判定不能）'
            else '' end as who,
       left(content, 60) as body
  from net._http_response
 where (created at time zone 'utc')::time between '00:00' and '00:03'
   and created > now() - interval '6 hours'
 order by created desc;

-- D-4（数日後）
delete from vault.secrets where name = 'cron_fraud_worker_secret_prev';


-- ############################################################################
-- 戻し方（設定ミスのときだけ。漏えい対応なら _prev に戻さず STEP 1 からやり直す）
-- 本体 ← _prev に戻し、Dashboard の Secret（C/D は Vercel の環境変数も）に _prev の値を貼って Redeploy
-- ############################################################################
-- do $$
-- declare
--   c_bodies constant text[] := array['cron_keyword_classify_secret'];      -- C なら array['cron_marketing_trigger_secret','cron_marketing_bearer']
--   c_prev   constant text   := 'cron_keyword_classify_secret_prev';
--   v_prev text; v_id uuid; b text;
-- begin
--   select decrypted_secret into v_prev from vault.decrypted_secrets where name = c_prev;
--   if v_prev is null then raise exception '% が無い（STEP 4 で消した後は戻せない）', c_prev; end if;
--   foreach b in array c_bodies loop
--     select id into v_id from vault.secrets where name = b;
--     if v_id is null then raise exception '% が Vault に無い', b; end if;
--     perform vault.update_secret(v_id, v_prev);
--   end loop;
-- end $$;
-- select decrypted_secret as "Dashboard（C/D は Vercel にも）に貼り戻す値" from vault.decrypted_secrets where name = 'cron_keyword_classify_secret_prev';


-- ############################################################################
-- 現状確認（いつでも・値は出ない）: cron と関数に平文の秘密が無く、全ジョブが Vault を参照していること
-- ############################################################################
select
  (select count(*) from cron.job where command ~ 'Bearer [0-9A-Za-z._-]{20,}' or command ~ '"x-[a-z-]+-secret":"[0-9a-f]{20,}"' or command ~ 'x-[a-z-]+-secret''\s*,\s*''[0-9a-f]{20,}') as cron_commands_with_literal_secret,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ '[0-9a-f]{40,}') as public_functions_with_literal_secret,
  (select count(*) from cron.job where command like '%vault.decrypted_secrets%') as jobs_using_vault,
  (select string_agg(name || ' (' || length(decrypted_secret) || ' chars)', ', ' order by name) from vault.decrypted_secrets where name like 'cron_%') as vault_entries;
