-- ============================================================
-- PeTa — Reddit Army: extend get_user_earnings() with retention
-- fields for display on the Earnings page.
--
-- Adds these new fields to the JSON response:
--   redditArmyRetentionHeld   — SUM bonus_holds WHERE status IN ('held','vesting')
--   redditArmyPendingCashable — pending daily bonus yet to be lump-summed
--   redditArmyPhase1Instant   — SUM user_credits source='phase1_completion'
--   redditArmyDailyCredited   — SUM user_credits source='daily_bonus_cashable'
--   redditArmyHoldReleased    — SUM user_credits source='hold_release'
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_earnings()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task_earnings int;
  v_manual_adj int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_bonus int;
  v_bonus_unlocked boolean;
  v_cashable int;
  v_total int;
  -- Reddit Army breakdown:
  v_ra_phase1 int;
  v_ra_daily_credited int;
  v_ra_hold_released int;
  v_ra_retention_held int;
  v_ra_pending_cashable int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Canonical task earnings: approved assignments (forum + reddit + challenge).
  SELECT COALESCE(SUM(t.reward_amount), 0)::int
  INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = v_uid
    AND ta.status = 'approved';

  -- Credits split (excluding task_reward which is a ledger mirror, and
  -- task_revert which is the negative reversal of task_reward — excluding
  -- both avoids double-counting since the canonical source of task earnings
  -- is task_assignments.status='approved', not user_credits).
  -- Note: phase1_completion / daily_bonus_cashable / hold_release are now
  -- captured inside v_manual_adj (they're all cashable), AND broken out
  -- explicitly below for the UI to display.
  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward','task_revert') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'phase1_completion' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'daily_bonus_cashable' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'hold_release' THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_manual_adj,
       v_ra_phase1, v_ra_daily_credited, v_ra_hold_released
  FROM public.user_credits
  WHERE user_id = v_uid;

  -- Reddit Army retention: bonus_holds still locked.
  SELECT COALESCE(SUM(amount), 0)::int
  INTO v_ra_retention_held
  FROM public.bonus_holds
  WHERE user_id = v_uid AND status IN ('held','vesting');

  -- Reddit Army pending cashable: lump not yet released.
  SELECT COALESCE(SUM(credited_amount / 2), 0)::int
  INTO v_ra_pending_cashable
  FROM public.reddit_daily_activity
  WHERE user_id = v_uid
    AND credited_type = 'pending_split'
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
    -- Reddit Army breakdown (new):
    'redditArmyPhase1Instant', v_ra_phase1,
    'redditArmyDailyCredited', v_ra_daily_credited,
    'redditArmyHoldReleased', v_ra_hold_released,
    'redditArmyRetentionHeld', v_ra_retention_held,
    'redditArmyPendingCashable', v_ra_pending_cashable
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_user_earnings() TO authenticated;

NOTIFY pgrst, 'reload schema';
