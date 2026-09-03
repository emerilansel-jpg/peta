-- ============================================================
-- PeTa — Invariant fix: hidden tasks must NEVER leak to army.
--
-- Bug (reported 2026-09-02): admin hid "Preferred Source: pilih
-- searchenginejournal.com" (is_hidden=true) but it still appeared in
-- army's Tugas list. Root cause: NEITHER list_eligible_tasks_for_user
-- NOR the claim RPCs ever checked tasks.is_hidden — for ANY category.
--
-- This migration enforces the invariant at every army entry point:
--   1. list_eligible_tasks_for_user — is_hidden = false in ALL buckets
--      (hidden means hidden on every army-facing surface; admins review
--      hidden tasks in TaskQueue's Hidden tab, not on /tasks).
--   2. claim_task_assignment — reject claims on hidden tasks (blocks
--      direct-API claims by task id even when the list no longer shows
--      them). Surgical string-patch of the LIVE body (same technique as
--      20260901) so prod-specific edits (preferred_source bucket) are
--      never clobbered by a repo-file rewrite.
--   3. claim_challenge_task — same hidden guard.
--
-- TaskDetail stays reachable for existing assignment holders on a task
-- that was hidden AFTER they claimed — they must still be able to
-- submit. Only NEW claims are blocked.
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

-- ------------------------------------------------------------
-- 1) list_eligible_tasks_for_user — filter is_hidden in every bucket.
--    (Full rewrite; body mirrors the live 20260902 visibility fix with
--    the is_hidden predicate added.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_has_reddit boolean;
  v_invited boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  v_is_admin := public.is_admin();
  v_has_reddit := EXISTS (SELECT 1 FROM public.reddit_accounts WHERE user_id = v_user);
  v_invited := EXISTS (
    SELECT 1 FROM public.reddit_army_profiles
    WHERE user_id = v_user AND invited_at IS NOT NULL
  );

  -- Admin preview bucket (admin without own reddit account) ALSO hides
  -- hidden tasks: hidden means hidden everywhere army-facing. Admins
  -- manage/preview hidden tasks in TaskQueue > Hidden.
  IF v_is_admin AND NOT v_has_reddit THEN
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
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
    ORDER BY t.id, t.created_at DESC;
    RETURN;
  END IF;

  -- 1. Forum + YouTube + Google Preferred Source: open to ALL army
  --    members (no Reddit account / invitation needed).
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
    AND t.task_category IN ('forum_comment', 'youtube_upload', 'preferred_source')
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND ta.status IN ('in_progress','submitted','approved')
    ) < COALESCE(t.per_account_limit, 1)
  ORDER BY t.id, t.created_at DESC;

  -- 2. Reddit tasks: REQUIRE invitation to Reddit Army program
  --    (reddit_army_profiles.invited_at IS NOT NULL)
  --    Plus: connected Reddit account + karma/age gates.
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
      AND COALESCE(t.task_category, '') NOT IN ('forum_comment', 'youtube_upload', 'preferred_source')
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
END $$;

GRANT EXECUTE ON FUNCTION public.list_eligible_tasks_for_user() TO authenticated;

-- ------------------------------------------------------------
-- 2) Surgical patch: reject claims on hidden tasks.
--    Loops over claim_task_assignment + claim_challenge_task (all
--    overloads), string-patches the live body so prod-specific edits
--    survive. Idempotent: skips bodies that already check is_hidden.
-- ------------------------------------------------------------
DO $patch$
DECLARE
  r record;
  v_new text;
  v_marker text := 'v_task.is_hidden';
  v_pat_lower text := 'OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN';
  v_pat_upper text := 'OR (v_task.end_at IS NOT NULL AND NOW() >= v_task.end_at) THEN';
  v_repl text := 'OR (v_task.end_at IS NOT NULL AND %I >= v_task.end_at)' || E'\n      OR v_task.is_hidden THEN';
BEGIN
  FOR r IN
    SELECT oid, pg_get_functiondef(oid) AS src, proname
    FROM pg_proc
    WHERE proname IN ('claim_task_assignment', 'claim_challenge_task')
      AND pronamespace = 'public'::regnamespace
  LOOP
    IF r.src LIKE '%' || v_marker || '%' THEN
      RAISE NOTICE '% already checks is_hidden — skipped', r.proname;
      CONTINUE;
    END IF;

    v_new := replace(
      r.src,
      v_pat_lower,
      replace(v_repl, '%I', 'now()')
    );
    IF v_new = r.src THEN
      v_new := replace(
        r.src,
        v_pat_upper,
        replace(v_repl, '%I', 'NOW()')
      );
    END IF;

    IF v_new <> r.src THEN
      EXECUTE v_new;
      RAISE NOTICE 'patched % (hidden-claim guard added)', r.proname;
    ELSE
      RAISE WARNING '%: end_at pattern not found — patch manually (oid %)', r.proname, r.oid;
    END IF;
  END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';
