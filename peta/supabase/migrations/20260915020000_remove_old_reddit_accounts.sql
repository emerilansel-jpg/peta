-- Migration: 20260915020000_remove_old_reddit_accounts.sql
-- Ensures replaced/old Reddit accounts are automatically removed/deactivated:
-- 1. In replace_user_reddit_account: if old account has no task assignments, delete it permanently.
--    If it has past task assignments, archive it with is_active = false (preserving earnings & history).
-- 2. In claim_task_assignment: enforce COALESCE(is_active, true) = true on chosen reddit_account_id.
-- 3. In list_eligible_tasks_for_user: join only active reddit_accounts (COALESCE(is_active, true) = true).
-- 4. Clean up existing inactive accounts that have 0 task assignments.

BEGIN;

-- 1. replace_user_reddit_account with auto-delete for unused old accounts
CREATE OR REPLACE FUNCTION public.replace_user_reddit_account(
  p_new_username text,
  p_reason text,
  p_initial_karma int DEFAULT 0,
  p_initial_age_days int DEFAULT 0,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_user_id uuid;
  v_is_admin boolean := public.is_admin();
  v_clean_username text;
  v_old_account public.reddit_accounts;
  v_existing_account public.reddit_accounts;
  v_new_account public.reddit_accounts;
  v_profile public.reddit_army_profiles;
  v_has_past_assignments boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_caller THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: only admin can replace another user account' USING ERRCODE = '42501';
    END IF;
    v_target_user_id := p_user_id;
  ELSE
    v_target_user_id := v_caller;
  END IF;

  -- Validate & sanitize username
  v_clean_username := regexp_replace(trim(COALESCE(p_new_username, '')), '^.*?(?:reddit\.com\/(?:user|u)\/|u\/|user\/)', '', 'i');
  v_clean_username := regexp_replace(v_clean_username, '[^A-Za-z0-9_-]', '', 'g');

  IF length(v_clean_username) < 3 OR length(v_clean_username) > 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit minimal 3 dan maksimal 32 karakter.');
  END IF;

  -- Check if username is used by someone else
  SELECT * INTO v_existing_account
  FROM public.reddit_accounts
  WHERE lower(username) = lower(v_clean_username)
  LIMIT 1;

  IF v_existing_account.id IS NOT NULL AND v_existing_account.user_id <> v_target_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit u/' || v_clean_username || ' sudah terdaftar di akun PeTa lain.');
  END IF;

  -- Find current active account
  SELECT * INTO v_old_account
  FROM public.reddit_accounts
  WHERE user_id = v_target_user_id
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_old_account.id IS NOT NULL AND lower(v_old_account.username) = lower(v_clean_username) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Akun baru tidak boleh sama dengan akun saat ini.');
  END IF;

  -- STEP 1: Deactivate or delete old account
  IF v_old_account.id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.task_assignments WHERE reddit_account_id = v_old_account.id
    ) INTO v_has_past_assignments;

    IF NOT v_has_past_assignments THEN
      -- Account never had any tasks: completely and permanently remove it
      DELETE FROM public.reddit_accounts WHERE id = v_old_account.id;
      v_old_account := NULL;
    ELSE
      -- Has past assignments: deactivate & archive to protect earnings & assignment history
      UPDATE public.reddit_accounts
      SET is_active = false,
          replaced_at = NOW(),
          replacement_reason = p_reason,
          updated_at = NOW()
      WHERE id = v_old_account.id;
    END IF;
  END IF;

  -- STEP 2: Reactivate or insert new active account
  IF v_existing_account.id IS NOT NULL AND v_existing_account.user_id = v_target_user_id THEN
    UPDATE public.reddit_accounts
    SET is_active = true,
        karma = COALESCE(p_initial_karma, karma),
        account_age_days = COALESCE(p_initial_age_days, account_age_days),
        status_flag = 'ok',
        flagged_at = NULL,
        last_sync = NOW(),
        updated_at = NOW()
    WHERE id = v_existing_account.id
    RETURNING * INTO v_new_account;
  ELSE
    INSERT INTO public.reddit_accounts (
      user_id, username, karma, account_age_days, level, is_active, status_flag, last_sync, created_at, updated_at
    ) VALUES (
      v_target_user_id,
      v_clean_username,
      COALESCE(p_initial_karma, 0),
      COALESCE(p_initial_age_days, 0),
      0,
      true,
      'ok',
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING * INTO v_new_account;
  END IF;

  -- STEP 3: Link old account to the new replacement account (if old account was archived)
  IF v_old_account.id IS NOT NULL THEN
    UPDATE public.reddit_accounts
    SET replaced_by_account_id = v_new_account.id
    WHERE id = v_old_account.id;
  END IF;

  -- STEP 4: Update reddit_army_profiles if enrolled
  SELECT * INTO v_profile
  FROM public.reddit_army_profiles
  WHERE user_id = v_target_user_id;

  IF v_profile.user_id IS NOT NULL THEN
    UPDATE public.reddit_army_profiles
    SET warmed_account_id = v_new_account.id,
        notes = CONCAT_WS(E'\n', notes, format('[%s] Ganti akun ke u/%s: %s', NOW()::date, v_new_account.username, COALESCE(p_reason, 'Permintaan member'))),
        updated_at = NOW()
    WHERE user_id = v_target_user_id;
  END IF;

  -- STEP 5: Audit log
  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (
    v_caller,
    'reddit_account_replaced',
    jsonb_build_object(
      'target_user_id', v_target_user_id,
      'old_username', v_old_account.username,
      'new_username', v_new_account.username,
      'reason', p_reason,
      'old_account_purged', (v_old_account.id IS NULL)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Akun Reddit berhasil diganti ke u/' || v_new_account.username,
    'account', jsonb_build_object(
      'id', v_new_account.id,
      'username', v_new_account.username,
      'karma', v_new_account.karma,
      'account_age_days', v_new_account.account_age_days,
      'status_flag', v_new_account.status_flag
    )
  );
END;
$$;


-- 2. claim_task_assignment: enforce is_active = true
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
      AND user_id = v_uid
      AND COALESCE(is_active, true) = true;

    IF v_account.id IS NULL THEN
      RAISE EXCEPTION 'Pilih akun Reddit yang valid dan aktif.' USING ERRCODE = 'P0001';
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


-- 3. list_eligible_tasks_for_user: join only active reddit_accounts
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
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') = regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. Reddit tasks (active accounts only)
  IF v_invited THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, ra.id AS can_do_with_account_id
    FROM public.tasks t
    JOIN public.reddit_accounts ra ON ra.user_id = v_user AND COALESCE(ra.is_active, true) = true
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
END $fn$;


-- 4. Clean up legacy inactive accounts that have 0 task assignments
DELETE FROM public.reddit_accounts ra
WHERE ra.is_active = false
  AND NOT EXISTS (
    SELECT 1 FROM public.task_assignments ta WHERE ta.reddit_account_id = ra.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.reddit_army_profiles rap WHERE rap.warmed_account_id = ra.id
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
