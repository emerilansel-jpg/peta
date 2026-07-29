-- ============================================================
-- PeTa — Reddit Army RPCs v2: invitation + cohort + min-days gating.
--
-- New / replaced functions:
--   admin_invite_reddit_army(p_user_id, p_cohort)       admin creates invitation
--   admin_revoke_reddit_army_invitation(p_user_id)      admin cancels invite
--   activate_reddit_army_invitation(p_username?)         army activates (username required for 'new' cohort)
--   check_challenge_level_complete(p_user_id)            REWRITTEN with min_days gate
--   list_challenge_tasks_for_user()                       REWRITTEN with min_days gate
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. admin_invite_reddit_army(p_user_id, p_cohort)
--    Creates an invitation row in reddit_army_profiles with
--    program_status='not_started'. Army later activates.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_invite_reddit_army(
  p_user_id uuid,
  p_cohort text
)
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.reddit_army_profiles;
  v_result public.reddit_army_profiles;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_cohort NOT IN ('new_self_register','warmed_purchased') THEN
    RAISE EXCEPTION 'cohort harus new_self_register atau warmed_purchased';
  END IF;

  -- Verify target user exists
  PERFORM 1 FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User tidak ditemukan'; END IF;

  SELECT * INTO v_existing FROM public.reddit_army_profiles WHERE user_id = p_user_id;

  IF v_existing IS NOT NULL THEN
    -- Allow re-invite only if status allows it.
    IF v_existing.program_status NOT IN ('not_started','resigned','expelled') THEN
      RAISE EXCEPTION 'User sudah aktif di program (status: %)', v_existing.program_status;
    END IF;
    -- Update the invitation fields; reset progress (re-enroll).
    UPDATE public.reddit_army_profiles SET
      cohort = p_cohort,
      invited_by = v_uid,
      invited_at = NOW(),
      warmed_account_id = CASE
        WHEN p_cohort = 'warmed_purchased' THEN warmed_account_id
        ELSE NULL
      END,
      program_status = 'not_started',
      current_challenge_level = 0,
      phase1_started_at = NULL,
      phase1_completed_at = NULL,
      phase2_started_at = NULL,
      resign_requested_at = NULL,
      resign_effective_at = NULL,
      resign_active_days = 0,
      resigned_at = NULL,
      expelled_at = NULL,
      expelled_reason = NULL,
      current_level_started_at = NULL,
      updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.reddit_army_profiles (
      user_id, cohort, invited_by, invited_at, program_status
    ) VALUES (
      p_user_id, p_cohort, v_uid, NOW(), 'not_started'
    )
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_invited',
    jsonb_build_object('cohort', p_cohort, 'admin_id', v_uid));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invite_reddit_army(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 2. admin_revoke_reddit_army_invitation(p_user_id)
--    Admin cancels a pending invitation (only if status='not_started').
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revoke_reddit_army_invitation(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT program_status INTO v_status FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'User belum diinvite'; END IF;
  IF v_status != 'not_started' THEN
    RAISE EXCEPTION 'Hanya bisa revoke undangan yang belum aktif (status: %)', v_status;
  END IF;

  DELETE FROM public.reddit_army_profiles WHERE user_id = p_user_id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_invite_revoked',
    jsonb_build_object('admin_id', v_uid));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_reddit_army_invitation(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. activate_reddit_army_invitation(p_username)
--    Army activates their pending invitation.
--    For cohort='warmed_purchased': warmed_account_id already set by admin
--      → p_username ignored.
--    For cohort='new_self_register': p_username is required.
--    Transitions program_status: not_started → phase1_active.
--    Sets phase1_started_at = NOW(), current_level_started_at = NOW().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_reddit_army_invitation(
  p_username text DEFAULT NULL
)
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_account_id uuid;
  v_clean_username text;
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
    -- Army must provide their own Reddit username.
    IF NULLIF(trim(p_username), '') IS NULL THEN
      RAISE EXCEPTION 'Username Reddit wajib diisi untuk cohort new_self_register.';
    END IF;
    v_clean_username := regexp_replace(trim(p_username), '^.*?(?:reddit\.com\/)?(?:u\/|user\/)?', '', 'i');
    v_clean_username := regexp_replace(v_clean_username, '[^A-Za-z0-9_-]', '', 'g');

    -- Find or create their reddit_accounts row.
    SELECT id INTO v_account_id FROM public.reddit_accounts
      WHERE user_id = v_uid AND lower(username) = lower(v_clean_username)
      LIMIT 1;
    IF v_account_id IS NULL THEN
      INSERT INTO public.reddit_accounts (user_id, username, karma, account_age_days, last_sync)
      VALUES (v_uid, v_clean_username, 0, 0, NOW())
      RETURNING id INTO v_account_id;
    END IF;
  ELSE
    -- Warmed: account already assigned by admin.
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

GRANT EXECUTE ON FUNCTION public.activate_reddit_army_invitation(text) TO authenticated;

-- ------------------------------------------------------------
-- 4. Replace check_challenge_level_complete(p_user_id)
--    Now gated by min_days_at_level: cannot advance to next level
--    until current level has been active for >= min_days_at_level days.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.check_challenge_level_complete(uuid);

CREATE OR REPLACE FUNCTION public.check_challenge_level_complete(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_target_level public.reddit_challenge_levels;
  v_total_tasks int;
  v_approved_tasks int;
  v_max_level int;
  v_days_at_level int;
  v_eligible_to_advance boolean;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL OR v_profile.program_status != 'phase1_active' THEN
    RETURN;
  END IF;

  SELECT MAX(level_number) INTO v_max_level FROM public.reddit_challenge_levels WHERE is_active;
  IF v_max_level IS NULL THEN RETURN; END IF;

  IF v_profile.current_challenge_level >= v_max_level THEN
    PERFORM public.complete_phase1(p_user_id);
    RETURN;
  END IF;

  LOOP
    SELECT * INTO v_target_level FROM public.reddit_challenge_levels
      WHERE level_number = v_profile.current_challenge_level + 1
        AND is_active = true;
    EXIT WHEN v_target_level IS NULL;

    -- Check time gate
    v_days_at_level := CASE
      WHEN v_profile.current_level_started_at IS NOT NULL
        THEN EXTRACT(DAY FROM (NOW() - v_profile.current_level_started_at))::int
      ELSE 999
    END;
    v_eligible_to_advance := v_days_at_level >= v_target_level.min_days_at_level;

    -- Even if not eligible to advance yet, we still check completion status
    SELECT COUNT(*) INTO v_total_tasks
      FROM public.tasks t
     WHERE t.challenge_level_id = v_target_level.id
       AND t.task_category = 'reddit_challenge'
       AND t.status IN ('active','completed');

    SELECT COUNT(DISTINCT ta.task_id) INTO v_approved_tasks
      FROM public.task_assignments ta
      JOIN public.tasks t ON t.id = ta.task_id
     WHERE t.challenge_level_id = v_target_level.id
       AND ta.user_id = p_user_id
       AND ta.status = 'approved';

    -- No tasks to complete or not all approved → exit loop
    IF v_total_tasks = 0 OR v_approved_tasks < v_total_tasks THEN
      EXIT;
    END IF;

    -- All tasks approved. Now check time gate.
    IF NOT v_eligible_to_advance THEN
      -- Tasks done but too early — log + exit (will retry later via cron)
      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (p_user_id, 'reddit_army_level_pending_warmup',
        jsonb_build_object('level', v_target_level.level_number,
                           'days_at_level', v_days_at_level,
                           'min_days_required', v_target_level.min_days_at_level))
      ON CONFLICT DO NOTHING;
      EXIT;
    END IF;

    -- Time + tasks both satisfied → advance
    PERFORM public.award_challenge_level_reward(p_user_id, v_target_level.id);

    v_profile.current_challenge_level := v_target_level.level_number;
    UPDATE public.reddit_army_profiles
       SET current_challenge_level = v_target_level.level_number,
           current_level_started_at = NOW(),
           updated_at = NOW()
     WHERE user_id = p_user_id;

    IF v_target_level.level_number >= v_max_level THEN
      PERFORM public.complete_phase1(p_user_id);
      RETURN;
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 5. Replace list_challenge_tasks_for_user()
--    Now returns:
--      - current level tasks (claimable)
--      - next level preview (locked with days_until_unlock)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_challenge_tasks_for_user();

CREATE OR REPLACE FUNCTION public.list_challenge_tasks_for_user()
RETURNS TABLE (
  task_id uuid,
  title text,
  description text,
  target_url text,
  reward_amount int,
  level_number int,
  level_name text,
  assignment_id uuid,
  assignment_status text,
  can_retry boolean,
  level_locked boolean,
  days_until_unlock int,
  min_days_at_level int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_target_level public.reddit_challenge_levels;
  v_days_at_level int;
  v_is_time_locked boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN
    RETURN;
  END IF;

  SELECT * INTO v_target_level FROM public.reddit_challenge_levels
    WHERE level_number = v_profile.current_challenge_level + 1
      AND is_active = true;
  IF v_target_level IS NULL THEN RETURN; END IF;

  v_days_at_level := CASE
    WHEN v_profile.current_level_started_at IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - v_profile.current_level_started_at))::int
    ELSE 0
  END;
  v_is_time_locked := v_days_at_level < v_target_level.min_days_at_level;

  RETURN QUERY
  SELECT
    t.id AS task_id,
    t.title,
    t.description,
    t.target_url,
    t.reward_amount,
    rcl.level_number,
    rcl.level_name,
    ta.id AS assignment_id,
    ta.status AS assignment_status,
    ta.can_retry,
    v_is_time_locked AS level_locked,
    GREATEST(v_target_level.min_days_at_level - v_days_at_level, 0)::int AS days_until_unlock,
    v_target_level.min_days_at_level AS min_days_at_level
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status = 'active'
    AND t.is_hidden = false
    AND rcl.level_number = v_profile.current_challenge_level + 1
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_challenge_tasks_for_user() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
