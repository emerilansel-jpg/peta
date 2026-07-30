-- ============================================================
-- Fix: admin_invite_reddit_army — support p_warmed_account_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_invite_reddit_army(
  p_user_id uuid,
  p_cohort text,
  p_warmed_account_id uuid DEFAULT NULL
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
  PERFORM 1 FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User tidak ditemukan'; END IF;

  SELECT * INTO v_existing FROM public.reddit_army_profiles WHERE user_id = p_user_id;

  IF v_existing IS NOT NULL THEN
    IF v_existing.program_status NOT IN ('not_started','resigned','expelled') THEN
      RAISE EXCEPTION 'User sudah aktif di program (status: %)', v_existing.program_status;
    END IF;
    UPDATE public.reddit_army_profiles SET
      cohort = p_cohort,
      invited_by = v_uid,
      invited_at = NOW(),
      warmed_account_id = CASE WHEN p_cohort = 'warmed_purchased'
        THEN COALESCE(p_warmed_account_id, warmed_account_id)
        ELSE NULL END,
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
      user_id, cohort, invited_by, invited_at, program_status, warmed_account_id
    ) VALUES (
      p_user_id, p_cohort, v_uid, NOW(), 'not_started',
      CASE WHEN p_cohort = 'warmed_purchased' THEN p_warmed_account_id ELSE NULL END
    )
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_invited',
    jsonb_build_object('cohort', p_cohort, 'admin_id', v_uid));
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invite_reddit_army(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
