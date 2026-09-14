-- Migration: 20260911000000_replace_reddit_account_flow.sql
-- Enables army members and admins to replace a banned/shadowbanned Reddit account
-- with a new healthy Reddit account WITHOUT resetting completed tasks, proofs, or earnings.

BEGIN;

-- 1. Add replacement tracking columns to reddit_accounts
ALTER TABLE public.reddit_accounts
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz,
  ADD COLUMN IF NOT EXISTS replacement_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by_account_id uuid REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reddit_accounts_user_active
  ON public.reddit_accounts (user_id) WHERE is_active = true;

-- 2. Transactional replacement RPC
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
BEGIN
  -- Authorization check
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

  -- Validate & sanitize new username
  v_clean_username := regexp_replace(trim(COALESCE(p_new_username, '')), '^.*?(?:reddit\.com\/(?:user|u)\/|u\/|user\/)', '', 'i');
  v_clean_username := regexp_replace(v_clean_username, '[^A-Za-z0-9_-]', '', 'g');

  IF length(v_clean_username) < 3 OR length(v_clean_username) > 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit minimal 3 dan maksimal 32 karakter.');
  END IF;

  -- Check if username is already used by another user
  SELECT * INTO v_existing_account
  FROM public.reddit_accounts
  WHERE lower(username) = lower(v_clean_username)
  LIMIT 1;

  IF v_existing_account.id IS NOT NULL AND v_existing_account.user_id <> v_target_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit u/' || v_clean_username || ' sudah terdaftar di akun PeTa lain.');
  END IF;

  -- Find the user current active reddit account
  SELECT * INTO v_old_account
  FROM public.reddit_accounts
  WHERE user_id = v_target_user_id
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_old_account.id IS NOT NULL AND lower(v_old_account.username) = lower(v_clean_username) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Akun baru tidak boleh sama dengan akun saat ini.');
  END IF;

  -- Insert or reactivate new account
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

  -- Archive old active account
  IF v_old_account.id IS NOT NULL THEN
    UPDATE public.reddit_accounts
    SET is_active = false,
        replaced_at = NOW(),
        replacement_reason = p_reason,
        replaced_by_account_id = v_new_account.id,
        updated_at = NOW()
    WHERE id = v_old_account.id;
  END IF;

  -- Update reddit_army_profiles linkage if user is enrolled
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

  -- Log to activity_logs for audit
  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (
    v_target_user_id,
    'reddit_account_replaced',
    jsonb_build_object(
      'old_account_id', v_old_account.id,
      'old_username', v_old_account.username,
      'new_account_id', v_new_account.id,
      'new_username', v_new_account.username,
      'reason', p_reason,
      'replaced_by', v_caller,
      'is_admin_action', v_is_admin
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Akun Reddit berhasil diganti ke u/' || v_new_account.username,
    'account_id', v_new_account.id,
    'username', v_new_account.username,
    'karma', v_new_account.karma,
    'account_age_days', v_new_account.account_age_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_reddit_account(text, text, int, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_user_reddit_account(text, text, int, int, uuid) TO authenticated;

-- 3. Update claim_challenge_task to ensure account is_active
CREATE OR REPLACE FUNCTION public.claim_challenge_task(
  p_task_id uuid,
  p_reddit_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_task public.tasks;
  v_account_id uuid;
  v_assignment_id uuid;
  v_live int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status != 'phase1_active' THEN
    RAISE EXCEPTION 'Program challenge belum aktif untuk kamu.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF v_task IS NULL OR v_task.task_category != 'reddit_challenge' THEN
    RAISE EXCEPTION 'Task ini bukan task challenge.';
  END IF;
  IF v_task.status <> 'active'
     OR (v_task.start_at IS NOT NULL AND NOW() < v_task.start_at)
     OR (v_task.end_at IS NOT NULL AND NOW() >= v_task.end_at) THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.';
  END IF;

  IF v_task.challenge_level_id IS NULL THEN
    RAISE EXCEPTION 'Task challenge tidak memiliki level target.';
  END IF;

  PERFORM 1 FROM public.reddit_challenge_levels rcl
   WHERE rcl.id = v_task.challenge_level_id
     AND rcl.level_number = v_profile.current_challenge_level + 1
     AND rcl.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task ini bukan untuk level kamu saat ini.';
  END IF;

  -- Account must be active, owned by member or assigned warmed, and not suspended/not_found
  SELECT ra.id INTO v_account_id
    FROM public.reddit_accounts ra
   WHERE ra.id = p_reddit_account_id
     AND (ra.user_id = v_uid OR ra.id = v_profile.warmed_account_id)
     AND COALESCE(ra.is_active, true) = true
     AND ra.status_flag NOT IN ('suspended','not_found')
   LIMIT 1;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Reddit tidak aktif atau tidak valid untuk misi ini.';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.';
  END IF;

  PERFORM 1 FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND status IN ('in_progress','submitted','approved')
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Kamu sudah punya misi ini. Selesaikan dulu ya.';
  END IF;

  INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
  VALUES (p_task_id, v_uid, v_account_id, 'in_progress')
  RETURNING id INTO v_assignment_id;

  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment_id;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
