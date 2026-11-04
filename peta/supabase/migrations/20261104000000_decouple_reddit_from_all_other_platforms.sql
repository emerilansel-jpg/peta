-- ============================================================
-- Migration: 20261104000000_decouple_reddit_from_all_other_platforms.sql
--
-- Core Principle: "Reddit khusus reddit. Dan tidak ada kaitannya dengan platform lain."
--
-- 1. claim_task_assignment: Only reddit_% tasks require a Reddit account.
--    All other platforms (Yelp, Clutch, Trustpilot, Google Maps, LinkedIn,
--    YouTube, Forum, Quora, Preferred Source, etc.) are accountless.
-- 2. tg_enforce_assignment_rules: Enforces Reddit account strictly on reddit_% tasks.
-- 3. tg_enforce_per_account_limit: Enforces Reddit account limit strictly on reddit_% tasks.
-- 4. list_eligible_tasks_for_user: Part 1 lists ALL non-Reddit tasks without Reddit account.
--    Part 2 lists strictly reddit_% tasks.
-- 5. tg_on_assignment_approved: Populates delivery proof to Straight order for all platforms.
-- ============================================================

-- 1. FIX claim_task_assignment
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL::uuid
)
RETURNS task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_assignment public.task_assignments;
  v_reddit_acc public.reddit_accounts;
  v_is_admin boolean := false;
  v_active_claims_count int;
  v_active_total int;
  v_norm_target text;
  v_timeout_interval interval;
  v_is_reddit_task boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Purge expired in_progress assignments for this task first
  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)',
      can_retry = true,
      updated_at = NOW()
  WHERE task_id = p_task_id
    AND status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  PERFORM public.sync_task_slot_count(p_task_id);

  -- 2. Anti-hoarding: Max 2 concurrent in_progress tasks per member (excluding Reddit challenge)
  SELECT COUNT(*) INTO v_active_total
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = v_uid
    AND ta.status = 'in_progress'
    AND (ta.expires_at IS NULL OR ta.expires_at > NOW())
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  IF v_active_total >= 2 THEN
    RAISE EXCEPTION 'Kamu sedang mengerjakan % tugas lain. Selesaikan dan submit bukti terlebih dahulu sebelum mengambil tugas baru.', v_active_total
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock task
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation)
  VALUES (txid_current(), pg_backend_pid(), 'claim');

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task tidak ditemukan atau sudah tidak tersedia.' USING ERRCODE = 'P0001';
  END IF;

  v_is_admin := public.is_admin();

  IF v_task.status <> 'active' THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.current_assignments >= v_task.max_assignments THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  -- 1 hour for micro-tasks, 4 hours for YouTube video production
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    v_timeout_interval := INTERVAL '4 hours';
  ELSE
    v_timeout_interval := INTERVAL '1 hour';
  END IF;

  -- Determine if this task is strictly a Reddit task
  v_is_reddit_task := (COALESCE(v_task.task_category, '') LIKE 'reddit_%');

  -- ========================================================
  -- BRANCH A: YouTube Upload (Requires YouTube verification)
  -- ========================================================
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.youtube_accounts ya
      WHERE ya.user_id = v_uid
        AND ya.verified_at IS NOT NULL
        AND ya.verification_status = 'approved'
        AND COALESCE(ya.is_active, true) = true
    ) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Wajib verifikasi akun YouTube (Advanced Features) dan disetujui admin sebelum mengambil task YouTube.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;

  -- ========================================================
  -- BRANCH B: NON-REDDIT TASKS (NO REDDIT ACCOUNT REQUIRED)
  -- Includes: yelp_review, clutch_review, trustpilot_review,
  -- google_maps_review, forum_comment, linkedin_*, preferred_source,
  -- quora_upvote, and ANY non-Reddit platform.
  -- ========================================================
  ELSIF NOT v_is_reddit_task THEN
    -- URL-based deduplication for review and social platforms (one review per user per URL)
    IF COALESCE(v_task.task_category, '') IN (
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review'
    ) THEN
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
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task untuk URL ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND (
        status IN ('in_progress', 'submitted', 'approved')
        OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
      );

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Kamu sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    -- Insert assignment cleanly without Reddit account
    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;

  -- ========================================================
  -- BRANCH C: REDDIT TASKS ONLY (reddit_upvote, reddit_comment, reddit_post_thread, reddit_challenge)
  -- ========================================================
  ELSE
    IF p_reddit_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit harus dipilih untuk task Reddit ini.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_reddit_acc
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id;

    IF v_reddit_acc.id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak ditemukan.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.user_id <> v_uid AND NOT v_is_admin THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit bukan milik kamu.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.status <> 'active' OR v_reddit_acc.is_active = FALSE THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.status_flag IS NOT NULL AND v_reddit_acc.status_flag <> '' THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang bermasalah (%s). Gunakan akun lain.', v_reddit_acc.status_flag USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.min_karma, 0) > 0 AND v_reddit_acc.karma < v_task.min_karma THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Karma akun Reddit belum cukup (minimal % karma).', v_task.min_karma USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.min_account_age_days, 0) > 0 AND v_reddit_acc.account_age_days < v_task.min_account_age_days THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Umur akun Reddit belum cukup (minimal % hari).', v_task.min_account_age_days USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND reddit_account_id = p_reddit_account_id
      AND status IN ('in_progress', 'submitted', 'approved');

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit ini sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment;
END;
$function$;

-- 2. FIX tg_enforce_assignment_rules
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
  v_is_reddit_task boolean := false;
BEGIN
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  v_limit := COALESCE(v_task.per_account_limit, 1);
  v_is_reddit_task := (COALESCE(v_task.task_category, '') LIKE 'reddit_%');

  IF TG_OP = 'INSERT' THEN
    IF v_task.status <> 'active'
      OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
      OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
      RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.task_live_assignment_count(NEW.task_id) INTO v_live;
    IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
      PERFORM public.sync_task_slot_count(NEW.task_id);
      RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
    END IF;

    -- NON-REDDIT TASKS: Accountless (no Reddit account)
    IF NOT v_is_reddit_task THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND user_id = NEW.user_id
        AND (
          status IN ('in_progress','submitted','approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per member). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;

    -- REDDIT TASKS ONLY:
    ELSE
      IF NEW.reddit_account_id IS NULL THEN
        RAISE EXCEPTION 'Akun Reddit wajib untuk task Reddit ini.' USING ERRCODE = 'P0001';
      END IF;

      SELECT user_id INTO NEW.user_id
      FROM public.reddit_accounts
      WHERE id = NEW.reddit_account_id;

      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Akun Reddit tidak valid.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND reddit_account_id = NEW.reddit_account_id
        AND (
          status IN ('in_progress','submitted','approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per akun). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF NEW.draft_comment IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.draft_comment IS DISTINCT FROM OLD.draft_comment OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.enforce_unique_forum_comment(NEW.id, NEW.task_id, NEW.draft_comment);
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. FIX tg_enforce_per_account_limit
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
  v_is_reddit boolean;
BEGIN
  SELECT COALESCE(per_account_limit, 1), task_category
  INTO v_limit, v_category
  FROM public.tasks
  WHERE id = NEW.task_id;

  v_is_reddit := (COALESCE(v_category, '') LIKE 'reddit_%');

  -- Non-Reddit tasks: limit per member
  IF NOT v_is_reddit THEN
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND user_id = NEW.user_id
      AND status IN ('in_progress','submitted','approved');

    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini (max % per member). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;

  -- Reddit tasks: limit per Reddit account
  ELSE
    IF NEW.reddit_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Reddit wajib untuk task Reddit ini.' USING ERRCODE = 'P0001';
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
END;
$function$;

-- 4. FIX list_eligible_tasks_for_user
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user(p_user_id uuid)
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
  created_at timestamp with time zone,
  platform text,
  eligible_account_count integer,
  brand_domain text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := p_user_id;
  v_yt_verified boolean := false;
BEGIN
  IF v_user IS NULL THEN
    v_user := auth.uid();
  END IF;
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  -- 1. ALL NON-REDDIT TASKS (Accountless: Yelp, Clutch, Trustpilot, Google Maps, LinkedIn, Forum, YouTube, Quora, Preferred Source, etc.)
  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    COALESCE(public.forum_platform_label(t.target_url, NULL), 'Forum') AS platform,
    1 AS eligible_account_count,
    NULL::text AS brand_domain
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    -- Exclude only Reddit tasks (which require a Reddit account)
    AND NOT (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND (COALESCE(t.task_category, '') <> 'youtube_upload' OR v_yt_verified)
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND (
          ta.status IN ('claimed', 'submitted', 'approved', 'in_progress')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    -- Deduplication for link-based review & social platforms
    AND (
      COALESCE(t.task_category, '') NOT IN (
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'yelp_review', 'clutch_review'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
          AND ta_dedup.status IN ('claimed', 'submitted', 'approved', 'in_progress')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. REDDIT TASKS ONLY (reddit_upvote, reddit_comment, reddit_post_thread)
  RETURN QUERY
  SELECT
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    'Reddit'::text AS platform,
    count(ra.id)::int AS eligible_account_count,
    NULL::text AS brand_domain
  FROM public.tasks t
  JOIN public.reddit_accounts ra
    ON ra.user_id = v_user
   AND ra.status = 'active'
   AND ra.is_active = true
   AND ra.karma >= COALESCE(t.min_karma, 0)
   AND ra.account_age_days >= COALESCE(t.min_account_age_days, 0)
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND COALESCE(t.task_category, '') <> 'reddit_challenge'
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND NOT EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.reddit_account_id = ra.id
        AND (
          ta.status IN ('claimed', 'submitted', 'approved', 'in_progress')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    )
  GROUP BY t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
           t.task_category, t.reward_amount, t.max_assignments,
           t.current_assignments, t.min_karma, t.min_account_age_days,
           t.per_account_limit, t.status, t.created_at
  HAVING count(ra.id) > 0
  ORDER BY t.created_at DESC;
END;
$function$;

-- 4b. FIX list_eligible_tasks_for_user() [0-argument version called by client app]
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
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user uuid;
  v_is_admin boolean;
  v_invited boolean;
  v_yt_verified boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- Active check
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND u.is_active = true) THEN
    RETURN;
  END IF;

  v_is_admin := public.is_admin();

  SELECT (
    v_is_admin
    OR EXISTS (SELECT 1 FROM public.reddit_army_profiles rap WHERE rap.user_id = v_user)
    OR COALESCE(u.role, '') IN ('admin', 'army', 'worker')
  ) INTO v_invited
  FROM public.users u
  WHERE u.id = v_user;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  -- 1. ALL NON-REDDIT TASKS (Yelp, Clutch, Trustpilot, Google Maps, LinkedIn, Forum, YouTube, Preferred Source, Quora, etc.)
  -- NO REDDIT ACCOUNT REQUIRED!
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
    -- Strictly exclude Reddit tasks
    AND NOT (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND (COALESCE(t.task_category, '') <> 'youtube_upload' OR v_yt_verified)
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND (
          ta.status IN ('in_progress','submitted','approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    -- Deduplication for link-based review & social tasks
    AND (
      COALESCE(t.task_category, '') NOT IN (
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'yelp_review', 'clutch_review'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND ta_dedup.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. REDDIT TASKS ONLY (reddit_upvote, reddit_comment, reddit_post_thread)
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
      AND (COALESCE(t.task_category, '') LIKE 'reddit_%')
      AND COALESCE(t.task_category, '') <> 'reddit_challenge'
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
END;
$function$;

-- 5. FIX tg_on_assignment_approved
CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_reward int;
  v_task_title text;
  v_source_order_id int;
  v_requested int;
  v_delivered int;
  v_proof_text text;
  v_task_category text;
  v_order_status text;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT COALESCE(ta.user_id, ra.user_id), t.reward_amount, t.title, t.source_order_id, t.task_category
      INTO v_user_id, v_reward, v_task_title, v_source_order_id, v_task_category
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.id = NEW.id;

    -- If linked to a client order, verify order is not cancelled or refunded
    IF v_source_order_id IS NOT NULL THEN
      SELECT status INTO v_order_status
      FROM public.reddit_upvote_orders
      WHERE id = v_source_order_id;

      IF v_order_status IN ('cancelled', 'refunded') THEN
        RAISE EXCEPTION 'Tidak bisa approve tugas dari pesanan yang sudah dibatalkan atau direfund.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Credit cashable task reward ONLY for regular tasks (exclude reddit_challenge retention)
    IF v_task_category IS DISTINCT FROM 'reddit_challenge' THEN
      INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
      VALUES (
        v_user_id, v_reward, 'task_reward',
        format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
        NEW.id
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (
        v_user_id,
        'task_reward_credited',
        jsonb_build_object(
          'assignment_id', NEW.id,
          'task_id', NEW.task_id,
          'amount', v_reward,
          'source_order_id', v_source_order_id
        )
      );
    END IF;

    NEW.balance_credited_at := NOW();

    -- Straight order sync (B2B orders)
    IF v_source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET delivered_upvotes = COALESCE(delivered_upvotes, 0) + 1
      WHERE id = v_source_order_id;

      SELECT requested_upvotes, delivered_upvotes INTO v_requested, v_delivered
      FROM public.reddit_upvote_orders WHERE id = v_source_order_id;

      IF v_requested IS NOT NULL AND v_delivered >= v_requested THEN
        UPDATE public.reddit_upvote_orders
        SET status = 'completed', completed_at = NOW()
        WHERE id = v_source_order_id
          AND status IN ('pending', 'processing');
      END IF;

      -- Populate delivery proof fields for client on ALL platforms
      v_proof_text := COALESCE(NEW.submitted_url, NEW.proof_url, NEW.draft_comment);
      UPDATE public.reddit_upvote_orders
      SET delivery_proof_text = CASE
            WHEN delivery_proof_text IS NULL OR length(trim(delivery_proof_text)) = 0 THEN v_proof_text
            ELSE delivery_proof_text || E'\n\n---\n\n' || v_proof_text
          END,
          delivery_proof_url = COALESCE(NEW.proof_image_url, NEW.proof_url, delivery_proof_url)
      WHERE id = v_source_order_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
