-- Straight Ltd: atomic bulk forum comment ordering.
-- A batch is one database transaction: if any item fails validation or
-- the balance check, every order and every spend is rolled back.

CREATE OR REPLACE FUNCTION public.fn_create_forum_comment_orders_bulk(
  p_orders JSONB
)
RETURNS SETOF public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_item JSONB;
  v_order public.reddit_upvote_orders;
  v_count INTEGER;
  i INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RAISE EXCEPTION 'orders payload required';
  END IF;

  v_count := jsonb_array_length(p_orders);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'orders payload required';
  END IF;
  IF v_count > 50 THEN
    RAISE EXCEPTION 'max 50 orders per batch';
  END IF;

  FOR i IN 0 .. v_count - 1 LOOP
    v_item := p_orders->i;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'invalid order payload';
    END IF;

    -- The existing single-order RPC locks the user row and deducts credit.
    -- Calling it inside this function makes the whole batch atomic.
    v_order := public.fn_create_forum_comment_order(
      COALESCE(v_item->>'target_url', ''),
      NULLIF(trim(COALESCE(v_item->>'platform', '')), ''),
      COALESCE(v_item->>'comment_text', ''),
      COALESCE(NULLIF(v_item->>'use_suggested_comment', '')::boolean, false),
      NULLIF(trim(COALESCE(v_item->>'brand_name', '')), ''),
      NULLIF(trim(COALESCE(v_item->>'brand_domain', '')), ''),
      NULLIF(trim(COALESCE(v_item->>'brand_mention_mode', '')), ''),
      NULLIF(trim(COALESCE(v_item->>'source_keyword', '')), ''),
      NULLIF(trim(COALESCE(v_item->>'notes', '')), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::integer, 1),
      COALESCE(v_item->'comment_drafts', '[]'::jsonb)
    );

    RETURN NEXT v_order;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_forum_comment_orders_bulk(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_forum_comment_orders_bulk(JSONB) TO authenticated;
