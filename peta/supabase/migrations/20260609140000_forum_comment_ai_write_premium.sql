-- =============================================================
-- Straight Ltd — "Let AI write it" is a +10% premium over the base comment price.
--
-- Until now fn_create_forum_comment_order charged the plain/link matrix price
-- regardless of who wrote the comment. The order flow now offers:
--   * "Let AI write it"      -> base comment price + 10%
--   * "I'll write it myself" -> base comment price
-- p_use_suggested_comment carries that choice; apply the premium here so the
-- charge matches what the client sees (the UI computes base * 1.10). Plain vs
-- link mention still comes from the matrix; the +10% stacks on top of it.
-- =============================================================

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
  v_base INTEGER;
  v_ai BOOLEAN;
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
  v_platform := CASE
    WHEN lower(coalesce(p_platform, '')) LIKE '%reddit%'
      OR lower(coalesce(p_target_url, '')) LIKE '%reddit.com%' THEN 'reddit'
    ELSE 'forum'
  END;
  -- Link price only when a brand link is actually requested; otherwise plain.
  v_mode := CASE WHEN p_brand_mention_mode = 'link' THEN 'link' ELSE 'plain' END;
  v_ai := coalesce(p_use_suggested_comment, false);

  v_base := public.fn_straight_unit_price(
    v_platform || '_comment_' || v_mode,
    CASE WHEN v_mode = 'link' THEN 550 ELSE 500 END
  );
  -- "Let AI write it" = +10% premium over the base; self-written pays the base.
  v_cost := CASE WHEN v_ai THEN round(v_base * 1.10) ELSE v_base END;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'forum_comment',
    'platform', nullif(trim(coalesce(p_platform, '')), ''),
    'comment_text', trim(p_comment_text),
    'use_suggested_comment', v_ai,
    'brand_name', nullif(trim(coalesce(p_brand_name, '')), ''),
    'brand_domain', nullif(trim(coalesce(p_brand_domain, '')), ''),
    'brand_mention_mode', p_brand_mention_mode,
    'price_key', v_platform || '_comment_' || v_mode,
    'ai_write_premium', v_ai,
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
      'use_suggested_comment', v_ai,
      'price_key', v_platform || '_comment_' || v_mode,
      'ai_write_premium', v_ai
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
