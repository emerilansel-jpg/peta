-- =============================================================
-- Straight Ltd — make PayPal credentials admin-configurable (no env rebuild).
--
-- The admin enters PayPal Client ID + Secret + environment in the Straight admin
-- Settings page. They are stored in app_secrets (service-role-only). The browser
-- SDK needs the (public) client_id, exposed via an anon RPC that returns ONLY the
-- client_id + environment — never the secret. The paypal-capture edge function
-- reads all three from app_secrets to verify the order server-side and credit.
--
-- app_secrets is the existing key/value credential store (RLS, no policies).
-- =============================================================

-- ---------- Admin: save PayPal config ----------
CREATE OR REPLACE FUNCTION public.admin_set_paypal_config(
  p_client_id     text,
  p_client_secret text,
  p_environment   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'invalid_environment';
  END IF;

  INSERT INTO public.app_secrets (key, value) VALUES ('PAYPAL_ENV', p_environment)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  -- Client id is required; empty string clears it (disables checkout).
  INSERT INTO public.app_secrets (key, value) VALUES ('PAYPAL_CLIENT_ID', coalesce(trim(p_client_id), ''))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  -- Only overwrite the secret when a non-empty value is provided, so the admin
  -- can update the client id/env without re-entering the secret each time.
  IF p_client_secret IS NOT NULL AND length(trim(p_client_secret)) > 0 THEN
    INSERT INTO public.app_secrets (key, value) VALUES ('PAYPAL_CLIENT_SECRET', trim(p_client_secret))
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_paypal_config(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_paypal_config(text, text, text) TO authenticated;

-- ---------- Admin: read PayPal config (secret masked) ----------
CREATE OR REPLACE FUNCTION public.admin_get_paypal_config()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id text;
  v_env text;
  v_secret text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT value INTO v_client_id FROM public.app_secrets WHERE key = 'PAYPAL_CLIENT_ID';
  SELECT value INTO v_env       FROM public.app_secrets WHERE key = 'PAYPAL_ENV';
  SELECT value INTO v_secret    FROM public.app_secrets WHERE key = 'PAYPAL_CLIENT_SECRET';
  RETURN json_build_object(
    'client_id', coalesce(v_client_id, ''),
    'environment', coalesce(v_env, 'sandbox'),
    'secret_set', (v_secret IS NOT NULL AND length(v_secret) > 0)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_paypal_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_paypal_config() TO authenticated;

-- ---------- Public: client_id + environment for the browser SDK (NO secret) ----------
CREATE OR REPLACE FUNCTION public.get_paypal_public_config()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id text;
  v_env text;
BEGIN
  SELECT value INTO v_client_id FROM public.app_secrets WHERE key = 'PAYPAL_CLIENT_ID';
  SELECT value INTO v_env       FROM public.app_secrets WHERE key = 'PAYPAL_ENV';
  RETURN json_build_object(
    'client_id', coalesce(v_client_id, ''),
    'environment', coalesce(v_env, 'sandbox'),
    'configured', (v_client_id IS NOT NULL AND length(v_client_id) > 0)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_paypal_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_paypal_public_config() TO anon, authenticated;

-- ---------- Service-role: credit a verified PayPal top-up ----------
-- Called ONLY by the paypal-capture edge function AFTER it has verified the
-- order with PayPal's API. Takes user_id explicitly (service-role context has no
-- auth.uid()). Idempotent on paypal_order_id. A trigger keeps users.credit_balance
-- in sync from credit_transactions (same path as fn_complete_paypal_topup).
CREATE OR REPLACE FUNCTION public.fn_paypal_credit_verified(
  p_user_id          uuid,
  p_amount_cents     integer,
  p_paypal_order_id  text,
  p_paypal_capture_id text
)
RETURNS public.reddit_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_balance integer;
  v_topup public.reddit_topup_requests;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user required'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 THEN RAISE EXCEPTION 'minimum $1.00 topup'; END IF;
  IF p_paypal_order_id IS NULL THEN RAISE EXCEPTION 'paypal_order_id required'; END IF;

  -- Idempotency: this PayPal order may only ever credit once.
  IF EXISTS (SELECT 1 FROM public.reddit_topup_requests WHERE paypal_order_id = p_paypal_order_id) THEN
    SELECT * INTO v_topup FROM public.reddit_topup_requests WHERE paypal_order_id = p_paypal_order_id;
    RETURN v_topup;
  END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  INSERT INTO public.reddit_topup_requests (
    user_id, amount_cents, credits_purchased,
    payment_method, paypal_order_id, paypal_capture_id,
    payment_status, completed_at
  ) VALUES (
    p_user_id, p_amount_cents, p_amount_cents,
    'paypal', p_paypal_order_id, p_paypal_capture_id,
    'completed', now()
  )
  RETURNING * INTO v_topup;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    p_user_id, 'topup', p_amount_cents, v_user_balance + p_amount_cents,
    jsonb_build_object('topup_request_id', v_topup.id, 'paypal_order_id', p_paypal_order_id, 'verified', true)
  );

  RETURN v_topup;
END $$;

REVOKE ALL ON FUNCTION public.fn_paypal_credit_verified(uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_paypal_credit_verified(uuid, integer, text, text) TO service_role;
