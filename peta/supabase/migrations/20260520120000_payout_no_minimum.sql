-- =============================================================
-- Remove the Rp150.000 minimum payout floor.
--
-- New rule (decreed by the user, "act as boss"):
--   Task earnings cair anytime, any amount, no minimum.
--   Bonus (signup + referral) still locked behind Rp100K task
--   floor — once unlocked it joins the cashable pool freely.
--
-- `request_payout` previously raised "minimum payout Rp150.000"
-- when amount < 150000.  That check is removed; only the
-- existing eligibility gates (auth, holding period, bonus floor,
-- weekly cap) apply.
-- =============================================================

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
