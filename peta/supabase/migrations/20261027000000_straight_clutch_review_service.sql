-- Migration: 20261027000000_straight_clutch_review_service.sql
-- Straight Ltd — Clutch.co B2B Review Service ($5.00 / review)
--
-- Adds Clutch.co Review service:
--   - $5.00 / review (500 cents), PeTa worker reward Rp5.000
--   - Quantity: 1-20 reviews per order
--   - Review modes: brief guidelines OR custom review drafts
--   - Accountless in PeTa (no Reddit account required)
--   - Strict cross-order target dedup: 1 worker can only review
--     the same Clutch business target URL once across all orders
--   - Auto-activation: orders mint ACTIVE PeTa tasks immediately
--   - Satisfies all Task Visibility Invariants

BEGIN;

-- ------------------------------------------------------------
-- 1. Update check constraints
-- ------------------------------------------------------------
ALTER TABLE public.reddit_upvote_orders
  DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;
ALTER TABLE public.reddit_upvote_orders
  ADD CONSTRAINT reddit_upvote_orders_target_type_check
  CHECK (target_type IN (
    'upvote', 'comment', 'thread', 'youtube_upload',
    'preferred_source', 'linkedin_like', 'linkedin_follow',
    'linkedin_comment', 'trustpilot_review', 'google_maps_review',
    'quora_upvote', 'reseller_order', 'yelp_review', 'clutch_review'
  ));

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_category_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN (
    'reddit_upvote', 'reddit_comment', 'reddit_post_thread', 'forum_comment',
    'youtube_upload', 'preferred_source', 'reddit_challenge',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review', 'quora_upvote',
    'yelp_review', 'clutch_review'
  ));

ALTER TABLE public.straight_pricing
  DROP CONSTRAINT IF EXISTS straight_pricing_platform_check;
ALTER TABLE public.straight_pricing
  ADD CONSTRAINT straight_pricing_platform_check
  CHECK (platform IN ('reddit', 'forum', 'youtube', 'google', 'linkedin', 'trustpilot', 'quora', 'yelp', 'clutch'));

-- ------------------------------------------------------------
-- 2. Seed pricing in straight_pricing ($5.00 = 500 cents)
-- ------------------------------------------------------------
INSERT INTO public.straight_pricing (
  key, platform, service, mention_mode, label, price_cents, enabled, sort_order
) VALUES (
  'clutch_review', 'clutch', 'review', 'none', 'Clutch.co — Verified B2B Review', 500, true, 34
)
ON CONFLICT (key) DO UPDATE SET
  platform = EXCLUDED.platform,
  service = EXCLUDED.service,
  label = EXCLUDED.label,
  price_cents = EXCLUDED.price_cents,
  sort_order = EXCLUDED.sort_order;

-- ------------------------------------------------------------
-- 3. Order creation RPC: fn_create_clutch_review_order
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_clutch_review_order(
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id UUID;
  v_unit_price INT;
  v_cost INT;
  v_user_balance INT;
  v_order public.reddit_upvote_orders;
  v_quantity INT;
  v_url TEXT;
  v_notes JSONB;
  v_draft JSONB;
  v_draft_text TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Idempotency check if client supplied request_id
  IF p_request_id IS NOT NULL AND length(trim(p_request_id)) > 0 THEN
    SELECT o.* INTO v_order
    FROM public.reddit_upvote_orders o
    JOIN public.credit_transactions ct
      ON ct.metadata->>'reddit_upvote_order_id' = o.id::text
     AND ct.metadata->>'request_id' = trim(p_request_id)
    WHERE o.user_id = v_user_id
      AND o.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY o.id DESC
    LIMIT 1;

    IF v_order.id IS NOT NULL THEN
      RETURN v_order;
    END IF;
  END IF;

  -- Target URL validation (must be valid Clutch profile or review URL)
  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://(?:[a-z0-9-]+\.)*(?:clutch\.co|review\.clutch\.co)/[^\s]+' THEN
    RAISE EXCEPTION 'Please enter a valid Clutch profile or review page URL (https://clutch.co/profile/...)' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20' USING ERRCODE = 'P0001';
  END IF;

  v_unit_price := public.fn_straight_unit_price('clutch_review', 500);
  v_cost := v_unit_price * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_user_balance IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'clutch_review',
    'platform', 'clutch',
    'target_url', v_url,
    'quantity', v_quantity,
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', COALESCE(NULLIF(btrim(COALESCE(p_review_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    v_url,
    'Clutch',
    'clutch_review',
    v_quantity,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  -- Store drafts if custom review drafts provided
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

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_cost,
    v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'clutch_review',
      'price_key', 'clutch_review',
      'quantity', v_quantity,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_clutch_review_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_clutch_review_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4. Update fn_ensure_order_task with Clutch mapping
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(p_order public.reddit_upvote_orders)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_notes            jsonb   := '{}'::jsonb;
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
  v_yt_title         text;
  v_yt_description   text;
  v_yt_tags          text;
  v_yt_privacy       text;
  v_domain           text;
  v_creator          uuid;
  v_task_id          uuid;
  v_auto_activate    boolean;
  v_initial_status   text;
BEGIN
  IF p_order.status NOT IN ('pending', 'processing') THEN RETURN NULL; END IF;

  SELECT id INTO v_task_id FROM tasks WHERE source_order_id = p_order.id;
  IF v_task_id IS NOT NULL THEN RETURN v_task_id; END IF;

  BEGIN
    v_notes := COALESCE(p_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_youtube_upload := COALESCE(p_order.target_type, '') = 'youtube_upload'
                         OR v_notes->>'service' = 'youtube_upload';
  v_is_forum_comment  := COALESCE(p_order.target_type, '') = 'comment'
                         AND COALESCE(v_notes->>'service', '') = 'forum_comment';
  v_is_preferred      := COALESCE(p_order.target_type, 'upvote') = 'preferred_source'
                         OR v_notes->>'service' = 'preferred_source';
  v_is_linkedin_like    := COALESCE(p_order.target_type, '') = 'linkedin_like'
                         OR v_notes->>'service' = 'linkedin_like';
  v_is_linkedin_follow  := COALESCE(p_order.target_type, '') = 'linkedin_follow'
                         OR v_notes->>'service' = 'linkedin_follow';
  v_is_linkedin_comment := COALESCE(p_order.target_type, '') = 'linkedin_comment'
                         OR v_notes->>'service' = 'linkedin_comment';
  v_is_trustpilot       := COALESCE(p_order.target_type, '') = 'trustpilot_review'
                         OR v_notes->>'service' = 'trustpilot_review';
  v_is_gmaps            := COALESCE(p_order.target_type, '') = 'google_maps_review'
                         OR v_notes->>'service' = 'google_maps_review';
  v_is_yelp             := COALESCE(p_order.target_type, '') = 'yelp_review'
                         OR v_notes->>'service' = 'yelp_review';
  v_is_clutch           := COALESCE(p_order.target_type, '') = 'clutch_review'
                         OR v_notes->>'service' = 'clutch_review';

  v_task_type := CASE
    WHEN p_order.target_type = 'upvote' THEN 'upvote'
    WHEN v_is_preferred      THEN 'upvote'
    WHEN v_is_linkedin_like  THEN 'upvote'
    WHEN v_is_linkedin_follow THEN 'upvote'
    WHEN v_is_youtube_upload THEN 'upload'
    ELSE 'comment'
  END;

  v_task_category := CASE
    WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote'
    WHEN v_is_preferred        THEN 'preferred_source'
    WHEN v_is_linkedin_like    THEN 'linkedin_like'
    WHEN v_is_linkedin_follow  THEN 'linkedin_follow'
    WHEN v_is_linkedin_comment THEN 'linkedin_comment'
    WHEN v_is_trustpilot       THEN 'trustpilot_review'
    WHEN v_is_gmaps            THEN 'google_maps_review'
    WHEN v_is_yelp             THEN 'yelp_review'
    WHEN v_is_clutch           THEN 'clutch_review'
    WHEN v_is_forum_comment    THEN 'forum_comment'
    WHEN v_is_youtube_upload   THEN 'youtube_upload'
    WHEN p_order.target_type = 'thread' THEN 'reddit_post_thread'
    ELSE 'reddit_comment'
  END;

  v_platform     := public.forum_platform_label(p_order.thread_url, COALESCE(v_notes->>'platform', p_order.subreddit));
  v_brand        := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');
  v_location     := NULLIF(v_notes->>'target_location', '');

  v_yt_title       := NULLIF(v_notes->>'title', '');
  v_yt_description := NULLIF(v_notes->>'description', '');
  v_yt_tags        := NULLIF(v_notes->>'tags', '');
  v_yt_privacy     := COALESCE(NULLIF(v_notes->>'privacy', ''), 'unlisted');

  v_domain := lower((regexp_match(p_order.thread_url, 'https?://(?:www\.)?([^/:?#]+)'))[1]);

  v_reward := CASE
    WHEN v_is_clutch           THEN 5000
    WHEN v_is_yelp             THEN 5000
    WHEN v_is_gmaps            THEN CASE WHEN v_location IS NOT NULL THEN 6000 ELSE 5000 END
    WHEN v_is_trustpilot       THEN 5000
    WHEN v_is_linkedin_like    THEN 1000
    WHEN v_is_linkedin_follow  THEN 1500
    WHEN v_is_linkedin_comment THEN 3000
    WHEN v_is_preferred        THEN 2500
    WHEN v_is_youtube_upload   THEN 10000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 3000
  END;

  v_title := CASE
    WHEN v_is_clutch THEN
      format('Tulis review Clutch B2B bintang 5: %s', COALESCE(NULLIF(v_domain, ''), 'Perusahaan Klien'))
    WHEN v_is_yelp THEN
      format('Tulis review Yelp bintang 5: %s', COALESCE(NULLIF(v_domain, ''), 'Bisnis Klien'))
    WHEN v_is_gmaps THEN
      CASE
        WHEN v_location IS NOT NULL THEN format('Tulis review Google Maps (%s): Bisnis Klien', v_location)
        ELSE 'Tulis review Google Maps bintang 5 untuk Bisnis Klien'
      END
    WHEN v_is_trustpilot THEN
      format('Tulis review di Trustpilot: %s', COALESCE(NULLIF(v_domain, ''), 'Bisnis Klien'))
    WHEN v_is_linkedin_like THEN
      'Beri Like postingan di LinkedIn'
    WHEN v_is_linkedin_follow THEN
      'Follow Company Page di LinkedIn'
    WHEN v_is_linkedin_comment THEN
      'Tulis komentar di post LinkedIn'
    WHEN v_is_preferred THEN
      format('Jadikan "%s" sebagai Preferred Source di Google', COALESCE(NULLIF(v_domain, ''), 'domain klien'))
    WHEN v_is_youtube_upload THEN
      format('Upload Video ke Channel YouTube: "%s"', COALESCE(NULLIF(v_yt_title, ''), 'Video Klien'))
    WHEN v_is_forum_comment THEN
      CASE
        WHEN v_brand IS NOT NULL THEN format('Post comment di %s (mention %s)', v_platform, v_brand)
        ELSE format('Post comment di %s', v_platform)
      END
    WHEN v_task_type = 'upvote' THEN
      format('Upvote post di r/%s', COALESCE(p_order.subreddit, 'reddit'))
    ELSE
      format('Komentar di r/%s', COALESCE(p_order.subreddit, 'reddit'))
  END;

  v_description := CASE
    WHEN v_is_clutch THEN
      'Wajib login menggunakan akun LinkedIn atau Google profesional. Buka formulir review Clutch.co untuk profil perusahaan klien. Isi seluruh 5 bagian kuesioner (Background, Challenge, Solution, Results, Ratings) secara detail dan realistis dalam Bahasa Inggris. Pilih opsi Remain Anonymous jika ingin merahasiakan nama di profil publik. Upload screenshot bukti formulir ulasan berhasil disubmit.'
    WHEN v_is_yelp THEN
      'Wajib aktifkan VPN US / UK (Windscribe) sebelum klik link. Buka halaman bisnis Yelp klien, berikan rating bintang 5, dan tulis review otentik dalam Bahasa Inggris minimal 3-4 kalimat. Akun Yelp wajib menggunakan nama Western/English dan memiliki foto profil avatar. Upload screenshot bukti review publik terbit.'
    WHEN v_is_gmaps THEN
      CASE
        WHEN v_location IS NOT NULL THEN
          format('Buka link Google Maps bisnis klien. Pastikan akun Google kamu aktif dan berada di/sekitar %s. Tulis ulasan bintang 5 yang jujur dan relevan minimal 2-3 kalimat. Upload screenshot bukti ulasan publik yang sudah terbit.', v_location)
        ELSE
          'Buka link Google Maps bisnis klien. Berikan rating bintang 5 dan tulis ulasan otentik minimal 2-3 kalimat yang menceritakan pengalaman positif. Upload screenshot bukti ulasan publik yang sudah terbit.'
      END
    WHEN v_is_trustpilot THEN
      'Wajib aktifkan VPN US/UK (Windscribe) sebelum membuka link. Buka halaman profil Trustpilot klien, berikan rating bintang 5, dan tulis review otentik dalam Bahasa Inggris minimal 3 kalimat. Wajib menggunakan akun Trustpilot dengan nama Bule/English. Upload screenshot bukti review terbit.'
    WHEN v_is_linkedin_like THEN
      'Buka tautan postingan LinkedIn berikut menggunakan akun LinkedIn aktif kamu. Berikan Like (atau reaction jempol/tepuk tangan) pada postingan tersebut. Ambil screenshot halaman postingan yang memperlihatkan tombol Like sudah aktif dan upload sebagai bukti penyelesaian.'
    WHEN v_is_linkedin_follow THEN
      'Buka tautan halaman LinkedIn Company Page berikut. Klik tombol Follow untuk mengikuti halaman perusahaan. Ambil screenshot yang memperlihatkan status Following pada halaman tersebut dan upload sebagai bukti penyelesaian.'
    WHEN v_is_linkedin_comment THEN
      'Buka tautan postingan LinkedIn berikut. Tulis komentar profesional yang relevan dengan topik postingan (minimal 1-2 kalimat, natural, dan tidak terlihat seperti bot). Ambil screenshot komentar kamu yang sudah terbit di kolom komentar dan upload sebagai bukti.'
    WHEN v_is_preferred THEN
      'Klik tombol "Jadikan Sumber Pilihan" pada halaman profil topik Google yang terbuka. Pastikan tombol berubah status menjadi terpilih/mengikuti. Upload screenshot bukti bahwa situs telah menjadi Preferred Source kamu.'
    WHEN v_is_youtube_upload THEN
      'Download video dari link yang disediakan, lalu upload ke channel YouTube aktif kamu dengan judul, deskripsi, tag, dan setelan privasi yang ditentukan di instruksi tugas ini.'
    WHEN v_is_forum_comment THEN
      format('Buka thread di %s. Baca konteks diskusi dengan cermat, lalu kirimkan komentar yang sudah disediakan atau tulis komentar yang relevan dengan brief. Pastikan komentar kamu terbit secara publik sebelum submit bukti.', v_platform)
    WHEN v_task_type = 'upvote' THEN
      'Buka postingan Reddit berikut dan berikan upvote. Jangan downvote, jangan batalkan upvote setelah submit.'
    ELSE
      'Tulis komentar yang relevan dan bernilai tambah pada postingan Reddit ini sesuai dengan brief yang diberikan.'
  END;

  v_brief := CASE
    WHEN v_is_clutch THEN
      COALESCE(NULLIF(v_notes->>'review_brief', ''), NULLIF(v_notes->>'client_notes', ''), 'Tulis ulasan B2B bintang 5 secara komprehensif dalam Bahasa Inggris mencakup Background, Solusi proyek, dan Hasil kepuasan kerja sama.')
    WHEN v_is_yelp THEN
      COALESCE(NULLIF(v_notes->>'review_brief', ''), NULLIF(v_notes->>'client_notes', ''), 'Tulis ulasan bintang 5 positif dalam Bahasa Inggris yang menceritakan pengalaman menggunakan jasa/layanan bisnis klien secara natural.')
    WHEN v_is_gmaps THEN
      COALESCE(NULLIF(v_notes->>'review_brief', ''), NULLIF(v_notes->>'client_notes', ''), 'Tulis ulasan bintang 5 yang mencerminkan pengalaman positif terhadap pelayanan atau produk bisnis ini.')
    WHEN v_is_trustpilot THEN
      COALESCE(NULLIF(v_notes->>'review_brief', ''), NULLIF(v_notes->>'client_notes', ''), 'Tulis ulasan positif dalam Bahasa Inggris yang menceritakan pengalaman memuaskan terhadap bisnis klien.')
    WHEN v_is_linkedin_comment THEN
      COALESCE(NULLIF(v_notes->>'comment_brief', ''), NULLIF(v_notes->>'client_notes', ''), 'Berikan komentar apresiatif dan berbobot yang relevan dengan isi postingan LinkedIn tersebut.')
    WHEN v_is_forum_comment THEN
      COALESCE(NULLIF(v_notes->>'client_notes', ''), 'Komentar diskusi yang natural dan konstruktif.')
    ELSE NULL
  END;

  SELECT id INTO v_creator
  FROM users
  WHERE role IN ('admin', 'lead')
  ORDER BY created_at ASC
  LIMIT 1;

  v_auto_activate := v_is_forum_comment
                  OR v_is_youtube_upload
                  OR v_is_preferred
                  OR v_is_linkedin_like
                  OR v_is_linkedin_follow
                  OR v_is_linkedin_comment
                  OR v_is_trustpilot
                  OR v_is_gmaps
                  OR v_is_yelp
                  OR v_is_clutch;

  v_initial_status := CASE WHEN v_auto_activate THEN 'active' ELSE 'pending_review' END;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    reward_amount, max_assignments, current_assignments,
    min_karma, min_account_age_days, per_account_limit,
    status, is_hidden, created_by, source_order_id
  ) VALUES (
    v_title,
    v_description,
    v_brief,
    p_order.thread_url,
    v_task_type,
    v_task_category,
    v_reward,
    p_order.requested_upvotes,
    0,
    0,
    0,
    1,
    v_initial_status,
    false,
    v_creator,
    p_order.id
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$fn$;

-- ------------------------------------------------------------
-- 5. Update claim_task_assignment with Clutch Review
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_task_assignment(p_task_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid;
  v_task record;
  v_account record;
  v_assignment_id uuid;
  v_norm_target text;
  v_draft_text text;
  v_assigned_draft_index int;
  v_yt_verified boolean := false;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'task_not_found');
  END IF;

  IF v_task.status <> 'active' OR v_task.is_hidden = true THEN
    RETURN json_build_object('success', false, 'error', 'task_not_available');
  END IF;

  IF v_task.start_at IS NOT NULL AND now() < v_task.start_at THEN
    RETURN json_build_object('success', false, 'error', 'task_not_started');
  END IF;

  IF v_task.end_at IS NOT NULL AND now() >= v_task.end_at THEN
    RETURN json_build_object('success', false, 'error', 'task_expired');
  END IF;

  IF v_task.current_assignments >= v_task.max_assignments THEN
    RETURN json_build_object('success', false, 'error', 'task_full');
  END IF;

  -- YouTube Upload guard
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.youtube_accounts ya
      WHERE ya.user_id = v_user
        AND ya.verified_at IS NOT NULL
        AND ya.verification_status = 'approved'
        AND COALESCE(ya.is_active, true) = true
    ) INTO v_yt_verified;

    IF NOT v_yt_verified THEN
      RETURN json_build_object('success', false, 'error', 'youtube_account_not_verified');
    END IF;
  END IF;

  -- Accountless categories: no Reddit account required
  IF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'preferred_source', 'youtube_upload',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review', 'quora_upvote',
    'yelp_review', 'clutch_review'
  ) THEN
    -- Strict cross-order target dedup for link-based tasks
    IF v_task.task_category IN (
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review'
    ) THEN
      v_norm_target := regexp_replace(lower(btrim(COALESCE(v_task.target_url, ''))), '[/?#]+$', '');
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments ta2
        JOIN public.tasks t2 ON t2.id = ta2.task_id
        WHERE ta2.user_id = v_user
          AND t2.task_category = v_task.task_category
          AND regexp_replace(lower(btrim(COALESCE(t2.target_url, ''))), '[/?#]+$', '') = v_norm_target
          AND ta2.status IN ('claimed', 'submitted', 'approved')
      ) THEN
        RETURN json_build_object('success', false, 'error', 'already_engaged_target');
      END IF;
    END IF;

    -- Per-task user limit
    IF (
      SELECT count(*)
      FROM public.task_assignments
      WHERE task_id = p_task_id
        AND user_id = v_user
        AND (
          status IN ('claimed', 'submitted', 'approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        )
    ) >= COALESCE(v_task.per_account_limit, 1) THEN
      RETURN json_build_object('success', false, 'error', 'per_account_limit_reached');
    END IF;

    -- Assign unique draft for comment & review tasks if available
    IF v_task.task_category IN ('forum_comment', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'yelp_review', 'clutch_review')
       AND v_task.source_order_id IS NOT NULL THEN
      SELECT cd.comment_text, cd.draft_index
      INTO v_draft_text, v_assigned_draft_index
      FROM public.reddit_order_comment_drafts cd
      WHERE cd.order_id = v_task.source_order_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.task_assignments ta_d
          JOIN public.tasks t_d ON t_d.id = ta_d.task_id
          WHERE t_d.source_order_id = v_task.source_order_id
            AND ta_d.assigned_draft_index = cd.draft_index
            AND ta_d.status IN ('claimed', 'submitted', 'approved')
        )
      ORDER BY cd.draft_index ASC
      LIMIT 1;
    END IF;

    INSERT INTO public.task_assignments (
      task_id, user_id, reddit_account_id, status, assigned_draft_comment, assigned_draft_index
    ) VALUES (
      p_task_id, v_user, NULL, 'claimed', v_draft_text, v_assigned_draft_index
    )
    RETURNING id INTO v_assignment_id;

    RETURN json_build_object(
      'success', true,
      'assignment_id', v_assignment_id,
      'assigned_draft_comment', v_draft_text
    );
  END IF;

  -- Reddit tasks branch
  SELECT * INTO v_account
  FROM public.reddit_accounts
  WHERE user_id = v_user
    AND status = 'active'
    AND is_active = true
    AND karma >= COALESCE(v_task.min_karma, 0)
    AND account_age_days >= COALESCE(v_task.min_account_age_days, 0)
    AND NOT EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = p_task_id
        AND ta.reddit_account_id = reddit_accounts.id
        AND (
          ta.status IN ('claimed', 'submitted', 'approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    )
  ORDER BY karma DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'no_eligible_account');
  END IF;

  INSERT INTO public.task_assignments (
    task_id, user_id, reddit_account_id, status
  ) VALUES (
    p_task_id, v_user, v_account.id, 'claimed'
  )
  RETURNING id INTO v_assignment_id;

  RETURN json_build_object(
    'success', true,
    'assignment_id', v_assignment_id,
    'reddit_account_id', v_account.id,
    'reddit_username', v_account.username
  );
END;
$fn$;

-- ------------------------------------------------------------
-- 6. Update list_eligible_tasks_for_user with Clutch Review
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  brief text,
  target_url text,
  task_type text,
  task_category text,
  reward_amount integer,
  max_assignments integer,
  current_assignments integer,
  min_karma integer,
  min_account_age_days integer,
  per_account_limit integer,
  status text,
  created_at timestamptz,
  platform text,
  eligible_account_count integer,
  brand_domain text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := p_user_id;
  v_yt_verified boolean := false;
BEGIN
  IF v_user IS NULL THEN
    v_user := auth.uid();
  END IF;

  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  -- 1. Accountless tasks: forum, youtube, google, linkedin, trustpilot, gmaps, quora, yelp, clutch
  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    COALESCE(t.platform, public.forum_platform_label(t.target_url, t.platform)) AS platform,
    1 AS eligible_account_count,
    t.brand_domain
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND COALESCE(t.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review'
    )
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
          ta.status IN ('claimed', 'submitted', 'approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    -- Deduplication for link-based tasks
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
          AND ta_dedup.status IN ('claimed', 'submitted', 'approved')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. Reddit tasks
  RETURN QUERY
  SELECT
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    'Reddit'::text AS platform,
    count(ra.id)::int AS eligible_account_count,
    t.brand_domain
  FROM public.tasks t
  JOIN public.reddit_accounts ra
    ON ra.user_id = v_user
   AND ra.status = 'active'
   AND ra.is_active = true
   AND ra.karma >= COALESCE(t.min_karma, 0)
   AND ra.account_age_days >= COALESCE(t.min_account_age_days, 0)
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND COALESCE(t.task_category, '') NOT IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review', 'reddit_challenge'
    )
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND NOT EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.reddit_account_id = ra.id
        AND (
          ta.status IN ('claimed', 'submitted', 'approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    )
  GROUP BY t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
           t.task_category, t.reward_amount, t.max_assignments,
           t.current_assignments, t.min_karma, t.min_account_age_days,
           t.per_account_limit, t.status, t.created_at, t.brand_domain
  HAVING count(ra.id) > 0
  ORDER BY t.created_at DESC;
END;
$fn$;

COMMIT;
NOTIFY pgrst, 'reload schema';
