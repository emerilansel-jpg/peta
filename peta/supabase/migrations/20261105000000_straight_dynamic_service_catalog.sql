-- ============================================================
-- Migration: 20261105000000_straight_dynamic_service_catalog.sql
--
-- Implements Phase 1 of the Dynamic Service Architecture:
-- 1. Creates public.straight_services table (single source of truth).
-- 2. Seeds all existing active services with pricing, SOPs, and form configs.
-- 3. Drops restrictive CHECK constraints on tasks.task_category & reddit_upvote_orders.target_type.
-- 4. Universal order RPC: fn_create_generic_service_order
-- 5. Admin CRUD RPCs: admin_upsert_straight_service, admin_toggle_straight_service, admin_delete_straight_service
-- 6. Generic task minting trigger: fn_ensure_order_task
-- 7. Live proofs RPC for clients: fn_get_order_delivery_proofs
-- ============================================================

BEGIN;

-- 1. Create straight_services table
CREATE TABLE IF NOT EXISTS public.straight_services (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  badge_text TEXT DEFAULT NULL,
  platform TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'review', -- 'review' | 'comment' | 'upvote' | 'social' | 'video'
  task_type TEXT NOT NULL DEFAULT 'comment', -- 'comment' | 'upvote' | 'upload'
  unit_price_cents INT NOT NULL CHECK (unit_price_cents >= 0),
  worker_reward_idr INT NOT NULL CHECK (worker_reward_idr >= 0),
  min_quantity INT NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  max_quantity INT NOT NULL DEFAULT 100 CHECK (max_quantity >= min_quantity),
  url_pattern TEXT DEFAULT NULL,
  url_placeholder TEXT DEFAULT NULL,
  form_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  worker_sop TEXT NOT NULL DEFAULT '',
  worker_brief_template TEXT DEFAULT NULL,
  icon TEXT NOT NULL DEFAULT 'Star',
  theme_color TEXT NOT NULL DEFAULT 'emerald',
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: Public read, Admin write
ALTER TABLE public.straight_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS straight_services_read ON public.straight_services;
CREATE POLICY straight_services_read ON public.straight_services
  FOR SELECT TO anon, authenticated USING (true);

-- 2. Drop legacy CHECK constraints that blocked dynamic services
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_category_check;

ALTER TABLE public.reddit_upvote_orders
  DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;

-- 3. Seed initial services (idempotent ON CONFLICT (slug) DO UPDATE)
INSERT INTO public.straight_services (
  slug, name, badge_text, platform, category, task_type,
  unit_price_cents, worker_reward_idr, min_quantity, max_quantity,
  url_pattern, url_placeholder, form_config,
  worker_sop, worker_brief_template, icon, theme_color, enabled, sort_order
) VALUES
(
  'google_maps_review', 'Google Maps Reviews', 'Anti-Drop Pacing', 'google', 'review', 'comment',
  500, 5000, 1, 20,
  '^https?://(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|goo\.gl)/[^\s]+',
  'https://maps.google.com/?cid=...',
  '{"requires_url": true, "url_label": "Google Maps Place URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 20, "allows_location": true, "allows_drip_feed": true, "default_drip_hours": 24}'::jsonb,
  'Buka link Google Maps bisnis klien. Berikan rating bintang 5 dan tulis ulasan otentik minimal 2-3 kalimat yang menceritakan pengalaman positif. Upload screenshot bukti ulasan publik yang sudah terbit.',
  'Tulis ulasan bintang 5 positif yang mencerminkan pengalaman bagus terhadap pelayanan bisnis ini.',
  'MapPin', 'emerald', true, 1
),
(
  'google_maps_review_targeted', 'Google Maps (Location Targeted)', 'Targeted City/State', 'google', 'review', 'comment',
  600, 6000, 1, 20,
  '^https?://(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|goo\.gl)/[^\s]+',
  'https://maps.google.com/?cid=...',
  '{"requires_url": true, "url_label": "Google Maps Place URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 20, "allows_location": true, "requires_location": true, "allows_drip_feed": true, "default_drip_hours": 24}'::jsonb,
  'Buka link Google Maps bisnis klien. Pastikan akun Google kamu aktif dan berada di/sekitar lokasi yang ditentukan. Tulis ulasan bintang 5 yang jujur dan relevan minimal 2-3 kalimat. Upload screenshot bukti ulasan publik yang sudah terbit.',
  'Tulis ulasan bintang 5 yang relevan dengan lokasi bisnis.',
  'MapPin', 'emerald', true, 2
),
(
  'yelp_review', 'Yelp Business Reviews', 'Western Accounts', 'yelp', 'review', 'comment',
  500, 5000, 1, 20,
  '^https?://(?:[a-z0-9-]+\.)*(?:yelp\.[a-z.]+|yelp\.to)/[^\s]+',
  'https://www.yelp.com/biz/...',
  '{"requires_url": true, "url_label": "Yelp Business Page URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 10, "allows_location": false, "allows_drip_feed": true, "default_drip_hours": 24}'::jsonb,
  'Wajib aktifkan VPN US/UK sebelum klik link. Buka halaman bisnis Yelp klien, berikan rating bintang 5, dan tulis review otentik dalam Bahasa Inggris minimal 3-4 kalimat. Akun Yelp wajib nama Western dan memiliki avatar. Upload screenshot bukti review publik terbit.',
  'Tulis ulasan bintang 5 dalam Bahasa Inggris tentang kepuasan menggunakan jasa klien.',
  'Star', 'red', true, 3
),
(
  'clutch_review', 'Clutch.co B2B Reviews', 'Verified B2B Profile', 'clutch', 'review', 'comment',
  500, 5000, 1, 20,
  '^https?://(?:[a-z0-9-]+\.)*(?:clutch\.co|review\.clutch\.co)/[^\s]+',
  'https://clutch.co/profile/...',
  '{"requires_url": true, "url_label": "Clutch Company Profile URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 30, "allows_location": false, "allows_drip_feed": true, "default_drip_hours": 24}'::jsonb,
  'Wajib login LinkedIn/Google profesional. Buka formulir review Clutch.co profil klien. Isi kuesioner review lengkap bintang 5 dalam Bahasa Inggris. Upload screenshot bukti form ulasan berhasil disubmit.',
  'Tulis ulasan B2B bintang 5 komprehensif dalam Bahasa Inggris mencakup background, project solution, dan outcome.',
  'Star', 'indigo', true, 4
),
(
  'trustpilot_review', 'Trustpilot Reviews', 'Verified Ratings', 'trustpilot', 'review', 'comment',
  500, 5000, 1, 20,
  '^https?://(?:[a-z0-9-]+\.)*trustpilot\.com/review/[^\s]+',
  'https://www.trustpilot.com/review/...',
  '{"requires_url": true, "url_label": "Trustpilot Business URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 15, "allows_location": false, "allows_drip_feed": true, "default_drip_hours": 24}'::jsonb,
  'Wajib aktifkan VPN US/UK sebelum membuka link. Buka halaman Trustpilot klien, berikan rating bintang 5, dan tulis review otentik dalam Bahasa Inggris minimal 3 kalimat. Akun wajib nama Western. Upload screenshot bukti ulasan publik terbit.',
  'Tulis ulasan bintang 5 pengalaman berbelanja/berlangganan di website klien.',
  'Star', 'emerald', true, 5
),
(
  'quora_upvote', 'Quora Upvotes', 'High Authority', 'quora', 'upvote', 'upvote',
  20, 1000, 5, 100,
  '^https?://(?:[a-z0-9-]+\.)*quora\.com/[^\s]+',
  'https://www.quora.com/What-is-.../answer/...',
  '{"requires_url": true, "url_label": "Quora Answer URL", "allows_brief": false, "allows_custom_drafts": false, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Buka jawaban Quora pada tautan berikut, lalu klik tombol Upvote (panah atas). Upload screenshot bukti upvote aktif.',
  NULL,
  'TrendingUp', 'red', true, 6
),
(
  'forum_comment', 'Forum & Discussion Comments', 'Contextual Placement', 'forum', 'comment', 'comment',
  500, 3000, 1, 20,
  '^https?://[^\s]+',
  'https://...',
  '{"requires_url": true, "url_label": "Discussion Thread URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 15, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Buka thread forum. Baca konteks diskusi dengan cermat, lalu kirimkan komentar yang relevan dengan brief. Pastikan komentar kamu terbit secara publik sebelum submit bukti.',
  'Tulis komentar natural yang bernilai tambah pada forum diskusi ini.',
  'MessageSquare', 'blue', true, 7
),
(
  'reddit_upvote', 'Reddit Upvotes', 'Real Karma Accounts', 'reddit', 'upvote', 'upvote',
  50, 500, 5, 200,
  '^https?://(?:[a-z0-9-]+\.)*reddit\.com/[^\s]+',
  'https://www.reddit.com/r/.../comments/...',
  '{"requires_url": true, "url_label": "Reddit Post/Comment URL", "allows_brief": false, "allows_custom_drafts": false, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Buka postingan Reddit berikut dan berikan upvote menggunakan akun Reddit kamu yang aktif. Upload screenshot bukti upvote.',
  NULL,
  'ArrowUp', 'orange', true, 8
),
(
  'youtube_upload', 'YouTube Video Upload', 'High Retention', 'youtube', 'video', 'upload',
  1000, 10000, 1, 5,
  '^https?://[^\s]+',
  'https://drive.google.com/.../video.mp4',
  '{"requires_url": true, "url_label": "Video Source Download URL", "allows_brief": true, "allows_custom_drafts": false, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Download video dari link yang disediakan, lalu upload ke channel YouTube aktif kamu sesuai instruksi tugas ini.',
  NULL,
  'Youtube', 'red', true, 9
),
(
  'preferred_source', 'Google Preferred Source', 'SEO Authority', 'google', 'upvote', 'upvote',
  250, 2500, 5, 50,
  '^https?://[^\s]+',
  'https://www.google.com/search?q=...',
  '{"requires_url": true, "url_label": "Topic / Search URL", "allows_brief": false, "allows_custom_drafts": false, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Klik tombol "Jadikan Sumber Pilihan" pada halaman profil topik Google yang terbuka. Upload screenshot bukti.',
  NULL,
  'Bookmark', 'blue', true, 10
),
(
  'linkedin_like', 'LinkedIn Post Like', 'Real Network', 'linkedin', 'social', 'upvote',
  100, 1000, 5, 50,
  '^https?://(?:[a-z0-9-]+\.)*linkedin\.com/[^\s]+',
  'https://www.linkedin.com/feed/update/...',
  '{"requires_url": true, "url_label": "LinkedIn Post URL", "allows_brief": false, "allows_custom_drafts": false, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Buka tautan postingan LinkedIn berikut menggunakan akun LinkedIn aktif kamu. Berikan Like pada postingan tersebut. Upload screenshot sebagai bukti.',
  NULL,
  'ThumbsUp', 'blue', true, 11
),
(
  'linkedin_follow', 'LinkedIn Page Follow', 'Organic Followers', 'linkedin', 'social', 'upvote',
  150, 1500, 5, 50,
  '^https?://(?:[a-z0-9-]+\.)*linkedin\.com/company/[^\s]+',
  'https://www.linkedin.com/company/...',
  '{"requires_url": true, "url_label": "LinkedIn Company URL", "allows_brief": false, "allows_custom_drafts": false, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Buka tautan halaman LinkedIn Company Page berikut. Klik tombol Follow untuk mengikuti halaman perusahaan. Upload screenshot sebagai bukti.',
  NULL,
  'Building', 'blue', true, 12
),
(
  'linkedin_comment', 'LinkedIn Post Comment', 'Professional Tone', 'linkedin', 'comment', 'comment',
  300, 3000, 1, 10,
  '^https?://(?:[a-z0-9-]+\.)*linkedin\.com/[^\s]+',
  'https://www.linkedin.com/feed/update/...',
  '{"requires_url": true, "url_label": "LinkedIn Post URL", "allows_brief": true, "allows_custom_drafts": true, "min_draft_length": 15, "allows_location": false, "allows_drip_feed": false}'::jsonb,
  'Buka tautan postingan LinkedIn berikut. Tulis komentar profesional yang relevan. Upload screenshot sebagai bukti.',
  'Tulis komentar profesional yang bernilai tambah dan positif pada postingan LinkedIn ini.',
  'MessageCircle', 'blue', true, 13
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  badge_text = EXCLUDED.badge_text,
  platform = EXCLUDED.platform,
  category = EXCLUDED.category,
  task_type = EXCLUDED.task_type,
  unit_price_cents = EXCLUDED.unit_price_cents,
  worker_reward_idr = EXCLUDED.worker_reward_idr,
  min_quantity = EXCLUDED.min_quantity,
  max_quantity = EXCLUDED.max_quantity,
  url_pattern = EXCLUDED.url_pattern,
  url_placeholder = EXCLUDED.url_placeholder,
  form_config = EXCLUDED.form_config,
  worker_sop = EXCLUDED.worker_sop,
  worker_brief_template = EXCLUDED.worker_brief_template,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- 4. Admin CRUD RPCs for straight_services
CREATE OR REPLACE FUNCTION public.admin_upsert_straight_service(
  p_slug TEXT,
  p_name TEXT,
  p_platform TEXT,
  p_category TEXT,
  p_task_type TEXT,
  p_unit_price_cents INT,
  p_worker_reward_idr INT,
  p_min_quantity INT DEFAULT 1,
  p_max_quantity INT DEFAULT 100,
  p_badge_text TEXT DEFAULT NULL,
  p_url_pattern TEXT DEFAULT NULL,
  p_url_placeholder TEXT DEFAULT NULL,
  p_form_config JSONB DEFAULT '{}'::jsonb,
  p_worker_sop TEXT DEFAULT '',
  p_worker_brief_template TEXT DEFAULT NULL,
  p_icon TEXT DEFAULT 'Star',
  p_theme_color TEXT DEFAULT 'emerald',
  p_enabled BOOLEAN DEFAULT true,
  p_sort_order INT DEFAULT 0
)
RETURNS public.straight_services
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller_role TEXT;
  v_res public.straight_services;
  v_clean_slug TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'lead') THEN
    RAISE EXCEPTION 'unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  v_clean_slug := lower(btrim(p_slug));
  IF v_clean_slug !~ '^[a-z0-9_]{3,40}$' THEN
    RAISE EXCEPTION 'Slug must be 3-40 lowercase alphanumeric characters or underscore' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.straight_services (
    slug, name, badge_text, platform, category, task_type,
    unit_price_cents, worker_reward_idr, min_quantity, max_quantity,
    url_pattern, url_placeholder, form_config,
    worker_sop, worker_brief_template, icon, theme_color, enabled, sort_order, updated_at
  ) VALUES (
    v_clean_slug, btrim(p_name), NULLIF(btrim(p_badge_text), ''), lower(btrim(p_platform)),
    lower(btrim(p_category)), lower(btrim(p_task_type)),
    p_unit_price_cents, p_worker_reward_idr, p_min_quantity, p_max_quantity,
    NULLIF(btrim(p_url_pattern), ''), NULLIF(btrim(p_url_placeholder), ''),
    COALESCE(p_form_config, '{}'::jsonb),
    btrim(COALESCE(p_worker_sop, '')), NULLIF(btrim(p_worker_brief_template), ''),
    COALESCE(NULLIF(btrim(p_icon), ''), 'Star'),
    COALESCE(NULLIF(btrim(p_theme_color), ''), 'emerald'),
    p_enabled, p_sort_order, NOW()
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    badge_text = EXCLUDED.badge_text,
    platform = EXCLUDED.platform,
    category = EXCLUDED.category,
    task_type = EXCLUDED.task_type,
    unit_price_cents = EXCLUDED.unit_price_cents,
    worker_reward_idr = EXCLUDED.worker_reward_idr,
    min_quantity = EXCLUDED.min_quantity,
    max_quantity = EXCLUDED.max_quantity,
    url_pattern = EXCLUDED.url_pattern,
    url_placeholder = EXCLUDED.url_placeholder,
    form_config = EXCLUDED.form_config,
    worker_sop = EXCLUDED.worker_sop,
    worker_brief_template = EXCLUDED.worker_brief_template,
    icon = EXCLUDED.icon,
    theme_color = EXCLUDED.theme_color,
    enabled = EXCLUDED.enabled,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW()
  RETURNING * INTO v_res;

  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_toggle_straight_service(
  p_slug TEXT,
  p_enabled BOOLEAN
)
RETURNS public.straight_services
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller_role TEXT;
  v_res public.straight_services;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'lead') THEN
    RAISE EXCEPTION 'unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.straight_services
  SET enabled = p_enabled, updated_at = NOW()
  WHERE slug = p_slug
  RETURNING * INTO v_res;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'service not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_straight_service(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'lead') THEN
    RAISE EXCEPTION 'unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.straight_services WHERE slug = p_slug;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_straight_service TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_straight_service TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_straight_service TO authenticated;

-- 5. Universal Service Order RPC (fn_create_generic_service_order)
CREATE OR REPLACE FUNCTION public.fn_create_generic_service_order(
  p_service_slug TEXT,
  p_target_url TEXT,
  p_quantity INT,
  p_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_drip_interval_hours INT DEFAULT 0,
  p_request_id TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', pg_temp
AS $$
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

  -- 4. Target URL validation
  v_url := btrim(COALESCE(p_target_url, ''));
  IF (v_service.form_config->>'requires_url')::boolean IS NOT FALSE THEN
    IF length(v_url) < 5 THEN
      RAISE EXCEPTION 'Please provide a valid target URL' USING ERRCODE = 'P0001';
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

  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001'; END IF;
  IF v_user_balance < v_cost THEN RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001'; END IF;

  -- 7. Compose notes JSONB
  v_notes := jsonb_build_object(
    'service', v_service.slug,
    'platform', v_service.platform,
    'service_name', v_service.name,
    'target_url', v_url,
    'quantity', v_quantity,
    'target_location', NULLIF(btrim(COALESCE(p_location, '')), ''),
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', NULLIF(btrim(COALESCE(p_review_brief, '')), ''),
    'client_notes', NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'drip_interval_hours', v_drip_hours
  );

  -- 8. Insert Order
  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id, v_url, v_service.name, v_service.slug,
    v_quantity, v_cost, v_notes::text, v_drip_hours
  ) RETURNING * INTO v_order;

  -- 9. Insert custom drafts if supplied
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
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_generic_service_order TO authenticated;

-- 6. Generic task minting trigger: fn_ensure_order_task
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(p_order public.reddit_upvote_orders)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_notes            jsonb   := '{}'::jsonb;
  v_service          public.straight_services;
  v_task_type        text;
  v_task_category    text;
  v_reward           int;
  v_title            text;
  v_description      text;
  v_brief            text;
  v_domain           text;
  v_creator          uuid;
  v_task_id          uuid;
  v_initial_status   text;
  v_drip_hours       int     := 0;
  v_initial_max      int;
  v_drip_target      int;
  v_drip_next        timestamptz;
BEGIN
  IF p_order.status NOT IN ('pending', 'processing') THEN RETURN NULL; END IF;

  SELECT id INTO v_task_id FROM tasks WHERE source_order_id = p_order.id;
  IF v_task_id IS NOT NULL THEN RETURN v_task_id; END IF;

  BEGIN
    v_notes := COALESCE(p_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_domain := lower((regexp_match(p_order.thread_url, 'https?://(?:www\.)?([^/:?#]+)'))[1]);

  -- Check if this order matches our dynamic straight_services catalog
  SELECT * INTO v_service
  FROM public.straight_services
  WHERE slug = COALESCE(p_order.target_type, v_notes->>'service');

  IF v_service.id IS NOT NULL THEN
    v_task_type := v_service.task_type;
    v_task_category := v_service.slug;
    v_reward := v_service.worker_reward_idr;
    v_title := format('%s: %s', v_service.name, COALESCE(NULLIF(v_domain, ''), 'Klien'));
    v_description := COALESCE(NULLIF(v_service.worker_sop, ''), 'Kerjakan tugas sesuai instruksi dan upload bukti screenshot.');
    v_brief := COALESCE(NULLIF(v_notes->>'review_brief', ''), NULLIF(v_notes->>'client_notes', ''), v_service.worker_brief_template, 'Kerjakan dengan teliti.');
    v_initial_status := 'active';
  ELSE
    -- Legacy Fallback for backward compatibility
    v_task_type := CASE
      WHEN p_order.target_type = 'upvote' THEN 'upvote'
      WHEN p_order.target_type = 'youtube_upload' THEN 'upload'
      ELSE 'comment'
    END;
    v_task_category := COALESCE(p_order.target_type, 'reddit_comment');
    v_reward := CASE WHEN v_task_type = 'upvote' THEN 500 ELSE 3000 END;
    v_title := format('Tugas %s: %s', COALESCE(p_order.subreddit, 'Online'), COALESCE(v_domain, 'Klien'));
    v_description := 'Kerjakan tugas sesuai petunjuk.';
    v_brief := COALESCE(v_notes->>'client_notes', 'Tulis respon natural.');
    v_initial_status := 'active';
  END IF;

  SELECT id INTO v_creator FROM users WHERE role IN ('admin', 'lead') ORDER BY created_at ASC LIMIT 1;

  v_drip_hours := COALESCE(p_order.drip_interval_hours, NULLIF((v_notes->>'drip_interval_hours')::text, '')::int, 0);

  IF v_drip_hours > 0 AND p_order.requested_upvotes > 1 THEN
    v_initial_max := 1;
    v_drip_target := p_order.requested_upvotes;
    v_drip_next := NOW() + (v_drip_hours || ' hours')::interval;
  ELSE
    v_initial_max := p_order.requested_upvotes;
    v_drip_target := p_order.requested_upvotes;
    v_drip_next := NULL;
  END IF;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    reward_amount, max_assignments, current_assignments,
    min_karma, min_account_age_days, per_account_limit,
    status, is_hidden, created_by, source_order_id,
    drip_interval_hours, drip_total_target, drip_next_release_at
  ) VALUES (
    v_title, v_description, v_brief, p_order.thread_url,
    v_task_type, v_task_category, v_reward, v_initial_max, 0,
    0, 0, 1, v_initial_status, false, v_creator, p_order.id,
    v_drip_hours, v_drip_target, v_drip_next
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$fn$;

-- 7. Live proofs RPC for client delivery transparency & CSV export
CREATE OR REPLACE FUNCTION public.fn_get_order_delivery_proofs(p_order_id INT)
RETURNS TABLE (
  assignment_id UUID,
  status TEXT,
  proof_url TEXT,
  proof_image_url TEXT,
  submitted_username TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_order_user_id UUID;
  v_task_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_order_user_id
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id;

  IF v_order_user_id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  -- Ensure caller is owner or admin
  IF v_order_user_id <> v_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND role IN ('admin', 'lead')) THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id INTO v_task_id
  FROM public.tasks
  WHERE source_order_id = p_order_id;

  IF v_task_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ta.id AS assignment_id,
    ta.status,
    COALESCE(ta.proof_url, '') AS proof_url,
    COALESCE(ta.proof_image_url, '') AS proof_image_url,
    COALESCE(ta.submitted_username, 'Verified User') AS submitted_username,
    ta.submitted_at,
    ta.updated_at AS approved_at
  FROM public.task_assignments ta
  WHERE ta.task_id = v_task_id
    AND ta.status IN ('approved', 'submitted')
  ORDER BY ta.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_order_delivery_proofs(INT) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
