-- Migration: 20261012100000_fix_forum_comment_credit_transactions.sql
-- Fix: Record credit spend via public.credit_transactions instead of direct UPDATE on users.credit_balance.
-- Root cause: guard_users_column_protection rejects direct credit_balance updates from non-admin users
-- with 'unauthorized: credit_balance cannot be modified directly' unless a matching credit_transactions
-- row was inserted in the last 1 minute.
-- Every other order service (reddit upvotes, youtube, preferred source, linkedin, trustpilot) inserts into
-- credit_transactions and relies on trg_update_credit_balance. fn_create_forum_comment_order_unchecked
-- was the only function still doing a direct UPDATE, which failed for all non-admin Straight clients.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_forum_comment_order_unchecked(
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
  p_comment_drafts JSONB DEFAULT '[]'::jsonb,
  p_is_reply BOOLEAN DEFAULT false,
  p_reply_to TEXT DEFAULT NULL
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

  -- Normalize p_comment_drafts
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

  v_platform := CASE
    WHEN lower(coalesce(p_platform, '')) LIKE '%reddit%'
      OR lower(coalesce(p_target_url, '')) LIKE '%reddit.com%' THEN 'reddit'
    ELSE 'forum'
  END;
  v_mode := CASE WHEN p_brand_mention_mode = 'link' THEN 'link' ELSE 'plain' END;
  v_ai := coalesce(p_use_suggested_comment, false);

  v_base := public.fn_straight_unit_price(
    v_platform || '_comment_' || v_mode,
    CASE WHEN v_mode = 'link' THEN 550 ELSE 500 END
  );
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
    'draft_count', jsonb_array_length(coalesce(p_comment_drafts, '[]'::jsonb)),
    'is_reply', coalesce(p_is_reply, false),
    'reply_to_comment', nullif(trim(coalesce(p_reply_to, '')), '')
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

  -- Store unique drafts if provided
  IF p_comment_drafts IS NOT NULL AND jsonb_array_length(p_comment_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_comment_drafts) - 1 LOOP
      v_draft := p_comment_drafts->i;
      v_draft_text := NULLIF(trim(v_draft->>'comment_text'), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  -- Deduct credits via credit_transactions ledger.
  -- trg_update_credit_balance will update users.credit_balance to (v_user_balance - v_cost).
  -- guard_users_column_protection will verify this matching credit_transactions row and allow the update.
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
      'ai_write_premium', v_ai,
      'quantity', v_qty
    )
  );

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_forum_comment_order_unchecked(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_forum_comment_order_unchecked(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
