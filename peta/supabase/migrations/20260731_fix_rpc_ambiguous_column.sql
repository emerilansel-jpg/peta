-- ============================================================
-- Fix: list_challenge_tasks_for_user — ambiguous column reference
--
-- Error: column reference "level_number" is ambiguous
-- Cause: RETURN QUERY SELECT ... rcl.level_number ... dengan variable
-- v_target_level juga punya level_number, Postgres bingung.
--
-- Fix: qualify semua column references dengan alias t./rcl./ta.
-- ============================================================

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
  v_target_level_number int;
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

  -- Extract to scalar to avoid ambiguity in RETURN QUERY.
  v_target_level_number := v_target_level.level_number;

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
    rcl.level_number AS level_number,
    rcl.level_name AS level_name,
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
    AND rcl.level_number = v_target_level_number
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_challenge_tasks_for_user() TO authenticated;

NOTIFY pgrst, 'reload schema';
