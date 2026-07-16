-- =============================================================
-- Straight Ltd — add YouTube Upload service.
--
-- Client-facing: $5 flat per YouTube video upload.
-- Client provides a video URL + metadata; PeTa army uploads it to
-- their own YouTube channel and returns the video URL as proof.
--
-- Army reward: Rp25,000 per upload (internal, not shown in Straight Ltd).
-- Army does NOT need a Reddit account for this task category.
-- =============================================================

-- 1. Widen enums / check constraints.
-- -------------------------------------------------------------

ALTER TABLE public.reddit_upvote_orders
DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;
ALTER TABLE public.reddit_upvote_orders
ADD CONSTRAINT reddit_upvote_orders_target_type_check
CHECK (target_type IN ('upvote', 'comment', 'thread', 'youtube_upload'));

ALTER TABLE public.tasks
DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE public.tasks
ADD CONSTRAINT tasks_task_type_check
CHECK (task_type IN ('comment', 'upvote', 'upload'));

ALTER TABLE public.tasks
DROP CONSTRAINT IF EXISTS tasks_task_category_check;
ALTER TABLE public.tasks
ADD CONSTRAINT tasks_task_category_check
CHECK (task_category IN (
  'reddit_upvote', 'reddit_comment', 'reddit_post_thread', 'forum_comment', 'youtube_upload'
));

ALTER TABLE public.straight_pricing
DROP CONSTRAINT IF EXISTS straight_pricing_platform_check;
ALTER TABLE public.straight_pricing
ADD CONSTRAINT straight_pricing_platform_check
CHECK (platform IN ('reddit', 'forum', 'youtube'));

ALTER TABLE public.straight_pricing
DROP CONSTRAINT IF EXISTS straight_pricing_service_check;
ALTER TABLE public.straight_pricing
ADD CONSTRAINT straight_pricing_service_check
CHECK (service IN ('upvote', 'comment', 'thread', 'upload'));

-- 2. Seed the pricing row for YouTube Upload ($5.00, enabled).
-- -------------------------------------------------------------
INSERT INTO public.straight_pricing (
  key, platform, service, mention_mode, label, price_cents, enabled, sort_order
) VALUES (
  'youtube_upload', 'youtube', 'upload', 'none', 'YouTube — Video Upload', 500, true, 11
)
ON CONFLICT (key) DO NOTHING;

-- 3. RPC: create a YouTube Upload order.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_youtube_upload_order(
  p_video_url TEXT,
  p_title TEXT,
  p_description TEXT,
  p_tags TEXT,
  p_privacy TEXT,
  p_notes TEXT
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_privacy TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_video_url IS NULL OR length(trim(p_video_url)) < 8 THEN
    RAISE EXCEPTION 'video_url required';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) < 1 THEN
    RAISE EXCEPTION 'title required';
  END IF;

  -- Normalize privacy setting; default to unlisted if unknown.
  v_privacy := COALESCE(NULLIF(trim(p_privacy), ''), 'unlisted');
  IF v_privacy NOT IN ('public', 'unlisted', 'private') THEN
    v_privacy := 'unlisted';
  END IF;

  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  -- Price from the matrix (flat $5.00). Reject if admin disabled the service.
  v_cost := public.fn_straight_unit_price('youtube_upload', 500);

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'youtube_upload',
    'video_url', trim(p_video_url),
    'title', trim(p_title),
    'description', COALESCE(NULLIF(trim(p_description), ''), ''),
    'tags', COALESCE(NULLIF(trim(p_tags), ''), ''),
    'privacy', v_privacy,
    'client_notes', COALESCE(NULLIF(trim(p_notes), ''), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    trim(p_video_url),
    'YouTube',
    'youtube_upload',
    1,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_cost,
    v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'youtube_upload',
      'price_key', 'youtube_upload'
    )
  );

  RETURN v_order;
END $$;

REVOKE ALL ON FUNCTION public.fn_create_youtube_upload_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_youtube_upload_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 4. Auto-import: map youtube_upload orders into PeTa tasks.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_import_reddit_order_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_notes           jsonb   := '{}'::jsonb;
  v_is_forum_comment boolean := false;
  v_is_youtube_upload boolean := false;
  v_task_type       text;
  v_task_category   text;
  v_reward          int;
  v_title           text;
  v_description     text;
  v_brief           text;
  v_platform        text;
  v_brand           text;
  v_comment_text    text;
  v_mention_mode    text;
  v_yt_title        text;
  v_yt_description  text;
  v_yt_tags         text;
  v_yt_privacy      text;
  v_creator         uuid;
BEGIN
  IF NEW.status NOT IN ('pending', 'processing') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE source_order_id = NEW.id) THEN RETURN NEW; END IF;

  BEGIN
    v_notes := COALESCE(NEW.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment := COALESCE(NEW.target_type, 'upvote') = 'comment'
                        OR v_notes->>'service' = 'forum_comment';
  v_is_youtube_upload := COALESCE(NEW.target_type, 'upvote') = 'youtube_upload'
                         OR v_notes->>'service' = 'youtube_upload';

  v_task_type := CASE
    WHEN NEW.target_type = 'upvote' THEN 'upvote'
    WHEN v_is_youtube_upload THEN 'upload'
    ELSE 'comment'
  END;

  v_task_category := CASE
    WHEN NEW.target_type = 'upvote'     THEN 'reddit_upvote'
    WHEN v_is_forum_comment             THEN 'forum_comment'
    WHEN v_is_youtube_upload            THEN 'youtube_upload'
    WHEN NEW.target_type = 'thread'     THEN 'reddit_post_thread'
    ELSE 'reddit_comment'
  END;

  v_platform     := public.forum_platform_label(NEW.thread_url, COALESCE(v_notes->>'platform', NEW.subreddit));
  v_brand        := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_yt_title       := NULLIF(v_notes->>'title', '');
  v_yt_description := NULLIF(v_notes->>'description', '');
  v_yt_tags        := NULLIF(v_notes->>'tags', '');
  v_yt_privacy     := COALESCE(NULLIF(v_notes->>'privacy', ''), 'unlisted');

  v_reward := CASE
    WHEN v_is_youtube_upload THEN 25000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 5000
  END;

  v_title := CASE
    WHEN v_is_youtube_upload THEN
      format('Upload video ke YouTube: %s', COALESCE(v_yt_title, 'tanpa judul'))
    WHEN v_is_forum_comment THEN
      format('Komen di %s%s', v_platform,
             CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
    WHEN NEW.subreddit IS NOT NULL THEN format('r/%s - %s', NEW.subreddit, v_task_type)
    ELSE format('Reddit %s task', v_task_type)
  END;

  IF v_is_youtube_upload THEN
    v_description := format(
      'Upload video dari %s ke YouTube. Judul: %s. Setel privasi jadi %s. Setelah upload, kirim URL video YouTube sebagai bukti.',
      NEW.thread_url,
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
      NEW.thread_url,
      COALESCE(v_yt_title, '-'),
      COALESCE(v_yt_description, '-'),
      COALESCE(v_yt_tags, '-'),
      v_yt_privacy
    );
  ELSIF v_is_forum_comment THEN
    v_description := format(
      'Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot buat bukti.',
      v_platform);
    v_brief := public.forum_comment_task_brief(NEW.thread_url, v_platform, v_comment_text, v_brand, v_mention_mode);
  ELSE
    IF NEW.notes IS NOT NULL AND btrim(NEW.notes) LIKE '{%' THEN
      v_description := 'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.';
    ELSE
      v_description := COALESCE(NULLIF(btrim(NEW.notes), ''),
                               'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.');
    END IF;
    v_brief := NULL;
  END IF;

  SELECT id INTO v_creator FROM users WHERE role = 'admin' LIMIT 1;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    min_karma, min_account_age_days, per_account_limit, min_level,
    max_assignments, reward_amount, status, created_by, source_order_id
  ) VALUES (
    v_title, v_description, v_brief,
    NEW.thread_url, v_task_type, v_task_category,
    0, 0, 1, 0,
    GREATEST(1, NEW.requested_upvotes),
    v_reward, 'draft', v_creator, NEW.id
  );

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_auto_import_reddit_order ON public.reddit_upvote_orders;
CREATE TRIGGER trg_auto_import_reddit_order
  AFTER INSERT ON public.reddit_upvote_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_import_reddit_order_to_task();

-- 5. Claiming: youtube_upload does NOT require a Reddit account (like forum_comment).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task record;
  v_account record;
  v_assignment public.task_assignments;
  v_live int;
  v_draft record;
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
    OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_task.task_category, '') IN ('forum_comment', 'youtube_upload') THEN
    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

    -- Only forum_comment tasks carry unique comment drafts.
    IF v_task.task_category = 'forum_comment' THEN
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

    IF NOT public.is_admin() THEN
      IF v_account.karma < COALESCE(v_task.min_karma, 0)
        OR v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0)
        OR v_account.status_flag IN ('suspended','not_found') THEN
        RAISE EXCEPTION 'Akun ini belum eligible untuk task ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_task_assignment(uuid, uuid) TO authenticated;

-- 6. Task list: include youtube_upload in the account-less branch.
-- -------------------------------------------------------------
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
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz,
  can_do_with_account_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_has_reddit boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  v_is_admin := public.is_admin();
  v_has_reddit := EXISTS (SELECT 1 FROM public.reddit_accounts WHERE user_id = v_user);

  IF v_is_admin AND NOT v_has_reddit THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, NULL::uuid AS can_do_with_account_id
    FROM public.tasks t
    WHERE t.status = 'active'
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
    ORDER BY t.id, t.created_at DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.task_category IN ('forum_comment', 'youtube_upload')
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
  ORDER BY t.id, t.created_at DESC;

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
    AND COALESCE(t.task_category, '') NOT IN ('forum_comment', 'youtube_upload')
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
END $$;

GRANT EXECUTE ON FUNCTION public.list_eligible_tasks_for_user() TO authenticated;

-- 7. Assignment limit enforcement: treat youtube_upload like forum_comment.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enforce_per_account_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit int;
  v_existing int;
  v_category text;
BEGIN
  SELECT COALESCE(per_account_limit, 1), task_category
  INTO v_limit, v_category
  FROM public.tasks
  WHERE id = NEW.task_id;

  IF v_category IN ('forum_comment', 'youtube_upload') THEN
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
END $$;

-- 8. Admin task creation: map youtube_upload -> upload task_type.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_task(
  p_title text,
  p_description text,
  p_brief text,
  p_target_url text,
  p_task_category text,
  p_reward_amount int,
  p_max_assignments int,
  p_per_account_limit int,
  p_min_karma int DEFAULT 0,
  p_min_account_age_days int DEFAULT 0,
  p_start_at timestamptz DEFAULT NULL,
  p_end_at timestamptz DEFAULT NULL,
  p_post_to_wa_group boolean DEFAULT false,
  p_wa_group_draft text DEFAULT NULL,
  p_status text DEFAULT 'draft'
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.tasks;
  v_task_type text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_end_at IS NOT NULL AND p_start_at IS NOT NULL AND p_end_at < p_start_at THEN
    RAISE EXCEPTION 'End time tidak boleh lebih awal dari start time';
  END IF;

  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote' THEN 'upvote'
    WHEN 'youtube_upload' THEN 'upload'
    ELSE 'comment'
  END;

  INSERT INTO public.tasks (
    title, description, brief, target_url, task_category, task_type,
    reward_amount, max_assignments, per_account_limit, min_karma, min_account_age_days,
    start_at, end_at, post_to_wa_group, wa_group_draft, status, created_by
  ) VALUES (
    p_title, p_description, p_brief, p_target_url, p_task_category, v_task_type,
    GREATEST(p_reward_amount, 0), GREATEST(p_max_assignments, 1), GREATEST(p_per_account_limit, 1),
    GREATEST(p_min_karma, 0), GREATEST(p_min_account_age_days, 0),
    p_start_at, p_end_at, COALESCE(p_post_to_wa_group, false), p_wa_group_draft,
    p_status, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_create_task(
  text, text, text, text, text, int, int, int, int, int, timestamptz, timestamptz, boolean, text, text
) TO authenticated;

-- 9. Admin task update: map youtube_upload -> upload task_type.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_update_task(
  uuid, text, text, text, text, text, integer, integer, integer, integer, integer,
  timestamp with time zone, timestamp with time zone, text
);
DROP FUNCTION IF EXISTS public.admin_update_task(
  uuid, text, text, text, text, text, integer, integer, integer, integer, integer,
  timestamp with time zone, timestamp with time zone, text, boolean, text
);

CREATE OR REPLACE FUNCTION public.admin_update_task(
  p_task_id uuid,
  p_title text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_brief text DEFAULT NULL::text,
  p_post_to_wa_group boolean DEFAULT NULL::boolean,
  p_wa_group_draft text DEFAULT NULL::text,
  p_target_url text DEFAULT NULL::text,
  p_task_category text DEFAULT NULL::text,
  p_reward_amount integer DEFAULT NULL::integer,
  p_max_assignments integer DEFAULT NULL::integer,
  p_per_account_limit integer DEFAULT NULL::integer,
  p_min_karma integer DEFAULT NULL::integer,
  p_min_account_age_days integer DEFAULT NULL::integer,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task_type text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote'      THEN 'upvote'
    WHEN 'reddit_comment'     THEN 'comment'
    WHEN 'forum_comment'      THEN 'comment'
    WHEN 'reddit_post_thread' THEN 'comment'
    WHEN 'youtube_upload'     THEN 'upload'
    ELSE NULL
  END;

  UPDATE public.tasks SET
    title                 = COALESCE(p_title, title),
    description           = COALESCE(p_description, description),
    brief                 = COALESCE(p_brief, brief),
    post_to_wa_group      = COALESCE(p_post_to_wa_group, post_to_wa_group),
    wa_group_draft        = COALESCE(p_wa_group_draft, wa_group_draft),
    target_url            = COALESCE(p_target_url, target_url),
    task_category         = COALESCE(p_task_category, task_category),
    task_type             = COALESCE(v_task_type, task_type),
    reward_amount         = COALESCE(p_reward_amount, reward_amount),
    max_assignments       = COALESCE(p_max_assignments, max_assignments),
    per_account_limit     = COALESCE(p_per_account_limit, per_account_limit),
    min_karma             = COALESCE(p_min_karma, min_karma),
    min_account_age_days  = COALESCE(p_min_account_age_days, min_account_age_days),
    start_at              = CASE WHEN p_start_at IS NOT NULL THEN p_start_at ELSE start_at END,
    end_at                = CASE WHEN p_end_at IS NOT NULL THEN p_end_at ELSE end_at END,
    status                = COALESCE(p_status, status)
  WHERE id = p_task_id;

  RETURN p_task_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_task(
  uuid, text, text, text, boolean, text, text, text, integer, integer, integer,
  integer, integer, timestamp with time zone, timestamp with time zone, text
) TO authenticated;
