-- Avvo VPN/English-name SOP and Yelp business-name-first ordering.
-- Historical Yelp orders, status, refunds, and service enabled state are untouched.

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

  -- New Yelp orders use a full business name, not a direct review link.
  IF v_service.slug = 'yelp_review' THEN
    IF NULLIF(btrim(COALESCE(p_location, '')), '') IS NOT NULL THEN
      v_url := btrim(p_location);
    END IF;
    IF length(v_url) < 3 OR v_url ~* '^https?://' THEN
      RAISE EXCEPTION 'Yelp orders require the full business name, not a direct review link.' USING ERRCODE = 'P0001';
    END IF;
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
    'business_name', CASE WHEN v_service.slug = 'yelp_review' THEN NULLIF(btrim(v_url), '') ELSE NULL END,
    'review_mode', COALESCE(NULLIF(btrim(p_review_mode), ''), 'brief'),
    'review_brief', NULLIF(btrim(COALESCE(p_review_brief, '')), ''),
    'client_notes', NULLIF(CONCAT_WS(' · ', NULLIF(regexp_replace(COALESCE(p_notes, ''), '(^|
)customer_attestation=true(
|$)', '', 'g'), ''), CASE WHEN v_service.slug = 'yelp_review' THEN CONCAT('Nama bisnis: ', NULLIF(btrim(v_url), '')) ELSE NULL END), ''),
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

UPDATE public.straight_services
SET form_config = form_config || '{"url_label": "Nama Bisnis Yelp", "url_helper": "Masukkan nama bisnis lengkap. Worker akan mencari bisnis tersebut di Yelp terlebih dahulu, bukan membuka link langsung.", "requires_business_name": true}'::jsonb,
    url_placeholder = 'Nama bisnis lengkap di Yelp, misal: Example Lawn Care - Jakarta',
    worker_sop = 'Cari nama bisnis di Yelp terlebih dahulu. Buka profil bisnis dari hasil pencarian, bukan link langsung. Wajib VPN US/UK (Windscribe), akun Yelp bernama Bule/English dengan foto avatar. Tulis review jujur Bahasa Inggris minimal 3 kalimat, jangan diarahkan ke rating tertentu. Upload screenshot review publik.',
    updated_at = NOW()
WHERE slug = 'yelp_review';

UPDATE public.straight_services
SET worker_sop = 'Wajib aktifkan Windscribe VPN sebelum membuka Avvo. Gunakan akun Avvo dengan nama Bule / English. Baca pertanyaan, tulis respons informatif dan hati-hati, jangan mengaku pengacara atau memberi kepastian hukum. Upload screenshot respons publik dan URL-nya.',
    updated_at = NOW()
WHERE slug = 'avvo_comment';


CREATE OR REPLACE FUNCTION public.tg_enforce_avvo_yelp_submission_sop()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_category text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'submitted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN RETURN NEW; END IF;
  SELECT task_category INTO v_category FROM public.tasks WHERE id = NEW.task_id;
  IF v_category = 'avvo_comment'
     AND (COALESCE(NEW.user_note, '') NOT LIKE '%[VPN-WINDSCRIBE]%'
          OR COALESCE(NEW.user_note, '') NOT LIKE '%[BULE-ACCOUNT]%') THEN
    RAISE EXCEPTION 'Avvo submissions require Windscribe VPN and English-name confirmations.' USING ERRCODE = 'P0001';
  END IF;
  IF v_category = 'yelp_review'
     AND (COALESCE(NEW.user_note, '') NOT LIKE '%[VPN-ACTIVE]%'
          OR COALESCE(NEW.user_note, '') NOT LIKE '%[SEARCH-FIRST]%'
          OR COALESCE(NEW.user_note, '') NOT LIKE '%[BULE-ACCOUNT]%') THEN
    RAISE EXCEPTION 'Yelp submissions require VPN, search-first, and English-name confirmations.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_enforce_avvo_yelp_submission_sop ON public.task_assignments;
CREATE TRIGGER tg_enforce_avvo_yelp_submission_sop
  BEFORE INSERT OR UPDATE OF status, user_note ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_avvo_yelp_submission_sop();

COMMIT;
NOTIFY pgrst, 'reload schema';
