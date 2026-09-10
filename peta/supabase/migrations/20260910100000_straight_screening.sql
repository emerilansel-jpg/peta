-- Persist server screening before charging; existing prices and ledger hooks unchanged.
BEGIN;
-- ponytail: empty server-managed allowlist is the default-off pilot; widen only after staging acceptance.
CREATE TABLE public.contributor_pilot_users (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE
);
ALTER TABLE public.contributor_pilot_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contributor_pilot_users FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.contributor_pilot_enabled(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.contributor_pilot_users WHERE user_id = p_user_id)
$$;
REVOKE ALL ON FUNCTION public.contributor_pilot_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contributor_pilot_enabled(uuid) TO authenticated, service_role;
CREATE TABLE public.straight_order_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  payload jsonb NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass','revise','reject','manual_review')),
  reason text NOT NULL,
  rules_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CHECK (verdict <> 'pass' OR rules_available)
);
ALTER TABLE public.straight_order_screenings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.straight_order_screenings FROM anon, authenticated;
GRANT SELECT ON public.straight_order_screenings TO authenticated;
GRANT ALL ON public.straight_order_screenings TO service_role;
CREATE POLICY screening_read ON public.straight_order_screenings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
ALTER TABLE public.reddit_upvote_orders ADD COLUMN screening_id uuid REFERENCES public.straight_order_screenings(id);

ALTER FUNCTION public.fn_create_forum_comment_order(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text)
  RENAME TO fn_create_forum_comment_order_unchecked;
REVOKE ALL ON FUNCTION public.fn_create_forum_comment_order_unchecked(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_create_forum_comment_order(
  p_target_url text, p_platform text, p_comment_text text, p_use_suggested_comment boolean,
  p_brand_name text, p_brand_domain text, p_brand_mention_mode text, p_source_keyword text,
  p_notes text, p_quantity integer DEFAULT 1, p_comment_drafts jsonb DEFAULT '[]',
  p_is_reply boolean DEFAULT false, p_reply_to text DEFAULT NULL
) RETURNS public.reddit_upvote_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payload jsonb;
  v_screen public.straight_order_screenings;
  v_order public.reddit_upvote_orders;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.contributor_pilot_enabled() OR lower(COALESCE(p_target_url, '')) !~ '^https?://([a-z0-9-]+\.)?reddit\.com([/:?#]|$)' THEN
    RETURN public.fn_create_forum_comment_order_unchecked(p_target_url,p_platform,p_comment_text,
      p_use_suggested_comment,p_brand_name,p_brand_domain,p_brand_mention_mode,p_source_keyword,
      p_notes,p_quantity,p_comment_drafts,p_is_reply,p_reply_to);
  END IF;
  v_payload := jsonb_build_object(
    'target_url', p_target_url, 'platform', p_platform, 'comment_text', p_comment_text,
    'use_suggested_comment', p_use_suggested_comment, 'brand_name', p_brand_name,
    'brand_domain', p_brand_domain, 'brand_mention_mode', p_brand_mention_mode,
    'source_keyword', p_source_keyword, 'notes', p_notes, 'quantity', p_quantity,
    'comment_drafts', p_comment_drafts, 'is_reply', p_is_reply, 'reply_to', p_reply_to);
  SELECT * INTO v_screen FROM public.straight_order_screenings
    WHERE user_id = auth.uid() AND payload = v_payload AND consumed_at IS NULL
      AND created_at > now() - interval '30 minutes' AND verdict IN ('pass','manual_review')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'screening_required: screen this exact order before checkout'; END IF;
  PERFORM set_config('app.straight_screening_id', v_screen.id::text, true);
  v_order := public.fn_create_forum_comment_order_unchecked(p_target_url,p_platform,p_comment_text,
    p_use_suggested_comment,p_brand_name,p_brand_domain,p_brand_mention_mode,p_source_keyword,
    p_notes,p_quantity,p_comment_drafts,p_is_reply,p_reply_to);
  UPDATE public.straight_order_screenings SET consumed_at = now() WHERE id = v_screen.id;
  PERFORM set_config('app.straight_screening_id', '', true);
  RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION public.fn_create_forum_comment_order(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_forum_comment_order(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text) TO authenticated;

-- Preserve atomic checkout; forward reply fields without lossy normalization so
-- the reviewed payload is exactly the one supplied to the single-order boundary.
CREATE OR REPLACE FUNCTION public.fn_create_forum_comment_orders_bulk(p_orders jsonb)
RETURNS SETOF public.reddit_upvote_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'orders payload required'; END IF;
  IF jsonb_array_length(p_orders) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'expected 1 to 50 orders'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    RETURN NEXT public.fn_create_forum_comment_order(
      v_item->>'target_url', v_item->>'platform', v_item->>'comment_text',
      (v_item->>'use_suggested_comment')::boolean, v_item->>'brand_name', v_item->>'brand_domain',
      v_item->>'brand_mention_mode', v_item->>'source_keyword', v_item->>'notes',
      (v_item->>'quantity')::integer, v_item->'comment_drafts',
      (v_item->>'is_reply')::boolean, v_item->>'reply_to');
  END LOOP;
END $$;

-- Snapshot paid obligations, not a timestamp clients could backdate. Never client-writable.
CREATE TABLE public.legacy_paid_vote_orders (
  order_id integer PRIMARY KEY REFERENCES public.reddit_upvote_orders(id)
);
REVOKE ALL ON public.legacy_paid_vote_orders FROM PUBLIC, anon, authenticated;
ALTER TABLE public.legacy_paid_vote_orders ENABLE ROW LEVEL SECURITY;
INSERT INTO public.legacy_paid_vote_orders
SELECT o.id FROM public.reddit_upvote_orders o
WHERE o.target_type = 'upvote' AND o.status IN ('pending', 'processing')
  AND o.cost_credits > 0 AND EXISTS (
    SELECT 1 FROM public.credit_transactions c WHERE c.user_id = o.user_id
      AND c.type = 'spend' AND c.amount = -o.cost_credits
      AND c.metadata->>'reddit_upvote_order_id' = o.id::text
  );

-- Blocks alternate RPC/direct insert bypass; legacy updates and payouts remain intact.
CREATE FUNCTION public.guard_straight_screening() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_screen public.straight_order_screenings;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.target_type = 'upvote' OR NEW.target_type = 'upvote') AND (
      NEW.target_type IS DISTINCT FROM OLD.target_type OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.thread_url IS DISTINCT FROM OLD.thread_url OR NEW.requested_upvotes IS DISTINCT FROM OLD.requested_upvotes
      OR NEW.cost_credits IS DISTINCT FROM OLD.cost_credits OR NEW.notes IS DISTINCT FROM OLD.notes
    ) THEN RAISE EXCEPTION 'legacy_vote_obligation_immutable'; END IF;
    IF NEW.screening_id IS DISTINCT FROM OLD.screening_id THEN RAISE EXCEPTION 'screening_id_server_managed'; END IF;
    IF OLD.screening_id IS NOT NULL AND (
      NEW.screening_id IS DISTINCT FROM OLD.screening_id OR NEW.thread_url IS DISTINCT FROM OLD.thread_url
      OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.target_type IS DISTINCT FROM OLD.target_type
      OR NEW.requested_upvotes IS DISTINCT FROM OLD.requested_upvotes OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.subreddit IS DISTINCT FROM OLD.subreddit
    ) THEN RAISE EXCEPTION 'screened_order_immutable: create a newly screened order'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.target_type = 'upvote' THEN
    RAISE EXCEPTION 'paid_reddit_votes_disabled';
  END IF;
  IF NEW.screening_id IS NOT NULL THEN RAISE EXCEPTION 'screening_id_server_managed'; END IF;
  IF NEW.target_type = 'comment' AND public.contributor_pilot_enabled(NEW.user_id)
     AND lower(COALESCE(NEW.thread_url, '')) ~ '^https?://([a-z0-9-]+\.)?reddit\.com([/:?#]|$)' THEN
    SELECT * INTO v_screen FROM public.straight_order_screenings
      WHERE id = nullif(current_setting('app.straight_screening_id',true),'')::uuid
        AND user_id = auth.uid() AND consumed_at IS NULL
        AND verdict IN ('pass','manual_review') AND created_at > now() - interval '30 minutes';
    IF NOT FOUND THEN RAISE EXCEPTION 'screening_required'; END IF;
    NEW.screening_id := v_screen.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_straight_screening BEFORE INSERT OR UPDATE ON public.reddit_upvote_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_straight_screening();

-- Existing permissive draft policy must not permit replacing screened text.
DROP POLICY IF EXISTS drafts_service_role ON public.reddit_order_comment_drafts;
CREATE POLICY drafts_read ON public.reddit_order_comment_drafts FOR SELECT TO authenticated USING (
  public.is_admin() OR EXISTS (SELECT 1 FROM public.reddit_upvote_orders o WHERE o.id = order_id AND o.user_id = auth.uid())
);
REVOKE INSERT, UPDATE, DELETE ON public.reddit_order_comment_drafts FROM anon, authenticated;
COMMIT;
