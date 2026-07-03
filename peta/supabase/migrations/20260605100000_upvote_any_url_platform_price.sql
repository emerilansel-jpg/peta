-- =============================================================
-- Straight Ltd — upvotes on ANY forum URL, priced per platform.
--
-- Upvote orders used to assume reddit.com. Now a client can paste any forum
-- URL; the charge is reddit_upvote for reddit.com links and forum_upvote for
-- everything else, both driven by the admin pricing matrix.
--
-- forum_upvote shipped disabled in the seed (20260604120000); enable it so
-- non-reddit upvotes are actually sellable. Admins can still toggle it later.
-- =============================================================

UPDATE public.straight_pricing
   SET enabled = true, updated_at = now()
 WHERE key = 'forum_upvote' AND enabled = false;

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
  v_platform TEXT;
  v_order public.reddit_upvote_orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_requested_upvotes IS NULL OR p_requested_upvotes < 1 THEN RAISE EXCEPTION 'invalid upvote count'; END IF;
  IF p_requested_upvotes > 10000 THEN RAISE EXCEPTION 'max 10000 upvotes per order'; END IF;

  -- Reddit vs other-forum pricing from the matrix. Raises service_disabled if OFF.
  v_platform := CASE WHEN lower(coalesce(p_thread_url, '')) LIKE '%reddit.com%' THEN 'reddit' ELSE 'forum' END;
  v_price_per_upvote := public.fn_straight_unit_price(v_platform || '_upvote', 50);

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
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'price_key', v_platform || '_upvote'
    )
  );

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_reddit_upvote_order(
  TEXT, TEXT, INTEGER, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_reddit_upvote_order(
  TEXT, TEXT, INTEGER, TEXT
) TO authenticated;
