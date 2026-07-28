-- =============================================================
-- Fix: "Task tidak ditemukan" when resuming a claimed task
--
-- Root cause:
--   The RLS policy "tasks_select_active" only shows tasks with
--   status='active' to army users. But the Tasks page uses
--   get_my_pending_assignments() (SECURITY DEFINER, bypasses RLS)
--   to list in-progress tasks — so tasks whose status was changed
--   (paused/completed/hidden) by admin still appear in "Task
--   sedang kamu kerjakan".
--
--   When the user clicks "Lanjutkan", TaskDetail does a direct
--   SELECT on the tasks table (subject to RLS). If the task is
--   no longer 'active', it returns null → "Task tidak ditemukan".
--
-- Fix:
--   Update the RLS policy to also allow reading tasks for which
--   the current user has an in_progress or submitted assignment.
--   This way, users who claimed a task can always resume it
--   until they submit, cancel, or the assignment expires — even
--   if an admin later pauses/completes/hides the task.
-- =============================================================

-- 1. Update RLS policy so assignment holders can read the task
DROP POLICY IF EXISTS "tasks_select_active" ON public.tasks;
CREATE POLICY "tasks_select_active" ON public.tasks
  FOR SELECT
  USING (
    -- Publicly visible: active + not hidden
    (status = 'active' AND NOT COALESCE(is_hidden, false))
    -- Admin sees everything
    OR public.is_admin()
    -- Users with a valid assignment always see their claimed task
    OR id IN (
      SELECT ta.task_id
      FROM public.task_assignments ta
      WHERE (
        ta.user_id = auth.uid()
        OR ta.reddit_account_id IN (
          SELECT ra.id FROM public.reddit_accounts ra WHERE ra.user_id = auth.uid()
        )
      )
      AND ta.status IN ('in_progress', 'submitted')
    )
  );

-- 2. Create an RPC for TaskDetail as a fallback when the direct
--    query fails (defensive — the RLS fix above should cover the
--    primary case, but this ensures we can always fetch task data
--    for a user who has a valid assignment).
CREATE OR REPLACE FUNCTION public.get_task_for_assignment_holder(
  p_task_id uuid
)
RETURNS public.tasks
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- Only return the task if the user has a valid assignment for it
  SELECT t.* INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id
    AND EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND (
          ta.user_id = v_uid
          OR ta.reddit_account_id IN (
            SELECT ra.id FROM public.reddit_accounts ra WHERE ra.user_id = v_uid
          )
        )
        AND ta.status IN ('in_progress', 'submitted')
    );

  RETURN v_task;
END $$;

GRANT EXECUTE ON FUNCTION public.get_task_for_assignment_holder(uuid) TO authenticated;

-- 3. Reload PostgREST schema cache so the new policy + RPC take
--    effect without waiting for the background refresh.
NOTIFY pgrst, 'reload schema';
