-- ============================================================
-- PeTa — Reddit Army RPCs (Phase 1: Challenge flow).
--
-- Functions:
--   join_reddit_army_program()                 army opts into program
--   list_challenge_tasks_for_user()            army sees checklist
--   claim_challenge_task(p_task_id, p_account_id)
--   award_challenge_level_reward(p_user_id, p_level_id)  internal helper
--   check_challenge_level_complete(p_user_id)  called from trigger or cron
--   complete_phase1(p_user_id)                 credits Rp100K split
--   admin_create_challenge_task(...)           admin helper
-- ============================================================

-- ------------------------------------------------------------
-- 1. join_reddit_army_program()
--    Army opts into the program from /reddit-army.
--    Requires: user has 1 active reddit_account.
--    Sets status to phase1_active.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_reddit_army_program()
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_existing public.reddit_army_profiles;
  v_result public.reddit_army_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  -- Must have at least one reddit account.
  SELECT id FROM public.reddit_accounts
   WHERE user_id = v_uid
   ORDER BY created_at DESC LIMIT 1
   INTO v_account_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Kamu harus tambah akun Reddit dulu di halaman Akun.';
  END IF;

  SELECT * INTO v_existing FROM public.reddit_army_profiles WHERE user_id = v_uid;

  IF v_existing IS NOT NULL THEN
    -- Re-enroll only from not_started / resigned / expelled.
    IF v_existing.program_status NOT IN ('not_started','resigned','expelled') THEN
      RAISE EXCEPTION 'Kamu sudah terdaftar di program (status: %).', v_existing.program_status;
    END IF;
    -- Reset all progress.
    UPDATE public.reddit_army_profiles SET
      warmed_account_id = v_account_id,
      program_status = 'phase1_active',
      current_challenge_level = 0,
      phase1_started_at = NOW(),
      phase1_completed_at = NULL,
      phase2_started_at = NULL,
      resign_requested_at = NULL,
      resign_effective_at = NULL,
      resign_active_days = 0,
      resigned_at = NULL,
      expelled_at = NULL,
      expelled_reason = NULL,
      last_sync_at = NULL,
      last_active_date = NULL,
      notes = NULL,
      updated_at = NOW()
    WHERE user_id = v_uid
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.reddit_army_profiles (
      user_id, warmed_account_id, program_status, phase1_started_at
    ) VALUES (
      v_uid, v_account_id, 'phase1_active', NOW()
    )
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.activity_logs (user_id, reddit_account_id, action, details)
  VALUES (v_uid, v_account_id, 'reddit_army_join',
          jsonb_build_object('profile_id', v_result.id));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_reddit_army_program() TO authenticated;

-- ------------------------------------------------------------
-- 2. list_challenge_tasks_for_user()
--    Returns challenge tasks for the user's current level,
--    with assignment status (locked/available/in_progress/submitted/approved/rejected).
-- ------------------------------------------------------------
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
  can_retry boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_target_level int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN
    RETURN;  -- not in challenge phase, no tasks
  END IF;

  v_target_level := v_profile.current_challenge_level + 1;

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
    ta.can_retry
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status = 'active'
    AND t.is_hidden = false
    AND rcl.level_number = v_target_level
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_challenge_tasks_for_user() TO authenticated;

-- ------------------------------------------------------------
-- 3. claim_challenge_task(p_task_id, p_reddit_account_id)
--    Wrapper over claim_task_assignment with program checks.
--    Only callable when program_status='phase1_active'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_challenge_task(
  p_task_id uuid,
  p_reddit_account_id uuid
)
RETURNS uuid  -- assignment_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_task public.tasks;
  v_assignment_id uuid;
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

  -- Verify task is for the user's current level.
  IF v_task.challenge_level_id IS NULL THEN
    RAISE EXCEPTION 'Task challenge tidak punya level.';
  END IF;

  PERFORM 1 FROM public.reddit_challenge_levels rcl
    WHERE rcl.id = v_task.challenge_level_id
      AND rcl.level_number = v_profile.current_challenge_level + 1
      AND rcl.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task ini bukan untuk level kamu saat ini.';
  END IF;

  -- Delegate to existing claim_task_assignment RPC.
  -- It already enforces quota, per_account_limit, account ownership.
  v_assignment_id := public.claim_task_assignment(p_task_id, p_reddit_account_id);

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_challenge_task(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4. award_challenge_level_reward(p_user_id, p_level_id)  [INTERNAL]
--    Idempotently insert a challenge_level bonus_hold row.
--    Called by check_challenge_level_complete() after a level finishes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_challenge_level_reward(
  p_user_id uuid,
  p_level_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level public.reddit_challenge_levels;
BEGIN
  SELECT * INTO v_level FROM public.reddit_challenge_levels WHERE id = p_level_id;
  IF v_level IS NULL THEN RAISE EXCEPTION 'Level tidak ditemukan.'; END IF;
  IF v_level.reward_amount <= 0 THEN
    RETURN;  -- level 5 has no level reward (uses phase1_completion instead)
  END IF;

  -- Idempotency via unique index on (user_id, source, source_id).
  INSERT INTO public.bonus_holds (user_id, source, source_id, amount, status, release_condition)
  VALUES (
    p_user_id,
    'challenge_level',
    p_level_id,
    v_level.reward_amount,
    'held',
    'resign_complete'
  )
  ON CONFLICT (user_id, source, source_id) WHERE source_id IS NOT NULL
  DO NOTHING;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_level_reward',
    jsonb_build_object('level', v_level.level_number, 'amount', v_level.reward_amount));
END;
$$;

-- ------------------------------------------------------------
-- 5. check_challenge_level_complete(p_user_id)
--    Checks if user's current challenge level has all tasks approved.
--    If yes: award level reward, advance current_challenge_level,
--    and if it was the final level, call complete_phase1().
--    Safe to call multiple times (idempotent).
-- ------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL OR v_profile.program_status != 'phase1_active' THEN
    RETURN;
  END IF;

  SELECT MAX(level_number) INTO v_max_level FROM public.reddit_challenge_levels WHERE is_active;
  IF v_max_level IS NULL THEN RETURN; END IF;

  -- Already completed all levels? Safety net.
  IF v_profile.current_challenge_level >= v_max_level THEN
    PERFORM public.complete_phase1(p_user_id);
    RETURN;
  END IF;

  LOOP
    SELECT * INTO v_target_level FROM public.reddit_challenge_levels
      WHERE level_number = v_profile.current_challenge_level + 1
        AND is_active = true;
    EXIT WHEN v_target_level IS NULL;

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

    -- Only advance if there are tasks AND all are approved.
    IF v_total_tasks = 0 OR v_approved_tasks < v_total_tasks THEN
      EXIT;
    END IF;

    -- Level complete!
    PERFORM public.award_challenge_level_reward(p_user_id, v_target_level.id);

    v_profile.current_challenge_level := v_target_level.level_number;
    UPDATE public.reddit_army_profiles
       SET current_challenge_level = v_target_level.level_number,
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
-- 6. complete_phase1(p_user_id)
--    Marks phase1 complete and transitions to phase2_active.
--    Credits Rp100K: 50% instant + 50% hold (30-day release).
--    Idempotent: a phase1_completion user_credit row prevents double credit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_phase1(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_phase1_amount int := 50000;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL THEN RETURN; END IF;
  IF v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN RETURN; END IF;

  -- Idempotency: if phase2 already started, don't double-credit.
  IF v_profile.program_status = 'phase1_complete' AND v_profile.phase2_started_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- Idempotency check on user_credits: a phase1_completion row already exists?
  PERFORM 1 FROM public.user_credits
    WHERE user_id = p_user_id AND source = 'phase1_completion'
    LIMIT 1;
  IF FOUND THEN
    -- Already credited, just ensure status advanced.
    UPDATE public.reddit_army_profiles SET
      program_status = 'phase2_active',
      phase1_completed_at = COALESCE(phase1_completed_at, NOW()),
      phase2_started_at = COALESCE(phase2_started_at, NOW()),
      updated_at = NOW()
    WHERE user_id = p_user_id;
    RETURN;
  END IF;

  -- Credit Rp50K instant cashable.
  INSERT INTO public.user_credits (user_id, amount, source, description)
  VALUES (p_user_id, v_phase1_amount, 'phase1_completion',
          'Bonus selesai Phase 1 Challenge (instant cashable)');

  -- Hold Rp50K with 30-day release condition.
  INSERT INTO public.bonus_holds (user_id, source, amount, status, release_condition)
  VALUES (p_user_id, 'phase1_completion', v_phase1_amount, 'held', 'days_30');

  UPDATE public.reddit_army_profiles SET
    program_status = 'phase2_active',
    phase1_completed_at = NOW(),
    phase2_started_at = NOW(),
    current_challenge_level = COALESCE(
      (SELECT MAX(level_number) FROM public.reddit_challenge_levels WHERE is_active),
      current_challenge_level
    ),
    updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_phase1_complete',
    jsonb_build_object('instant_amount', v_phase1_amount, 'hold_amount', v_phase1_amount));
END;
$$;

-- ------------------------------------------------------------
-- 7. admin_create_challenge_task(...)
--    Admin helper to create a challenge task linked to a level.
--    Wraps the existing admin_create_task but forces task_category + level.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_challenge_task(
  p_level_id uuid,
  p_title text,
  p_description text,
  p_target_url text,
  p_reward_amount int,
  p_max_assignments int DEFAULT 1,
  p_per_account_limit int DEFAULT 1,
  p_brief text
)
RETURNS uuid  -- task_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_level public.reddit_challenge_levels;
  v_task_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_level FROM public.reddit_challenge_levels WHERE id = p_level_id;
  IF v_level IS NULL THEN RAISE EXCEPTION 'Level tidak ditemukan.'; END IF;

  -- Insert directly to bypass admin_create_task's restrictive param list.
  -- We reuse the existing columns: max_assignments, per_account_limit, brief.
  INSERT INTO public.tasks (
    title, description, target_url, brief,
    task_category, task_type,
    reward_amount,
    max_assignments, per_account_limit,
    challenge_level_id,
    status, created_by
  ) VALUES (
    p_title, p_description, p_target_url, p_brief,
    'reddit_challenge', 'comment',
    p_reward_amount,
    p_max_assignments, p_per_account_limit,
    p_level_id,
    'active', v_uid
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_challenge_task(uuid, text, text, text, int, int, int, text) TO authenticated;

-- ------------------------------------------------------------
-- 8. AFTER UPDATE trigger on task_assignments:
--    when a challenge assignment moves to 'approved', recompute level.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reddit_army_check_level_after_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_task_category text;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_user_id := COALESCE(NEW.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = NEW.reddit_account_id));
    IF v_user_id IS NULL THEN RETURN NEW; END IF;

    SELECT task_category INTO v_task_category FROM public.tasks WHERE id = NEW.task_id;
    IF v_task_category = 'reddit_challenge' THEN
      PERFORM public.check_challenge_level_complete(v_user_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reddit_army_check_level_after_approval ON public.task_assignments;
CREATE TRIGGER trg_reddit_army_check_level_after_approval
  AFTER UPDATE OF status ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_reddit_army_check_level_after_approval();

NOTIFY pgrst, 'reload schema';
