-- =============================================================
-- Straight Ltd — tolerate scalar JSON-encoded p_comment_drafts.
--
-- Some clients (older/cached builds) send p_comment_drafts as a
-- JSON string scalar like '[{"comment_text":"..."}]' instead of a
-- native JSON array. The previous function called jsonb_array_length
-- directly and failed with:
--   "cannot get array length of a scalar" (22023)
--
-- This migration normalizes the input: parse string scalars, wrap
-- single objects, and fall back to an empty array for anything else.
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
  p_notes TEXT,
  p_quantity INTEGER DEFAULT 1,
  p_comment_drafts JSONB DEFAULT '[]'::jsonb
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
  v_qty INTEGER;
  v_draft JSONB;
  v_draft_text TEXT;
  i INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_target_url IS NULL OR length(trim(p_target_url)) < 8 THEN RAISE EXCEPTION 'target_url required'; END IF;
  IF p_comment_text IS NULL OR length(trim(p_comment_text)) < 20 THEN RAISE EXCEPTION 'comment_text too short'; END IF;
  IF p_brand_mention_mode IS NOT NULL AND p_brand_mention_mode NOT IN ('plain', 'link') THEN
    RAISE EXCEPTION 'invalid brand mention mode';
  END IF;

  v_qty := GREATEST(1, LEAST(COALESCE(p_quantity, 1), 500));

  -- Normalize p_comment_drafts: some clients send a JSON-encoded string scalar
  -- instead of a JSON array. Wrap single objects and fall back to empty array.
  IF p_comment_drafts IS NOT NULL AND jsonb_typeof(p_comment_drafts) = 'string' THEN
    BEGIN
      p_comment_drafts := COALESCE((p_comment_drafts #>> '{}')::jsonb, '[]'::jsonb);
    EXCEPTION WHEN others THEN
      p_comment_drafts := '[]'::jsonb;
    END;
  END IF;
  IF jsonb_typeof(COALESCE(p_comment_drafts, '[]'::jsonb)) <> 'array' THEN
    p_comment_drafts := CASE
      WHEN jsonb_typeof(p_comment_drafts) = 'object' THEN jsonb_build_array(p_comment_drafts)
      ELSE '[]'::jsonb
    END;
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
  v_cost := v_qty * CASE WHEN v_ai THEN round(v_base * 1.10) ELSE v_base END;

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
    'client_notes', nullif(trim(coalesce(p_notes, '')), ''),
    'quantity', v_qty,
    'draft_count', jsonb_array_length(coalesce(p_comment_drafts, '[]'::jsonb))
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    trim(p_target_url),
    nullif(trim(coalesce(p_platform, '')), ''),
    'comment',
    v_qty,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  -- Store unique drafts if provided (AI-suggested quantity > 1 or bulk per-URL).
  IF p_comment_drafts IS NOT NULL AND jsonb_array_length(p_comment_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_comment_drafts) - 1 LOOP
      v_draft := p_comment_drafts->i;
      v_draft_text := NULLIF(trim(v_draft->>'comment_text'), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i + 1, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'forum_comment',
      'use_suggested_comment', v_ai,
      'price_key', v_platform || '_comment_' || v_mode,
      'ai_write_premium', v_ai,
      'quantity', v_qty
    )
  );

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_forum_comment_order(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_forum_comment_order(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB
) TO authenticated;
