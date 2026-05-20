-- =============================================================
-- Payout eligibility: include `karma_milestone` (and any future
-- non-bonus credit source) in the cashable pool.
--
-- Previous version only counted `manual_adjustment` as a cashable
-- credit alongside task_assignments rewards. Result: users with
-- karma_milestone credits saw the money in their UI but the
-- server treated those rupiah as nonexistent for payout eligibility.
--
-- Fix: collapse to a single "cashable credits" bucket = everything
-- in user_credits that is NOT signup/referral bonus AND NOT a
-- mirror of an approved task_assignment (`task_reward`, written by
-- the tg_on_assignment_approved trigger and already counted via
-- the assignments JOIN — including it would double-count).
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
  v_other_credits int;   -- manual_adjustment + karma_milestone + future cashable sources
  v_bonus_total int;
  v_committed int;
  v_bonus_unlocked boolean;
  v_cashable_pool int;
  v_available_unlocked int;
  v_weekly_cap CONSTANT int := 500000;
  v_min_account_age CONSTANT int := 7;
  v_min_approved_tasks CONSTANT int := 5;
  v_bonus_unlock_floor CONSTANT int := 100000;
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

  -- Task earnings — canonical source: approved assignments * reward.
  SELECT COALESCE(SUM(t.reward_amount), 0)::int INTO v_task_earnings
  FROM public.task_assignments ta
  JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ra.user_id = p_user_id AND ta.status = 'approved';

  -- Credits split.  `task_reward` is the ledger mirror of an approved
  -- assignment — excluded here to avoid double counting.  Everything
  -- that's not a bonus and not a task_reward mirror is cashable.
  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward') THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_other_credits
  FROM public.user_credits
  WHERE user_id = p_user_id;

  v_bonus_total := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= v_bonus_unlock_floor;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_committed
  FROM public.payouts
  WHERE user_id = p_user_id AND status IN ('pending', 'paid');

  v_cashable_pool := v_task_earnings + v_other_credits
                   + CASE WHEN v_bonus_unlocked THEN v_bonus_total ELSE 0 END;
  v_available_unlocked := v_cashable_pool - v_committed;

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

  IF p_amount > v_available_unlocked THEN
    IF NOT v_bonus_unlocked AND v_bonus_total > 0 THEN
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
