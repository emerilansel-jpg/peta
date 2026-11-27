-- Restore reseller RPCs missing from production schema cache.
-- Idempotent. Does not create an order or mutate balances by itself.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_reseller_order(
  p_service_key TEXT,
  p_package_key TEXT,
  p_target_url TEXT,
  p_platform TEXT DEFAULT 'Social',
  p_notes TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_balance INT;
  v_pkg public.straight_supplier_packages%ROWTYPE;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_existing_order_id INT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_target_url IS NULL OR length(btrim(p_target_url)) < 5
     OR btrim(p_target_url) !~* '^https?://[^\s]+$'
     OR btrim(p_target_url) !~* '^https?://[^\s./]+(?:\.[^\s./]+)+(?::[0-9]{1,5})?(?:/[^\s]*)?$' THEN
    RAISE EXCEPTION 'Target URL is required and must be a valid http(s) URL' USING ERRCODE = 'P0001';
  END IF;

  IF p_request_id IS NOT NULL AND length(btrim(p_request_id)) > 0 THEN
    SELECT (ct.metadata->>'reddit_upvote_order_id')::int INTO v_existing_order_id
    FROM public.credit_transactions ct
    WHERE ct.user_id = v_user_id
      AND ct.metadata->>'request_id' = btrim(p_request_id)
      AND ct.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY ct.id DESC LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN
      SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = v_existing_order_id;
      IF v_order.id IS NOT NULL THEN RETURN v_order; END IF;
    END IF;
  END IF;

  SELECT * INTO v_pkg
  FROM public.straight_supplier_packages
  WHERE public_service_key = btrim(p_service_key)
    AND public_package_key = btrim(p_package_key);
  IF v_pkg.id IS NULL THEN RAISE EXCEPTION 'Package not found' USING ERRCODE = 'P0001'; END IF;
  IF v_pkg.status <> 'active' THEN RAISE EXCEPTION 'This service is currently unavailable or requires a custom quote' USING ERRCODE = 'P0001'; END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF v_user_balance < v_pkg.selling_price_cents THEN RAISE EXCEPTION 'insufficient_credits'; END IF;

  v_notes := jsonb_build_object(
    'service', v_pkg.public_service_key,
    'platform', COALESCE(NULLIF(btrim(p_platform), ''), 'Social'),
    'package_name', v_pkg.package_label,
    'quantity', v_pkg.quantity,
    'target_url', btrim(p_target_url),
    'client_notes', NULLIF(btrim(COALESCE(p_notes, '')), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type, requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id, btrim(p_target_url), COALESCE(NULLIF(btrim(p_platform), ''), 'Social'),
    'reseller_order', v_pkg.quantity, v_pkg.selling_price_cents, v_notes::text
  ) RETURNING * INTO v_order;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, metadata)
  VALUES (
    v_user_id, 'spend', -v_pkg.selling_price_cents, v_user_balance - v_pkg.selling_price_cents,
    jsonb_build_object('reddit_upvote_order_id', v_order.id, 'service', v_pkg.public_service_key,
                       'package', v_pkg.package_label, 'quantity', v_pkg.quantity, 'request_id', p_request_id)
  );

  INSERT INTO public.straight_supplier_fulfillments (
    order_id, supplier, supplier_code, supplier_service_name, supplier_package,
    supplier_cost_idr, selling_price_idr, selling_price_cents, supplier_wa, supplier_url, fulfillment_status
  ) VALUES (
    v_order.id, 'SolusiMedsos', v_pkg.supplier_code, v_pkg.supplier_service_name, v_pkg.package_label,
    v_pkg.supplier_cost_idr, v_pkg.selling_price_idr, v_pkg.selling_price_cents,
    v_pkg.supplier_wa, v_pkg.supplier_url, 'pending'
  );

  RETURN v_order;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.public_get_reseller_packages(
  p_service_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  public_service_key TEXT,
  public_package_key TEXT,
  package_label TEXT,
  quantity INT,
  selling_price_cents INT,
  status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.public_service_key, p.public_package_key, p.package_label,
         p.quantity, p.selling_price_cents, p.status
  FROM public.straight_supplier_packages p
  WHERE p_service_key IS NULL OR p.public_service_key = p_service_key
  ORDER BY p.public_service_key, p.quantity ASC;
$$;

REVOKE ALL ON FUNCTION public.fn_create_reseller_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_reseller_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_reseller_packages(TEXT) TO PUBLIC, anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
