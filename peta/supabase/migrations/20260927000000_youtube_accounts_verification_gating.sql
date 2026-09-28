-- Migration: 20260927000000_youtube_accounts_verification_gating.sql
-- Description:
--   1. Create public.youtube_accounts table with RLS for 3-step verification (Advanced Features).
--   2. Add youtube_account_id to public.task_assignments.
--   3. Gate list_eligible_tasks_for_user() so youtube_upload requires approved youtube_accounts.
--   4. Enforce approved YouTube account in claim_task_assignment() and link youtube_account_id.
--   5. Add admin RPCs: admin_list_youtube_accounts and admin_review_youtube_account.

BEGIN;

-- 1. Create table public.youtube_accounts
CREATE TABLE IF NOT EXISTS public.youtube_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel_name text NOT NULL,
  channel_url text NOT NULL,
  verification_screenshot_url text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  verified_at timestamptz,
  verified_by uuid REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_accounts_user_status ON public.youtube_accounts(user_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_youtube_accounts_status ON public.youtube_accounts(verification_status);

-- Enable RLS
ALTER TABLE public.youtube_accounts ENABLE ROW LEVEL SECURITY;

-- Member policies:
CREATE POLICY "Users can view own youtube accounts"
  ON public.youtube_accounts FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users can insert own youtube accounts"
  ON public.youtube_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rejected youtube accounts"
  ON public.youtube_accounts FOR UPDATE
  USING (auth.uid() = user_id AND verification_status = 'rejected')
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins have full access to youtube accounts"
  ON public.youtube_accounts FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2. Add youtube_account_id to task_assignments
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS youtube_account_id uuid REFERENCES public.youtube_accounts(id);

CREATE INDEX IF NOT EXISTS idx_task_assignments_youtube_acc ON public.task_assignments(youtube_account_id);

-- 3. Update claim_task_assignment with YouTube Account Gating
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
  v_yt_account_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
  END IF;

  -- Enforce active user
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RAISE EXCEPTION 'Akun kamu sedang dinonaktifkan.' USING ERRCODE = 'P0001';
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

  -- Set write capability to satisfy zz_guard_assignment_authorization on draft assignment
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation, task_id)
  VALUES (txid_current(), pg_backend_pid(), 'claim', p_task_id)
  ON CONFLICT (transaction_id, backend_id, operation) DO UPDATE SET task_id = EXCLUDED.task_id;

  -- Gating khusus YouTube Upload: wajib punya akun YouTube yang sudah diverifikasi (Tier 3)
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    SELECT id INTO v_yt_account_id
    FROM public.youtube_accounts
    WHERE user_id = v_uid
      AND verification_status = 'approved'
      AND is_active = true
    ORDER BY verified_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    IF v_yt_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Wajib verifikasi akun YouTube Step 3 (Fitur Lanjutan) terlebih dahulu di menu Akun.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, youtube_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, v_yt_account_id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

  -- Accountless categories: no Reddit account required
  ELSIF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'preferred_source',
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
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
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
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak valid.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_account.is_active THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.status = 'suspended' THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu berstatus suspended.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.karma < COALESCE(v_task.min_karma, 0) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Karma akun kamu belum cukup untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Umur akun kamu belum cukup untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, v_account.id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END;
$fn$;

-- 4. Update list_eligible_tasks_for_user dengan gating YouTube verified
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
  -- Anonymous calls return 0 tasks
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- User inactive return 0 tasks
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND u.is_active = true) THEN
    RETURN;
  END IF;

  SELECT (role = 'admin') INTO v_is_admin
  FROM public.users
  WHERE users.id = v_user;

  SELECT EXISTS (
    SELECT 1
    FROM public.reddit_army_profiles
    WHERE reddit_army_profiles.user_id = v_user
  ) INTO v_invited;

  -- 1. Non-Reddit tasks (forum_comment, youtube_upload, preferred_source, linkedin_*)
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
      'linkedin_like', 'linkedin_follow', 'linkedin_comment'
    )
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    -- Khusus youtube_upload: wajib punya akun YouTube yang sudah di-approve
    AND (
      COALESCE(t.task_category, '') <> 'youtube_upload'
      OR EXISTS (
        SELECT 1 FROM public.youtube_accounts ya
        WHERE ya.user_id = v_user
          AND ya.verification_status = 'approved'
          AND ya.is_active = true
      )
    )
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND ta.status IN ('in_progress','submitted','approved')
    ) < COALESCE(t.per_account_limit, 1)
    AND (
      COALESCE(t.task_category, '') NOT IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment')
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

  -- 2. Reddit tasks (reddit_challenge / reddit comment/upvote)
  IF v_invited OR v_is_admin THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, ra.id AS can_do_with_account_id
    FROM public.tasks t
    CROSS JOIN LATERAL (
      SELECT a.id, a.account_age_days, a.karma
      FROM public.reddit_accounts a
      WHERE a.user_id = v_user
        AND a.is_active = true
        AND a.status <> 'suspended'
        AND a.not_found_streak < 3
        AND (
          SELECT count(*)
          FROM public.task_assignments ta
          WHERE ta.task_id = t.id
            AND ta.reddit_account_id = a.id
            AND ta.status IN ('in_progress','submitted','approved')
        ) < COALESCE(t.per_account_limit, 1)
      ORDER BY a.account_age_days DESC, a.karma DESC
      LIMIT 1
    ) ra
    WHERE t.status = 'active'
      AND t.is_hidden = false
      AND COALESCE(t.task_category, '') NOT IN (
        'forum_comment', 'youtube_upload', 'preferred_source',
        'linkedin_like', 'linkedin_follow', 'linkedin_comment'
      )
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
      AND ra.account_age_days >= COALESCE(t.min_account_age_days, 0)
      AND ra.karma >= COALESCE(t.min_karma, 0)
    ORDER BY t.id, t.created_at DESC;
  END IF;
END;
$fn$;

-- 5. Admin RPCs: List & Review YouTube Accounts
CREATE OR REPLACE FUNCTION public.admin_list_youtube_accounts()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  user_full_name text,
  user_email text,
  user_whatsapp text,
  channel_name text,
  channel_url text,
  verification_screenshot_url text,
  verification_status text,
  rejection_reason text,
  is_active boolean,
  created_at timestamptz,
  verified_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    ya.id,
    ya.user_id,
    u.full_name AS user_full_name,
    u.email AS user_email,
    u.whatsapp AS user_whatsapp,
    ya.channel_name,
    ya.channel_url,
    ya.verification_screenshot_url,
    ya.verification_status,
    ya.rejection_reason,
    ya.is_active,
    ya.created_at,
    ya.verified_at
  FROM public.youtube_accounts ya
  JOIN public.users u ON u.id = ya.user_id
  ORDER BY
    CASE WHEN ya.verification_status = 'pending' THEN 0 ELSE 1 END,
    ya.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_youtube_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_youtube_account(
  p_account_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS public.youtube_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.youtube_accounts;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;

  UPDATE public.youtube_accounts
  SET verification_status = p_decision,
      rejection_reason = CASE WHEN p_decision = 'rejected' THEN p_reason ELSE NULL END,
      verified_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
      verified_by = auth.uid()
  WHERE id = p_account_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'account not found';
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_youtube_account(uuid, text, text) TO authenticated;

COMMIT;
