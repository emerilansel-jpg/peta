-- Migration: 20260911010000_fix_reddit_account_unique_and_activation.sql
-- Fixes:
-- 1. Drop old rigid constraint reddit_accounts_user_id_unique (replaced by partial unique index)
-- 2. Allow legitimate role promotion 'army' -> 'hero_army' in guard_users_column_protection
-- 3. Update replace_user_reddit_account to deactivate old account BEFORE inserting new one
-- 4. Update activate_reddit_army_invitation to handle existing accounts safely

BEGIN;

-- ------------------------------------------------------------
-- 1. Drop rigid UNIQUE constraint on reddit_accounts(user_id)
-- ------------------------------------------------------------
ALTER TABLE public.reddit_accounts
  DROP CONSTRAINT IF EXISTS reddit_accounts_user_id_unique;

-- Ensure partial unique index exists so each user only has 1 active account at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_reddit_accounts_user_active_unique
  ON public.reddit_accounts (user_id)
  WHERE is_active = true;

-- ------------------------------------------------------------
-- 2. Update guard_users_column_protection to allow hero_army promotion
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_users_column_protection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Admin or internal service_role can perform any update
  IF public.is_admin() OR auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Role modification check:
  -- Allow automated promotion from 'army' to 'hero_army' when legitimate Reddit Army profile exists
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role = 'army' AND NEW.role = 'hero_army' AND EXISTS (
      SELECT 1 FROM public.reddit_army_profiles rap
      WHERE rap.user_id = NEW.id
        AND rap.program_status IN ('phase1_active', 'phase2_active', 'phase1_complete')
    ) THEN
      -- Allowed: system promotion triggered by Reddit Army activation
    ELSE
      RAISE EXCEPTION 'unauthorized: role cannot be modified directly' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Non-admin users cannot change their active status
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'unauthorized: is_active cannot be modified directly' USING ERRCODE = '42501';
  END IF;

  -- Non-admin users cannot directly alter their credit_balance
  IF NEW.credit_balance IS DISTINCT FROM OLD.credit_balance THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions ct
      WHERE ct.user_id = NEW.id AND ct.balance_after = NEW.credit_balance
        AND ct.created_at >= NOW() - INTERVAL '1 minute'
    ) THEN
      RAISE EXCEPTION 'unauthorized: credit_balance cannot be modified directly' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 3. Update replace_user_reddit_account (Archive old FIRST)
-- ------------------------------------------------------------
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

  -- STEP 1: Deactivate old account first to prevent partial unique index conflict
  IF v_old_account.id IS NOT NULL THEN
    UPDATE public.reddit_accounts
    SET is_active = false,
        replaced_at = NOW(),
        replacement_reason = p_reason,
        updated_at = NOW()
    WHERE id = v_old_account.id;
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

  -- STEP 3: Link old account to the new replacement account
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

-- ------------------------------------------------------------
-- 4. Update activate_reddit_army_invitation for account safety
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_reddit_army_invitation(
  p_username text DEFAULT NULL
)
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_account_id uuid;
  v_clean_username text;
  v_existing_account public.reddit_accounts;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Kamu belum diundang ke Reddit Army. Hubungi admin.';
  END IF;
  IF v_profile.program_status != 'not_started' THEN
    RAISE EXCEPTION 'Undangan sudah aktif atau tidak valid (status: %)', v_profile.program_status;
  END IF;
  IF v_profile.cohort IS NULL THEN
    RAISE EXCEPTION 'Cohort belum ditentukan. Hubungi admin.';
  END IF;

  IF v_profile.cohort = 'new_self_register' THEN
    IF NULLIF(trim(p_username), '') IS NULL THEN
      RAISE EXCEPTION 'Username Reddit wajib diisi untuk cohort new_self_register.';
    END IF;
    v_clean_username := regexp_replace(trim(p_username), '^.*?(?:reddit\.com\/(?:user|u)\/|u\/|user\/)', '', 'i');
    v_clean_username := regexp_replace(v_clean_username, '[^A-Za-z0-9_-]', '', 'g');

    -- Deactivate any other active accounts for this user to satisfy partial unique index
    UPDATE public.reddit_accounts
    SET is_active = false
    WHERE user_id = v_uid
      AND is_active = true
      AND lower(username) <> lower(v_clean_username);

    -- Find existing matching account or insert
    SELECT * INTO v_existing_account
    FROM public.reddit_accounts
    WHERE user_id = v_uid AND lower(username) = lower(v_clean_username)
    LIMIT 1;

    IF v_existing_account.id IS NOT NULL THEN
      UPDATE public.reddit_accounts
      SET is_active = true, updated_at = NOW()
      WHERE id = v_existing_account.id
      RETURNING id INTO v_account_id;
    ELSE
      INSERT INTO public.reddit_accounts (user_id, username, karma, account_age_days, last_sync, is_active, status_flag)
      VALUES (v_uid, v_clean_username, 0, 0, NOW(), true, 'ok')
      RETURNING id INTO v_account_id;
    END IF;
  ELSE
    -- Warmed: account already assigned by admin
    v_account_id := v_profile.warmed_account_id;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Admin belum assign akun warmed untuk kamu. Hubungi admin.';
    END IF;
  END IF;

  UPDATE public.reddit_army_profiles SET
    warmed_account_id = v_account_id,
    program_status = 'phase1_active',
    phase1_started_at = NOW(),
    current_level_started_at = NOW(),
    current_challenge_level = 0,
    updated_at = NOW()
  WHERE user_id = v_uid
  RETURNING * INTO v_profile;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (v_uid, 'reddit_army_activated',
    jsonb_build_object('cohort', v_profile.cohort, 'reddit_account_id', v_account_id));

  RETURN v_profile;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
