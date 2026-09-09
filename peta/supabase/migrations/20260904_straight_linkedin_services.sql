-- ============================================================
-- Straight Ltd — LinkedIn Services (2026-09-04)
--
-- Adds 3 MVP LinkedIn services:
--   1. Post Likes ($0.20/unit, reward Rp1.000, 10-25 units)
--   2. Company Page Follows ($0.25/unit, reward Rp1.500, 10-25 units)
--   3. Post Comments ($0.75/unit, reward Rp4.000, 5-10 units)
--
-- Adheres to Task Visibility Invariants (2026-09-03):
--   (a) list_eligible_tasks_for_user open bucket
--   (b) claim_task_assignment no-account branch + is_hidden check
--   (c) tg_enforce_assignment_rules no-account branch + is_hidden check
--   (d) tg_enforce_per_account_limit no-account branch
--   (e) admin_create_task / admin_update_task category->task_type CASE
--   (f) tasks_task_category_check constraint (preserves reddit_challenge)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Update check constraints
-- ------------------------------------------------------------
ALTER TABLE public.reddit_upvote_orders
  DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;
ALTER TABLE public.reddit_upvote_orders
  ADD CONSTRAINT reddit_upvote_orders_target_type_check
  CHECK (target_type IN (
    'upvote', 'comment', 'thread', 'youtube_upload', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment'
  ));

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_category_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN (
    'reddit_upvote', 'reddit_comment', 'reddit_post_thread', 'forum_comment',
    'youtube_upload', 'preferred_source', 'reddit_challenge',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment'
  ));

ALTER TABLE public.straight_pricing
  DROP CONSTRAINT IF EXISTS straight_pricing_platform_check;
ALTER TABLE public.straight_pricing
  ADD CONSTRAINT straight_pricing_platform_check
  CHECK (platform IN ('reddit', 'forum', 'youtube', 'google', 'linkedin'));

ALTER TABLE public.straight_pricing
  DROP CONSTRAINT IF EXISTS straight_pricing_service_check;
ALTER TABLE public.straight_pricing
  ADD CONSTRAINT straight_pricing_service_check
  CHECK (service IN ('upvote', 'comment', 'thread', 'upload', 'select', 'like', 'follow'));

-- ------------------------------------------------------------
-- 2. Seed pricing rows in straight_pricing
-- ------------------------------------------------------------
INSERT INTO public.straight_pricing (
  key, platform, service, mention_mode, label, price_cents, enabled, sort_order
) VALUES
  ('linkedin_like', 'linkedin', 'like', 'none', 'LinkedIn — Post Likes', 20, true, 20),
  ('linkedin_follow', 'linkedin', 'follow', 'none', 'LinkedIn — Company Page Followers', 25, true, 21),
  ('linkedin_comment', 'linkedin', 'comment', 'none', 'LinkedIn — Post Comments', 75, true, 22)
ON CONFLICT (key) DO UPDATE SET
  platform = EXCLUDED.platform,
  service = EXCLUDED.service,
  label = EXCLUDED.label,
  price_cents = EXCLUDED.price_cents,
  sort_order = EXCLUDED.sort_order;

-- ------------------------------------------------------------
-- 3. Order creation RPC for LinkedIn services
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_linkedin_order(
  p_service TEXT,
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_comment_mode TEXT DEFAULT NULL,
  p_comment_brief TEXT DEFAULT NULL,
  p_comment_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_user_id UUID;
  v_unit_price INTEGER;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_quantity INT;
  v_url TEXT;
  v_notes JSONB;
  v_fallback INT;
  v_draft JSONB;
  v_draft_text TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF p_service NOT IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment') THEN
    RAISE EXCEPTION 'invalid_service';
  END IF;

  -- Idempotency check if client supplied request_id
  IF p_request_id IS NOT NULL AND length(trim(p_request_id)) > 0 THEN
    SELECT o.* INTO v_order
    FROM public.reddit_upvote_orders o
    JOIN public.credit_transactions ct
      ON ct.metadata->>'reddit_upvote_order_id' = o.id::text
     AND ct.metadata->>'request_id' = trim(p_request_id)
    WHERE o.user_id = v_user_id
      AND o.created_at >= NOW() - INTERVAL '15 minutes'
    LIMIT 1;
    IF v_order.id IS NOT NULL THEN
      RETURN v_order;
    END IF;
  END IF;

  -- Target URL validation
  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://(?:[a-z0-9-]+\.)*linkedin\.com/[^\s]+' THEN
    RAISE EXCEPTION 'valid_linkedin_url_required';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF p_service = 'linkedin_comment' THEN
    IF v_quantity < 5 OR v_quantity > 10 THEN
      RAISE EXCEPTION 'quantity must be between 5 and 10';
    END IF;
  ELSE
    IF v_quantity < 10 OR v_quantity > 25 THEN
      RAISE EXCEPTION 'quantity must be between 10 and 25';
    END IF;
  END IF;

  v_fallback := CASE
    WHEN p_service = 'linkedin_like' THEN 20
    WHEN p_service = 'linkedin_follow' THEN 25
    ELSE 75
  END;

  v_unit_price := public.fn_straight_unit_price(p_service, v_fallback);
  v_cost := v_unit_price * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', p_service,
    'platform', 'linkedin',
    'target_url', v_url,
    'quantity', v_quantity,
    'comment_mode', COALESCE(p_comment_mode, 'brief'),
    'comment_brief', COALESCE(NULLIF(btrim(COALESCE(p_comment_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    v_url,
    'LinkedIn',
    p_service,
    v_quantity,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  -- Store drafts if custom comments provided
  IF p_service = 'linkedin_comment' AND p_comment_drafts IS NOT NULL AND jsonb_array_length(p_comment_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_comment_drafts) - 1 LOOP
      v_draft := p_comment_drafts->i;
      v_draft_text := NULLIF(btrim(COALESCE(v_draft->>'comment_text', '')), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_cost,
    v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', p_service,
      'price_key', p_service,
      'quantity', v_quantity,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_linkedin_order(TEXT, TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_linkedin_order(TEXT, TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4. Update fn_ensure_order_task with LinkedIn mapping
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(p_order public.reddit_upvote_orders)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_notes            jsonb   := '{}'::jsonb;
  v_is_forum_comment boolean := false;
  v_is_youtube_upload boolean := false;
  v_is_preferred     boolean := false;
  v_is_linkedin_like boolean := false;
  v_is_linkedin_follow boolean := false;
  v_is_linkedin_comment boolean := false;
  v_task_type        text;
  v_task_category    text;
  v_reward           int;
  v_title            text;
  v_description      text;
  v_brief            text;
  v_platform         text;
  v_brand            text;
  v_comment_text     text;
  v_mention_mode     text;
  v_yt_title         text;
  v_yt_description   text;
  v_yt_tags          text;
  v_yt_privacy       text;
  v_domain           text;
  v_creator          uuid;
  v_task_id          uuid;
  v_auto_activate    boolean;
  v_initial_status   text;
BEGIN
  IF p_order.status NOT IN ('pending', 'processing') THEN RETURN NULL; END IF;

  SELECT id INTO v_task_id FROM tasks WHERE source_order_id = p_order.id;
  IF v_task_id IS NOT NULL THEN RETURN v_task_id; END IF;

  BEGIN
    v_notes := COALESCE(p_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment  := COALESCE(p_order.target_type, 'upvote') = 'comment'
                         OR v_notes->>'service' = 'forum_comment';
  v_is_youtube_upload := COALESCE(p_order.target_type, 'upvote') = 'youtube_upload'
                         OR v_notes->>'service' = 'youtube_upload';
  v_is_preferred      := COALESCE(p_order.target_type, 'upvote') = 'preferred_source'
                         OR v_notes->>'service' = 'preferred_source';
  v_is_linkedin_like    := COALESCE(p_order.target_type, '') = 'linkedin_like'
                         OR v_notes->>'service' = 'linkedin_like';
  v_is_linkedin_follow  := COALESCE(p_order.target_type, '') = 'linkedin_follow'
                         OR v_notes->>'service' = 'linkedin_follow';
  v_is_linkedin_comment := COALESCE(p_order.target_type, '') = 'linkedin_comment'
                         OR v_notes->>'service' = 'linkedin_comment';

  v_task_type := CASE
    WHEN p_order.target_type = 'upvote' THEN 'upvote'
    WHEN v_is_preferred      THEN 'upvote'
    WHEN v_is_linkedin_like  THEN 'upvote'
    WHEN v_is_linkedin_follow THEN 'upvote'
    WHEN v_is_youtube_upload THEN 'upload'
    ELSE 'comment'
  END;

  v_task_category := CASE
    WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote'
    WHEN v_is_preferred       THEN 'preferred_source'
    WHEN v_is_linkedin_like   THEN 'linkedin_like'
    WHEN v_is_linkedin_follow THEN 'linkedin_follow'
    WHEN v_is_linkedin_comment THEN 'linkedin_comment'
    WHEN v_is_forum_comment   THEN 'forum_comment'
    WHEN v_is_youtube_upload  THEN 'youtube_upload'
    WHEN p_order.target_type = 'thread' THEN 'reddit_post_thread'
    ELSE 'reddit_comment'
  END;

  v_platform     := public.forum_platform_label(p_order.thread_url, COALESCE(v_notes->>'platform', p_order.subreddit));
  v_brand        := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_yt_title       := NULLIF(v_notes->>'title', '');
  v_yt_description := NULLIF(v_notes->>'description', '');
  v_yt_tags        := NULLIF(v_notes->>'tags', '');
  v_yt_privacy     := COALESCE(NULLIF(v_notes->>'privacy', ''), 'unlisted');

  v_domain := lower((regexp_match(p_order.thread_url, 'https?://(?:www\.)?([^/:?#]+)'))[1]);

  v_reward := CASE
    WHEN v_is_linkedin_like    THEN 1000
    WHEN v_is_linkedin_follow  THEN 1500
    WHEN v_is_linkedin_comment THEN 4000
    WHEN v_is_preferred        THEN 2500
    WHEN v_is_youtube_upload   THEN 25000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 5000
  END;

  v_title := CASE
    WHEN v_is_linkedin_like THEN
      'Beri Like postingan di LinkedIn'
    WHEN v_is_linkedin_follow THEN
      'Follow Company Page di LinkedIn'
    WHEN v_is_linkedin_comment THEN
      'Tulis komentar di post LinkedIn'
    WHEN v_is_preferred THEN
      format('Preferred Source: pilih %s di Google', COALESCE(NULLIF(v_domain, ''), 'situs klien'))
    WHEN v_is_youtube_upload THEN
      format('Upload video ke YouTube: %s', COALESCE(v_yt_title, 'tanpa judul'))
    WHEN v_is_forum_comment THEN
      format('Komen di %s%s', v_platform,
             CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
    WHEN p_order.subreddit IS NOT NULL THEN format('r/%s - %s', p_order.subreddit, v_task_type)
    ELSE format('Reddit %s task', v_task_type)
  END;

  IF v_is_linkedin_like THEN
    v_description := 'Buka posting LinkedIn di link target, berikan Like dengan akun LinkedIn pribadimu, lalu kirim screenshot dan URL profilmu.';
    v_brief := format(
      E'👍 Misi: Like postingan LinkedIn target.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link postingan target di atas\n' ||
      E'2. Klik Like pada postingan tersebut menggunakan akun LinkedIn aktifmu\n' ||
      E'3. Screenshot bukti bahwa tombol Like sudah aktif berwarna biru\n' ||
      E'4. Kirim URL profil LinkedIn publikmu dan screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.'
    );
  ELSIF v_is_linkedin_follow THEN
    v_description := 'Buka halaman Company Page LinkedIn di link target, klik Follow dengan akun LinkedIn pribadimu, lalu kirim screenshot bukti.';
    v_brief := format(
      E'🏢 Misi: Follow Company Page LinkedIn target.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link Company Page target di atas\n' ||
      E'2. Klik tombol Follow pada halaman tersebut menggunakan akun LinkedIn pribadimu\n' ||
      E'3. Screenshot bukti bahwa status tombol sudah berubah menjadi Following\n' ||
      E'4. Kirim URL profil LinkedIn publikmu dan screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.'
    );
  ELSIF v_is_linkedin_comment THEN
    v_description := 'Buka posting LinkedIn di link target, tulis komentar relevan dan profesional, lalu kirim screenshot bukti dan permalink komentar.';
    v_brief := format(
      E'💬 Misi: Komentar di posting LinkedIn target.\n\n' ||
      E'Instruksi khusus:\n%s\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link postingan target di atas\n' ||
      E'2. Jika ada draft komentar yang disediakan, gunakan draft tersebut. Jika tidak, tulis komentar yang relevan dan profesional sesuai brief di atas.\n' ||
      E'3. Screenshot komentar kamu setelah berhasil tayang\n' ||
      E'4. Salin permalink komentar dan kirim bersama URL profil LinkedIn publikmu.\n\n' ||
      E'Catatan: Dilarang spam atau komentar tidak nyambung.',
      COALESCE(NULLIF(v_notes->>'comment_brief', ''), 'Tulis komentar profesional dan relevan dengan topik postingan.')
    );
  ELSIF v_is_preferred THEN
    v_description := format(
      'Buka link tombol, klik tombol Preferred Source-nya, konfirmasi di Google, terus screenshot buktinya. 1 akun Google = 1 pilihan.',
      p_order.thread_url
    );
    v_brief := format(
      E'🎯 Misi: pilih situs %s sebagai Preferred Source di Google.\n\n' ||
      E'Langkah:\n' ||
      E'1. Buka link di atas (target URL task ini)\n' ||
      E'2. Cari dan klik tombol "Prefer us in Google" / Preferred Source di halaman itu\n' ||
      E'3. Di halaman Google yang terbuka, klik tombol konfirmasi sampai situs ini benar-benar terpilih\n' ||
      E'4. Screenshot tampilan Google yang menunjukkan situsnya sudah terpilih\n\n' ||
      E'📷 Bukti: screenshot dari langkah 4.\n' ||
      E'1 akun Google = 1 pilihan. Akun yang pernah memilih situs ini jangan dipakai lagi.\n' ||
      E'Link tombol: %s',
      COALESCE(NULLIF(v_domain, ''), p_order.thread_url),
      p_order.thread_url
    );
  ELSIF v_is_youtube_upload THEN
    v_description := format(
      'Upload video dari %s ke YouTube. Judul: %s. Setel privasi jadi %s. Setelah upload, kirim URL video YouTube sebagai bukti.',
      p_order.thread_url,
      COALESCE(v_yt_title, 'lihat brief'),
      v_yt_privacy
    );
    v_brief := format(
      E'📹 Video sumber: %s\n' ||
      E'🎬 Judul: %s\n' ||
      E'📝 Deskripsi: %s\n' ||
      E'🏷️ Tags: %s\n' ||
      E'🔒 Privasi: %s\n\n' ||
      E'Upload video ke channel YouTube-mu, lalu kirim URL video hasil upload sebagai bukti. Jangan lupa pakai metadata di atas.',
      p_order.thread_url,
      COALESCE(v_yt_title, '-'),
      COALESCE(v_yt_description, '-'),
      COALESCE(v_yt_tags, '-'),
      v_yt_privacy
    );
  ELSIF v_is_forum_comment THEN
    v_description := format(
      'Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot buat bukti.',
      v_platform);
    v_brief := public.forum_comment_task_brief(p_order.thread_url, v_platform, v_comment_text, v_brand, v_mention_mode);
  ELSE
    IF p_order.notes IS NOT NULL AND btrim(p_order.notes) LIKE '{%' THEN
      v_description := 'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.';
    ELSE
      v_description := COALESCE(NULLIF(btrim(p_order.notes), ''),
                               'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.');
    END IF;
    v_brief := NULL;
  END IF;

  SELECT id INTO v_creator FROM users WHERE role = 'admin' LIMIT 1;

  SELECT COALESCE(s.auto_activate_tasks, true) INTO v_auto_activate
  FROM straight_settings s LIMIT 1;
  v_initial_status := CASE WHEN COALESCE(v_auto_activate, true) THEN 'active' ELSE 'draft' END;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    min_karma, min_account_age_days, per_account_limit, min_level,
    max_assignments, reward_amount, status, created_by, source_order_id
  ) VALUES (
    v_title, v_description, v_brief,
    p_order.thread_url, v_task_type, v_task_category,
    0, 0, 1, 0,
    GREATEST(1, p_order.requested_upvotes),
    v_reward, v_initial_status, v_creator, p_order.id
  )
  RETURNING id INTO v_task_id;

  IF v_initial_status = 'active' AND p_order.status = 'pending' THEN
    UPDATE reddit_upvote_orders SET status = 'processing' WHERE id = p_order.id AND status = 'pending';
  END IF;

  RETURN v_task_id;
END
$fn$;

-- ------------------------------------------------------------
-- 5. Update claim_task_assignment:
--    Allow claim without Reddit account for LinkedIn categories,
--    enforce is_hidden, enforce cross-order target dedup,
--    and assign comment draft.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_task record;
  v_account record;
  v_assignment public.task_assignments;
  v_live int;
  v_draft record;
  v_norm_target text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.status <> 'active'
    OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
    OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at)
    OR v_task.is_hidden THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  -- Accountless categories: no Reddit account required
  IF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'youtube_upload', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment'
  ) THEN
    -- Strict cross-order target dedup for LinkedIn tasks
    IF v_task.task_category IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment') THEN
      v_norm_target := regexp_replace(lower(btrim(COALESCE(v_task.target_url, ''))), '[/?#]+$', '');
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments ta2
        JOIN public.tasks t2 ON t2.id = ta2.task_id
        WHERE ta2.user_id = v_uid
          AND t2.task_category = v_task.task_category
          AND ta2.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t2.target_url, ''))), '[/?#]+$', '') = v_norm_target
      ) THEN
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task LinkedIn untuk target ini sebelumnya.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

    -- Assign unique draft for comments (forum_comment & linkedin_comment)
    IF v_task.task_category IN ('forum_comment', 'linkedin_comment') THEN
      SELECT d.id, d.comment_text
      INTO v_draft
      FROM public.reddit_order_comment_drafts d
      WHERE d.order_id = v_task.source_order_id
        AND d.assignment_id IS NULL
      ORDER BY d.draft_index
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

      IF v_draft.id IS NOT NULL THEN
        UPDATE public.task_assignments
        SET draft_comment = v_draft.comment_text
        WHERE id = v_assignment.id;

        UPDATE public.reddit_order_comment_drafts
        SET assignment_id = v_assignment.id
        WHERE id = v_draft.id;

        v_assignment.draft_comment := v_draft.comment_text;
      END IF;
    END IF;
  ELSE
    SELECT *
    INTO v_account
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id
      AND user_id = v_uid;

    IF v_account.id IS NULL THEN
      RAISE EXCEPTION 'Pilih akun Reddit yang valid.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.karma < COALESCE(v_task.min_karma, 0)
      OR v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0)
      OR v_account.status_flag IN ('suspended','not_found') THEN
      RAISE EXCEPTION 'Akun Reddit tidak memenuhi syarat task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, v_account.id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  RETURN v_assignment;
END $fn$;

-- ------------------------------------------------------------
-- 6. Update list_eligible_tasks_for_user:
--    Include LinkedIn categories in non-Reddit group & apply dedup.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  brief text,
  target_url text,
  task_type text,
  task_category text,
  reward_amount integer,
  max_assignments integer,
  current_assignments integer,
  min_karma integer,
  min_account_age_days integer,
  per_account_limit integer,
  status text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  created_at timestamp with time zone,
  can_do_with_account_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean := false;
  v_invited boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, NULL::uuid AS can_do_with_account_id
    FROM public.tasks t
    WHERE t.status = 'active'
      AND t.is_hidden = false
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
    ORDER BY t.id, t.created_at DESC;
    RETURN;
  END IF;

  SELECT (role = 'admin') INTO v_is_admin FROM public.users WHERE users.id = v_user;
  SELECT (invited_at IS NOT NULL) INTO v_invited FROM public.reddit_army_profiles WHERE reddit_army_profiles.user_id = v_user;

  -- 1. Non-Reddit tasks (forum_comment, youtube_upload, preferred_source, linkedin)
  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND t.task_category IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment'
    )
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND ta.status IN ('in_progress','submitted','approved')
    ) < COALESCE(t.per_account_limit, 1)
    -- Exclude LinkedIn tasks if user already did the same target URL
    AND NOT (
      t.task_category IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment')
      AND EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND ta_dedup.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') = regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. Reddit tasks
  IF v_invited THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, ra.id AS can_do_with_account_id
    FROM public.tasks t
    JOIN public.reddit_accounts ra ON ra.user_id = v_user
    WHERE t.status = 'active'
      AND t.is_hidden = false
      AND COALESCE(t.task_category, '') NOT IN (
        'forum_comment', 'youtube_upload', 'preferred_source',
        'linkedin_like', 'linkedin_follow', 'linkedin_comment'
      )
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
      AND (v_is_admin OR ra.karma >= COALESCE(t.min_karma, 0))
      AND (v_is_admin OR ra.account_age_days >= COALESCE(t.min_account_age_days, 0))
      AND (v_is_admin OR ra.status_flag NOT IN ('suspended','not_found'))
      AND (
        SELECT count(*)
        FROM public.task_assignments ta
        WHERE ta.task_id = t.id
          AND ta.reddit_account_id = ra.id
          AND ta.status IN ('in_progress','submitted','approved')
      ) < COALESCE(t.per_account_limit, 1)
    ORDER BY t.id, t.created_at DESC;
  END IF;
END
$fn$;

-- ------------------------------------------------------------
-- 7. Update tg_enforce_assignment_rules:
--    Include LinkedIn categories in no-account bucket + is_hidden check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enforce_assignment_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_task record;
  v_limit int;
  v_existing int;
  v_live int;
BEGIN
  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  v_limit := COALESCE(v_task.per_account_limit, 1);

  IF TG_OP = 'INSERT' THEN
    IF v_task.status <> 'active'
      OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
      OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at)
      OR v_task.is_hidden THEN
      RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.task_live_assignment_count(NEW.task_id) INTO v_live;
    IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
      PERFORM public.sync_task_slot_count(NEW.task_id);
      RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
    END IF;

    -- No-Reddit-account categories
    IF COALESCE(v_task.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment'
    ) THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND user_id = NEW.user_id
        AND status IN ('in_progress','submitted','approved');

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini (max % per member). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF NEW.reddit_account_id IS NULL THEN
        RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.' USING ERRCODE = 'P0001';
      END IF;

      SELECT user_id INTO NEW.user_id
      FROM public.reddit_accounts
      WHERE id = NEW.reddit_account_id;

      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Akun tidak valid.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND reddit_account_id = NEW.reddit_account_id
        AND status IN ('in_progress','submitted','approved');

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini (max % per akun). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF NEW.draft_comment IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.draft_comment IS DISTINCT FROM OLD.draft_comment OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.enforce_unique_forum_comment(NEW.id, NEW.task_id, NEW.draft_comment);
  END IF;

  RETURN NEW;
END $function$;

-- ------------------------------------------------------------
-- 8. Update tg_enforce_per_account_limit:
--    Include LinkedIn categories in no-account bucket
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enforce_per_account_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit int;
  v_existing int;
  v_category text;
BEGIN
  SELECT COALESCE(per_account_limit, 1), task_category
  INTO v_limit, v_category
  FROM public.tasks
  WHERE id = NEW.task_id;

  IF v_category IN (
    'forum_comment', 'youtube_upload', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment'
  ) THEN
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND user_id = NEW.user_id
      AND status IN ('in_progress','submitted','approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini (max % per member). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.reddit_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND reddit_account_id = NEW.reddit_account_id
      AND status IN ('in_progress','submitted','approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini (max % per akun). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ------------------------------------------------------------
-- 9. Patch admin_create_task / admin_update_task CASE mappings
-- ------------------------------------------------------------
DO $patch$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT oid, pg_get_functiondef(oid) AS src, proname
    FROM pg_proc
    WHERE proname IN ('admin_create_task', 'admin_update_task')
      AND pronamespace = 'public'::regnamespace
  LOOP
    IF r.src LIKE '%linkedin_like%' THEN
      CONTINUE;
    END IF;
    v_new := replace(
      r.src,
      $q$WHEN 'preferred_source'   THEN 'upvote'$q$,
      $q$WHEN 'preferred_source'   THEN 'upvote'
      WHEN 'linkedin_like'      THEN 'upvote'
      WHEN 'linkedin_follow'    THEN 'upvote'
      WHEN 'linkedin_comment'   THEN 'comment'$q$
    );
    IF v_new = r.src THEN
      v_new := replace(
        r.src,
        $q$WHEN 'preferred_source' THEN 'upvote'$q$,
        $q$WHEN 'preferred_source' THEN 'upvote'
        WHEN 'linkedin_like' THEN 'upvote'
        WHEN 'linkedin_follow' THEN 'upvote'
        WHEN 'linkedin_comment' THEN 'comment'$q$
      );
    END IF;
    IF v_new <> r.src THEN
      EXECUTE v_new;
      RAISE NOTICE 'patched % (added linkedin categories)', r.proname;
    END IF;
  END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';
