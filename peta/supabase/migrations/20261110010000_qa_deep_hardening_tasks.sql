-- ============================================================
-- Migration: 20261110010000_qa_deep_hardening_tasks.sql
--
-- Deep QA Hardening:
-- 1. Drop stale 1-arg claim_task_assignment(uuid) overload (used obsolete 'claimed' status and bypassed URL guards).
-- 2. Harden retry_rejected_assignment() against paused/invalid/410/closed tasks, preserve draft_comment, and enforce 1h/4h SLA.
-- 3. Filter dead/paused/broken tasks out of get_my_pending_assignments() rejected retry rows.
-- 4. Add fn_is_invalid_task_url() guard inside fn_create_generic_service_order().
-- 5. Tighten straight_services quora_upvote url_pattern (reject quora.com/search) & preferred_source placeholder.
-- 6. Pause the remaining 1/1 active broken tasks (410/closed/search) and disable can_retry on dead tasks' old rejected rows.
-- ============================================================

-- 1. Drop ambiguous stale 1-arg claim_task_assignment(uuid) so 1-arg calls resolve to (p_task_id, p_reddit_account_id DEFAULT NULL)
DROP FUNCTION IF EXISTS public.claim_task_assignment(uuid);

-- 2. Harden get_my_pending_assignments: don't invite members to retry rejected assignments on paused/broken tasks
CREATE OR REPLACE FUNCTION public.get_my_pending_assignments()
RETURNS TABLE(id uuid, task_id uuid, status text, admin_notes text, can_retry boolean, rejection_type text, proof_url text, draft_comment text, created_at timestamp with time zone, updated_at timestamp with time zone, task_title text, task_category text, task_reward integer, task_target_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ta.id,
    ta.task_id,
    ta.status::text,
    ta.admin_notes,
    COALESCE(ta.can_retry, true),
    ta.rejection_type,
    ta.proof_url,
    ta.draft_comment,
    ta.created_at,
    ta.updated_at,
    t.title::text,
    t.task_category::text,
    t.reward_amount,
    t.target_url
  FROM task_assignments ta
  JOIN tasks t ON t.id = ta.task_id
  WHERE ta.user_id = auth.uid()
    AND COALESCE(t.task_category, '') <> 'reddit_challenge'
    AND (
      ta.status IN ('submitted', 'in_progress')
      OR (
        ta.status = 'rejected'
        AND COALESCE(ta.can_retry, false) = true
        AND t.status = 'active'
        AND t.is_hidden = false
        AND NOT public.fn_is_invalid_task_url(t.target_url)
        AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
      )
    )
  ORDER BY ta.updated_at DESC;
END;
$function$;

-- 3. Harden retry_rejected_assignment: block retrying dead/paused tasks, preserve draft_comment, enforce 1h/4h timeout
CREATE OR REPLACE FUNCTION public.retry_rejected_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_assignment record;
  v_task public.tasks;
  v_timeout interval;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
    AND user_id = v_uid
    AND status = 'rejected'
    AND can_retry = true
  FOR UPDATE;

  IF v_assignment IS NULL THEN
    RAISE EXCEPTION 'Assignment ini tidak bisa di-retry.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = v_assignment.task_id FOR UPDATE;
  IF v_task.id IS NULL
     OR v_task.status <> 'active'
     OR v_task.is_hidden = true
     OR (COALESCE(v_task.task_category, '') <> 'reddit_challenge' AND (
       public.fn_is_invalid_task_url(v_task.target_url)
       OR COALESCE(v_task.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
     )) THEN
    UPDATE public.task_assignments
    SET can_retry = false,
        admin_notes = COALESCE(admin_notes, '') || ' [Task sudah ditutup / link bermasalah]',
        updated_at = NOW()
    WHERE id = p_assignment_id;
    RAISE EXCEPTION 'Task ini sudah ditutup atau link-nya bermasalah. Silakan pilih task lain.' USING ERRCODE = 'P0001';
  END IF;

  v_timeout := CASE
    WHEN COALESCE(v_task.task_category, '') = 'youtube_upload' THEN INTERVAL '4 hours'
    ELSE INTERVAL '1 hour'
  END;

  UPDATE public.task_assignments
  SET status = 'in_progress',
      expires_at = NOW() + v_timeout,
      proof_url = NULL,
      proof_image_url = NULL,
      proof_image_hash = NULL,
      submitted_url = NULL,
      submitted_username = NULL,
      user_note = NULL,
      admin_notes = NULL,
      can_retry = false,
      updated_at = NOW()
  WHERE id = p_assignment_id;

  PERFORM public.sync_task_slot_count(v_assignment.task_id);
END;
$function$;

-- 4. Guard fn_create_generic_service_order against search/invalid URLs
CREATE OR REPLACE FUNCTION public.fn_create_generic_service_order(
  p_service_slug text,
  p_target_url text,
  p_quantity integer DEFAULT 1,
  p_location text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_review_mode text DEFAULT 'ai'::text,
  p_review_brief text DEFAULT NULL::text,
  p_review_drafts jsonb DEFAULT NULL::jsonb,
  p_drip_interval_hours integer DEFAULT 0,
  p_request_id text DEFAULT NULL::text
)
RETURNS reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_user_balance INT;
  v_service public.straight_services;
  v_cost INT;
  v_url TEXT;
  v_quantity INT;
  v_drip_hours INT;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_draft JSONB;
  v_draft_text TEXT;
  i INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- 1. Idempotency Check
  IF p_request_id IS NOT NULL AND length(btrim(p_request_id)) > 0 THEN
    SELECT o.* INTO v_order
    FROM public.reddit_upvote_orders o
    JOIN public.credit_transactions ct
      ON ct.metadata->>'reddit_upvote_order_id' = o.id::text
     AND ct.metadata->>'request_id' = btrim(p_request_id)
    WHERE o.user_id = v_user_id AND o.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY o.id DESC LIMIT 1;
    IF v_order.id IS NOT NULL THEN RETURN v_order; END IF;
  END IF;

  -- 2. Fetch service catalog row
  SELECT * INTO v_service
  FROM public.straight_services
  WHERE slug = lower(btrim(p_service_slug));

  IF v_service.id IS NULL THEN
    RAISE EXCEPTION 'Service "%" does not exist', p_service_slug USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_service.enabled THEN
    RAISE EXCEPTION 'This service is paused right now. Please check back soon.' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Quantity check
  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < v_service.min_quantity OR v_quantity > v_service.max_quantity THEN
    RAISE EXCEPTION 'Quantity must be between % and % for %', v_service.min_quantity, v_service.max_quantity, v_service.name USING ERRCODE = 'P0001';
  END IF;

  -- 4. Target URL validation + anti-search-page guard
  v_url := btrim(COALESCE(p_target_url, ''));
  IF (v_service.form_config->>'requires_url')::boolean IS NOT FALSE THEN
    IF length(v_url) < 5 OR public.fn_is_invalid_task_url(v_url) THEN
      RAISE EXCEPTION 'Please provide a valid direct target URL (search result pages are not allowed).' USING ERRCODE = 'P0001';
    END IF;
    IF v_service.url_pattern IS NOT NULL AND length(v_service.url_pattern) > 0 THEN
      IF v_url !~* v_service.url_pattern THEN
        RAISE EXCEPTION 'Target URL format is invalid for %. Example: %', v_service.name, COALESCE(v_service.url_placeholder, '') USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- 5. Drip feed check
  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF (v_service.form_config->>'allows_drip_feed')::boolean IS NOT TRUE THEN
    v_drip_hours := 0;
  END IF;
  IF v_drip_hours < 0 OR v_drip_hours > 168 THEN v_drip_hours := 0; END IF;

  -- 6. Cost calculation & credit lock
  v_cost := v_service.unit_price_cents * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users WHERE id = v_user_id FOR UPDATE;

  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits: You need % cents but only have %', v_cost, v_user_balance USING ERRCODE = 'P0001';
  END IF;

  -- 7. Build standardized metadata JSON
  v_notes := jsonb_build_object(
    'service', v_service.slug,
    'platform', v_service.platform,
    'quantity', v_quantity,
    'target_location', NULLIF(btrim(COALESCE(p_location, '')), ''),
    'review_mode', COALESCE(NULLIF(btrim(p_review_mode), ''), 'ai'),
    'review_brief', NULLIF(btrim(COALESCE(p_review_brief, '')), ''),
    'client_notes', NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'drip_interval_hours', v_drip_hours
  );

  -- 8. Insert Order (Triggers fn_ensure_order_task automatically)
  INSERT INTO public.reddit_upvote_orders (
    user_id, target_type, subreddit, thread_url, requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id,
    v_service.slug,
    initcap(v_service.platform),
    v_url,
    v_quantity, v_cost, v_notes::text, v_drip_hours
  ) RETURNING * INTO v_order;

  -- 9. Store Custom Drafts if provided
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

  -- 10. Deduct Credits
  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, metadata)
  VALUES (
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', v_service.slug,
      'quantity', v_quantity,
      'drip_interval_hours', v_drip_hours,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END;
$function$;

-- 5. Tighten straight_services quora_upvote pattern & preferred_source placeholder
UPDATE public.straight_services
SET url_pattern = '^https?://(?:[a-z0-9-]+\.)*quora\.com/(?!search(?:[/?#]|$))[^\s]+'
WHERE slug = 'quora_upvote';

UPDATE public.straight_services
SET url_placeholder = 'https://yourdomain.com/article'
WHERE slug = 'preferred_source';

-- 6. Pause remaining active tasks with broken url_status (even 1/1 pending approval) so they never reopen
UPDATE public.tasks
SET status = 'paused',
    updated_at = now()
WHERE status = 'active'
  AND COALESCE(task_category, '') <> 'reddit_challenge'
  AND (
    public.fn_is_invalid_task_url(target_url)
    OR COALESCE(url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
  );

-- Disable can_retry on old rejected assignments attached to broken/paused tasks
UPDATE public.task_assignments ta
SET can_retry = false,
    updated_at = now()
FROM public.tasks t
WHERE ta.task_id = t.id
  AND ta.status = 'rejected'
  AND ta.can_retry = true
  AND (
    t.status <> 'active'
    OR (COALESCE(t.task_category, '') <> 'reddit_challenge' AND (
      public.fn_is_invalid_task_url(t.target_url)
      OR COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    ))
  );

NOTIFY pgrst, 'reload schema';
