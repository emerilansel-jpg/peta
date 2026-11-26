-- Facebook Review / Avvo self-service ordering improvements.
-- Client review text is validated server-side before credit deduction and stored
-- in the existing draft table. Avvo/Facebook become standard checkout products.

BEGIN;

UPDATE public.straight_services
SET form_config = form_config || '{"allows_custom_drafts": true, "requires_custom_drafts": true}'::jsonb,
    updated_at = NOW()
WHERE slug = 'facebook_page_review';

UPDATE public.straight_services
SET form_config = form_config || '{"allows_custom_drafts": true, "min_draft_length": 30}'::jsonb,
    updated_at = NOW()
WHERE slug = 'avvo_comment';

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
  v_min_draft_length INT;
  i INT;
  j INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;

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

  SELECT * INTO v_service FROM public.straight_services WHERE slug = lower(btrim(p_service_slug));
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'Service "%" does not exist', p_service_slug USING ERRCODE = 'P0002'; END IF;
  IF NOT v_service.enabled THEN RAISE EXCEPTION 'This service is paused right now. Please check back soon.' USING ERRCODE = 'P0001'; END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < v_service.min_quantity OR v_quantity > v_service.max_quantity THEN
    RAISE EXCEPTION 'Quantity must be between % and % for %', v_service.min_quantity, v_service.max_quantity, v_service.name USING ERRCODE = 'P0001';
  END IF;

  v_min_draft_length := COALESCE(NULLIF((v_service.form_config->>'min_draft_length')::text, '')::int, 10);
  IF (v_service.form_config->>'requires_custom_drafts')::boolean IS TRUE THEN
    IF p_review_drafts IS NULL OR jsonb_typeof(p_review_drafts) <> 'array' OR jsonb_array_length(p_review_drafts) < v_quantity THEN
      RAISE EXCEPTION 'Please provide % unique review texts before checkout.', v_quantity USING ERRCODE = 'P0001';
    END IF;
    FOR i IN 0 .. v_quantity - 1 LOOP
      v_draft_text := NULLIF(btrim(COALESCE(p_review_drafts->i->>'comment_text', '')), '');
      IF v_draft_text IS NULL OR length(v_draft_text) < v_min_draft_length THEN
        RAISE EXCEPTION 'Review text #% must be at least % characters.', i + 1, v_min_draft_length USING ERRCODE = 'P0001';
      END IF;
      FOR j IN 0 .. i - 1 LOOP
        IF lower(regexp_replace(v_draft_text, '\s+', ' ', 'g')) =
           lower(regexp_replace(btrim(COALESCE(p_review_drafts->j->>'comment_text', '')), '\s+', ' ', 'g')) THEN
          RAISE EXCEPTION 'Each review text must be unique. Text #% duplicates an earlier one.', i + 1 USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  v_url := btrim(COALESCE(p_target_url, ''));
  IF (v_service.form_config->>'requires_url')::boolean IS NOT FALSE THEN
    IF length(v_url) < 5 OR public.fn_is_invalid_task_url(v_url) OR v_url !~* COALESCE(v_service.url_pattern, '^https?://[^\\s]+') THEN
      RAISE EXCEPTION 'Please provide a valid direct target URL (search result pages are not allowed).' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_service.slug = 'facebook_page_review'
     AND COALESCE(p_notes, '') !~ '(^|\n)customer_attestation=true(\n|$)' THEN
    RAISE EXCEPTION 'Facebook Page feedback requires genuine-customer attestation.' USING ERRCODE = 'P0001';
  END IF;

  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF (v_service.form_config->>'allows_drip_feed')::boolean IS NOT TRUE OR v_drip_hours < 0 OR v_drip_hours > 168 THEN v_drip_hours := 0; END IF;
  v_cost := v_service.unit_price_cents * v_quantity;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF v_user_balance < v_cost THEN RAISE EXCEPTION 'insufficient_credits'; END IF;

  v_notes := jsonb_build_object(
    'service', v_service.slug,
    'platform', v_service.platform,
    'quantity', v_quantity,
    'target_location', NULLIF(btrim(COALESCE(p_location, '')), ''),
    'review_mode', COALESCE(NULLIF(btrim(p_review_mode), ''), 'brief'),
    'review_brief', NULLIF(btrim(COALESCE(p_review_brief, '')), ''),
    'client_notes', NULLIF(regexp_replace(COALESCE(p_notes, ''), '(^|\n)customer_attestation=true(\n|$)', '\1', 'g'), ''),
    'customer_attestation', v_service.slug = 'facebook_page_review',
    'drip_interval_hours', v_drip_hours
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, target_type, subreddit, thread_url, requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id, v_service.slug, initcap(v_service.platform), v_url, v_quantity, v_cost, v_notes::text, v_drip_hours
  ) RETURNING * INTO v_order;

  IF (v_service.form_config->>'allows_custom_drafts')::boolean IS TRUE
     AND p_review_drafts IS NOT NULL AND jsonb_typeof(p_review_drafts) = 'array' AND jsonb_array_length(p_review_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_review_drafts) - 1 LOOP
      v_draft := p_review_drafts->i;
      v_draft_text := NULLIF(btrim(COALESCE(v_draft->>'comment_text', '')), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text) VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, metadata)
  VALUES (v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
          jsonb_build_object('reddit_upvote_order_id', v_order.id, 'service', v_service.slug, 'quantity', v_quantity, 'request_id', p_request_id));

  RETURN v_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(id uuid, title text, description text, brief text, target_url text, task_type text, task_category text, reward_amount integer, max_assignments integer, current_assignments integer, min_karma integer, min_account_age_days integer, per_account_limit integer, status text, start_at timestamp with time zone, end_at timestamp with time zone, created_at timestamp with time zone, can_do_with_account_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user uuid;
  v_is_admin boolean;
  v_invited boolean;
  v_yt_verified boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND u.is_active = true) THEN
    RETURN;
  END IF;

  v_is_admin := public.is_admin();

  SELECT (
    v_is_admin
    OR EXISTS (SELECT 1 FROM public.reddit_army_profiles rap WHERE rap.user_id = v_user)
    OR COALESCE(u.role, '') IN ('admin', 'army', 'worker')
  ) INTO v_invited
  FROM public.users u
  WHERE u.id = v_user;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  -- 1. ALL NON-REDDIT TASKS
  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND NOT (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND NOT public.fn_is_invalid_task_url(t.target_url)
    AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    AND (COALESCE(t.task_category, '') <> 'youtube_upload' OR v_yt_verified)
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND (
          ta.status IN ('in_progress','submitted','approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    AND (
      COALESCE(t.task_category, '') NOT IN (
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'yelp_review', 'clutch_review', 'facebook_page_review', 'avvo_comment', 'facebook_group_comment'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND ta_dedup.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. REDDIT TASKS ONLY
  IF v_invited THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, ra.id AS can_do_with_account_id
    FROM public.tasks t
    JOIN public.reddit_accounts ra ON ra.user_id = v_user
    WHERE t.status = 'active'
      AND t.is_hidden = false
      AND (COALESCE(t.task_category, '') LIKE 'reddit_%')
      AND COALESCE(t.task_category, '') <> 'reddit_challenge'
      AND NOT public.fn_is_invalid_task_url(t.target_url)
      AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
      AND (v_is_admin OR ra.karma >= COALESCE(t.min_karma, 0))
      AND (v_is_admin OR ra.account_age_days >= COALESCE(t.min_account_age_days, 0))
      AND (v_is_admin OR ra.status_flag NOT IN ('suspended','not_found'))
      AND (
        SELECT count(*)
        FROM public.task_assignments ta
        WHERE ta.task_id = t.id
          AND ta.reddit_account_id = ra.id
          AND ta.status IN ('in_progress','submitted','approved')
      ) < COALESCE(t.per_account_limit, 1)
    ORDER BY t.id, t.created_at DESC;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user(p_user_id uuid)
RETURNS TABLE(id uuid, title text, description text, brief text, target_url text, task_type text, task_category text, reward_amount integer, max_assignments integer, current_assignments integer, min_karma integer, min_account_age_days integer, per_account_limit integer, status text, created_at timestamp with time zone, platform text, eligible_account_count integer, brand_domain text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := p_user_id;
  v_yt_verified boolean := false;
BEGIN
  IF v_user IS NULL THEN v_user := auth.uid(); END IF;
  IF v_user IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    COALESCE(public.forum_platform_label(t.target_url, NULL), 'Forum') AS platform,
    1 AS eligible_account_count,
    NULL::text AS brand_domain
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND NOT (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND NOT public.fn_is_invalid_task_url(t.target_url)
    AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    AND (COALESCE(t.task_category, '') <> 'youtube_upload' OR v_yt_verified)
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND (
          ta.status IN ('claimed', 'submitted', 'approved', 'in_progress')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    AND (
      COALESCE(t.task_category, '') NOT IN (
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'yelp_review', 'clutch_review', 'facebook_page_review', 'avvo_comment', 'facebook_group_comment'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
          AND ta_dedup.status IN ('claimed', 'submitted', 'approved', 'in_progress')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  RETURN QUERY
  SELECT
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    'Reddit'::text AS platform,
    count(ra.id)::int AS eligible_account_count,
    NULL::text AS brand_domain
  FROM public.tasks t
  JOIN public.reddit_accounts ra
    ON ra.user_id = v_user
   AND ra.status = 'active'
   AND ra.is_active = true
   AND ra.karma >= COALESCE(t.min_karma, 0)
   AND ra.account_age_days >= COALESCE(t.min_account_age_days, 0)
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND COALESCE(t.task_category, '') <> 'reddit_challenge'
    AND NOT public.fn_is_invalid_task_url(t.target_url)
    AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND NOT EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.reddit_account_id = ra.id
        AND (
          ta.status IN ('claimed', 'submitted', 'approved', 'in_progress')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    )
  GROUP BY t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
           t.task_category, t.reward_amount, t.max_assignments,
           t.current_assignments, t.min_karma, t.min_account_age_days,
           t.per_account_limit, t.status, t.created_at
  HAVING count(ra.id) > 0
  ORDER BY t.created_at DESC;
END;
$function$;

COMMIT;
NOTIFY pgrst, 'reload schema';
