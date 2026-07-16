-- =============================================================
-- PeTa — payout withdrawal method selection.
--
-- Adds payment destination columns to payouts and updates the
-- request_payout RPC to collect e-wallet / bank details from
-- the army member. Also enforces a Rp20.000 minimum payout.
-- =============================================================

-- 1. Add destination columns to payouts.
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS payment_type TEXT CHECK (payment_type IN ('ewallet','bank')),
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS account_holder_name TEXT;

-- 2. Update payment_method legacy column for quick admin display.
-- (Use the provider name as the human-readable payment method.)
UPDATE public.payouts
  SET payment_method = provider
WHERE payment_method IS NULL
  AND provider IS NOT NULL;

-- 3. Add the new multi-parameter request_payout RPC. Keep the old single-parameter
-- version for a short transition window until the new frontend is fully deployed.
CREATE OR REPLACE FUNCTION public.request_payout(
  p_amount int,
  p_payment_type text,
  p_provider text,
  p_account_number text,
  p_account_holder_name text
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_amount < 20000 THEN RAISE EXCEPTION 'Minimum payout Rp20.000'; END IF;
  IF p_payment_type IS NULL OR p_payment_type NOT IN ('ewallet', 'bank') THEN
    RAISE EXCEPTION 'Pilih metode penarikan (E-wallet atau Bank)';
  END IF;
  IF NULLIF(trim(p_provider), '') IS NULL THEN
    RAISE EXCEPTION 'Pilih provider (misal Dana, BCA, dll)';
  END IF;
  IF NULLIF(trim(p_account_number), '') IS NULL THEN
    RAISE EXCEPTION 'Nomor rekening/e-wallet wajib diisi';
  END IF;
  IF NULLIF(trim(p_account_holder_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pemilik rekening/e-wallet wajib diisi';
  END IF;

  v_eligibility := public.validate_payout_eligibility(v_uid, p_amount);
  IF NOT (v_eligibility->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_eligibility->>'message';
  END IF;

  INSERT INTO public.payouts (
    user_id,
    amount,
    status,
    payment_method,
    payment_type,
    provider,
    account_number,
    account_holder_name
  )
  VALUES (
    v_uid,
    p_amount,
    'pending',
    p_provider,
    p_payment_type,
    p_provider,
    trim(p_account_number),
    trim(p_account_holder_name)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.request_payout(int, text, text, text, text) TO authenticated;

-- Legacy single-parameter overload remains for the brief transition window.
CREATE OR REPLACE FUNCTION public.request_payout(p_amount int)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  v_eligibility := public.validate_payout_eligibility(v_uid, p_amount);
  IF NOT (v_eligibility->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_eligibility->>'message';
  END IF;

  INSERT INTO public.payouts (user_id, amount, status)
  VALUES (v_uid, p_amount, 'pending')
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.request_payout(int) TO authenticated;

-- 4. Update validate_payout_eligibility to enforce Rp20.000 minimum.
CREATE OR REPLACE FUNCTION public.validate_payout_eligibility(
  p_user_id uuid,
  p_amount int
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_at timestamptz;
  v_days_old int;
  v_approved_tasks int;
  v_weekly_total int;
  v_task_earnings int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_other_credits int;
  v_bonus_total int;
  v_committed int;
  v_bonus_unlocked boolean;
  v_cashable_pool int;
  v_available_unlocked int;
  v_weekly_cap CONSTANT int := 500000;
  v_min_account_age CONSTANT int := 7;
  v_min_approved_tasks CONSTANT int := 5;
  v_bonus_unlock_floor CONSTANT int := 100000;
  v_min_payout CONSTANT int := 20000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF auth.uid() <> p_user_id AND NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_amount < v_min_payout THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'minimum_payout',
      'message', format('Minimum payout Rp%s.', to_char(v_min_payout, 'FM999G999G999')),
      'min_payout', v_min_payout
    );
  END IF;

  SELECT created_at INTO v_created_at FROM public.users WHERE id = p_user_id;
  IF v_created_at IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  v_days_old := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_created_at)) / 86400)::int;

  SELECT COUNT(*)::int INTO v_approved_tasks
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  WHERE COALESCE(ta.user_id, ra.user_id) = p_user_id AND ta.status = 'approved';

  SELECT COALESCE(SUM(amount), 0)::int INTO v_weekly_total
  FROM public.payouts
  WHERE user_id = p_user_id
    AND created_at > NOW() - INTERVAL '7 days'
    AND status IN ('pending', 'paid');

  SELECT COALESCE(SUM(t.reward_amount), 0)::int INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = p_user_id AND ta.status = 'approved';

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

-- 5. Notify PostgREST to reload schema cache.
NOTIFY pgrst, 'reload schema';
