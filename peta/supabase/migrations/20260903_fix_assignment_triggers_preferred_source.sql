-- ============================================================
-- PeTa — Fix: preferred_source claims rejected by assignment triggers.
--
-- Bug (reported 2026-09-03, Order #89 privin.net): opening the task page
-- raised 'Gagal memulai task'. Real RPC error (captured via browser
-- network trace): 'Akun Reddit wajib untuk task ini.' — raised NOT by
-- claim_task_assignment (whose preferred_source branch was already
-- correct) but by the BEFORE INSERT trigger tg_enforce_assignment_rules,
-- whose no-account category list only knew 'forum_comment'.
--
-- Systemic pattern (3rd occurrence): tasks.task_category lists are
-- duplicated across MANY objects — every new category must update ALL
-- of them. This migration closes every remaining gap for
-- preferred_source AND adds the is_hidden guard to the trigger layer
-- (defense in depth for inserts that bypass the claim RPCs):
--
--   1. tg_enforce_assignment_rules  — no-account bucket + is_hidden
--   2. tg_enforce_per_account_limit — no-account bucket (not currently
--      bound, patched so it can never reject if re-bound)
--   3. admin_create_task / admin_update_task — category→task_type CASE
--      maps preferred_source → 'upvote' (was falling to NULL)
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

-- ------------------------------------------------------------
-- 1) tg_enforce_assignment_rules — live body + preferred_source + is_hidden
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
      OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at)
      OR v_task.is_hidden THEN
      RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.task_live_assignment_count(NEW.task_id) INTO v_live;
    IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
      PERFORM public.sync_task_slot_count(NEW.task_id);
      RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
    END IF;

    -- No-Reddit-account categories: forum, YouTube, Google Preferred Source.
    IF COALESCE(v_task.task_category, '') IN ('forum_comment', 'youtube_upload', 'preferred_source') THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

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
        AND status IN ('in_progress','submitted','approved');

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini (max % per akun). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF NEW.draft_comment IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.draft_comment IS DISTINCT FROM OLD.draft_comment OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.enforce_unique_forum_comment(NEW.id, NEW.task_id, NEW.draft_comment);
  END IF;

  RETURN NEW;
END $function$;

-- ------------------------------------------------------------
-- 2) tg_enforce_per_account_limit — same no-account bucket.
--    (Not currently bound to task_assignments; kept correct so a future
--    re-bind can never reintroduce this bug.)
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

  IF v_category IN ('forum_comment', 'youtube_upload', 'preferred_source') THEN
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
END $function$;

-- ------------------------------------------------------------
-- 3) admin_create_task / admin_update_task — map preferred_source to
--    task_type 'upvote' (surgical string-patch, idempotent).
-- ------------------------------------------------------------
DO $patch$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT oid, pg_get_functiondef(oid) AS src, proname
    FROM pg_proc
    WHERE proname IN ('admin_create_task', 'admin_update_task')
      AND pronamespace = 'public'::regnamespace
  LOOP
    IF r.src LIKE '%preferred_source%' THEN
      RAISE NOTICE '% already maps preferred_source — skipped', r.proname;
      CONTINUE;
    END IF;
    v_new := replace(
      r.src,
      $q$WHEN 'youtube_upload'     THEN 'upload'$q$,
      $q$WHEN 'youtube_upload'     THEN 'upload'
      WHEN 'preferred_source'   THEN 'upvote'$q$
    );
    IF v_new = r.src THEN
      v_new := replace(
        r.src,
        $q$WHEN 'youtube_upload' THEN 'upload'$q$,
        $q$WHEN 'youtube_upload' THEN 'upload'
        WHEN 'preferred_source' THEN 'upvote'$q$
      );
    END IF;
    IF v_new <> r.src THEN
      EXECUTE v_new;
      RAISE NOTICE 'patched % (preferred_source → upvote)', r.proname;
    ELSE
      RAISE WARNING '%: youtube_upload CASE pattern not found — patch manually (oid %)', r.proname, r.oid;
    END IF;
  END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';
