-- Adds structured payment method columns to payouts + admin RPCs for Payroll page
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS account_holder_name text,
  ADD COLUMN IF NOT EXISTS user_note text,
  ADD COLUMN IF NOT EXISTS paid_reference text,
  ADD COLUMN IF NOT EXISTS admin_note text;

CREATE OR REPLACE FUNCTION public.request_payout(
  p_amount integer,
  p_payment_type text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_account_number text DEFAULT NULL,
  p_account_holder_name text DEFAULT NULL,
  p_user_note text DEFAULT NULL
)
RETURNS payouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  INSERT INTO public.payouts (user_id, amount, status, payment_type, provider, account_number, account_holder_name, user_note)
    VALUES (v_uid, p_amount, 'pending', p_payment_type, p_provider, p_account_number, p_account_holder_name, p_user_note)
    RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_last_payment_method()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid; v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_row FROM public.payouts
    WHERE user_id = v_uid AND payment_type IS NOT NULL
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN json_build_object(
    'payment_type', v_row.payment_type,
    'provider', v_row.provider,
    'account_number', v_row.account_number,
    'account_holder_name', v_row.account_holder_name,
    'user_note', v_row.user_note
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(
  p_payout_id uuid,
  p_paid_reference text DEFAULT NULL,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.payouts
    SET status = 'paid', paid_at = now(),
        paid_reference = p_paid_reference, admin_note = p_admin_note, updated_at = now()
    WHERE id = p_payout_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout not found or already processed'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_payout(
  p_payout_id uuid,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.payouts
    SET status = 'cancelled', admin_note = p_admin_note, updated_at = now()
    WHERE id = p_payout_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout not found or already processed'; END IF;
END;
$$;
