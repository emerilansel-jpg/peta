-- =============================================================
-- Straight Ltd — forum comment bulk orders with unique AI drafts.
--
-- Adds quantity support to forum comment orders so a client can order
-- N comments on one thread. Each slot gets a unique AI-generated draft
-- stored in reddit_order_comment_drafts and assigned to one army member
-- at claim time. This prevents armies from posting identical comments.
--
-- Also fixes the Ranking Forum bulk flow: previously one generated draft
-- was reused for every selected URL. Now each URL gets its own draft.
-- =============================================================

-- 1) Drafts table: one row per unique comment slot for a forum comment order.
CREATE TABLE IF NOT EXISTS public.reddit_order_comment_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL REFERENCES public.reddit_upvote_orders(id) ON DELETE CASCADE,
  draft_index integer NOT NULL,
  comment_text text NOT NULL,
  assignment_id uuid REFERENCES public.task_assignments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, draft_index)
);

COMMENT ON TABLE public.reddit_order_comment_drafts IS
  'Unique AI-generated comment drafts for forum comment orders. One row per slot.';

-- RLS: only service role / admin should read drafts; assignments claim path uses RPC.
ALTER TABLE public.reddit_order_comment_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drafts_service_role" ON public.reddit_order_comment_drafts;
CREATE POLICY "drafts_service_role" ON public.reddit_order_comment_drafts
  FOR ALL USING (true) WITH CHECK (true);

-- 2) Recreate forum comment order RPC with quantity and draft array support.
-- Drop the old 9-param overload so PostgREST never routes to it.
DROP FUNCTION IF EXISTS public.fn_create_forum_comment_order(text, text, text, boolean, text, text, text, text, text);

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

-- 3) Claim: assign one unique draft to the army member for forum_comment tasks.
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task record;
  v_account record;
  v_assignment public.task_assignments;
  v_live int;
  v_draft record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.status <> 'active'
    OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
    OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_task.task_category, '') = 'forum_comment' THEN
    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
    VALUES (p_task_id, v_uid, NULL, 'in_progress')
    RETURNING * INTO v_assignment;

    -- Assign the next unused unique draft for this source order.
    SELECT d.id, d.comment_text
    INTO v_draft
    FROM public.reddit_order_comment_drafts d
    WHERE d.order_id = v_task.source_order_id
      AND d.assignment_id IS NULL
    ORDER BY d.draft_index
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_draft.id IS NOT NULL THEN
      UPDATE public.task_assignments
      SET draft_comment = v_draft.comment_text
      WHERE id = v_assignment.id;

      UPDATE public.reddit_order_comment_drafts
      SET assignment_id = v_assignment.id
      WHERE id = v_draft.id;

      v_assignment.draft_comment := v_draft.comment_text;
    END IF;
  ELSE
    SELECT *
    INTO v_account
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id
      AND user_id = v_uid;

    IF v_account.id IS NULL THEN
      RAISE EXCEPTION 'Pilih akun Reddit yang valid.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.is_admin() THEN
      IF v_account.karma < COALESCE(v_task.min_karma, 0)
        OR v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0)
        OR v_account.status_flag IN ('suspended','not_found') THEN
        RAISE EXCEPTION 'Akun ini belum eligible untuk task ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress')
    RETURNING * INTO v_assignment;
  END IF;

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_task_assignment(uuid, uuid) TO authenticated;
