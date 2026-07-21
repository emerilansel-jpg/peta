-- ============================================================
-- PeTa — task ordering and visibility for admin Task Queue.
--
-- Adds manual drag-and-drop order + a Show/Hide flag so admins can
-- hide old completed tasks without deleting them.
-- ============================================================

-- 1. Add ordering and visibility columns.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_display_order ON public.tasks(display_order);

-- 2. Backfill display_order for existing tasks.
--    Newest tasks first (matching the previous created_at DESC default).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM public.tasks
)
UPDATE public.tasks t
SET display_order = o.rn
FROM ordered o
WHERE t.id = o.id;

-- 3. Update RLS policy so army only sees active + not-hidden tasks.
DROP POLICY IF EXISTS "tasks_select_active" ON public.tasks;
CREATE POLICY "tasks_select_active" ON public.tasks
  FOR SELECT
  USING (
    (status = 'active' AND NOT COALESCE(is_hidden, false))
    OR public.is_admin()
  );

-- 4. Update eligible task list for army: exclude hidden tasks, respect display_order.
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  v_is_admin := public.is_admin();
  v_has_reddit := EXISTS (SELECT 1 FROM public.reddit_accounts WHERE user_id = v_user);

  IF v_is_admin AND NOT v_has_reddit THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.display_order, t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, NULL::uuid AS can_do_with_account_id
    FROM public.tasks t
    WHERE t.status = 'active'
      AND NOT COALESCE(t.is_hidden, false)
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
    ORDER BY t.display_order ASC, t.id ASC, t.created_at DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (t.display_order, t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND NOT COALESCE(t.is_hidden, false)
    AND t.task_category IN ('forum_comment', 'youtube_upload')
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
  ORDER BY t.display_order ASC, t.id ASC, t.created_at DESC;

  RETURN QUERY
  SELECT DISTINCT ON (t.display_order, t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, ra.id AS can_do_with_account_id
  FROM public.tasks t
  JOIN public.reddit_accounts ra ON ra.user_id = v_user
  WHERE t.status = 'active'
    AND NOT COALESCE(t.is_hidden, false)
    AND COALESCE(t.task_category, '') NOT IN ('forum_comment', 'youtube_upload')
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
  ORDER BY t.display_order ASC, t.id ASC, t.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.list_eligible_tasks_for_user() TO authenticated;

-- 5. Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
