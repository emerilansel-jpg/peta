-- ============================================================
-- Fix: list_challenge_tasks_for_user — challenge tasks visible
-- even when admin pauses them (paused = maintenance, not hidden)
-- ============================================================

DROP FUNCTION IF EXISTS public.list_challenge_tasks_for_user();

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
  v_activity_sum int;
  v_target_count int;
  v_username text;
  v_account_id uuid;
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
  v_target_count := GREATEST(COALESCE(v_target_level.target_count, 1), 1);

  SELECT COALESCE(SUM(comments_today + posts_today), 0)::int INTO v_activity_sum
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date >= COALESCE(v_profile.phase1_started_at::date, CURRENT_DATE - 60);

  SELECT ra.username, ra.id INTO v_username, v_account_id
    FROM public.reddit_accounts ra WHERE ra.id = v_profile.warmed_account_id;

  RETURN QUERY
  SELECT jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'description', t.description,
    'target_url', t.target_url,
    'reward_amount', t.reward_amount,
    'level_number', rcl.level_number,
    'level_name', rcl.level_name,
    'assignment_id', ta.id,
    'assignment_status', ta.status,
    'can_retry', ta.can_retry,
    'level_locked', v_is_time_locked,
    'days_until_unlock', GREATEST(v_target_level.min_days_at_level - v_days_at_level, 0),
    'min_days_at_level', v_target_level.min_days_at_level,
    'progress_count', v_activity_sum,
    'target_count', v_target_count,
    'progress_complete', v_activity_sum >= v_target_count,
    'can_submit', (ta.status = 'in_progress' AND v_activity_sum >= v_target_count),
    'reddit_username', v_username,
    'reddit_account_id', v_account_id
  )
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status IN ('active','paused')
    AND t.is_hidden = false
    AND rcl.level_number = v_target_level.level_number
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_challenge_tasks_for_user() TO authenticated;

NOTIFY pgrst, 'reload schema';
