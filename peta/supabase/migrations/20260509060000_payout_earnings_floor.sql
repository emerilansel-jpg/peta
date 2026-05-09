-- =============================================================
-- Anti-fraud Tier 1 (extension): earnings floor on payouts.
--
-- New rule: user must earn Rp150.000 from REAL WORK
-- (approved task rewards + signup_bonus credits) before any
-- payout — including referral balance — can be cashed out.
--
-- Closes the "harvest referral bonuses then bail" loophole:
-- a referrer can rack up Rp20K x N from referee signups, but
-- those rupiah are locked until the referrer also clears
-- Rp150K of their own task work (or signup bonus).
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
  v_earned_from_work int;
  v_weekly_cap CONSTANT int := 500000;       -- Rp 500.000
  v_min_account_age CONSTANT int := 7;        -- 7 hari
  v_min_approved_tasks CONSTANT int := 5;     -- atau 5 task approved
  v_earnings_floor CONSTANT int := 150000;    -- Rp 150.000 dari task + signup
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

  -- Earnings floor: tasks (approved) + signup_bonus credits
  SELECT COALESCE(SUM(t.reward_amount), 0)::int INTO v_task_earnings
  FROM public.task_assignments ta
  JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ra.user_id = p_user_id AND ta.status = 'approved';

  SELECT COALESCE(SUM(amount), 0)::int INTO v_signup_bonus
  FROM public.user_credits
  WHERE user_id = p_user_id AND source = 'signup_bonus';

  v_earned_from_work := v_task_earnings + v_signup_bonus;

  -- Hold-period gate (existing)
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
      'earned_from_work', v_earned_from_work,
      'earnings_floor', v_earnings_floor
    );
  END IF;

  -- Earnings-floor gate (new)
  IF v_earned_from_work < v_earnings_floor THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'earnings_floor',
      'message', format(
        'Buat narik saldo (termasuk bonus referral), kamu harus kumpulin minimal Rp%s dari task + signup bonus dulu. Sekarang baru Rp%s, kurang Rp%s lagi.',
        to_char(v_earnings_floor, 'FM999G999G999'),
        to_char(v_earned_from_work, 'FM999G999G999'),
        to_char(v_earnings_floor - v_earned_from_work, 'FM999G999G999')
      ),
      'earned_from_work', v_earned_from_work,
      'earnings_floor', v_earnings_floor,
      'task_earnings', v_task_earnings,
      'signup_bonus', v_signup_bonus
    );
  END IF;

  -- Weekly-cap gate (existing)
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
      'earned_from_work', v_earned_from_work,
      'earnings_floor', v_earnings_floor
    );
  END IF;

  RETURN json_build_object(
    'eligible', true,
    'days_old', v_days_old,
    'approved_tasks', v_approved_tasks,
    'weekly_total', v_weekly_total,
    'weekly_cap', v_weekly_cap,
    'earned_from_work', v_earned_from_work,
    'earnings_floor', v_earnings_floor,
    'task_earnings', v_task_earnings,
    'signup_bonus', v_signup_bonus
  );
END $$;

GRANT EXECUTE ON FUNCTION public.validate_payout_eligibility(uuid, int) TO authenticated;
