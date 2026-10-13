-- Migration: 20261012110000_straight_google_maps_review_service.sql
-- Adds Google Maps Review service ($5.00/review global, $6.00/review specific location).
-- Auto-mints active PeTa Army task with strict anti-drop Google review guidelines (Rp 25.000 / Rp 30.000).

BEGIN;

-- ------------------------------------------------------------
-- 1. Constraints on reddit_upvote_orders & tasks
-- ------------------------------------------------------------
ALTER TABLE public.reddit_upvote_orders DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;
ALTER TABLE public.reddit_upvote_orders ADD CONSTRAINT reddit_upvote_orders_target_type_check
  CHECK (target_type IN (
    'upvote', 'comment', 'thread', 'youtube_upload',
    'preferred_source', 'linkedin_like', 'linkedin_follow',
    'linkedin_comment', 'trustpilot_review', 'google_maps_review'
  ));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_task_category_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN (
    'reddit_upvote', 'reddit_comment', 'reddit_post_thread',
    'forum_comment', 'youtube_upload', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review'
  ));

-- ------------------------------------------------------------
-- 2. Seed Pricing Matrix in straight_pricing
-- ------------------------------------------------------------
INSERT INTO public.straight_pricing (
  key, platform, service, mention_mode, label, price_cents, enabled, sort_order
) VALUES
  ('google_maps_review', 'google', 'review', 'none', 'Google Maps — Review (Any Location)', 500, true, 13),
  ('google_maps_review_location', 'google', 'review', 'none', 'Google Maps — Review (Specific Location)', 600, true, 14)
ON CONFLICT (key) DO UPDATE SET
  price_cents = EXCLUDED.price_cents,
  label = EXCLUDED.label,
  enabled = true;

-- ------------------------------------------------------------
-- 3. Order creation RPC: fn_create_google_maps_review_order
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_google_maps_review_order(
  p_target_url TEXT,
  p_quantity INT,
  p_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_review_mode TEXT DEFAULT 'brief',
  p_review_brief TEXT DEFAULT NULL,
  p_review_drafts JSONB DEFAULT '[]'::jsonb,
  p_request_id TEXT DEFAULT NULL
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
  i INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Idempotency check via request_id in recent transactions
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

  IF p_target_url IS NULL OR length(btrim(p_target_url)) < 8 OR p_target_url !~* '^https?://[^\s]+' THEN
    RAISE EXCEPTION 'URL Google Maps tidak valid' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := GREATEST(1, LEAST(COALESCE(p_quantity, 1), 20));

  v_has_location := p_location IS NOT NULL AND length(btrim(p_location)) > 0;
  v_price_key := CASE WHEN v_has_location THEN 'google_maps_review_location' ELSE 'google_maps_review' END;
  v_unit_price := public.fn_straight_unit_price(v_price_key, CASE WHEN v_has_location THEN 600 ELSE 500 END);
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
    'service', 'google_maps_review',
    'platform', 'google',
    'quantity', v_quantity,
    'price_key', v_price_key,
    'target_url', btrim(p_target_url),
    'target_location', nullif(btrim(coalesce(p_location, '')), ''),
    'review_mode', COALESCE(NULLIF(p_review_mode, ''), 'brief'),
    'review_brief', NULLIF(btrim(COALESCE(p_review_brief, '')), ''),
    'client_notes', NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'draft_count', CASE
      WHEN p_review_drafts IS NOT NULL AND jsonb_typeof(p_review_drafts) = 'array'
        THEN jsonb_array_length(p_review_drafts)
      ELSE 0
    END
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id,
    thread_url,
    subreddit,
    target_type,
    requested_upvotes,
    cost_credits,
    notes
  ) VALUES (
    v_user_id,
    btrim(p_target_url),
    'Google Maps',
    'google_maps_review',
    v_quantity,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  -- Insert custom drafts if supplied
  IF p_review_drafts IS NOT NULL AND jsonb_typeof(p_review_drafts) = 'array' AND jsonb_array_length(p_review_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_review_drafts) - 1 LOOP
      v_draft := p_review_drafts->i;
      v_draft_text := NULLIF(btrim(COALESCE(v_draft->>'comment_text', '')), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  -- Record credit transaction (trigger trg_update_credit_balance will update users.credit_balance)
  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_cost,
    v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'google_maps_review',
      'price_key', v_price_key,
      'quantity', v_quantity,
      'target_location', nullif(btrim(coalesce(p_location, '')), ''),
      'request_id', p_request_id
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_google_maps_review_order(TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_google_maps_review_order(TEXT, INT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4. Update fn_ensure_order_task with Google Maps Review mapping
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(
  p_order public.reddit_upvote_orders
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task_id uuid;
  v_settings public.straight_settings;
  v_notes jsonb;
  v_is_youtube_upload boolean;
  v_is_forum_comment boolean;
  v_is_preferred boolean;
  v_is_linkedin_like boolean;
  v_is_linkedin_follow boolean;
  v_is_linkedin_comment boolean;
  v_is_trustpilot boolean;
  v_is_gmaps boolean;
  v_task_type text;
  v_task_category text;
  v_platform text;
  v_brand text;
  v_comment_text text;
  v_mention_mode text;
  v_yt_title text;
  v_yt_description text;
  v_yt_tags text;
  v_yt_privacy text;
  v_domain text;
  v_location text;
  v_title text;
  v_description text;
  v_brief text;
  v_reward integer;
BEGIN
  SELECT * INTO v_settings FROM public.straight_settings WHERE id = true LIMIT 1;

  SELECT id INTO v_task_id
  FROM public.tasks
  WHERE source_order_id = p_order.id
  LIMIT 1;

  IF v_task_id IS NOT NULL THEN
    RETURN v_task_id;
  END IF;

  BEGIN
    v_notes := p_order.notes::jsonb;
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
    WHEN v_is_gmaps            THEN CASE WHEN v_location IS NOT NULL THEN 30000 ELSE 25000 END
    WHEN v_is_trustpilot       THEN 25000
    WHEN v_is_linkedin_like    THEN 1000
    WHEN v_is_linkedin_follow  THEN 1500
    WHEN v_is_linkedin_comment THEN 4000
    WHEN v_is_preferred        THEN 2500
    WHEN v_is_youtube_upload   THEN 25000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 5000
  END;

  v_title := CASE
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
      format('Preferred Source: pilih %s di Google', COALESCE(NULLIF(v_domain, ''), 'situs klien'))
    WHEN v_is_youtube_upload THEN
      format('Upload video YouTube Shorts (%s)', COALESCE(NULLIF(v_yt_title, ''), 'video baru'))
    WHEN v_is_forum_comment THEN
      format('Tulis komentar di %s: %s', v_platform, COALESCE(NULLIF(v_brand, ''), 'mention brand'))
    WHEN v_task_type = 'upvote' THEN
      format('Upvote postingan r/%s', COALESCE(NULLIF(p_order.subreddit, ''), 'all'))
    WHEN p_order.target_type = 'thread' THEN
      format('Posting thread baru di r/%s', COALESCE(NULLIF(p_order.subreddit, ''), 'all'))
    ELSE
      format('Tulis komentar di r/%s', COALESCE(NULLIF(p_order.subreddit, ''), 'all'))
  END;

  IF v_is_gmaps THEN
    v_description := CASE
      WHEN v_location IS NOT NULL THEN
        format('Wajib akun Google aktif & berumur. Lokasi spesifik: %s. Tulis ulasan bintang 5 yang natural di Google Maps, lalu kirim screenshot bukti & nama akun Google kamu.', v_location)
      ELSE
        'Wajib akun Google aktif & berumur. Jangan gunakan VPN datacenter. Tulis ulasan bintang 5 yang natural di Google Maps, lalu kirim screenshot bukti & nama akun Google kamu.'
    END;

    v_brief := format(
      E'⭐ Misi: Tulis review bintang 5 di Google Maps untuk bisnis target.\n\n' ||
      E'🚨 ATURAN KETAT AGAR REVIEW TIDAK DIHAPUS GOOGLE (WAJIB DIPATUHI):\n' ||
      E'1. AKUN GOOGLE BERUMUR & ASLI: Wajib pakai akun Google pribadi yang sudah aktif lama dan punya riwayat aktivitas. DILARANG KERAS memakai akun baru buat/ternak (Google langsung auto-drop review dari akun baru).\n' ||
      CASE
        WHEN v_location IS NOT NULL THEN
          format(E'2. LOKASI SPESIFIK: Klien meminta ulasan dari area "%s". Pastikan koneksi/profil kamu selaras dengan area tersebut.\n', v_location)
        ELSE
          E'2. TANPA VPN / IP ASLI: Gunakan koneksi seluler/Wi-Fi normal kamu (TIDAK PERLU VPN/Proxy). Dilarang pakai VPN gratis/datacenter karena Google mendeteksi IP tersebut dan menghapus rating!\n'
      END ||
      E'3. ULASAN NATURAL & BINTANG 5: Beri rating bintang 5. Tulis ulasan 2-4 kalimat yang alami seolah-olah kamu adalah pelanggan puas nyata. JANGAN copas kalimat yang sama berulang-ulang.\n' ||
      E'4. REVIEW PUBLIK: Pastikan ulasanmu berhasil tayang dan berstatus Public sebelum screenshot.\n\n' ||
      E'Petunjuk review dari klien:\n%s\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link Google Maps bisnis target di atas\n' ||
      E'2. Klik tombol "Tulis Ulasan" / "Write a review"\n' ||
      E'3. Pilih bintang 5 (⭐⭐⭐⭐⭐)\n' ||
      E'4. Masukkan draft ulasan atau tulis pengalaman positif sesuai petunjuk di atas\n' ||
      E'5. Klik "Posting" / "Post"\n' ||
      E'6. Screenshot ulasan kamu yang sudah tampil di Google Maps\n' ||
      E'7. Masukkan Nama Akun Google Reviewer kamu dan upload screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang hanya boleh 1x me-review bisnis ini.',
      COALESCE(NULLIF(v_notes->>'review_brief', ''), 'Tulis pengalaman positif bintang 5 yang ramah, sopan, dan relevan dengan bisnis.')
    );
  ELSIF v_is_trustpilot THEN
    v_description := 'WAJIB VPN US/UK (Windscribe: https://windscribe.com/id) & NAMA BULE (ENGLISH NAME). Tulis ulasan bintang 5 di Trustpilot sesuai instruksi/draft, lalu kirim screenshot bukti.';
    v_brief := format(
      E'⭐ Misi: Tulis review di Trustpilot untuk bisnis klien internasional.\n\n' ||
      E'🚨 ATURAN MUTLAK VPN, NAMA AKUN & BAHASA REVIEW (WAJIB DIPATUHI):\n' ||
      E'1. WAJIB MENGGUNAKAN VPN KE US / AMERIKA SERIKAT ATAU UK (Gunakan Windscribe gratis: https://windscribe.com/id). Aktifkan VPN sebelum membuka link Trustpilot dan sebelum submit review! Dilarang submit memakai IP Indonesia.\n' ||
      E'2. NAMA AKUN TRUSTPILOT WAJIB NAMA BULE / AMERIKA / ENGLISH (Contoh: Alex Miller, Sarah Jenkins, David Clark, Emily Watson, Michael Brown). DILARANG KERAS menggunakan nama Indonesia / lokal!\n' ||
      E'3. Cara ganti nama: Buka Trustpilot.com -> My Profile / Pengaturan Akun -> Edit Display Name -> ubah jadi nama Bule sebelum menulis review.\n' ||
      E'4. Ulasan WAJIB 100%% dalam BAHASA INGGRIS (English only).\n' ||
      E'5. Review dengan nama Indonesia atau tanpa VPN akan LANGSUNG DI-REJECT tanpa bayaran!\n\n' ||
      E'Petunjuk review dari klien:\n%s\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Aktifkan VPN US / UK (Windscribe: https://windscribe.com/id)\n' ||
      E'2. Pastikan nama akun Trustpilot kamu sudah nama Bule / English (bukan nama Indonesia)\n' ||
      E'3. Buka link Trustpilot bisnis di atas\n' ||
      E'4. Klik "Write a review", beri rating bintang 5\n' ||
      E'5. Gunakan draft ulasan atau tulis ulasan bahasa Inggris yang natural sesuai petunjuk\n' ||
      E'6. Pasang ulasan di profil Trustpilot\n' ||
      E'7. Screenshot ulasan kamu yang sudah terbit di Trustpilot\n' ||
      E'8. Kirim screenshot dan nama akun Trustpilot bule kamu sebagai bukti.\n\n' ||
      E'Catatan: 1 orang hanya boleh 1x me-review bisnis ini.',
      COALESCE(NULLIF(v_notes->>'review_brief', ''), 'Tulis review pengalaman positif bintang 5 dalam bahasa Inggris yang natural dan profesional.')
    );
  ELSIF v_is_linkedin_like THEN
    v_description := 'Buka posting LinkedIn di link target, berikan Like dengan akun LinkedIn pribadimu, lalu kirim screenshot dan URL profilmu.';
    v_brief := format(
      E'👍 Misi: Like postingan LinkedIn target.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link postingan target di atas\n' ||
      E'2. Klik Like pada postingan tersebut menggunakan akun LinkedIn aktifmu\n' ||
      E'3. Screenshot bukti bahwa tombol Like sudah aktif berwarna biru\n' ||
      E'4. Kirim URL profil LinkedIn publikmu dan screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.'
    );
  ELSIF v_is_linkedin_follow THEN
    v_description := 'Buka halaman Company Page LinkedIn di link target, klik Follow dengan akun LinkedIn pribadimu, lalu kirim screenshot bukti.';
    v_brief := format(
      E'🏢 Misi: Follow Company Page LinkedIn target.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link Company Page target di atas\n' ||
      E'2. Klik tombol Follow pada halaman tersebut menggunakan akun LinkedIn pribadimu\n' ||
      E'3. Screenshot bukti bahwa status tombol sudah berubah menjadi Following\n' ||
      E'4. Kirim URL profil LinkedIn publikmu dan screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.'
    );
  ELSIF v_is_linkedin_comment THEN
    v_description := 'Buka posting LinkedIn di link target, tulis komentar relevan dan profesional, lalu kirim screenshot bukti dan permalink komentar.';
    v_brief := format(
      E'💬 Misi: Komentar di posting LinkedIn target.\n\n' ||
      E'Instruksi khusus:\n%s\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link postingan target di atas\n' ||
      E'2. Jika ada draft komentar yang disediakan, gunakan draft tersebut. Jika tidak, tulis komentar yang relevan dan profesional sesuai brief di atas.\n' ||
      E'3. Screenshot komentar kamu setelah berhasil tayang\n' ||
      E'4. Salin permalink komentar dan kirim bersama URL profil LinkedIn publikmu.\n\n' ||
      E'Catatan: Dilarang spam atau komentar tidak nyambung.',
      COALESCE(NULLIF(v_notes->>'comment_brief', ''), 'Tulis komentar profesional dan relevan dengan topik postingan.')
    );
  ELSIF v_is_preferred THEN
    v_description := 'Cari brand di Google Search, temukan tombol Preferred Source, klik untuk menandai sebagai sumber preferensi, lalu kirim screenshot bukti.';
    v_brief := format(
      E'🔍 Misi: Pilih Preferred Source di Google Search.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka Google Search menggunakan akun Google aktifmu\n' ||
      E'2. Akses target URL atau cari sesuai link di atas\n' ||
      E'3. Temukan opsi "Preferred Source" / "Sumber Pilihan" untuk %s dan klik untuk memilih\n' ||
      E'4. Screenshot bukti bahwa tombol sudah terpilih / aktif\n' ||
      E'5. Kirim screenshot tersebut sebagai bukti pengerjaan.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.',
      COALESCE(NULLIF(v_domain, ''), 'situs klien')
    );
  ELSIF v_is_youtube_upload THEN
    v_description := 'Download video dari link target, lalu upload ke channel YouTube kamu sebagai YouTube Shorts dengan title, deskripsi, dan tag yang sudah ditentukan.';
    v_brief := format(
      E'📹 Misi: Upload YouTube Shorts\n\n' ||
      E'Detail Upload:\n' ||
      E'• Judul: %s\n' ||
      E'• Deskripsi: %s\n' ||
      E'• Tags: %s\n' ||
      E'• Privasi: %s\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Download video dari URL di atas\n' ||
      E'2. Buka YouTube Studio / aplikasi YouTube dengan akun YouTube terverifikasi kamu\n' ||
      E'3. Upload video sebagai Shorts dengan judul, deskripsi, dan tag persis seperti di atas\n' ||
      E'4. Atur status privasi sesuai instruksi (%s)\n' ||
      E'5. Salin link video yang sudah terupload dan submit sebagai bukti pengerjaan.\n\n' ||
      E'Catatan: Video wajib tetap tayang minimal 30 hari. Menghapus video akan membatalkan reward.',
      COALESCE(v_yt_title, '-'),
      COALESCE(v_yt_description, '-'),
      COALESCE(v_yt_tags, '-'),
      COALESCE(v_yt_privacy, 'unlisted'),
      COALESCE(v_yt_privacy, 'unlisted')
    );
  ELSIF v_is_forum_comment THEN
    v_description := format('Tulis komentar di %s yang relevan dan natural.', v_platform);
    v_brief := public.forum_comment_task_brief(
      p_order.thread_url,
      v_comment_text,
      v_brand,
      v_mention_mode,
      COALESCE((v_notes->>'is_reply')::boolean, false),
      v_notes->>'reply_to_comment'
    );
  ELSE
    v_description := format('Tulis komentar yang relevan dan bernilai di thread r/%s.', COALESCE(NULLIF(p_order.subreddit, ''), 'all'));
    v_brief := format(
      E'💬 Tugas: Komentar di Reddit\n\n' ||
      E'Subreddit: r/%s\n' ||
      E'Link: %s\n\n' ||
      E'Instruksi:\n' ||
      E'1. Buka thread Reddit melalui link di atas\n' ||
      E'2. Baca konteks diskusi dengan seksama\n' ||
      E'3. Tulis komentar yang relevan, bernilai, dan terlihat natural (bukan spam)\n' ||
      E'4. Setelah posting, salin link komentar kamu dan submit sebagai bukti\n\n' ||
      E'Catatan: Komentar yang terhapus oleh moderator atau automod tidak akan di-approve.',
      COALESCE(NULLIF(p_order.subreddit, ''), 'all'),
      p_order.thread_url
    );
  END IF;

  INSERT INTO public.tasks (
    title,
    description,
    brief,
    target_url,
    task_type,
    task_category,
    reward_amount,
    max_assignments,
    current_assignments,
    per_account_limit,
    status,
    source_order_id,
    created_at,
    updated_at
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
    1,
    'active',
    p_order.id,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_task_id;

  IF p_order.status = 'pending' THEN
    UPDATE public.reddit_upvote_orders
    SET status = 'processing', updated_at = NOW()
    WHERE id = p_order.id;
  END IF;

  RETURN v_task_id;
END;
$$;

-- ------------------------------------------------------------
-- 5. Update claim_task_assignment:
--    Include google_maps_review in accountless bucket & dedup
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_task public.tasks;
  v_account public.reddit_accounts;
  v_assignment public.task_assignments;
  v_existing_active_count integer;
  v_is_admin boolean;
  v_category text;
  v_draft record;
  v_norm_target text;
  v_cap_granted boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation)
  VALUES (txid_current(), pg_backend_pid(), 'claim')
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF v_task.id IS NULL THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.is_hidden = true THEN
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

  IF v_task.current_assignments >= v_task.max_assignments THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Kuota pengerjaan task ini sudah habis.' USING ERRCODE = 'P0001';
  END IF;

  -- YouTube Upload category
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.youtube_accounts ya
      WHERE ya.user_id = v_uid
        AND ya.step3_approved_at IS NOT NULL
        AND ya.status = 'approved'
    ) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Wajib verifikasi akun YouTube Step 3 (upload video bukti) dan disetujui admin sebelum mengambil task YouTube.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

  -- Accountless categories: no Reddit account required
  ELSIF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review'
  ) THEN
    -- Strict cross-order target dedup for LinkedIn, Trustpilot & Google Maps tasks
    IF v_task.task_category IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment', 'trustpilot_review', 'google_maps_review') THEN
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
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task untuk target ini sebelumnya.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

    -- Assign unique draft for comments (forum_comment, linkedin_comment, trustpilot_review, google_maps_review)
    IF v_task.task_category IN ('forum_comment', 'linkedin_comment', 'trustpilot_review', 'google_maps_review') THEN
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
    END IF;
  ELSE
    SELECT *
    INTO v_account
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id
      AND user_id = v_uid;

    IF v_account.id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak valid.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_account.is_active THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_is_admin THEN
      IF v_account.status_flag IN ('suspended', 'not_found') THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Akun Reddit kamu sedang bermasalah (%s). Gunakan akun lain.', v_account.status_flag USING ERRCODE = 'P0001';
      END IF;

      IF v_account.karma < COALESCE(v_task.min_karma, 0) THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Karma akun Reddit kamu (%s) belum mencukupi batas minimum (%s).', v_account.karma, v_task.min_karma USING ERRCODE = 'P0001';
      END IF;

      IF v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0) THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Umur akun Reddit kamu (%s hari) belum memenuhi syarat minimum (%s hari).', v_account.account_age_days, v_task.min_account_age_days USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  RETURN v_assignment;
END;
$$;

-- ------------------------------------------------------------
-- 6. Update list_eligible_tasks_for_user
--    Include google_maps_review in accountless bucket & dedup
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
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
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz,
  can_do_with_account_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
DECLARE
  v_user uuid;
  v_is_admin boolean;
  v_invited boolean;
  v_yt_verified boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  v_is_admin := public.is_admin();

  SELECT (
    v_is_admin
    OR COALESCE(u.reddit_army_invited, false)
    OR COALESCE(u.role, '') IN ('admin', 'army', 'worker')
  ) INTO v_invited
  FROM public.users u
  WHERE u.id = v_user;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.step3_approved_at IS NOT NULL
      AND ya.status = 'approved'
  ) INTO v_yt_verified;

  -- 1. Accountless tasks: forum_comment, youtube_upload, preferred_source, linkedin, trustpilot, google_maps_review
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
    AND COALESCE(t.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review'
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
          ta.status IN ('in_progress','submitted','approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    -- Exclude LinkedIn, Trustpilot & Google Maps tasks if user already did the same target URL
    AND (
      COALESCE(t.task_category, '') NOT IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment', 'trustpilot_review', 'google_maps_review')
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

  -- 2. Reddit tasks
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
      AND COALESCE(t.task_category, '') NOT IN (
        'forum_comment', 'youtube_upload', 'preferred_source',
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review'
      )
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
$fn$;

-- ------------------------------------------------------------
-- 7. Update tg_enforce_assignment_rules:
--    Include google_maps_review in no-account bucket
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enforce_assignment_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_task record;
  v_limit int;
  v_existing int;
  v_live int;
BEGIN
  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  v_limit := COALESCE(v_task.per_account_limit, 1);

  IF TG_OP = 'INSERT' THEN
    IF v_task.status <> 'active'
      OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
      OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
      RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.task_live_assignment_count(NEW.task_id) INTO v_live;
    IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
      PERFORM public.sync_task_slot_count(NEW.task_id);
      RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review'
    ) THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND user_id = NEW.user_id
        AND (
          status IN ('in_progress','submitted','approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per member). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF NEW.reddit_account_id IS NULL THEN
        RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.' USING ERRCODE = 'P0001';
      END IF;

      SELECT user_id INTO NEW.user_id
      FROM public.reddit_accounts
      WHERE id = NEW.reddit_account_id;

      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Akun tidak valid.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND reddit_account_id = NEW.reddit_account_id
        AND (
          status IN ('in_progress','submitted','approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per akun). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF NEW.draft_comment IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.draft_comment IS DISTINCT FROM OLD.draft_comment OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.enforce_unique_forum_comment(NEW.id, NEW.task_id, NEW.draft_comment);
  END IF;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- 8. Update tg_enforce_per_account_limit:
--    Include google_maps_review in no-account bucket
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enforce_per_account_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit int;
  v_existing int;
  v_category text;
BEGIN
  SELECT COALESCE(per_account_limit, 1), task_category
  INTO v_limit, v_category
  FROM public.tasks
  WHERE id = NEW.task_id;

  IF v_category IN (
    'forum_comment', 'youtube_upload', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review'
  ) THEN
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND user_id = NEW.user_id
      AND status IN ('in_progress','submitted','approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini (max % per member). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.reddit_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND reddit_account_id = NEW.reddit_account_id
      AND status IN ('in_progress','submitted','approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini (max % per akun). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
NOTIFY pgrst, 'reload schema';
