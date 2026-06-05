-- =============================================================
-- Straight Ltd — make the pricing matrix authoritative for CHARGES.
--
-- Before this migration the order RPCs hardcoded prices:
--   * fn_create_reddit_upvote_order  -> 50c per upvote (constant)
--   * fn_create_forum_comment_order  -> 550/500 (AI-vs-self)
-- so admin price/toggle changes in `straight_pricing` only affected what
-- the client *saw*, never what they were *charged*.
--
-- This migration routes both RPCs through the matrix:
--   * price comes from straight_pricing.price_cents
--   * a disabled (enabled=false) service is REJECTED server-side
--   * if the matrix row is missing (e.g. table not seeded), it falls back
--     to the legacy hardcoded price so nothing breaks.
-- =============================================================

-- ---------- helper: resolve a unit price from the matrix ----------
CREATE OR REPLACE FUNCTION public.fn_straight_unit_price(
  p_key      text,
  p_fallback integer
)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price   integer;
  v_enabled boolean;
BEGIN
  SELECT price_cents, enabled
    INTO v_price, v_enabled
    FROM public.straight_pricing
   WHERE key = p_key;

  IF NOT FOUND THEN
    -- Matrix not seeded for this key yet: behave like before.
    RETURN p_fallback;
  END IF;

  IF NOT v_enabled THEN
    RAISE EXCEPTION 'service_disabled';
  END IF;

  RETURN v_price;
END $$;

REVOKE ALL ON FUNCTION public.fn_straight_unit_price(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_straight_unit_price(text, integer) TO authenticated;

-- ---------- upvote orders: price per upvote from matrix ----------
CREATE OR REPLACE FUNCTION public.fn_create_reddit_upvote_order(
  p_thread_url TEXT,
  p_subreddit TEXT,
  p_requested_upvotes INTEGER,
  p_notes TEXT
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_price_per_upvote INTEGER;
  v_order public.reddit_upvote_orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_requested_upvotes IS NULL OR p_requested_upvotes < 1 THEN RAISE EXCEPTION 'invalid upvote count'; END IF;
  IF p_requested_upvotes > 10000 THEN RAISE EXCEPTION 'max 10000 upvotes per order'; END IF;

  -- Matrix-driven price (cents); legacy fallback 50c. Raises service_disabled if OFF.
  v_price_per_upvote := public.fn_straight_unit_price('reddit_upvote', 50);

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;

  v_cost := p_requested_upvotes * v_price_per_upvote;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id, p_thread_url, p_subreddit, 'upvote',
    p_requested_upvotes, v_cost, p_notes
  )
  RETURNING * INTO v_order;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object('reddit_upvote_order_id', v_order.id)
  );

  RETURN v_order;
END;
$$;

-- ---------- forum comment orders: price by platform + mention mode ----------
CREATE OR REPLACE FUNCTION public.fn_create_forum_comment_order(
  p_target_url TEXT,
  p_platform TEXT,
  p_comment_text TEXT,
  p_use_suggested_comment BOOLEAN,
  p_brand_name TEXT,
  p_brand_domain TEXT,
  p_brand_mention_mode TEXT,
  p_source_keyword TEXT,
  p_notes TEXT
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id UUID;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_platform TEXT;
  v_mode TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_target_url IS NULL OR length(trim(p_target_url)) < 8 THEN RAISE EXCEPTION 'target_url required'; END IF;
  IF p_comment_text IS NULL OR length(trim(p_comment_text)) < 20 THEN RAISE EXCEPTION 'comment_text too short'; END IF;
  IF p_brand_mention_mode IS NOT NULL AND p_brand_mention_mode NOT IN ('plain', 'link') THEN
    RAISE EXCEPTION 'invalid brand mention mode';
  END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  -- Resolve price from the matrix: {reddit|forum}_comment_{plain|link}.
  -- Reddit when the platform label or the URL points at reddit; else "other forum".
  v_platform := CASE
    WHEN lower(coalesce(p_platform, '')) LIKE '%reddit%'
      OR lower(coalesce(p_target_url, '')) LIKE '%reddit.com%' THEN 'reddit'
    ELSE 'forum'
  END;
  -- Link price only when a brand link is actually requested; otherwise plain.
  v_mode := CASE WHEN p_brand_mention_mode = 'link' THEN 'link' ELSE 'plain' END;

  v_cost := public.fn_straight_unit_price(
    v_platform || '_comment_' || v_mode,
    CASE WHEN v_mode = 'link' THEN 550 ELSE 500 END
  );

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'forum_comment',
    'platform', nullif(trim(coalesce(p_platform, '')), ''),
    'comment_text', trim(p_comment_text),
    'use_suggested_comment', coalesce(p_use_suggested_comment, false),
    'brand_name', nullif(trim(coalesce(p_brand_name, '')), ''),
    'brand_domain', nullif(trim(coalesce(p_brand_domain, '')), ''),
    'brand_mention_mode', p_brand_mention_mode,
    'price_key', v_platform || '_comment_' || v_mode,
    'source_keyword', nullif(trim(coalesce(p_source_keyword, '')), ''),
    'client_notes', nullif(trim(coalesce(p_notes, '')), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    trim(p_target_url),
    nullif(trim(coalesce(p_platform, '')), ''),
    'comment',
    1,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_cost,
    v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'forum_comment',
      'use_suggested_comment', coalesce(p_use_suggested_comment, false),
      'price_key', v_platform || '_comment_' || v_mode
    )
  );

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_forum_comment_order(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_forum_comment_order(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
