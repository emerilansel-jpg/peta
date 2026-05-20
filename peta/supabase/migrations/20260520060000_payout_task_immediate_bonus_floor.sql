-- =============================================================
-- Payout rule v2: task earnings cashable immediately, bonus
-- (signup + referral) locked behind Rp100K of TASK earnings.
--
-- Replaces the previous Rp150K "earned_from_work" floor (which
-- counted signup_bonus toward the floor). New behavior:
--
--   * Approved task rewards   → cashable anytime (subject to
--                                  min payout amount + holding
--                                  period + weekly cap).
--   * Manual adjustments      → cashable anytime (admin trust).
--   * signup_bonus + referral → locked until task earnings
--                                  alone reach Rp100.000.
--
-- Closes the "harvest signup + referral, never work" loophole
-- while letting users who actually do tasks cash out the moment
-- they hit the minimum payout amount. Min payout stays Rp150K.
-- =============================================================

CREATE OR REPLACE FUNCTION public.validate_payout_eligibility(
  p_user_id uuid,
  p_amount int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_created_at timestamptz;
  v_days_old int;
  v_approved_tasks int;
  v_weekly_total int;
  v_task_earnings int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_manual_adj int;
  v_bonus_total int;
  v_committed int;
  v_bonus_unlocked boolean;
  v_cashable_pool int;
  v_available_unlocked int;
  v_weekly_cap CONSTANT int := 500000;             -- Rp 500.000 / 7d
  v_min_account_age CONSTANT int := 7;              -- 7 hari
  v_min_approved_tasks CONSTANT int := 5;           -- atau 5 task approved
  v_bonus_unlock_floor CONSTANT int := 100000;      -- Rp 100.000 dari TASK saja
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF auth.uid() <> p_user_id AND NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT created_at INTO v_created_at FROM public.users WHERE id = p_user_id;
  IF v_created_at IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  v_days_old := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_created_at)) / 86400)::int;

  SELECT COUNT(*)::int INTO v_approved_tasks
  FROM public.task_assignments ta
  JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  WHERE ra.user_id = p_user_id AND ta.status = 'approved';

  SELECT COALESCE(SUM(amount), 0)::int INTO v_weekly_total
  FROM public.payouts
  WHERE user_id = p_user_id
    AND created_at > NOW() - INTERVAL '7 days'
    AND status IN ('pending', 'paid');

  SELECT COALESCE(SUM(t.reward_amount), 0)::int INTO v_task_earnings
  FROM public.task_assignments ta
  JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ra.user_id = p_user_id AND ta.status = 'approved';

  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'manual_adjustment' THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_manual_adj
  FROM public.user_credits
  WHERE user_id = p_user_id;

  v_bonus_total := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= v_bonus_unlock_floor;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_committed
  FROM public.payouts
  WHERE user_id = p_user_id AND status IN ('pending', 'paid');

  -- Task earnings + manual adj always cashable; bonus joins pool only
  -- once user has earned the Rp100K floor from approved tasks.
  v_cashable_pool := v_task_earnings + v_manual_adj
                   + CASE WHEN v_bonus_unlocked THEN v_bonus_total ELSE 0 END;
  v_available_unlocked := v_cashable_pool - v_committed;

  -- 1) Holding-period gate (unchanged)
  IF v_days_old < v_min_account_age AND v_approved_tasks < v_min_approved_tasks THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'holding_period',
      'message', format(
        'Payout pertama buka setelah %s hari ATAU %s task approved. Akun kamu %s hari, task approved: %s.',
        v_min_account_age, v_min_approved_tasks, v_days_old, v_approved_tasks
      ),
      'days_old', v_days_old,
      'approved_tasks', v_approved_tasks,
      'task_earnings', v_task_earnings,
      'bonus_total', v_bonus_total,
      'bonus_unlocked', v_bonus_unlocked,
      'bonus_unlock_floor', v_bonus_unlock_floor,
      'available_unlocked', v_available_unlocked
    );
  END IF;

  -- 2) Balance / earnings-floor gate
  IF p_amount > v_available_unlocked THEN
    IF NOT v_bonus_unlocked AND v_bonus_total > 0 THEN
      -- User has locked bonus saldo they're trying to dip into
      RETURN json_build_object(
        'eligible', false,
        'reason', 'earnings_floor',
        'message', format(
          'Saldo bonus (signup + referral) kebuka setelah kumpulin Rp%s dari TASK approved. Sekarang baru Rp%s dari task — kurang Rp%s lagi. Saldo dari task bisa langsung cair.',
          to_char(v_bonus_unlock_floor, 'FM999G999G999'),
          to_char(v_task_earnings, 'FM999G999G999'),
          to_char(v_bonus_unlock_floor - v_task_earnings, 'FM999G999G999')
        ),
        'task_earnings', v_task_earnings,
        'bonus_total', v_bonus_total,
        'bonus_unlocked', false,
        'bonus_unlock_floor', v_bonus_unlock_floor,
        'available_unlocked', v_available_unlocked
      );
    ELSE
      RETURN json_build_object(
        'eligible', false,
        'reason', 'insufficient_balance',
        'message', format(
          'Saldo tidak cukup. Tersedia Rp%s.',
          to_char(GREATEST(v_available_unlocked, 0), 'FM999G999G999')
        ),
        'task_earnings', v_task_earnings,
        'bonus_total', v_bonus_total,
        'bonus_unlocked', v_bonus_unlocked,
        'bonus_unlock_floor', v_bonus_unlock_floor,
        'available_unlocked', v_available_unlocked
      );
    END IF;
  END IF;

  -- 3) Weekly-cap gate (unchanged)
  IF (v_weekly_total + p_amount) > v_weekly_cap THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'weekly_cap',
      'message', format(
        'Limit payout mingguan Rp%s. Sudah pakai Rp%s minggu ini, sisa Rp%s. Hubungi admin untuk override.',
        to_char(v_weekly_cap, 'FM999G999G999'),
        to_char(v_weekly_total, 'FM999G999G999'),
        to_char(v_weekly_cap - v_weekly_total, 'FM999G999G999')
      ),
      'weekly_total', v_weekly_total,
      'weekly_cap', v_weekly_cap,
      'task_earnings', v_task_earnings,
      'bonus_total', v_bonus_total,
      'bonus_unlocked', v_bonus_unlocked,
      'bonus_unlock_floor', v_bonus_unlock_floor,
      'available_unlocked', v_available_unlocked
    );
  END IF;

  RETURN json_build_object(
    'eligible', true,
    'days_old', v_days_old,
    'approved_tasks', v_approved_tasks,
    'weekly_total', v_weekly_total,
    'weekly_cap', v_weekly_cap,
    'task_earnings', v_task_earnings,
    'bonus_total', v_bonus_total,
    'bonus_unlocked', v_bonus_unlocked,
    'bonus_unlock_floor', v_bonus_unlock_floor,
    'available_unlocked', v_available_unlocked
  );
END $$;

GRANT EXECUTE ON FUNCTION public.validate_payout_eligibility(uuid, int) TO authenticated;
