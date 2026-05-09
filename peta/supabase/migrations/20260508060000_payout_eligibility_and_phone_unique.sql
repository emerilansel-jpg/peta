-- =============================================================
-- Anti-fraud Tier 1: payout eligibility + phone uniqueness.
--
-- Closes the highest-value fraud surface (signup-claim-vanish farming
-- and multi-account bonus stacking) before any real payout volume.
--
-- One person = one PeTa Army account (phone-number unique). Payouts
-- only open after either 7 days of account age OR 5 approved tasks,
-- and total weekly outflow per user is capped at Rp500.000 unless
-- an admin manually overrides via direct UPDATE.
-- =============================================================

-- 1) Phone uniqueness — one WA number = one PeTa Army account.
--    Existing data must be deduplicated before this migration runs.
ALTER TABLE public.users
  ADD CONSTRAINT users_whatsapp_unique UNIQUE (whatsapp);

-- 2) Eligibility checker (pre-flight, returns JSON for friendly UI).
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
  v_weekly_cap CONSTANT int := 500000;       -- Rp 500.000
  v_min_account_age CONSTANT int := 7;        -- 7 hari
  v_min_approved_tasks CONSTANT int := 5;     -- atau 5 task approved
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

  IF v_days_old < v_min_account_age AND v_approved_tasks < v_min_approved_tasks THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'holding_period',
      'message', format(
        'Payout pertama buka setelah %s hari ATAU %s task approved. Akun kamu %s hari, task approved: %s.',
        v_min_account_age, v_min_approved_tasks, v_days_old, v_approved_tasks
      ),
      'days_old', v_days_old,
      'approved_tasks', v_approved_tasks
    );
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
      'weekly_cap', v_weekly_cap
    );
  END IF;

  RETURN json_build_object(
    'eligible', true,
    'days_old', v_days_old,
    'approved_tasks', v_approved_tasks,
    'weekly_total', v_weekly_total,
    'weekly_cap', v_weekly_cap
  );
END $$;

GRANT EXECUTE ON FUNCTION public.validate_payout_eligibility(uuid, int) TO authenticated;

-- 3) request_payout RPC — replaces direct INSERT into payouts so the
--    eligibility check runs server-side (can't be bypassed by editing
--    client JS).
CREATE OR REPLACE FUNCTION public.request_payout(p_amount int)
RETURNS public.payouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount < 150000 THEN RAISE EXCEPTION 'minimum payout Rp150.000'; END IF;

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
