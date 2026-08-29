-- ============================================================
-- Straight → PeTa pipeline hardening (2026-08-29)
--
-- Goals:
--   1. FULLY automatic order→task sync: a new Straight order
--      mints a PeTa task that is ACTIVE immediately (no admin
--      activation step). Controlled by
--      straight_settings.auto_activate_tasks (default ON).
--   2. Import logic becomes callable (fn_ensure_order_task) so
--      historical orders that missed the trigger can be
--      backfilled via admin_resync_straight_order_tasks().
--   3. One-time reconciliation: missing tasks created, delivered
--      counters recalculated, task statuses re-synced to order
--      statuses, quota counters reconciled.
--   4. Public anon RPC get_straight_public_stats() for the
--      landing page (real numbers only).
--
-- Idempotent: safe to re-run.
-- Apply via: supabase db query --linked --file <this file>
-- ============================================================

-- ------------------------------------------------------------
-- 0. Settings: auto_activate_tasks (default ON)
-- ------------------------------------------------------------
ALTER TABLE public.straight_settings
  ADD COLUMN IF NOT EXISTS auto_activate_tasks boolean NOT NULL DEFAULT true;

-- ------------------------------------------------------------
-- 1. Core import logic as a callable function.
--    Body = live 20260717 trigger version (incl. YouTube upload
--    mapping) + auto-activation + pending→processing bump.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(p_order public.reddit_upvote_orders)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_notes            jsonb   := '{}'::jsonb;
  v_is_forum_comment boolean := false;
  v_is_youtube_upload boolean := false;
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

  v_task_type := CASE
    WHEN p_order.target_type = 'upvote' THEN 'upvote'
    WHEN v_is_youtube_upload THEN 'upload'
    ELSE 'comment'
  END;

  v_task_category := CASE
    WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote'
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

  v_reward := CASE
    WHEN v_is_youtube_upload THEN 25000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 5000
  END;

  v_title := CASE
    WHEN v_is_youtube_upload THEN
      format('Upload video ke YouTube: %s', COALESCE(v_yt_title, 'tanpa judul'))
    WHEN v_is_forum_comment THEN
      format('Komen di %s%s', v_platform,
             CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
    WHEN p_order.subreddit IS NOT NULL THEN format('r/%s - %s', p_order.subreddit, v_task_type)
    ELSE format('Reddit %s task', v_task_type)
  END;

  IF v_is_youtube_upload THEN
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
$$;

-- Trigger wrapper: keep the existing trigger name/behaviour.
CREATE OR REPLACE FUNCTION public.auto_import_reddit_order_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_ensure_order_task(NEW);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_auto_import_reddit_order ON public.reddit_upvote_orders;
CREATE TRIGGER trg_auto_import_reddit_order
  AFTER INSERT ON public.reddit_upvote_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_import_reddit_order_to_task();

-- ------------------------------------------------------------
-- 2. Settings RPCs: expose auto_activate_tasks.
--    admin_get_straight_settings return type changes → DROP+CREATE.
--    admin_update_straight_settings keeps the 1-arg signature
--    (OR REPLACE, preserves auto_activate_tasks) + new 2-arg overload.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_straight_settings();
CREATE FUNCTION public.admin_get_straight_settings()
RETURNS TABLE (
  registration_mode TEXT,
  auto_activate_tasks boolean,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.registration_mode, s.auto_activate_tasks, s.updated_at
  FROM public.straight_settings s LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_straight_settings() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_straight_settings() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_update_straight_settings(
  p_registration_mode TEXT
)
RETURNS public.straight_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.straight_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.straight_settings
  SET registration_mode = p_registration_mode, updated_at = NOW()
  WHERE id = true
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_straight_settings(
  p_registration_mode TEXT,
  p_auto_activate_tasks boolean
)
RETURNS public.straight_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.straight_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.straight_settings
  SET registration_mode = p_registration_mode,
      auto_activate_tasks = p_auto_activate_tasks,
      updated_at = NOW()
  WHERE id = true
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_straight_settings(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_straight_settings(TEXT, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_update_straight_settings(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_straight_settings(TEXT, boolean) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 3. Admin resync RPC: create missing tasks for any orders that
--    missed the trigger (historical stragglers).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resync_straight_order_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.reddit_upvote_orders%ROWTYPE;
  v_count int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT o.* FROM reddit_upvote_orders o
    WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_order_id = o.id)
    ORDER BY o.created_at
  LOOP
    IF public.fn_ensure_order_task(r) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_resync_straight_order_tasks() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_resync_straight_order_tasks() FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 4. One-time reconciliation (idempotent — reruns are no-ops).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_created int := 0;
  r public.reddit_upvote_orders%ROWTYPE;
BEGIN
  -- 4a. Backfill missing tasks.
  FOR r IN
    SELECT o.* FROM reddit_upvote_orders o
    WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_order_id = o.id)
    ORDER BY o.created_at
  LOOP
    IF public.fn_ensure_order_task(r) IS NOT NULL THEN v_created := v_created + 1; END IF;
  END LOOP;
  RAISE NOTICE 'backfilled tasks: %', v_created;

  -- 4b. delivered_upvotes = actual approved assignments (orders with a task only).
  UPDATE reddit_upvote_orders o
  SET delivered_upvotes = c.approved
  FROM (
    SELECT t.source_order_id AS oid, count(*)::int AS approved
    FROM task_assignments ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.status = 'approved' AND t.source_order_id IS NOT NULL
    GROUP BY t.source_order_id
  ) c
  WHERE o.id = c.oid AND o.delivered_upvotes IS DISTINCT FROM c.approved;

  -- 4c. Auto-complete orders whose delivery quota is fully approved.
  UPDATE reddit_upvote_orders o
  SET status = 'completed', completed_at = COALESCE(completed_at, NOW())
  WHERE o.status IN ('pending','processing')
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.source_order_id = o.id)
    AND o.delivered_upvotes >= o.requested_upvotes;

  -- 4d. Task status mirrors order status (same mapping as the live trigger).
  UPDATE tasks t
  SET status = CASE
        WHEN o.status = 'completed' THEN 'completed'
        WHEN o.status IN ('cancelled','refunded') THEN 'paused'
        ELSE 'active'
      END,
      updated_at = NOW()
  FROM reddit_upvote_orders o
  WHERE t.source_order_id = o.id
    AND t.task_category <> 'reddit_challenge'
    AND t.status <> 'draft'
    AND t.status <> CASE
      WHEN o.status = 'completed' THEN 'completed'
      WHEN o.status IN ('cancelled','refunded') THEN 'paused'
      ELSE 'active'
    END;

  -- 4e. Quota counter reconcile on every order-linked task.
  PERFORM public.sync_task_slot_count(t.id)
  FROM tasks t WHERE t.source_order_id IS NOT NULL;

  -- 4f. Historical drafts: when auto-activation is ON, paid orders must not
  --     sit as unactivated drafts. Activate them + bump pending → processing.
  IF (SELECT COALESCE(s.auto_activate_tasks, true) FROM straight_settings s LIMIT 1) THEN
    UPDATE tasks t
    SET status = 'active', updated_at = NOW()
    FROM reddit_upvote_orders o
    WHERE t.source_order_id = o.id
      AND t.status = 'draft'
      AND o.status IN ('pending', 'processing');

    UPDATE reddit_upvote_orders o
    SET status = 'processing'
    WHERE o.status = 'pending'
      AND EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.source_order_id = o.id AND t.status = 'active'
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Public stats for the landing page (REAL numbers only).
--    Frontend hides the section when completed_orders < 20.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_straight_public_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'completed_orders', (
      SELECT count(*)::int FROM reddit_upvote_orders WHERE status = 'completed'
    ),
    'delivered_units', (
      SELECT COALESCE(sum(delivered_upvotes), 0)::int FROM reddit_upvote_orders
    ),
    'avg_delivery_hours', (
      SELECT round(avg(
        EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0
      )::numeric, 1)::float8
      FROM reddit_upvote_orders
      WHERE status = 'completed' AND completed_at IS NOT NULL
    ),
    'total_clients', (
      SELECT count(*)::int FROM users WHERE role = 'client'
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_straight_public_stats() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
