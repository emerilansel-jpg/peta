-- ============================================================
-- Permanent Fix: Task Eligibility & Claim RPC Column Hardening
--
-- Root Cause:
--   Recent migrations (20261012110000 and 20261012120000) contained outdated
--   column names:
--     1. `u.reddit_army_invited` on `public.users` (column does not exist).
--     2. `ya.step3_approved_at` / `ya.status` on `public.youtube_accounts`
--        (real columns are `ya.verified_at` and `ya.verification_status`).
--
-- This caused runtime Postgres errors in `list_eligible_tasks_for_user()`
-- whenever any regular user viewed `/tasks`, returning 0 tasks while
-- admin saw all 43+ tasks in `/admin/tasks`.
--
-- This migration permanently replaces both `list_eligible_tasks_for_user()`
-- and `claim_task_assignment()` with clean, verified column references.
-- ============================================================

-- 1. Hardened list_eligible_tasks_for_user
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE (
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
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

  -- 1. Accountless tasks: forum_comment, youtube_upload, preferred_source, linkedin, trustpilot, google_maps_review, quora_upvote
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
    AND COALESCE(t.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote'
    )
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
    -- Deduplication for link-based tasks
    AND (
      COALESCE(t.task_category, '') NOT IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'quora_upvote')
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

  -- 2. Reddit tasks (excluding reddit_challenge which is isolated in /reddit-army)
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
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'reddit_challenge'
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
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_eligible_tasks_for_user() TO authenticated;

-- 2. Hardened claim_task_assignment
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_assignment public.task_assignments;
  v_reddit_acc public.reddit_accounts;
  v_is_admin boolean := false;
  v_active_claims_count int;
  v_norm_target text;
  v_active_total int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Concurrency control: acquire transaction lock
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation)
  VALUES (txid_current(), pg_backend_pid(), 'claim');

  -- Lock task row
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
    RAISE EXCEPTION 'Kuota pengerjaan task ini sudah habis.' USING ERRCODE = 'P0001';
  END IF;

  -- YouTube Upload category: check verified youtube account
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
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

  -- Accountless categories: no Reddit account required
  ELSIF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review', 'quora_upvote'
  ) THEN
    -- Strict cross-order target dedup for LinkedIn, Trustpilot, Google Maps & Quora tasks
    IF v_task.task_category IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'quora_upvote') THEN
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

    -- Per-member claim check for accountless tasks
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

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

  -- Reddit categories: require valid Reddit account
  ELSE
    IF p_reddit_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit harus dipilih untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_reddit_acc
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id;

    IF v_reddit_acc.id IS NULL OR v_reddit_acc.user_id <> v_uid THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak valid atau bukan milik kamu.' USING ERRCODE = 'P0001';
    END IF;

    -- Per-reddit-account limit check
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
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  RETURN v_assignment;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_task_assignment(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
