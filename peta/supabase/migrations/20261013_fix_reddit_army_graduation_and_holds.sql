-- ============================================================
-- PeTa — Fix Reddit Army Warmup Graduation & Hold Release
--
-- Product Model Alignment:
--   - Phase 1 (Level 1–5) is onboarding/warming up so the account matures.
--   - Level rewards are held while the account is undergoing warmup/testing.
--   - When the user passes Level 5 (account is fully mature & enters Phase 2):
--     ALL held rewards (Levels 1–4 + Level 5 bonus) are 100% released to user_credits.
--   - In Phase 2 (Mature Active Army):
--     There is NO retention hold or resign concept.
--     Daily check-in earns Rp2.500/day full active income (cair 2-mingguan).
-- ============================================================

-- 1. complete_phase1: graduates the user when Level 5 is completed
CREATE OR REPLACE FUNCTION public.complete_phase1(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.reddit_army_profiles;
  v_phase1_instant int := 50000;
  v_phase1_mature int := 50000;
  v_hold record;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL THEN RETURN; END IF;
  IF v_profile.program_status NOT IN ('phase1_active','phase1_complete', 'phase2_active') THEN RETURN; END IF;

  -- 1a. Ensure initial Phase 1 bonus is credited (Rp50.000)
  PERFORM 1 FROM public.user_credits
    WHERE user_id = p_user_id AND source = 'phase1_completion'
    LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.user_credits (user_id, amount, source, description)
    VALUES (p_user_id, v_phase1_instant, 'phase1_completion',
            'Bonus selesai Phase 1 Challenge: Rp50.000');
  END IF;

  -- 1b. Credit Level 5 mature completion bonus (Rp50.000) directly (no 30-day hold)
  PERFORM 1 FROM public.user_credits
    WHERE user_id = p_user_id AND source = 'phase1_completion_mature'
    LIMIT 1;
  IF NOT FOUND THEN
    -- Check if it was previously held as phase1_completion hold
    SELECT * INTO v_hold FROM public.bonus_holds
     WHERE user_id = p_user_id AND source = 'phase1_completion' AND status IN ('held', 'vesting')
     LIMIT 1;
    IF v_hold IS NOT NULL THEN
      UPDATE public.bonus_holds
         SET status = 'released', released_at = NOW()
       WHERE id = v_hold.id;

      INSERT INTO public.user_credits (user_id, amount, source, description)
      VALUES (p_user_id, v_hold.amount, 'hold_release',
              'Release bonus kelulusan Level 5 (akun matang): Rp50.000');
    ELSE
      -- Check if already released via hold_release
      PERFORM 1 FROM public.user_credits
        WHERE user_id = p_user_id AND source = 'hold_release' AND description ILIKE '%phase1_completion%'
        LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO public.user_credits (user_id, amount, source, description)
        VALUES (p_user_id, v_phase1_mature, 'phase1_completion_mature',
                'Bonus kelulusan Level 5 (akun matang): Rp50.000');
      END IF;
    END IF;
  END IF;

  -- 1c. Automatically release all warmup holds (Levels 1–4)
  FOR v_hold IN
    SELECT * FROM public.bonus_holds
    WHERE user_id = p_user_id
      AND source = 'challenge_level'
      AND status IN ('held', 'vesting')
  LOOP
    UPDATE public.bonus_holds
       SET status = 'released', released_at = NOW()
     WHERE id = v_hold.id;

    INSERT INTO public.user_credits (user_id, amount, source, description)
    VALUES (p_user_id, v_hold.amount, 'hold_release',
            format('Reward kelulusan warmup Reddit Army: %s (Rp%s)', v_hold.source, v_hold.amount));
  END LOOP;

  -- 1d. Advance profile to phase2_active
  UPDATE public.reddit_army_profiles SET
    program_status = 'phase2_active',
    phase1_completed_at = COALESCE(phase1_completed_at, NOW()),
    phase2_started_at = COALESCE(phase2_started_at, NOW()),
    current_challenge_level = COALESCE(
      (SELECT MAX(level_number) FROM public.reddit_challenge_levels WHERE is_active),
      current_challenge_level
    ),
    updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_phase1_complete',
    jsonb_build_object('total_completion_bonus', 100000, 'status', 'graduated_mature'));
END;
$function$;

-- 2. credit_daily_bonus: 100% full active income, no retention hold
CREATE OR REPLACE FUNCTION public.credit_daily_bonus(p_user_id uuid, p_activity_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.reddit_army_profiles;
  v_activity public.reddit_daily_activity;
  v_total int;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase2_active','resigning') THEN
    RETURN;
  END IF;

  SELECT * INTO v_activity FROM public.reddit_daily_activity WHERE id = p_activity_id;
  IF v_activity IS NULL THEN RETURN; END IF;
  IF v_activity.user_id != p_user_id THEN RETURN; END IF;
  IF v_activity.bonus_credited THEN RETURN; END IF;
  IF NOT v_activity.bonus_eligible THEN RETURN; END IF;

  v_total := v_profile.daily_bonus_rate; -- default 2500

  -- Full amount credited as pending biweekly cashout (no split, no hold)
  UPDATE public.reddit_daily_activity SET
    bonus_credited = true,
    bonus_credited_at = NOW(),
    credited_amount = v_total,
    credited_type = 'pending_cashable',
    updated_at = NOW()
  WHERE id = p_activity_id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_daily_bonus',
    jsonb_build_object('activity_id', p_activity_id, 'total', v_total, 'type', 'full_cashable'));
END;
$function$;

-- 3. release_biweekly_cashout: aggregate full credited_amount
CREATE OR REPLACE FUNCTION public.release_biweekly_cashout()
 RETURNS TABLE(user_id uuid, amount integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user record;
  v_sum int;
  v_cutoff date := CURRENT_DATE - INTERVAL '14 days';
BEGIN
  FOR v_user IN
    SELECT DISTINCT rap.user_id
      FROM public.reddit_army_profiles rap
     WHERE rap.program_status IN ('phase2_active','resigning')
  LOOP
    SELECT COALESCE(SUM(rda.credited_amount), 0) INTO v_sum
      FROM public.reddit_daily_activity rda
     WHERE rda.user_id = v_user.user_id
       AND rda.credited_type IN ('pending_split', 'pending_cashable')
       AND rda.bonus_credited = true
       AND rda.lump_credited_at IS NULL
       AND rda.activity_date <= v_cutoff;

    IF v_sum > 0 THEN
      INSERT INTO public.user_credits (user_id, amount, source, description)
      VALUES (v_user.user_id, v_sum, 'daily_bonus_cashable',
              format('Lump sum bonus harian Reddit Army 14 hari: Rp%s', v_sum));

      UPDATE public.reddit_daily_activity rda
         SET lump_credited_at = NOW(),
             updated_at = NOW()
       WHERE rda.user_id = v_user.user_id
         AND rda.credited_type IN ('pending_split', 'pending_cashable')
         AND rda.bonus_credited = true
         AND rda.lump_credited_at IS NULL
         AND rda.activity_date <= v_cutoff;

      RETURN QUERY SELECT v_user.user_id, v_sum;
    END IF;
  END LOOP;
END;
$function$;

-- 4. get_reddit_army_profile: return full pending cashable
CREATE OR REPLACE FUNCTION public.get_reddit_army_profile()
 RETURNS TABLE(profile reddit_army_profiles, retention_held integer, pending_cashable integer, today_activity reddit_daily_activity, recent_activities jsonb, reddit_username text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_retention int;
  v_pending int;
  v_today public.reddit_daily_activity;
  v_recent jsonb;
  v_username text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_retention
    FROM public.bonus_holds
   WHERE user_id = v_uid AND status IN ('held','vesting');

  -- Pending cashable: full amount from un-lumped active days
  SELECT COALESCE(SUM(credited_amount), 0) INTO v_pending
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND credited_type IN ('pending_split', 'pending_cashable')
     AND bonus_credited = true
     AND lump_credited_at IS NULL;

  SELECT * INTO v_today
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid AND activity_date = CURRENT_DATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date,
    'active', is_active_day,
    'credited', bonus_credited,
    'amount', credited_amount,
    'comments', comments_today,
    'posts', posts_today,
    'karma_delta', karma_delta
  ) ORDER BY activity_date DESC), '[]'::jsonb) INTO v_recent
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date > CURRENT_DATE - INTERVAL '30 days';

  SELECT ra.username INTO v_username
    FROM public.reddit_accounts ra
   WHERE ra.id = v_profile.warmed_account_id;
  IF v_username IS NULL THEN
    SELECT ra.username INTO v_username
      FROM public.reddit_accounts ra
     WHERE ra.user_id = v_uid
     ORDER BY ra.created_at DESC LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_profile, v_retention, v_pending, v_today, v_recent, v_username;
END;
$function$;

-- 5. get_user_earnings: reflect full credited_amount
CREATE OR REPLACE FUNCTION public.get_user_earnings()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task_earnings int;
  v_signup_bonus int;
  v_manual_adj int;
  v_referral_bonus int;
  v_bonus int;
  v_bonus_unlocked boolean;
  v_cashable int;
  v_total int;
  v_ra_phase1 int;
  v_ra_daily_credited int;
  v_ra_hold_released int;
  v_ra_retention_held int;
  v_ra_pending_cashable int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(SUM(t.reward_amount), 0)::int
  INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = v_uid
    AND ta.status = 'approved'
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward','task_revert') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('phase1_completion', 'phase1_completion_mature') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'daily_bonus_cashable' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'hold_release' THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_manual_adj,
       v_ra_phase1, v_ra_daily_credited, v_ra_hold_released
  FROM public.user_credits
  WHERE user_id = v_uid;

  SELECT COALESCE(SUM(amount), 0)::int
  INTO v_ra_retention_held
  FROM public.bonus_holds
  WHERE user_id = v_uid AND status IN ('held','vesting');

  SELECT COALESCE(SUM(credited_amount), 0)::int
  INTO v_ra_pending_cashable
  FROM public.reddit_daily_activity
  WHERE user_id = v_uid
    AND credited_type IN ('pending_split', 'pending_cashable')
    AND bonus_credited = true
    AND lump_credited_at IS NULL;

  v_bonus := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= 100000;
  v_cashable := v_task_earnings + v_manual_adj + CASE WHEN v_bonus_unlocked THEN v_bonus ELSE 0 END;
  v_total := v_task_earnings + v_manual_adj + v_bonus;

  RETURN json_build_object(
    'tasks', v_task_earnings,
    'manualAdj', v_manual_adj,
    'signupBonus', v_signup_bonus,
    'referralBonus', v_referral_bonus,
    'bonus', v_bonus,
    'bonusUnlocked', v_bonus_unlocked,
    'cashable', v_cashable,
    'total', v_total,
    'earned', v_task_earnings + v_manual_adj,
    'referral', v_bonus,
    'fromWork', v_task_earnings,
    'redditArmyPhase1Instant', v_ra_phase1,
    'redditArmyDailyCredited', v_ra_daily_credited,
    'redditArmyHoldReleased', v_ra_hold_released,
    'redditArmyRetentionHeld', v_ra_retention_held,
    'redditArmyPendingCashable', v_ra_pending_cashable
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
