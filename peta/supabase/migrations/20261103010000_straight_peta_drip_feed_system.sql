-- ============================================================
-- Migration: 20261103010000_straight_peta_drip_feed_system.sql
--
-- Adds Drip Feed capability across Straight.ltd and PeTa:
--   1. Columns on reddit_upvote_orders & tasks:
--      - drip_interval_hours: 0 = instant, 24 = 1/day, 48 = 1/2 days, etc.
--      - drip_total_target: total target assignments for the order (e.g. 5)
--      - drip_next_release_at: timestamp when the next slot unlocks
--   2. Hardens sync_task_slot_count:
--      - Evaluates completion against drip_total_target (not premature max_assignments)
--   3. Automated drip release engine:
--      - process_drip_feed_tasks() checks due drip tasks and increments max_assignments
--      - Hooks into cancel_expired_assignments() (runs every 10m in production)
--   4. Updates order RPCs to accept p_drip_interval_hours:
--      - fn_create_yelp_review_order
--      - fn_create_clutch_review_order
--      - fn_create_trustpilot_order
--      - fn_create_google_maps_review_order
--   5. Updates fn_ensure_order_task with drip-feed slot initialization
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Schema additions
-- ------------------------------------------------------------
ALTER TABLE public.reddit_upvote_orders
  ADD COLUMN IF NOT EXISTS drip_interval_hours INT DEFAULT 0;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS drip_interval_hours INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drip_total_target INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drip_next_release_at TIMESTAMPTZ DEFAULT NULL;

-- ------------------------------------------------------------
-- 2. Hardened sync_task_slot_count with drip_total_target awareness
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_task_slot_count(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live int;
  v_approved int;
  v_max int;
  v_target_total int;
  v_task public.tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN; END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  v_max := COALESCE(v_task.max_assignments, 0);
  v_target_total := COALESCE(NULLIF(v_task.drip_total_target, 0), v_max);

  -- Count only approved assignments for task completion check
  SELECT count(*)::integer INTO v_approved
  FROM public.task_assignments
  WHERE task_id = p_task_id AND status = 'approved';

  UPDATE public.tasks
  SET current_assignments = LEAST(v_max, v_live),
      status = CASE
        -- Only mark completed when ALL required target slots are APPROVED
        WHEN status = 'active' AND v_approved >= v_target_total THEN 'completed'
        -- Reopen if task was completed but assignments got rejected/reverted
        WHEN status = 'completed' AND v_approved < v_target_total THEN 'active'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_task_id;
END $$;

-- ------------------------------------------------------------
-- 3. process_drip_feed_tasks engine
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_drip_feed_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released_count int := 0;
  r RECORD;
  v_fulfilled_count int;
BEGIN
  FOR r IN
    SELECT t.id, t.max_assignments, t.drip_total_target, t.drip_interval_hours
    FROM public.tasks t
    WHERE t.status = 'active'
      AND COALESCE(t.drip_interval_hours, 0) > 0
      AND t.drip_total_target > 0
      AND t.max_assignments < t.drip_total_target
      AND t.drip_next_release_at IS NOT NULL
      AND NOW() >= t.drip_next_release_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Safety check: Ensure previous slots have at least been submitted or approved
    SELECT count(*)::int INTO v_fulfilled_count
    FROM public.task_assignments ta
    WHERE ta.task_id = r.id
      AND ta.status IN ('submitted', 'approved');

    IF v_fulfilled_count >= r.max_assignments THEN
      UPDATE public.tasks
      SET
        max_assignments = r.max_assignments + 1,
        drip_next_release_at = CASE
          WHEN r.max_assignments + 1 >= r.drip_total_target THEN NULL
          ELSE NOW() + (r.drip_interval_hours || ' hours')::interval
        END,
        updated_at = NOW()
      WHERE id = r.id;

      PERFORM public.sync_task_slot_count(r.id);
      v_released_count := v_released_count + 1;
    END IF;
  END LOOP;

  RETURN v_released_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_drip_feed_tasks() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Hook process_drip_feed_tasks into cancel_expired_assignments
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_expired_assignments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_task_ids uuid[];
BEGIN
  -- Find all expired in_progress assignments
  SELECT ARRAY_AGG(DISTINCT task_id) INTO v_task_ids
  FROM public.task_assignments
  WHERE status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)',
      can_retry = true,
      updated_at = NOW()
  WHERE status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Re-sync slot counts for affected tasks
  IF v_task_ids IS NOT NULL THEN
    PERFORM public.sync_task_slot_count(tid) FROM unnest(v_task_ids) AS tid;
  END IF;

  -- Process due drip-feed tasks
  PERFORM public.process_drip_feed_tasks();

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_expired_assignments() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Update fn_ensure_order_task with Drip Feed support
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

  v_initial_status := CASE WHEN v_auto_activate THEN 'active' ELSE 'paused' END;

  -- Drip feed determination
  v_drip_hours := COALESCE(
    p_order.drip_interval_hours,
    NULLIF((v_notes->>'drip_interval_hours')::text, '')::int,
    0
  );

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
    v_title,
    v_description,
    v_brief,
    p_order.thread_url,
    v_task_type,
    v_task_category,
    v_reward,
    v_initial_max,
    0,
    0,
    0,
    1,
    v_initial_status,
    false,
    v_creator,
    p_order.id,
    v_drip_hours,
    v_drip_target,
    v_drip_next
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$fn$;

-- ------------------------------------------------------------
-- 6. Update order creation RPCs to accept p_drip_interval_hours
-- ------------------------------------------------------------

-- A. Yelp
CREATE OR REPLACE FUNCTION public.fn_create_yelp_review_order(
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_drip_interval_hours INT DEFAULT 0
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
  v_drip_hours INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

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

  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://(?:[a-z0-9-]+\.)*(?:yelp\.[a-z.]+|yelp\.to)/[^\s]+' THEN
    RAISE EXCEPTION 'Please enter a valid Yelp business page URL (https://www.yelp.com/biz/...)' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20' USING ERRCODE = 'P0001';
  END IF;

  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF v_drip_hours < 0 OR v_drip_hours > 168 THEN
    v_drip_hours := 0;
  END IF;

  v_unit_price := public.fn_straight_unit_price('yelp_review', 500);
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
    'service', 'yelp_review',
    'platform', 'yelp',
    'target_url', v_url,
    'quantity', v_quantity,
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', COALESCE(NULLIF(btrim(COALESCE(p_review_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), ''),
    'drip_interval_hours', v_drip_hours
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id,
    v_url,
    'Yelp',
    'yelp_review',
    v_quantity,
    v_cost,
    v_notes::text,
    v_drip_hours
  )
  RETURNING * INTO v_order;

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
      'service', 'yelp_review',
      'price_key', 'yelp_review',
      'quantity', v_quantity,
      'drip_interval_hours', v_drip_hours,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_yelp_review_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_yelp_review_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) TO authenticated;

-- B. Clutch
CREATE OR REPLACE FUNCTION public.fn_create_clutch_review_order(
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_drip_interval_hours INT DEFAULT 0
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
  v_drip_hours INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

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

  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://(?:[a-z0-9-]+\.)*(?:clutch\.co|review\.clutch\.co)/[^\s]+' THEN
    RAISE EXCEPTION 'Please enter a valid Clutch profile or review page URL (https://clutch.co/profile/...)' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20' USING ERRCODE = 'P0001';
  END IF;

  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF v_drip_hours < 0 OR v_drip_hours > 168 THEN
    v_drip_hours := 0;
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
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), ''),
    'drip_interval_hours', v_drip_hours
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id,
    v_url,
    'Clutch',
    'clutch_review',
    v_quantity,
    v_cost,
    v_notes::text,
    v_drip_hours
  )
  RETURNING * INTO v_order;

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
      'drip_interval_hours', v_drip_hours,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_clutch_review_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_clutch_review_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) TO authenticated;

-- C. Trustpilot
CREATE OR REPLACE FUNCTION public.fn_create_trustpilot_order(
  p_target_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT NULL,
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_drip_interval_hours INT DEFAULT 0
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_user_id UUID;
  v_unit_price INTEGER;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_quantity INT;
  v_url TEXT;
  v_notes JSONB;
  v_draft JSONB;
  v_draft_text TEXT;
  v_drip_hours INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF p_request_id IS NOT NULL AND length(trim(p_request_id)) > 0 THEN
    SELECT o.* INTO v_order
    FROM public.reddit_upvote_orders o
    JOIN public.credit_transactions ct
      ON ct.metadata->>'reddit_upvote_order_id' = o.id::text
     AND ct.metadata->>'request_id' = trim(p_request_id)
    WHERE o.user_id = v_user_id
      AND o.created_at >= NOW() - INTERVAL '15 minutes'
    LIMIT 1;
    IF v_order.id IS NOT NULL THEN
      RETURN v_order;
    END IF;
  END IF;

  v_url := btrim(COALESCE(p_target_url, ''));
  IF v_url IS NULL OR length(v_url) < 10 OR v_url !~* '^https?://(?:[a-z0-9-]+\.)*trustpilot\.com/review/[^\s]+' THEN
    RAISE EXCEPTION 'Please enter a valid Trustpilot business page URL (https://www.trustpilot.com/review/...)' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20' USING ERRCODE = 'P0001';
  END IF;

  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF v_drip_hours < 0 OR v_drip_hours > 168 THEN
    v_drip_hours := 0;
  END IF;

  v_unit_price := public.fn_straight_unit_price('trustpilot_review', 500);
  v_cost := v_unit_price * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users WHERE id = v_user_id FOR UPDATE;

  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001'; END IF;
  IF v_user_balance < v_cost THEN RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001'; END IF;

  v_notes := jsonb_build_object(
    'service', 'trustpilot_review',
    'platform', 'trustpilot',
    'target_url', v_url,
    'quantity', v_quantity,
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', COALESCE(NULLIF(btrim(COALESCE(p_review_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), ''),
    'drip_interval_hours', v_drip_hours
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id, v_url, 'Trustpilot', 'trustpilot_review',
    v_quantity, v_cost, v_notes::text, v_drip_hours
  )
  RETURNING * INTO v_order;

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
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'trustpilot_review',
      'price_key', 'trustpilot_review',
      'quantity', v_quantity,
      'drip_interval_hours', v_drip_hours,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_trustpilot_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_trustpilot_order(TEXT, INT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) TO authenticated;

-- D. Google Maps
CREATE OR REPLACE FUNCTION public.fn_create_google_maps_review_order(
  p_target_url TEXT,
  p_quantity INT,
  p_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT 'brief',
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT '[]'::jsonb,
  p_request_id TEXT DEFAULT NULL,
  p_drip_interval_hours INT DEFAULT 0
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id UUID;
  v_user_balance INT;
  v_quantity INT;
  v_unit_price INT;
  v_cost INT;
  v_price_key TEXT;
  v_has_location BOOLEAN;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_existing_order_id INT;
  v_draft JSONB;
  v_draft_text TEXT;
  v_drip_hours INT;
  i INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NOT NULL AND length(btrim(p_request_id)) > 0 THEN
    SELECT (ct.metadata->>'reddit_upvote_order_id')::int
    INTO v_existing_order_id
    FROM public.credit_transactions ct
    WHERE ct.user_id = v_user_id
      AND ct.metadata->>'request_id' = btrim(p_request_id)
      AND ct.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY ct.id DESC
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = v_existing_order_id;
      IF v_order.id IS NOT NULL THEN
        RETURN v_order;
      END IF;
    END IF;
  END IF;

  IF p_target_url IS NULL OR length(btrim(p_target_url)) < 10 OR
     p_target_url !~* '^https?://(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|goo\.gl)/[^\s]+' THEN
    RAISE EXCEPTION 'Please enter a valid Google Maps place URL' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 20 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 20' USING ERRCODE = 'P0001';
  END IF;

  v_drip_hours := COALESCE(p_drip_interval_hours, 0);
  IF v_drip_hours < 0 OR v_drip_hours > 168 THEN
    v_drip_hours := 0;
  END IF;

  v_has_location := p_location IS NOT NULL AND length(btrim(p_location)) > 0;
  IF v_has_location THEN
    v_price_key := 'google_maps_review_targeted';
    v_unit_price := public.fn_straight_unit_price('google_maps_review_targeted', 600);
  ELSE
    v_price_key := 'google_maps_review';
    v_unit_price := public.fn_straight_unit_price('google_maps_review', 500);
  END IF;
  v_cost := v_unit_price * v_quantity;

  SELECT credit_balance INTO v_user_balance
  FROM public.users WHERE id = v_user_id FOR UPDATE;

  IF v_user_balance IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'google_maps_review',
    'platform', 'google_maps',
    'target_url', btrim(p_target_url),
    'quantity', v_quantity,
    'target_location', CASE WHEN v_has_location THEN btrim(p_location) ELSE NULL END,
    'review_mode', COALESCE(p_review_mode, 'brief'),
    'review_brief', COALESCE(NULLIF(btrim(COALESCE(p_review_brief, '')), ''), ''),
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), ''),
    'drip_interval_hours', v_drip_hours
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes, drip_interval_hours
  ) VALUES (
    v_user_id, btrim(p_target_url), 'Google Maps', 'google_maps_review',
    v_quantity, v_cost, v_notes::text, v_drip_hours
  )
  RETURNING * INTO v_order;

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
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'google_maps_review',
      'price_key', v_price_key,
      'quantity', v_quantity,
      'drip_interval_hours', v_drip_hours,
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_google_maps_review_order(TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_google_maps_review_order(TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, INT) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
