-- ============================================================
-- Migration: 20261110020000_straight_client_broken_url_resubmit.sql
--
-- Client-facing broken/410/search/closed URL alerting, self-service
-- URL replacement (resubmit), and penalty-free 100% credit refund
-- bypassing the 6-hour cancel window when an order's task URL is broken.
-- ============================================================

-- 1. Client order URL health reader
CREATE OR REPLACE FUNCTION public.fn_get_client_orders_health(p_order_id bigint DEFAULT NULL)
RETURNS TABLE(
  order_id bigint,
  task_status text,
  url_status text,
  url_check_error text,
  locked_active_units bigint,
  is_broken_url boolean,
  can_update_url boolean,
  can_refund_broken boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id::bigint AS order_id,
    t.status::text AS task_status,
    COALESCE(
      t.url_status,
      CASE WHEN COALESCE(t.task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(o.thread_url) THEN 'search_page' ELSE NULL END
    )::text AS url_status,
    COALESCE(
      t.url_check_error,
      CASE WHEN COALESCE(t.task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(o.thread_url) THEN 'Target URL is a search page rather than a direct discussion thread.' ELSE NULL END
    )::text AS url_check_error,
    COALESCE((
      SELECT COUNT(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.status IN ('in_progress', 'submitted')
    ), 0)::bigint AS locked_active_units,
    (
      COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
      OR (COALESCE(t.task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(o.thread_url))
    ) AS is_broken_url,
    (
      (
        COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
        OR (COALESCE(t.task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(o.thread_url))
      )
      AND o.status IN ('pending', 'processing', 'paused')
      AND COALESCE(o.delivered_upvotes, 0) < COALESCE(o.requested_upvotes, 1)
      AND o.screening_id IS NULL
      AND COALESCE((
        SELECT COUNT(*)
        FROM public.task_assignments ta
        WHERE ta.task_id = t.id
          AND ta.status IN ('in_progress', 'submitted')
      ), 0) = 0
    ) AS can_update_url,
    (
      (
        COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
        OR (COALESCE(t.task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(o.thread_url))
      )
      AND o.status IN ('pending', 'processing', 'paused')
      AND COALESCE(o.delivered_upvotes, 0) < COALESCE(o.requested_upvotes, 1)
      AND COALESCE((
        SELECT COUNT(*)
        FROM public.task_assignments ta
        WHERE ta.task_id = t.id
          AND ta.status IN ('in_progress', 'submitted')
      ), 0) = 0
    ) AS can_refund_broken
  FROM public.reddit_upvote_orders o
  LEFT JOIN public.tasks t ON t.source_order_id = o.id
  WHERE (v_is_admin OR o.user_id = v_uid)
    AND (p_order_id IS NULL OR o.id = p_order_id)
  ORDER BY o.id DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_client_orders_health(bigint) TO authenticated;

-- 2. Client self-service URL update & resubmit for broken/410/search/closed orders
CREATE OR REPLACE FUNCTION public.fn_client_update_broken_order_url(
  p_order_id bigint,
  p_new_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_order public.reddit_upvote_orders;
  v_task public.tasks;
  v_service public.straight_services;
  v_notes jsonb := '{}'::jsonb;
  v_new_url text := btrim(COALESCE(p_new_url, ''));
  v_locked_active int := 0;
  v_is_broken boolean := false;
  v_old_is_reddit boolean := false;
  v_new_is_reddit boolean := false;
  v_platform text;
  v_brand text;
  v_comment_text text;
  v_mention_mode text;
  v_service_slug text;
  v_domain text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_admin AND v_order.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status NOT IN ('pending', 'processing', 'paused') THEN
    RAISE EXCEPTION 'Only pending, processing, or paused orders can update their target URL.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_order.delivered_upvotes, 0) >= COALESCE(v_order.requested_upvotes, 1) THEN
    RAISE EXCEPTION 'Order is already fully delivered.' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.screening_id IS NOT NULL THEN
    RAISE EXCEPTION 'Screened Reddit orders cannot edit their URL directly. Please cancel for a full credit refund and place a new order.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE source_order_id = p_order_id
  FOR UPDATE;

  v_is_broken := (
    COALESCE(v_task.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    OR public.fn_is_invalid_task_url(v_order.thread_url)
    OR public.fn_is_invalid_task_url(v_task.target_url)
  );

  IF NOT v_is_broken THEN
    RAISE EXCEPTION 'Only orders flagged with an inaccessible, 410/404, closed, or search-page URL can replace their link directly.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_locked_active
    FROM public.task_assignments ta
    WHERE ta.task_id = v_task.id
      AND ta.status IN ('in_progress', 'submitted');

    IF v_locked_active > 0 THEN
      RAISE EXCEPTION 'This order currently has % pending worker submission(s) under review. Please wait for review or contact support.', v_locked_active USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF public.fn_is_invalid_task_url(v_new_url) THEN
    RAISE EXCEPTION 'Please provide a valid direct target URL. Search pages (Google, Quora, HubSpot, Indie Hackers search) are not allowed.' USING ERRCODE = 'P0001';
  END IF;

  v_old_is_reddit := lower(COALESCE(v_order.thread_url, '')) ~ '^https?://([a-z0-9-]+\.)?reddit\.com([/:?#]|$)';
  v_new_is_reddit := lower(v_new_url) ~ '^https?://([a-z0-9-]+\.)?reddit\.com([/:?#]|$)';

  IF v_new_is_reddit AND NOT v_old_is_reddit THEN
    RAISE EXCEPTION 'Cannot switch a non-Reddit order to a Reddit URL. Please cancel for a credit refund and place a new Reddit order.' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_notes := COALESCE(v_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_service_slug := lower(COALESCE(
    NULLIF(btrim(v_notes->>'service'), ''),
    NULLIF(btrim(v_order.target_type), ''),
    ''
  ));

  IF v_service_slug <> '' THEN
    SELECT * INTO v_service FROM public.straight_services WHERE slug = v_service_slug;
    IF v_service.id IS NOT NULL AND v_service.url_pattern IS NOT NULL AND length(v_service.url_pattern) > 0 THEN
      IF v_new_url !~* v_service.url_pattern THEN
        RAISE EXCEPTION 'Target URL format is invalid for %. Example: %', v_service.name, COALESCE(v_service.url_placeholder, '') USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_platform := CASE
    WHEN v_service_slug = 'forum_comment' OR COALESCE(v_notes->>'service', '') = 'forum_comment'
      THEN public.forum_platform_label(v_new_url, NULL)
    ELSE v_order.subreddit
  END;

  UPDATE public.reddit_upvote_orders
  SET thread_url = v_new_url,
      subreddit = v_platform,
      status = CASE WHEN COALESCE(delivered_upvotes, 0) > 0 THEN 'processing' ELSE 'pending' END,
      updated_at = NOW()
  WHERE id = p_order_id;

  IF v_task.id IS NOT NULL THEN
    v_brand        := COALESCE(NULLIF(btrim(v_notes->>'brand_name'), ''), NULLIF(btrim(v_notes->>'brand_domain'), ''), '');
    v_comment_text := NULLIF(btrim(v_notes->>'comment_text'), '');
    v_mention_mode := COALESCE(NULLIF(btrim(v_notes->>'brand_mention_mode'), ''), 'plain');
    v_domain       := lower((regexp_match(v_new_url, 'https?://(?:www\.)?([^/:?#]+)'))[1]);

    UPDATE public.tasks
    SET target_url = v_new_url,
        title = CASE
          WHEN task_category = 'forum_comment' THEN
            CASE WHEN v_brand <> '' THEN format('Post comment di %s (mention %s)', v_platform, v_brand) ELSE format('Post comment di %s', v_platform) END
          WHEN task_category = 'preferred_source' THEN
            format('Preferred Source: pilih %s di Google', COALESCE(NULLIF(v_domain, ''), 'domain klien'))
          WHEN task_category = 'yelp_review' THEN
            format('Tulis review Yelp bintang 5: %s', COALESCE(NULLIF(v_domain, ''), 'Bisnis Klien'))
          WHEN task_category = 'clutch_review' THEN
            format('Tulis review Clutch B2B bintang 5: %s', COALESCE(NULLIF(v_domain, ''), 'Perusahaan Klien'))
          WHEN task_category = 'quora_upvote' THEN
            format('Quora Upvote: %s', COALESCE(NULLIF(v_domain, ''), 'quora.com'))
          ELSE title
        END,
        description = CASE
          WHEN task_category = 'forum_comment' THEN
            format('Buka thread di %s. Baca konteks diskusi dengan cermat, lalu kirimkan komentar yang sudah disediakan atau relevan dengan brief. Pastikan komentar kamu terbit secara publik sebelum submit bukti.', v_platform)
          ELSE description
        END,
        brief = CASE
          WHEN task_category = 'forum_comment' THEN
            public.forum_comment_task_brief(
              v_new_url,
              v_comment_text,
              v_brand,
              v_mention_mode,
              COALESCE((v_notes->>'is_reply')::boolean, false),
              v_notes->>'reply_to_comment'
            )
          ELSE brief
        END,
        url_status = 'ok',
        url_checked_at = NOW(),
        url_check_error = NULL,
        eligibility_reason = NULL,
        status = 'active',
        is_hidden = false,
        updated_at = NOW()
    WHERE id = v_task.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'new_url', v_new_url,
    'task_id', v_task.id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_client_update_broken_order_url(bigint, text) TO authenticated;

-- 3. Update fn_client_cancel_order: bypass 6h window when order URL is broken/410/closed/search
CREATE OR REPLACE FUNCTION public.fn_client_cancel_order(
  p_order_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_order public.reddit_upvote_orders;
  v_is_admin boolean;
  v_elapsed interval;
  v_is_broken boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
  END IF;

  v_is_admin := public.is_admin();

  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_admin AND v_order.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Order sudah selesai atau sudah dibatalkan.' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.source_order_id = p_order_id
      AND COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
  ) OR public.fn_is_invalid_task_url(v_order.thread_url)
  INTO v_is_broken;

  -- 6 hour cancellation window check for non-admins (bypassed when URL is broken/inaccessible)
  IF NOT v_is_admin AND NOT v_is_broken THEN
    v_elapsed := NOW() - v_order.created_at;
    IF v_elapsed > interval '6 hours' THEN
      RAISE EXCEPTION 'Batas waktu pembatalan otomatis (6 jam) telah berakhir. Hubungi support untuk bantuan.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.reddit_upvote_orders
  SET status = 'cancelled',
      cancel_reason = COALESCE(
        NULLIF(trim(p_reason), ''),
        CASE WHEN v_is_broken THEN 'Cancelled due to inaccessible / 410 / search-page target URL' ELSE 'Client requested cancellation' END
      ),
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'status', 'cancelled',
    'broken_url_bypass', v_is_broken
  );
END;
$function$;

-- 4. Update get_order_cancellation_preview to include is_broken_url & bypass_window
CREATE OR REPLACE FUNCTION public.get_order_cancellation_preview(p_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_order public.reddit_upvote_orders;
  v_locked_active int := 0;
  v_total_committed int := 0;
  v_refundable_units int := 0;
  v_refund_amount int := 0;
  v_is_broken boolean := false;
BEGIN
  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id
    AND (user_id = auth.uid() OR public.is_admin());

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Order not found');
  END IF;

  SELECT
    COUNT(*)
  INTO v_locked_active
  FROM public.tasks t
  JOIN public.task_assignments ta ON ta.task_id = t.id
  WHERE t.source_order_id = v_order.id
    AND ta.status IN ('in_progress', 'submitted');

  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.source_order_id = v_order.id
      AND COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
  ) OR public.fn_is_invalid_task_url(v_order.thread_url)
  INTO v_is_broken;

  v_total_committed := COALESCE(v_order.delivered_upvotes, 0) + v_locked_active;
  v_refundable_units := GREATEST(COALESCE(v_order.requested_upvotes, 1) - v_total_committed, 0);
  v_refund_amount := (v_refundable_units * COALESCE(v_order.cost_credits, 0)) / COALESCE(v_order.requested_upvotes, 1);

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'requested_units', v_order.requested_upvotes,
    'delivered_units', v_order.delivered_upvotes,
    'locked_active_units', v_locked_active,
    'total_committed', v_total_committed,
    'refundable_units', v_refundable_units,
    'refund_amount', v_refund_amount,
    'is_broken_url', v_is_broken,
    'bypass_window', (v_is_broken AND v_refundable_units > 0 AND v_order.status NOT IN ('cancelled', 'completed')),
    'can_cancel', (v_refundable_units > 0 AND v_order.status NOT IN ('cancelled', 'completed'))
  );
END;
$function$;

-- 5. Guard fn_client_resume_order so broken-URL orders cannot re-activate into broken PeTa tasks
CREATE OR REPLACE FUNCTION public.fn_client_resume_order(p_order_id integer)
RETURNS reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_order public.reddit_upvote_orders;
  v_next_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;

  IF v_order.user_id <> v_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND role IN ('admin', 'lead')) THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_order.status <> 'paused' THEN RAISE EXCEPTION 'order is not paused' USING ERRCODE = 'P0001'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.source_order_id = p_order_id
      AND (
        COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
        OR (COALESCE(t.task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(t.target_url))
      )
  ) THEN
    RAISE EXCEPTION 'Target URL is inaccessible (410/404/closed/search page). Please update the URL or cancel for a credit refund.' USING ERRCODE = 'P0001';
  END IF;

  v_next_status := CASE WHEN v_order.delivered_upvotes > 0 THEN 'processing' ELSE 'pending' END;

  UPDATE public.reddit_upvote_orders
  SET status = v_next_status, updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  UPDATE public.tasks
  SET status = 'active', updated_at = NOW()
  WHERE source_order_id = p_order_id
    AND COALESCE(url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url');

  RETURN v_order;
END;
$function$;

-- 6. Send one clear action-required notification per affected client
INSERT INTO public.notifications (user_id, target_role, type, title, body, link, metadata)
SELECT
  o.user_id,
  'user',
  'order_status',
  format('Action required: %s order(s) need link replacement or refund', COUNT(*)),
  'Some target URLs returned 410 Gone, search pages, or closed threads and cannot be fulfilled. Open Orders to replace links or claim an instant full credit refund.',
  '/reddit/orders?filter=needs_action',
  jsonb_build_object(
    'reason', 'broken_url_alert_20261110',
    'affected_orders', COUNT(*)
  )
FROM public.reddit_upvote_orders o
JOIN public.tasks t ON t.source_order_id = o.id
WHERE o.status IN ('pending', 'processing', 'paused')
  AND COALESCE(o.delivered_upvotes, 0) < COALESCE(o.requested_upvotes, 1)
  AND COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = o.user_id
      AND n.metadata->>'reason' = 'broken_url_alert_20261110'
  )
GROUP BY o.user_id;

NOTIFY pgrst, 'reload schema';
