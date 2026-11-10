-- ============================================================
-- Migration: 20261110000000_fix_task_quality_urls_and_briefs.sql
--
-- Permanent root-cause fixes for PeTa task quality feedback:
-- 1. Tasks without direct valid link (or search-only URLs like google.com/search, quora.com/search, indiehackers.com/search, hubspot/searchpage)
-- 2. Tasks with 410 Gone URLs (auto-detection + member report + admin health check)
-- 3. Tasks with closed/locked comment threads
-- 4. Tasks with missing/unready guides (regression in 20261105000000 fn_ensure_order_task overwriting forum_comment & dropping comment_text + leaking bulk_source=)
-- ============================================================

-- 1. Add URL health metadata columns on tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS url_status text,
  ADD COLUMN IF NOT EXISTS url_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS url_check_error text;

-- 2. Task Issue Reports table (for member broken/closed thread reporting)
CREATE TABLE IF NOT EXISTS public.task_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('no_link', 'gone_410', 'not_found_404', 'closed_topic', 'other')),
  detail text,
  verified_broken boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_issue_reports_task ON public.task_issue_reports(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_issue_reports_user_task ON public.task_issue_reports(task_id, user_id);

ALTER TABLE public.task_issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own task_issue_reports" ON public.task_issue_reports;
CREATE POLICY "Users view own task_issue_reports"
  ON public.task_issue_reports FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users insert own task_issue_reports" ON public.task_issue_reports;
CREATE POLICY "Users insert own task_issue_reports"
  ON public.task_issue_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. Helper: Detect missing, malformed, or search-only non-thread URLs
CREATE OR REPLACE FUNCTION public.fn_is_invalid_task_url(p_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_url text := lower(btrim(COALESCE(p_url, '')));
BEGIN
  IF v_url = '' OR length(v_url) < 10 THEN
    RETURN true;
  END IF;

  IF v_url !~ '^https?://[a-z0-9.-]+\.[a-z]{2,}(?:[:/?#]|$)' THEN
    RETURN true;
  END IF;

  -- Search result pages are NEVER valid direct task targets
  IF v_url ~ '^https?://(?:[a-z0-9-]+\.)?google\.[a-z.]+/search(?:[/?#]|$)'
     OR v_url ~ '^https?://(?:[a-z0-9-]+\.)?bing\.com/search(?:[/?#]|$)'
     OR v_url ~ '^https?://(?:[a-z0-9-]+\.)?search\.yahoo\.com(?:[/?#]|$)'
     OR v_url ~ '^https?://(?:[a-z0-9-]+\.)?duckduckgo\.com/(?:\?|$)'
     OR v_url ~ '^https?://(?:[a-z0-9-]+\.)?quora\.com/search(?:[/?#]|$)'
     OR v_url ~ '^https?://(?:[a-z0-9-]+\.)?indiehackers\.com/search(?:[/?#]|$)'
     OR v_url ~ '^https?://community\.hubspot\.com/t5/forums/searchpage(?:[/?#]|$)'
     OR v_url ~ '/(?:search|searchpage)(?:\?|$)' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- 4. Helper: Strip internal bulk tracking markers from client notes/briefs
CREATE OR REPLACE FUNCTION public.fn_clean_client_brief(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(trim(
    regexp_replace(
      regexp_replace(
        COALESCE(p_raw, ''),
        '(?m)^(?:bulk_source|bulk_target_title|bulk_suggested|comment)=.*(?:\r?\n|$)',
        '',
        'g'
      ),
      E'\\n{3,}',
      E'\\n\\n',
      'g'
    )
  ), '')
$function$;

-- 5. Fix fn_ensure_order_task (restores full forum_comment, youtube_upload, preferred_source, review SOPs & briefs, plus dynamic straight_services & URL guard)
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(p_order public.reddit_upvote_orders)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_notes            jsonb   := '{}'::jsonb;
  v_service          public.straight_services;
  v_service_slug     text;
  v_is_forum_comment boolean := false;
  v_is_youtube_upload boolean := false;
  v_is_preferred     boolean := false;
  v_is_linkedin_like boolean := false;
  v_is_linkedin_follow boolean := false;
  v_is_linkedin_comment boolean := false;
  v_is_trustpilot    boolean := false;
  v_is_gmaps         boolean := false;
  v_is_yelp          boolean := false;
  v_is_clutch        boolean := false;
  v_is_quora_upvote  boolean := false;
  v_task_type        text;
  v_task_category    text;
  v_reward           int;
  v_title            text;
  v_description      text;
  v_brief            text;
  v_platform         text;
  v_brand            text;
  v_comment_text     text;
  v_mention_mode     text;
  v_location         text;
  v_clean_notes      text;
  v_yt_title         text;
  v_yt_description   text;
  v_yt_tags          text;
  v_yt_privacy       text;
  v_domain           text;
  v_creator          uuid;
  v_task_id          uuid;
  v_auto_activate    boolean := true;
  v_initial_status   text;
  v_is_hidden        boolean := false;
  v_url_status       text := NULL;
  v_url_err          text := NULL;
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

  -- Prefer explicit notes->>'service' (e.g. 'forum_comment' when target_type is 'comment')
  v_service_slug := lower(COALESCE(
    NULLIF(btrim(v_notes->>'service'), ''),
    CASE
      WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote'
      WHEN p_order.target_type = 'comment' AND COALESCE(v_notes->>'service', '') = '' THEN 'reddit_comment'
      ELSE NULLIF(btrim(p_order.target_type), '')
    END,
    'reddit_comment'
  ));

  SELECT * INTO v_service
  FROM public.straight_services
  WHERE slug = v_service_slug;

  v_is_youtube_upload   := v_service_slug = 'youtube_upload' OR COALESCE(p_order.target_type, '') = 'youtube_upload';
  v_is_forum_comment    := v_service_slug = 'forum_comment' OR (COALESCE(p_order.target_type, '') = 'comment' AND COALESCE(v_notes->>'service', '') = 'forum_comment');
  v_is_preferred        := v_service_slug = 'preferred_source' OR COALESCE(p_order.target_type, '') = 'preferred_source';
  v_is_linkedin_like    := v_service_slug = 'linkedin_like' OR COALESCE(p_order.target_type, '') = 'linkedin_like';
  v_is_linkedin_follow  := v_service_slug = 'linkedin_follow' OR COALESCE(p_order.target_type, '') = 'linkedin_follow';
  v_is_linkedin_comment := v_service_slug = 'linkedin_comment' OR COALESCE(p_order.target_type, '') = 'linkedin_comment';
  v_is_trustpilot       := v_service_slug = 'trustpilot_review' OR COALESCE(p_order.target_type, '') = 'trustpilot_review';
  v_is_gmaps            := v_service_slug IN ('google_maps_review', 'google_maps_review_targeted') OR COALESCE(p_order.target_type, '') IN ('google_maps_review', 'google_maps_review_targeted');
  v_is_yelp             := v_service_slug = 'yelp_review' OR COALESCE(p_order.target_type, '') = 'yelp_review';
  v_is_clutch           := v_service_slug = 'clutch_review' OR COALESCE(p_order.target_type, '') = 'clutch_review';
  v_is_quora_upvote     := v_service_slug = 'quora_upvote' OR COALESCE(p_order.target_type, '') = 'quora_upvote';

  v_platform     := public.forum_platform_label(p_order.thread_url, COALESCE(v_notes->>'platform', p_order.subreddit));
  v_brand        := COALESCE(NULLIF(btrim(v_notes->>'brand_name'), ''), NULLIF(btrim(v_notes->>'brand_domain'), ''), '');
  v_comment_text := NULLIF(btrim(v_notes->>'comment_text'), '');
  v_mention_mode := COALESCE(NULLIF(btrim(v_notes->>'brand_mention_mode'), ''), 'plain');
  v_location     := NULLIF(btrim(v_notes->>'target_location'), '');
  v_clean_notes  := public.fn_clean_client_brief(v_notes->>'client_notes');

  v_yt_title       := NULLIF(btrim(v_notes->>'title'), '');
  v_yt_description := NULLIF(btrim(v_notes->>'description'), '');
  v_yt_tags        := NULLIF(btrim(v_notes->>'tags'), '');
  v_yt_privacy     := COALESCE(NULLIF(btrim(v_notes->>'privacy'), ''), 'unlisted');

  IF v_is_forum_comment THEN
    v_task_type     := 'comment';
    v_task_category := 'forum_comment';
    v_reward        := COALESCE(v_service.worker_reward_idr, 3000);
    v_title         := CASE
                         WHEN v_brand <> '' THEN format('Post comment di %s (mention %s)', v_platform, v_brand)
                         ELSE format('Post comment di %s', v_platform)
                       END;
    v_description   := format('Buka thread di %s. Baca konteks diskusi dengan cermat, lalu kirimkan komentar yang sudah disediakan atau relevan dengan brief. Pastikan komentar kamu terbit secara publik sebelum submit bukti.', v_platform);
    v_brief         := public.forum_comment_task_brief(
                         p_order.thread_url,
                         v_comment_text,
                         v_brand,
                         v_mention_mode,
                         COALESCE((v_notes->>'is_reply')::boolean, false),
                         v_notes->>'reply_to_comment'
                       );
  ELSIF v_is_youtube_upload THEN
    v_task_type     := 'upload';
    v_task_category := 'youtube_upload';
    v_reward        := COALESCE(v_service.worker_reward_idr, 10000);
    v_title         := format('Upload Video ke Channel YouTube: "%s"', COALESCE(v_yt_title, 'Video Klien'));
    v_description   := format('Upload video dari %s ke YouTube. Judul: %s. Setel privasi jadi %s. Setelah upload, kirim URL video YouTube sebagai bukti.', p_order.thread_url, COALESCE(v_yt_title, 'lihat brief'), v_yt_privacy);
    v_brief         := format(
                         E'📹 Video sumber: %s\n🎬 Judul: %s\n📝 Deskripsi: %s\n🏷️ Tags: %s\n🔒 Privasi: %s\n\nUpload video ke channel YouTube-mu, lalu kirim URL video hasil upload sebagai bukti. Pastikan metadata sesuai di atas.',
                         p_order.thread_url,
                         COALESCE(v_yt_title, '-'),
                         COALESCE(v_yt_description, '-'),
                         COALESCE(v_yt_tags, '-'),
                         v_yt_privacy
                       );
  ELSIF v_is_preferred THEN
    v_task_type     := 'upvote';
    v_task_category := 'preferred_source';
    v_reward        := COALESCE(v_service.worker_reward_idr, 2500);
    v_title         := format('Preferred Source: pilih %s di Google', COALESCE(NULLIF(v_domain, ''), 'domain klien'));
    v_description   := 'Buka link target, klik tombol Preferred Source-nya, konfirmasi di Google, terus screenshot buktinya. 1 akun Google = 1 pilihan.';
    v_brief         := format(
                         E'🎯 Misi: pilih situs %s sebagai Preferred Source di Google.\n\nLangkah:\n1. Buka link di atas (target URL task ini)\n2. Cari dan klik tombol "Prefer us in Google" / Preferred Source di halaman itu\n3. Di halaman Google yang terbuka, klik tombol konfirmasi sampai situs ini benar-benar terpilih\n4. Screenshot tampilan Google yang menunjukkan situsnya sudah terpilih\n\nLink target: %s',
                         COALESCE(NULLIF(v_domain, ''), p_order.thread_url),
                         p_order.thread_url
                       );
  ELSIF v_is_gmaps THEN
    v_task_type     := 'comment';
    v_task_category := 'google_maps_review';
    v_reward        := COALESCE(v_service.worker_reward_idr, CASE WHEN v_location IS NOT NULL THEN 6000 ELSE 5000 END);
    v_title         := CASE
                         WHEN v_location IS NOT NULL THEN format('Tulis review Google Maps (%s): Bisnis Klien', v_location)
                         ELSE 'Tulis review Google Maps bintang 5 untuk Bisnis Klien'
                       END;
    v_description   := CASE
                         WHEN v_location IS NOT NULL THEN format('Buka link Google Maps bisnis klien. Pastikan akun Google kamu aktif dan berada di/sekitar %s. Tulis ulasan bintang 5 yang jujur dan relevan minimal 2-3 kalimat. Upload screenshot bukti ulasan publik yang sudah terbit.', v_location)
                         ELSE 'Buka link Google Maps bisnis klien. Berikan rating bintang 5 dan tulis ulasan otentik minimal 2-3 kalimat yang menceritakan pengalaman positif. Upload screenshot bukti ulasan publik yang sudah terbit.'
                       END;
    v_brief         := COALESCE(NULLIF(btrim(v_notes->>'review_brief'), ''), v_clean_notes, v_service.worker_brief_template, 'Tulis ulasan bintang 5 yang mencerminkan pengalaman positif terhadap pelayanan atau produk bisnis ini.');
  ELSIF v_is_yelp THEN
    v_task_type     := 'comment';
    v_task_category := 'yelp_review';
    v_reward        := COALESCE(v_service.worker_reward_idr, 5000);
    v_title         := format('Tulis review Yelp bintang 5: %s', COALESCE(NULLIF(v_domain, ''), 'Bisnis Klien'));
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Wajib aktifkan VPN US / UK (Windscribe) sebelum klik link. Buka halaman bisnis Yelp klien, berikan rating bintang 5, dan tulis review otentik dalam Bahasa Inggris minimal 3-4 kalimat. Akun Yelp wajib menggunakan nama Western/English dan memiliki foto profil avatar. Upload screenshot bukti review publik terbit.');
    v_brief         := COALESCE(NULLIF(btrim(v_notes->>'review_brief'), ''), v_clean_notes, v_service.worker_brief_template, 'Tulis ulasan bintang 5 positif dalam Bahasa Inggris yang menceritakan pengalaman menggunakan jasa/layanan bisnis klien secara natural.');
  ELSIF v_is_clutch THEN
    v_task_type     := 'comment';
    v_task_category := 'clutch_review';
    v_reward        := COALESCE(v_service.worker_reward_idr, 5000);
    v_title         := format('Tulis review Clutch B2B bintang 5: %s', COALESCE(NULLIF(v_domain, ''), 'Perusahaan Klien'));
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Wajib login menggunakan akun LinkedIn atau Google profesional. Buka formulir review Clutch.co untuk profil perusahaan klien. Isi seluruh bagian kuesioner dalam Bahasa Inggris, pilih Remain Anonymous bila perlu, dan upload screenshot bukti submit.');
    v_brief         := COALESCE(NULLIF(btrim(v_notes->>'review_brief'), ''), v_clean_notes, v_service.worker_brief_template, 'Tulis ulasan B2B bintang 5 secara komprehensif dalam Bahasa Inggris mencakup Background, Solusi proyek, dan Hasil kepuasan kerja sama.');
  ELSIF v_is_trustpilot THEN
    v_task_type     := 'comment';
    v_task_category := 'trustpilot_review';
    v_reward        := COALESCE(v_service.worker_reward_idr, 5000);
    v_title         := format('Tulis review di Trustpilot: %s', COALESCE(NULLIF(v_domain, ''), 'Bisnis Klien'));
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Wajib aktifkan VPN US/UK (Windscribe) sebelum membuka link. Buka halaman profil Trustpilot klien, berikan rating bintang 5, dan tulis review otentik dalam Bahasa Inggris minimal 3 kalimat dengan nama Western/English. Upload screenshot bukti review terbit.');
    v_brief         := COALESCE(NULLIF(btrim(v_notes->>'review_brief'), ''), v_clean_notes, v_service.worker_brief_template, 'Tulis ulasan positif dalam Bahasa Inggris yang menceritakan pengalaman memuaskan terhadap bisnis klien.');
  ELSIF v_is_linkedin_like THEN
    v_task_type     := 'upvote';
    v_task_category := 'linkedin_like';
    v_reward        := COALESCE(v_service.worker_reward_idr, 1000);
    v_title         := 'Beri Like postingan di LinkedIn';
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Buka tautan postingan LinkedIn berikut menggunakan akun LinkedIn aktif kamu. Berikan Like dan upload screenshot bukti.');
    v_brief         := v_clean_notes;
  ELSIF v_is_linkedin_follow THEN
    v_task_type     := 'upvote';
    v_task_category := 'linkedin_follow';
    v_reward        := COALESCE(v_service.worker_reward_idr, 1500);
    v_title         := 'Follow Company Page di LinkedIn';
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Buka tautan LinkedIn Company Page berikut, klik Follow, dan upload screenshot bukti status Following.');
    v_brief         := v_clean_notes;
  ELSIF v_is_linkedin_comment THEN
    v_task_type     := 'comment';
    v_task_category := 'linkedin_comment';
    v_reward        := COALESCE(v_service.worker_reward_idr, 3000);
    v_title         := 'Tulis komentar di post LinkedIn';
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Buka tautan postingan LinkedIn berikut. Tulis komentar profesional relevan (minimal 1-2 kalimat) dan upload screenshot bukti komentar terbit.');
    v_brief         := COALESCE(v_comment_text, NULLIF(btrim(v_notes->>'comment_brief'), ''), v_clean_notes, v_service.worker_brief_template, 'Berikan komentar apresiatif dan berbobot yang relevan dengan isi postingan LinkedIn tersebut.');
  ELSIF v_is_quora_upvote THEN
    v_task_type     := 'upvote';
    v_task_category := 'quora_upvote';
    v_reward        := COALESCE(v_service.worker_reward_idr, 1000);
    v_title         := format('Quora Upvote: %s', COALESCE(NULLIF(v_domain, ''), 'quora.com'));
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Buka jawaban Quora pada tautan berikut, klik tombol Upvote (panah atas), dan upload screenshot bukti.');
    v_brief         := v_clean_notes;
  ELSIF v_service.id IS NOT NULL THEN
    -- Dynamic catalog services added by admin later
    v_task_type     := v_service.task_type;
    v_task_category := v_service.slug;
    v_reward        := v_service.worker_reward_idr;
    v_title         := format('%s: %s', v_service.name, COALESCE(NULLIF(v_domain, ''), 'Klien'));
    v_description   := COALESCE(NULLIF(v_service.worker_sop, ''), 'Kerjakan tugas sesuai instruksi dan upload bukti screenshot.');
    v_brief         := COALESCE(v_comment_text, NULLIF(btrim(v_notes->>'review_brief'), ''), NULLIF(btrim(v_notes->>'comment_brief'), ''), v_clean_notes, v_service.worker_brief_template, 'Kerjakan dengan teliti.');
  ELSE
    -- Reddit fallback
    v_task_type     := CASE WHEN p_order.target_type = 'upvote' THEN 'upvote' WHEN p_order.target_type = 'youtube_upload' THEN 'upload' ELSE 'comment' END;
    v_task_category := CASE WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote' WHEN p_order.target_type = 'thread' THEN 'reddit_post_thread' ELSE 'reddit_comment' END;
    v_reward        := CASE WHEN v_task_type = 'upvote' THEN 500 ELSE 3000 END;
    v_title         := CASE WHEN v_task_type = 'upvote' THEN format('Upvote post di r/%s', COALESCE(p_order.subreddit, 'reddit')) ELSE format('Komentar di r/%s', COALESCE(p_order.subreddit, 'reddit')) END;
    v_description   := CASE WHEN v_task_type = 'upvote' THEN 'Buka postingan Reddit berikut dan berikan upvote. Jangan downvote atau batalkan upvote.' ELSE 'Tulis komentar yang relevan dan bernilai tambah pada postingan Reddit ini sesuai brief.' END;
    v_brief         := COALESCE(v_comment_text, v_clean_notes);
    v_auto_activate := false;
  END IF;

  -- Guard: Never expose tasks without valid direct thread/target URLs (e.g., search pages or empty URLs)
  IF public.fn_is_invalid_task_url(p_order.thread_url) THEN
    v_initial_status := 'paused';
    v_is_hidden      := true;
    v_url_status     := 'invalid_url';
    v_url_err        := 'Target URL tidak valid atau berupa halaman pencarian (bukan link diskusi/target langsung).';
  ELSE
    v_initial_status := CASE WHEN v_auto_activate THEN 'active' ELSE 'paused' END;
    v_is_hidden      := false;
  END IF;

  SELECT id INTO v_creator FROM users WHERE role IN ('admin', 'lead') ORDER BY created_at ASC LIMIT 1;

  v_drip_hours := COALESCE(p_order.drip_interval_hours, NULLIF((v_notes->>'drip_interval_hours')::text, '')::int, 0);
  IF v_drip_hours > 0 AND p_order.requested_upvotes > 1 THEN
    v_initial_max := 1;
    v_drip_target := p_order.requested_upvotes;
    v_drip_next   := NOW() + (v_drip_hours || ' hours')::interval;
  ELSE
    v_initial_max := p_order.requested_upvotes;
    v_drip_target := p_order.requested_upvotes;
    v_drip_next   := NULL;
  END IF;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    reward_amount, max_assignments, current_assignments,
    min_karma, min_account_age_days, per_account_limit,
    status, is_hidden, created_by, source_order_id,
    drip_interval_hours, drip_total_target, drip_next_release_at,
    url_status, url_check_error
  ) VALUES (
    v_title, v_description, v_brief, p_order.thread_url, v_task_type, v_task_category,
    v_reward, v_initial_max, 0,
    0, 0, 1,
    v_initial_status, v_is_hidden, v_creator, p_order.id,
    v_drip_hours, v_drip_target, v_drip_next,
    v_url_status, v_url_err
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$fn$;

-- 6. Reject search-only or invalid URLs when creating forum comment orders
CREATE OR REPLACE FUNCTION public.fn_create_forum_comment_order_unchecked(
  p_target_url text,
  p_platform text,
  p_comment_text text,
  p_use_suggested_comment boolean,
  p_brand_name text,
  p_brand_domain text,
  p_brand_mention_mode text,
  p_source_keyword text,
  p_notes text,
  p_quantity integer DEFAULT 1,
  p_comment_drafts jsonb DEFAULT '[]'::jsonb,
  p_is_reply boolean DEFAULT false,
  p_reply_to text DEFAULT NULL::text
)
RETURNS reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF public.fn_is_invalid_task_url(p_target_url) THEN
    RAISE EXCEPTION 'Target URL cannot be a search results page (Google, Quora, HubSpot, Indie Hackers search). Use a direct live forum thread URL.' USING ERRCODE = 'P0001';
  END IF;
  IF p_comment_text IS NULL OR length(trim(p_comment_text)) < 20 THEN RAISE EXCEPTION 'comment_text too short'; END IF;
  IF p_brand_mention_mode IS NOT NULL AND p_brand_mention_mode NOT IN ('plain', 'link') THEN
    RAISE EXCEPTION 'invalid brand mention mode';
  END IF;

  v_qty := GREATEST(1, LEAST(COALESCE(p_quantity, 1), 500));

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
$function$;

-- 7. Guard admin_create_task & admin_update_task against blank or invalid URLs for non-challenge tasks
CREATE OR REPLACE FUNCTION public.admin_create_task(
  p_title text,
  p_description text,
  p_brief text,
  p_target_url text,
  p_task_category text,
  p_reward_amount integer,
  p_max_assignments integer,
  p_per_account_limit integer,
  p_min_karma integer DEFAULT 0,
  p_min_account_age_days integer DEFAULT 0,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_post_to_wa_group boolean DEFAULT false,
  p_wa_group_draft text DEFAULT NULL::text,
  p_status text DEFAULT 'draft'::text
)
RETURNS tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.tasks;
  v_task_type text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_end_at IS NOT NULL AND p_start_at IS NOT NULL AND p_end_at < p_start_at THEN
    RAISE EXCEPTION 'End time tidak boleh lebih awal dari start time';
  END IF;

  IF COALESCE(p_task_category, '') <> 'reddit_challenge' AND public.fn_is_invalid_task_url(p_target_url) THEN
    RAISE EXCEPTION 'Target URL wajib berupa link http(s) langsung dan tidak boleh halaman search (Google/Quora/HubSpot/IndieHackers search).' USING ERRCODE = 'P0001';
  END IF;

  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote' THEN 'upvote'
    WHEN 'quora_upvote' THEN 'upvote'
    WHEN 'youtube_upload' THEN 'upload'
    WHEN 'preferred_source' THEN 'upvote'
    WHEN 'linkedin_like' THEN 'upvote'
    WHEN 'linkedin_follow' THEN 'upvote'
    ELSE 'comment'
  END;

  INSERT INTO public.tasks (
    title, description, brief, target_url, task_category, task_type,
    reward_amount, max_assignments, per_account_limit, min_karma, min_account_age_days,
    start_at, end_at, post_to_wa_group, wa_group_draft, status, created_by
  ) VALUES (
    p_title, p_description, p_brief, NULLIF(btrim(p_target_url), ''), p_task_category, v_task_type,
    GREATEST(p_reward_amount, 0), GREATEST(p_max_assignments, 1), GREATEST(p_per_account_limit, 1),
    GREATEST(p_min_karma, 0), GREATEST(p_min_account_age_days, 0),
    p_start_at, p_end_at, COALESCE(p_post_to_wa_group, false), p_wa_group_draft,
    p_status, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_update_task(
  p_task_id uuid,
  p_title text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_brief text DEFAULT NULL::text,
  p_post_to_wa_group boolean DEFAULT NULL::boolean,
  p_wa_group_draft text DEFAULT NULL::text,
  p_target_url text DEFAULT NULL::text,
  p_task_category text DEFAULT NULL::text,
  p_reward_amount integer DEFAULT NULL::integer,
  p_max_assignments integer DEFAULT NULL::integer,
  p_per_account_limit integer DEFAULT NULL::integer,
  p_min_karma integer DEFAULT NULL::integer,
  p_min_account_age_days integer DEFAULT NULL::integer,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task_type text;
  v_existing public.tasks;
  v_next_url text;
  v_next_cat text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT * INTO v_existing FROM public.tasks WHERE id = p_task_id;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  v_next_cat := COALESCE(p_task_category, v_existing.task_category);
  v_next_url := COALESCE(NULLIF(btrim(p_target_url), ''), v_existing.target_url);

  IF COALESCE(v_next_cat, '') <> 'reddit_challenge'
     AND (p_target_url IS NOT NULL OR COALESCE(p_status, v_existing.status) = 'active')
     AND public.fn_is_invalid_task_url(v_next_url) THEN
    RAISE EXCEPTION 'Target URL wajib berupa link http(s) langsung sebelum task diaktifkan (tidak boleh kosong atau halaman search).' USING ERRCODE = 'P0001';
  END IF;

  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote'      THEN 'upvote'
    WHEN 'quora_upvote'       THEN 'upvote'
    WHEN 'reddit_comment'     THEN 'comment'
    WHEN 'forum_comment'      THEN 'comment'
    WHEN 'reddit_post_thread' THEN 'comment'
    WHEN 'youtube_upload'     THEN 'upload'
    WHEN 'preferred_source'   THEN 'upvote'
    WHEN 'linkedin_like'      THEN 'upvote'
    WHEN 'linkedin_follow'    THEN 'upvote'
    WHEN 'linkedin_comment'   THEN 'comment'
    WHEN 'trustpilot_review'  THEN 'comment'
    WHEN 'google_maps_review' THEN 'comment'
    WHEN 'yelp_review'        THEN 'comment'
    WHEN 'clutch_review'      THEN 'comment'
    ELSE NULL
  END;

  UPDATE public.tasks SET
    title                 = COALESCE(p_title, title),
    description           = COALESCE(p_description, description),
    brief                 = COALESCE(p_brief, brief),
    post_to_wa_group      = COALESCE(p_post_to_wa_group, post_to_wa_group),
    wa_group_draft        = COALESCE(p_wa_group_draft, wa_group_draft),
    target_url            = COALESCE(NULLIF(btrim(p_target_url), ''), target_url),
    task_category         = COALESCE(p_task_category, task_category),
    task_type             = COALESCE(v_task_type, task_type),
    reward_amount         = COALESCE(p_reward_amount, reward_amount),
    max_assignments       = COALESCE(p_max_assignments, max_assignments),
    per_account_limit     = COALESCE(p_per_account_limit, per_account_limit),
    min_karma             = COALESCE(p_min_karma, min_karma),
    min_account_age_days  = COALESCE(p_min_account_age_days, min_account_age_days),
    start_at              = CASE WHEN p_start_at IS NOT NULL THEN p_start_at ELSE start_at END,
    end_at                = CASE WHEN p_end_at IS NOT NULL THEN p_end_at ELSE end_at END,
    status                = COALESCE(p_status, status),
    url_status            = CASE WHEN p_target_url IS NOT NULL AND NOT public.fn_is_invalid_task_url(p_target_url) THEN NULL ELSE url_status END,
    url_check_error       = CASE WHEN p_target_url IS NOT NULL AND NOT public.fn_is_invalid_task_url(p_target_url) THEN NULL ELSE url_check_error END
  WHERE id = p_task_id;

  RETURN p_task_id;
END
$function$;

-- 8. Filter out missing/invalid/broken URLs in list_eligible_tasks_for_user (both overloads)
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
        'yelp_review', 'clutch_review'
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
        'yelp_review', 'clutch_review'
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

-- 9. Exclude reddit_challenge from get_my_pending_assignments (belongs on /reddit-army only)
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
    AND ta.status IN ('submitted', 'rejected', 'in_progress')
    AND COALESCE(t.task_category, '') <> 'reddit_challenge'
  ORDER BY ta.updated_at DESC;
END;
$function$;

-- 10. Update claim_task_assignment(uuid, uuid): block invalid/broken URLs + populate draft_comment from order/drafts
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL::uuid
)
RETURNS task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_assignment public.task_assignments;
  v_reddit_acc public.reddit_accounts;
  v_is_admin boolean := false;
  v_active_claims_count int;
  v_active_total int;
  v_norm_target text;
  v_timeout_interval interval;
  v_is_reddit_task boolean := false;
  v_draft_text text := NULL;
  v_order_notes jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Purge expired in_progress assignments for this task first
  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)',
      can_retry = true,
      updated_at = NOW()
  WHERE task_id = p_task_id
    AND status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  PERFORM public.sync_task_slot_count(p_task_id);

  -- 2. Anti-hoarding: Max 2 concurrent in_progress tasks per member (excluding Reddit challenge)
  SELECT COUNT(*) INTO v_active_total
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = v_uid
    AND ta.status = 'in_progress'
    AND (ta.expires_at IS NULL OR ta.expires_at > NOW())
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  IF v_active_total >= 2 THEN
    RAISE EXCEPTION 'Kamu sedang mengerjakan % tugas lain. Selesaikan dan submit bukti terlebih dahulu sebelum mengambil tugas baru.', v_active_total
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock task
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation)
  VALUES (txid_current(), pg_backend_pid(), 'claim');

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task tidak ditemukan atau sudah tidak tersedia.' USING ERRCODE = 'P0001';
  END IF;

  v_is_admin := public.is_admin();

  IF v_task.status <> 'active' THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  -- Guard against broken / missing / search-page URLs
  IF COALESCE(v_task.task_category, '') <> 'reddit_challenge'
     AND (
       public.fn_is_invalid_task_url(v_task.target_url)
       OR COALESCE(v_task.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
     ) THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Link task ini tidak valid atau thread sudah ditutup (410/Closed). Silakan pilih task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.current_assignments >= v_task.max_assignments THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  -- 1 hour for micro-tasks, 4 hours for YouTube video production
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    v_timeout_interval := INTERVAL '4 hours';
  ELSE
    v_timeout_interval := INTERVAL '1 hour';
  END IF;

  v_is_reddit_task := (COALESCE(v_task.task_category, '') LIKE 'reddit_%');

  -- Fetch available comment/review draft if linked to a Straight order
  IF v_task.source_order_id IS NOT NULL
     AND COALESCE(v_task.task_category, '') IN ('forum_comment', 'comment', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'yelp_review', 'clutch_review') THEN
    SELECT cd.comment_text INTO v_draft_text
    FROM public.reddit_order_comment_drafts cd
    WHERE cd.order_id = v_task.source_order_id
      AND NOT EXISTS (
        SELECT 1 FROM public.task_assignments ta_d
        WHERE ta_d.task_id = v_task.id
          AND ta_d.status IN ('in_progress', 'submitted', 'approved')
          AND public.normalize_forum_comment(ta_d.draft_comment) = public.normalize_forum_comment(cd.comment_text)
      )
    ORDER BY cd.draft_index ASC
    LIMIT 1;

    IF v_draft_text IS NULL AND COALESCE(v_task.max_assignments, 1) = 1 THEN
      BEGIN
        SELECT COALESCE(o.notes, '{}')::jsonb INTO v_order_notes
        FROM public.reddit_upvote_orders o WHERE o.id = v_task.source_order_id;
        v_draft_text := NULLIF(btrim(v_order_notes->>'comment_text'), '');
      EXCEPTION WHEN others THEN
        v_draft_text := NULL;
      END;
    END IF;
  END IF;

  -- BRANCH A: YouTube Upload
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.youtube_accounts ya
      WHERE ya.user_id = v_uid
        AND ya.verified_at IS NOT NULL
        AND ya.verification_status = 'approved'
        AND COALESCE(ya.is_active, true) = true
    ) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Wajib verifikasi akun YouTube (Advanced Features) dan disetujui admin sebelum mengambil task YouTube.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;

  -- BRANCH B: NON-REDDIT TASKS
  ELSIF NOT v_is_reddit_task THEN
    IF COALESCE(v_task.task_category, '') IN (
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review'
    ) THEN
      v_norm_target := regexp_replace(lower(btrim(COALESCE(v_task.target_url, ''))), '[/?#]+$', '');
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments ta2
        JOIN public.tasks t2 ON t2.id = ta2.task_id
        WHERE ta2.user_id = v_uid
          AND t2.task_category = v_task.task_category
          AND ta2.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t2.target_url, ''))), '[/?#]+$', '') = v_norm_target
      ) THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task untuk URL ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND (
        status IN ('in_progress', 'submitted', 'approved')
        OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
      );

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Kamu sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at, draft_comment)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval, v_draft_text)
    RETURNING * INTO v_assignment;

  -- BRANCH C: REDDIT TASKS ONLY
  ELSE
    IF p_reddit_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit harus dipilih untuk task Reddit ini.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_reddit_acc FROM public.reddit_accounts WHERE id = p_reddit_account_id;

    IF v_reddit_acc.id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak ditemukan.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.user_id <> v_uid AND NOT v_is_admin THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit bukan milik kamu.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.status <> 'active' OR v_reddit_acc.is_active = FALSE THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.status_flag IS NOT NULL AND v_reddit_acc.status_flag <> '' THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang bermasalah (%s). Gunakan akun lain.', v_reddit_acc.status_flag USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.min_karma, 0) > 0 AND v_reddit_acc.karma < v_task.min_karma THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Karma akun Reddit belum cukup (minimal % karma).', v_task.min_karma USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.min_account_age_days, 0) > 0 AND v_reddit_acc.account_age_days < v_task.min_account_age_days THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Umur akun Reddit belum cukup (minimal % hari).', v_task.min_account_age_days USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND reddit_account_id = p_reddit_account_id
      AND status IN ('in_progress', 'submitted', 'approved');

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit ini sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at, draft_comment)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + v_timeout_interval, v_draft_text)
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment;
END;
$function$;

-- 11. Member Broken/Closed Task Report RPC (releases own claim cleanly & pauses verified broken tasks)
CREATE OR REPLACE FUNCTION public.fn_report_broken_task(
  p_task_id uuid,
  p_reason text,
  p_detail text DEFAULT NULL,
  p_verified_broken boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := lower(btrim(COALESCE(p_reason, 'other')));
  v_task public.tasks;
  v_report_count int;
  v_paused boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  IF v_reason NOT IN ('no_link', 'gone_410', 'not_found_404', 'closed_topic', 'other') THEN
    v_reason := 'other';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.task_issue_reports (task_id, user_id, reason, detail, verified_broken)
  VALUES (p_task_id, v_uid, v_reason, NULLIF(btrim(p_detail), ''), COALESCE(p_verified_broken, false))
  ON CONFLICT (task_id, user_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    detail = EXCLUDED.detail,
    verified_broken = task_issue_reports.verified_broken OR EXCLUDED.verified_broken,
    created_at = now();

  -- Release user's in_progress slot if any so they don't lose quota / get penalized
  UPDATE public.task_assignments
  SET status = 'rejected',
      can_retry = true,
      admin_notes = 'Slot dilepas oleh member (laporan link bermasalah: ' || v_reason || ')',
      updated_at = now()
  WHERE task_id = p_task_id
    AND user_id = v_uid
    AND status = 'in_progress';

  PERFORM public.sync_task_slot_count(p_task_id);

  SELECT count(*) INTO v_report_count FROM public.task_issue_reports WHERE task_id = p_task_id;

  -- Auto-pause if confirmed by server probe OR >= 2 distinct members reported it OR URL is structurally invalid
  IF COALESCE(p_verified_broken, false)
     OR v_report_count >= 2
     OR public.fn_is_invalid_task_url(v_task.target_url) THEN
    UPDATE public.tasks
    SET status = 'paused',
        url_status = CASE
          WHEN v_reason = 'no_link' THEN 'invalid_url'
          ELSE v_reason
        END,
        url_checked_at = now(),
        url_check_error = COALESCE(NULLIF(btrim(p_detail), ''), 'Auto-paused: ' || v_reason),
        eligibility_reason = COALESCE(NULLIF(btrim(p_detail), ''), 'Auto-paused: ' || v_reason),
        updated_at = now()
    WHERE id = p_task_id
      AND status = 'active';
    v_paused := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'paused', v_paused,
    'report_count', v_report_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_report_broken_task(uuid, text, text, boolean) TO authenticated;

-- 12. Admin URL Health Update RPC
CREATE OR REPLACE FUNCTION public.admin_mark_task_url_health(
  p_task_id uuid,
  p_url_status text,
  p_error text DEFAULT NULL,
  p_pause_if_broken boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_is_broken boolean := p_url_status IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tasks
  SET url_status = p_url_status,
      url_checked_at = now(),
      url_check_error = NULLIF(btrim(p_error), ''),
      status = CASE WHEN v_is_broken AND p_pause_if_broken AND status = 'active' THEN 'paused' ELSE status END,
      eligibility_reason = CASE WHEN v_is_broken AND p_pause_if_broken THEN COALESCE(NULLIF(btrim(p_error), ''), p_url_status) ELSE eligibility_reason END,
      updated_at = now()
  WHERE id = p_task_id;

  RETURN jsonb_build_object('ok', true, 'broken', v_is_broken);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_mark_task_url_health(uuid, text, text, boolean) TO authenticated;

-- 13. Backfill & Cleanup Current Database
-- A. Fix broken tasks created from Orders 201..231 (restore proper forum_comment category, title, description, brief)
DO $$
DECLARE
  r RECORD;
  v_notes jsonb;
  v_platform text;
  v_brand text;
  v_comment text;
  v_mode text;
BEGIN
  FOR r IN
    SELECT t.id AS task_id, o.*
    FROM public.tasks t
    JOIN public.reddit_upvote_orders o ON o.id = t.source_order_id
    WHERE (t.brief ILIKE '%bulk_source=%' OR t.task_category = 'comment')
      AND o.notes IS NOT NULL AND btrim(o.notes) LIKE '{%'
  LOOP
    BEGIN
      v_notes := r.notes::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    IF COALESCE(v_notes->>'service', '') = 'forum_comment' THEN
      v_platform := public.forum_platform_label(r.thread_url, COALESCE(v_notes->>'platform', r.subreddit));
      v_brand    := COALESCE(NULLIF(btrim(v_notes->>'brand_name'), ''), NULLIF(btrim(v_notes->>'brand_domain'), ''), '');
      v_comment  := NULLIF(btrim(v_notes->>'comment_text'), '');
      v_mode     := COALESCE(NULLIF(btrim(v_notes->>'brand_mention_mode'), ''), 'plain');

      UPDATE public.tasks
      SET task_category = 'forum_comment',
          task_type = 'comment',
          title = CASE WHEN v_brand <> '' THEN format('Post comment di %s (mention %s)', v_platform, v_brand) ELSE format('Post comment di %s', v_platform) END,
          description = format('Buka thread di %s. Baca konteks diskusi dengan cermat, lalu kirimkan komentar yang sudah disediakan. Pastikan komentar terbit secara publik sebelum submit bukti.', v_platform),
          brief = public.forum_comment_task_brief(r.thread_url, v_comment, v_brand, v_mode, COALESCE((v_notes->>'is_reply')::boolean, false), v_notes->>'reply_to_comment'),
          updated_at = now()
      WHERE id = r.task_id;
    END IF;
  END LOOP;
END $$;

-- B. Pause all unworked active tasks whose URL is a search page / 410 / confirmed closed topic
UPDATE public.tasks
SET status = 'paused',
    url_status = CASE
      WHEN target_url ILIKE '%indiehackers.com/search%' OR target_url ILIKE '%community.hubspot.com/t5/forums/searchpage%' THEN 'gone_410'
      WHEN public.fn_is_invalid_task_url(target_url) THEN 'search_page'
      ELSE url_status
    END,
    url_checked_at = now(),
    url_check_error = CASE
      WHEN target_url ILIKE '%indiehackers.com/search%' OR target_url ILIKE '%community.hubspot.com/t5/forums/searchpage%' THEN 'HTTP 410 Gone (Search Page URL)'
      ELSE 'URL adalah halaman search, bukan thread diskusi langsung'
    END,
    updated_at = now()
WHERE status = 'active'
  AND COALESCE(task_category, '') <> 'reddit_challenge'
  AND public.fn_is_invalid_task_url(target_url)
  AND current_assignments < max_assignments;

-- Mark the already-submitted search/410 tasks too so Admin sees warning badge without hiding existing submissions
UPDATE public.tasks
SET url_status = CASE
      WHEN target_url ILIKE '%indiehackers.com/search%' OR target_url ILIKE '%community.hubspot.com/t5/forums/searchpage%' THEN 'gone_410'
      ELSE 'search_page'
    END,
    url_checked_at = now(),
    url_check_error = 'HTTP 410 Gone / Search Page URL'
WHERE COALESCE(task_category, '') <> 'reddit_challenge'
  AND public.fn_is_invalid_task_url(target_url)
  AND url_status IS NULL;

-- Pause unworked confirmed closed/locked threads (Spiceworks Discourse closed & nhimg wpForo Closed)
UPDATE public.tasks
SET status = 'paused',
    url_status = 'closed_topic',
    url_checked_at = now(),
    url_check_error = 'Thread / kolom komentar sudah ditutup (Closed/Locked) di forum target',
    updated_at = now()
WHERE status = 'active'
  AND source_order_id IN (137, 138, 152, 153, 154)
  AND current_assignments < max_assignments;

UPDATE public.tasks
SET url_status = 'closed_topic',
    url_checked_at = now(),
    url_check_error = 'Thread / kolom komentar sudah ditutup (Closed/Locked) di forum target'
WHERE source_order_id IN (137, 138, 152, 153, 154, 159)
  AND url_status IS NULL;

NOTIFY pgrst, 'reload schema';
