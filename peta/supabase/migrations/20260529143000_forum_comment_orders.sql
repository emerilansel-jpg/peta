-- Straight Ltd: forum comment orders.
-- Stores comment-specific inputs in notes JSON text while reusing the existing
-- reddit_upvote_orders ledger/order table and credit transaction flow.

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

  -- Standard comment = $5. Suggested-comment assistant = 10% more.
  v_cost := CASE WHEN coalesce(p_use_suggested_comment, false) THEN 550 ELSE 500 END;

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
      'use_suggested_comment', coalesce(p_use_suggested_comment, false)
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
