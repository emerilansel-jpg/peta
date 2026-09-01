-- ============================================================
-- Straight Ltd — Google Preferred Source service (2026-09-01)
--
-- New service type: clients buy N "real-person selections" for their
-- domain (USD $1 per selection). Fulfillment flows through the SAME
-- pipeline as every other service: order -> PeTa task (auto-activate)
-- -> army worker selects the site via the client's Preferred Source
-- button -> screenshot proof -> admin approval -> delivered count.
--
-- Button installation is NOT part of this product (client must have
-- the button on their site; the button URL is the order target).
--
-- Idempotent: safe to re-run.
-- Apply via: supabase db query --linked --file <this file>
-- ============================================================

-- ------------------------------------------------------------
-- 1. Widen enum constraints for the new service
-- ------------------------------------------------------------
ALTER TABLE public.reddit_upvote_orders
  DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;
ALTER TABLE public.reddit_upvote_orders
  ADD CONSTRAINT reddit_upvote_orders_target_type_check
  CHECK (target_type IN ('upvote', 'comment', 'thread', 'youtube_upload', 'preferred_source'));

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_category_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN (
    'reddit_upvote', 'reddit_comment', 'reddit_post_thread', 'forum_comment',
    'youtube_upload', 'preferred_source', 'reddit_challenge'
  ));

ALTER TABLE public.straight_pricing
  DROP CONSTRAINT IF EXISTS straight_pricing_platform_check;
ALTER TABLE public.straight_pricing
  ADD CONSTRAINT straight_pricing_platform_check
  CHECK (platform IN ('reddit', 'forum', 'youtube', 'google'));

ALTER TABLE public.straight_pricing
  DROP CONSTRAINT IF EXISTS straight_pricing_service_check;
ALTER TABLE public.straight_pricing
  ADD CONSTRAINT straight_pricing_service_check
  CHECK (service IN ('upvote', 'comment', 'thread', 'upload', 'select'));

-- ------------------------------------------------------------
-- 2. Pricing matrix row ($1.00 per selection)
-- ------------------------------------------------------------
INSERT INTO public.straight_pricing (
  key, platform, service, mention_mode, label, price_cents, enabled, sort_order
) VALUES (
  'preferred_source', 'google', 'select', 'none', 'Google Preferred Source — Selection', 100, true, 12
)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Client RPC: create a Preferred Source selection order.
--    Clones the youtube_upload RPC pattern (lock balance FOR UPDATE,
--    price via matrix, insert order + spend ledger row).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_preferred_source_order(
  p_button_url TEXT,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_user_id UUID;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_quantity INT;
  v_url TEXT;
  v_notes JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Validate button URL.
  v_url := lower(btrim(COALESCE(p_button_url, '')));
  IF v_url IS NULL OR length(v_url) < 8 OR v_url !~ '^https?://[^\s.]+\.[^\s]+' THEN
    RAISE EXCEPTION 'button_url required';
  END IF;

  -- Validate quantity (MVP cap: 100 per order).
  v_quantity := COALESCE(p_quantity, 0);
  IF v_quantity < 1 OR v_quantity > 100 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 100';
  END IF;

  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  -- Price from the matrix ($1.00 per selection). Reject if admin disabled.
  v_cost := public.fn_straight_unit_price('preferred_source', 100) * v_quantity;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'preferred_source',
    'button_url', v_url,
    'quantity', v_quantity,
    'client_notes', COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    v_url,
    'Google',
    'preferred_source',
    v_quantity,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_cost,
    v_user_balance - v_cost,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', 'preferred_source',
      'price_key', 'preferred_source',
      'quantity', v_quantity
    )
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_preferred_source_order(TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_preferred_source_order(TEXT, INT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4. Auto-import mapping: preferred_source order -> PeTa task.
--    task_type stays 'upvote' so the army submit path (screenshot
--    proof, no comment text) works unchanged.
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

  -- Already imported?
  SELECT id INTO v_task_id FROM tasks WHERE source_order_id = p_order.id;
  IF v_task_id IS NOT NULL THEN RETURN v_task_id; END IF;

  BEGIN
    v_notes := COALESCE(p_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment  := COALESCE(p_order.target_type, 'upvote') = 'comment'
                         OR v_notes->>'service' = 'forum_comment';
  v_is_youtube_upload := COALESCE(p_order.target_type, 'upvote') = 'youtube_upload'
                         OR v_notes->>'service' = 'youtube_upload';
  v_is_preferred      := COALESCE(p_order.target_type, 'upvote') = 'preferred_source'
                         OR v_notes->>'service' = 'preferred_source';

  v_task_type := CASE
    WHEN p_order.target_type = 'upvote' THEN 'upvote'
    WHEN v_is_preferred THEN 'upvote'
    WHEN v_is_youtube_upload THEN 'upload'
    ELSE 'comment'
  END;

  v_task_category := CASE
    WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote'
    WHEN v_is_preferred      THEN 'preferred_source'
    WHEN v_is_forum_comment  THEN 'forum_comment'
    WHEN v_is_youtube_upload THEN 'youtube_upload'
    WHEN p_order.target_type = 'thread' THEN 'reddit_post_thread'
    ELSE 'reddit_comment'
  END;

  v_platform     := public.forum_platform_label(p_order.thread_url, COALESCE(v_notes->>'platform', p_order.subreddit));
  v_brand        := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_yt_title       := NULLIF(v_notes->>'title', '');
  v_yt_description := NULLIF(v_notes->>'description', '');
  v_yt_tags        := NULLIF(v_notes->>'tags', '');
  v_yt_privacy     := COALESCE(NULLIF(v_notes->>'privacy', ''), 'unlisted');

  v_domain := lower((regexp_match(p_order.thread_url, 'https?://(?:www\.)?([^/:?#]+)'))[1]);

  v_reward := CASE
    WHEN v_is_preferred      THEN 2500
    WHEN v_is_youtube_upload THEN 25000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 5000
  END;

  v_title := CASE
    WHEN v_is_preferred THEN
      format('Preferred Source: pilih %s di Google', COALESCE(NULLIF(v_domain, ''), 'situs klien'))
    WHEN v_is_youtube_upload THEN
      format('Upload video ke YouTube: %s', COALESCE(v_yt_title, 'tanpa judul'))
    WHEN v_is_forum_comment THEN
      format('Komen di %s%s', v_platform,
             CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
    WHEN p_order.subreddit IS NOT NULL THEN format('r/%s - %s', p_order.subreddit, v_task_type)
    ELSE format('Reddit %s task', v_task_type)
  END;

  IF v_is_preferred THEN
    v_description := format(
      'Buka link tombol, klik tombol Preferred Source-nya, konfirmasi di Google, terus screenshot buktinya. 1 akun Google = 1 pilihan.',
      p_order.thread_url
    );
    v_brief := format(
      E'🎯 Misi: pilih situs %s sebagai Preferred Source di Google.\n\n' ||
      E'Langkah:\n' ||
      E'1. Buka link di atas (target URL task ini)\n' ||
      E'2. Cari dan klik tombol "Prefer us in Google" / Preferred Source di halaman itu\n' ||
      E'3. Di halaman Google yang terbuka, klik tombol konfirmasi sampai situs ini benar-benar terpilih\n' ||
      E'4. Screenshot tampilan Google yang menunjukkan situsnya sudah terpilih\n\n' ||
      E'📷 Bukti: screenshot dari langkah 4.\n' ||
      E'1 akun Google = 1 pilihan. Akun yang pernah memilih situs ini jangan dipakai lagi.\n' ||
      E'Link tombol: %s',
      COALESCE(NULLIF(v_domain, ''), p_order.thread_url),
      p_order.thread_url
    );
  ELSIF v_is_youtube_upload THEN
    v_description := format(
      'Upload video dari %s ke YouTube. Judul: %s. Setel privasi jadi %s. Setelah upload, kirim URL video YouTube sebagai bukti.',
      p_order.thread_url,
      COALESCE(v_yt_title, 'lihat brief'),
      v_yt_privacy
    );
    v_brief := format(
      E'📹 Video sumber: %s\n' ||
      E'🎬 Judul: %s\n' ||
      E'📝 Deskripsi: %s\n' ||
      E'🏷️ Tags: %s\n' ||
      E'🔒 Privasi: %s\n\n' ||
      E'Upload video ke channel YouTube-mu, lalu kirim URL video hasil upload sebagai bukti. Jangan lupa pakai metadata di atas.',
      p_order.thread_url,
      COALESCE(v_yt_title, '-'),
      COALESCE(v_yt_description, '-'),
      COALESCE(v_yt_tags, '-'),
      v_yt_privacy
    );
  ELSIF v_is_forum_comment THEN
    v_description := format(
      'Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot buat bukti.',
      v_platform);
    v_brief := public.forum_comment_task_brief(p_order.thread_url, v_platform, v_comment_text, v_brand, v_mention_mode);
  ELSE
    IF p_order.notes IS NOT NULL AND btrim(p_order.notes) LIKE '{%' THEN
      v_description := 'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.';
    ELSE
      v_description := COALESCE(NULLIF(btrim(p_order.notes), ''),
                               'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.');
    END IF;
    v_brief := NULL;
  END IF;

  SELECT id INTO v_creator FROM users WHERE role = 'admin' LIMIT 1;

  SELECT COALESCE(s.auto_activate_tasks, true) INTO v_auto_activate
  FROM straight_settings s LIMIT 1;
  v_initial_status := CASE WHEN COALESCE(v_auto_activate, true) THEN 'active' ELSE 'draft' END;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    min_karma, min_account_age_days, per_account_limit, min_level,
    max_assignments, reward_amount, status, created_by, source_order_id
  ) VALUES (
    v_title, v_description, v_brief,
    p_order.thread_url, v_task_type, v_task_category,
    0, 0, 1, 0,
    GREATEST(1, p_order.requested_upvotes),
    v_reward, v_initial_status, v_creator, p_order.id
  )
  RETURNING id INTO v_task_id;

  -- Active task means the order is being worked on: bump pending → processing.
  IF v_initial_status = 'active' AND p_order.status = 'pending' THEN
    UPDATE reddit_upvote_orders SET status = 'processing' WHERE id = p_order.id AND status = 'pending';
  END IF;

  RETURN v_task_id;
END
$fn$;

-- ------------------------------------------------------------
-- 5. Patch claim_task_assignment (LIVE body, surgical):
--    allow claiming WITHOUT a Reddit account for preferred_source,
--    same as forum_comment / youtube_upload.
--    Idempotent: skips if the live body already mentions it.
-- ------------------------------------------------------------
DO $patch$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT oid, pg_get_functiondef(oid) AS src
    FROM pg_proc
    WHERE proname = 'claim_task_assignment'
      AND pronamespace = 'public'::regnamespace
  LOOP
    IF r.src LIKE '%preferred_source%' THEN
      CONTINUE;
    END IF;
    v_new := replace(
      r.src,
      'IN (''forum_comment'', ''youtube_upload'')',
      'IN (''forum_comment'', ''youtube_upload'', ''preferred_source'')'
    );
    IF v_new <> r.src THEN
      EXECUTE v_new;
      RAISE NOTICE 'patched claim_task_assignment (oid %)', r.oid;
    ELSE
      RAISE WARNING 'claim_task_assignment: pattern not found — patch manually (oid %)', r.oid;
    END IF;
  END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';
