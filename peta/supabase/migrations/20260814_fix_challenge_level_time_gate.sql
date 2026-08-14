-- ============================================================
-- PeTa — Fix Reddit Army Challenge Time Gate on Admin Approval
--
-- Admins can approve tasks when criteria are met (like Karma >= 20).
-- The time gate (min_days_at_level) should only restrict the member
-- from CLAIMING the task on their dashboard. It should NOT prevent
-- the system from leveling up the member once the admin has APPROVED
-- the required tasks for that level.
--
-- This migration removes the EXIT condition in check_challenge_level_complete
-- that blocked level progression if the time gate hadn't elapsed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_challenge_level_complete(p_user_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_target_level public.reddit_challenge_levels;
  v_total_tasks int;
  v_approved_tasks int;
  v_max_level int;
  v_days_at_level int;
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

    -- Calculate days (just for logging if needed, or UI consistency)
    v_days_at_level := CASE
      WHEN v_profile.current_level_started_at IS NOT NULL
        THEN EXTRACT(DAY FROM (NOW() - v_profile.current_level_started_at))::int
      ELSE 999
    END;

    -- Check completion status
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

    -- Tasks are fully approved by admin. Advance the level immediately!
    -- (We no longer EXIT if v_days_at_level < min_days_at_level)
    
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
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Retroactive Fix: Re-evaluate all active members
-- so that those whose challenge tasks were already approved 
-- but were blocked by the time gate will now level up correctly.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT user_id 
    FROM public.reddit_army_profiles 
    WHERE program_status = 'phase1_active'
  LOOP
    PERFORM public.check_challenge_level_complete(v_user_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;
