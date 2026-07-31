-- ============================================================
-- Fix: claim_challenge_task + add proof requirement
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Fix claim_challenge_task: extract id from row return
-- ------------------------------------------------------------
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
  v_assignment public.task_assignments;
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

  -- claim_task_assignment returns the whole row; extract .id
  v_assignment := public.claim_task_assignment(p_task_id, p_reddit_account_id);
  RETURN v_assignment.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_challenge_task(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 2. Update list_challenge_tasks_for_user — include target_count
--    + assignment_id + proof fields
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_challenge_tasks_for_user()
RETURNS SETOF jsonb
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
  SELECT jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'description', t.description,
    'brief', t.brief,
    'target_url', t.target_url,
    'reward_amount', t.reward_amount,
    'target_count', COALESCE(v_target_level.target_count, 1),
    'level_number', rcl.level_number,
    'level_name', rcl.level_name,
    'assignment_id', ta.id,
    'assignment_status', ta.status,
    'proof_image_url', ta.proof_image_url,
    'proof_url', ta.proof_url,
    'can_retry', ta.can_retry,
    'level_locked', v_is_time_locked,
    'days_until_unlock', GREATEST(v_target_level.min_days_at_level - v_days_at_level, 0),
    'min_days_at_level', v_target_level.min_days_at_level
  )
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status = 'active'
    AND t.is_hidden = false
    AND rcl.level_number = v_target_level.level_number
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_challenge_tasks_for_user() TO authenticated;

-- ------------------------------------------------------------
-- 3. Add target_count column to reddit_challenge_levels
-- ------------------------------------------------------------
ALTER TABLE public.reddit_challenge_levels
  ADD COLUMN IF NOT EXISTS target_count int NOT NULL DEFAULT 1;

-- Seed target_count for existing levels (level 1 = 3 comments)
UPDATE public.reddit_challenge_levels SET target_count = 3  WHERE level_number = 1;
UPDATE public.reddit_challenge_levels SET target_count = 5  WHERE level_number = 2;
UPDATE public.reddit_challenge_levels SET target_count = 1  WHERE level_number = 3;  -- karma based
UPDATE public.reddit_challenge_levels SET target_count = 1  WHERE level_number = 4;
UPDATE public.reddit_challenge_levels SET target_count = 1  WHERE level_number = 5;

NOTIFY pgrst, 'reload schema';

COMMIT;
