-- Disable Trustpilot Review service across Straight catalog, pricing matrix, and RPC endpoints
-- so clients cannot browse or place Trustpilot orders.

UPDATE public.straight_pricing
SET enabled = FALSE,
    updated_at = NOW()
WHERE key = 'trustpilot_review';

UPDATE public.straight_services
SET enabled = FALSE,
    updated_at = NOW()
WHERE slug = 'trustpilot_review';

-- Guard both overloads of fn_create_trustpilot_order so direct RPC / cached client calls are blocked
-- whenever either straight_pricing or straight_services has trustpilot_review disabled.
CREATE OR REPLACE FUNCTION public.fn_create_trustpilot_order(
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_unit_price INTEGER;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_quantity INT;
  v_url TEXT;
  v_notes JSONB;
  v_draft JSONB;
  v_draft_text TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF NOT COALESCE((SELECT enabled FROM public.straight_pricing WHERE key = 'trustpilot_review'), FALSE)
     OR NOT COALESCE((SELECT enabled FROM public.straight_services WHERE slug = 'trustpilot_review'), FALSE) THEN
    RAISE EXCEPTION 'Trustpilot Reviews are paused right now.' USING ERRCODE = 'P0001';
  END IF;

  IF p_request_id IS NOT NULL AND length(trim(p_request_id)) > 0 THEN
    SELECT o.* INTO v_order
    FROM public.reddit_upvote_orders o
    JOIN public.credit_transactions ct
      ON ct.metadata->>'reddit_upvote_order_id' = o.id::text
     AND ct.metadata->>'request_id' = trim(p_request_id)
    WHERE o.user_id = v_user_id
      AND o.created_at >= NOW() - INTERVAL '15 minutes'
    LIMIT 1;
    IF v_order.id IS NOT NULL THEN
      RETURN v_order;
    END IF;
  END IF;

  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://[^\s]+' THEN
    RAISE EXCEPTION 'valid_url_required';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20';
  END IF;

  v_unit_price := public.fn_straight_unit_price('trustpilot_review', 500);
  v_cost := v_unit_price * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'trustpilot_review',
    'platform', 'trustpilot',
    'target_url', v_url,
    'quantity', v_quantity,
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', COALESCE(NULLIF(btrim(COALESCE(p_review_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id, v_url, 'Trustpilot', 'trustpilot_review',
    v_quantity, v_cost, v_notes::text
  )
  RETURNING * INTO v_order;

  IF p_review_drafts IS NOT NULL AND jsonb_array_length(p_review_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_review_drafts) - 1 LOOP
      v_draft := p_review_drafts->i;
      v_draft_text := NULLIF(btrim(COALESCE(v_draft->>'comment_text', '')), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'trustpilot_review',
      'price_key', 'trustpilot_review',
      'quantity', v_quantity,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $function$;

REVOKE ALL ON FUNCTION public.fn_create_trustpilot_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_trustpilot_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_create_trustpilot_order(
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_drip_interval_hours INT DEFAULT 0
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_unit_price INTEGER;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_quantity INT;
  v_url TEXT;
  v_notes JSONB;
  v_draft JSONB;
  v_draft_text TEXT;
  v_drip_hours INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF NOT COALESCE((SELECT enabled FROM public.straight_pricing WHERE key = 'trustpilot_review'), FALSE)
     OR NOT COALESCE((SELECT enabled FROM public.straight_services WHERE slug = 'trustpilot_review'), FALSE) THEN
    RAISE EXCEPTION 'Trustpilot Reviews are paused right now.' USING ERRCODE = 'P0001';
  END IF;

  IF p_request_id IS NOT NULL AND length(trim(p_request_id)) > 0 THEN
    SELECT o.* INTO v_order
    FROM public.reddit_upvote_orders o
    JOIN public.credit_transactions ct
      ON ct.metadata->>'reddit_upvote_order_id' = o.id::text
     AND ct.metadata->>'request_id' = trim(p_request_id)
    WHERE o.user_id = v_user_id
      AND o.created_at >= NOW() - INTERVAL '15 minutes'
    LIMIT 1;
    IF v_order.id IS NOT NULL THEN
      RETURN v_order;
    END IF;
  END IF;

  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://(?:[a-z0-9-]+\.)*trustpilot\.com/review/[^\s]+' THEN
    RAISE EXCEPTION 'Please enter a valid Trustpilot business page URL (https://www.trustpilot.com/review/...)' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20' USING ERRCODE = 'P0001';
  END IF;

  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF v_drip_hours < 0 OR v_drip_hours > 168 THEN
    v_drip_hours := 0;
  END IF;

  v_unit_price := public.fn_straight_unit_price('trustpilot_review', 500);
  v_cost := v_unit_price * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001'; END IF;
  IF v_user_balance < v_cost THEN RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001'; END IF;

  v_notes := jsonb_build_object(
    'service', 'trustpilot_review',
    'platform', 'trustpilot',
    'target_url', v_url,
    'quantity', v_quantity,
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', COALESCE(NULLIF(btrim(COALESCE(p_review_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), ''),
    'drip_interval_hours', v_drip_hours
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id, v_url, 'Trustpilot', 'trustpilot_review',
    v_quantity, v_cost, v_notes::text, v_drip_hours
  )
  RETURNING * INTO v_order;

  IF p_review_drafts IS NOT NULL AND jsonb_array_length(p_review_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_review_drafts) - 1 LOOP
      v_draft := p_review_drafts->i;
      v_draft_text := NULLIF(btrim(COALESCE(v_draft->>'comment_text', '')), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'trustpilot_review',
      'price_key', 'trustpilot_review',
      'quantity', v_quantity,
      'drip_interval_hours', v_drip_hours,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $function$;

REVOKE ALL ON FUNCTION public.fn_create_trustpilot_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_trustpilot_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) TO authenticated;
