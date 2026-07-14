-- =============================================================
-- PeTa QA Round 2b — Fix RLS on task_assignments for forum_comment
--
-- Root cause:
--   assignments_select_own / _update_own only checked reddit_account_id.
--   For forum_comment tasks, reddit_account_id IS NULL and the row is
--   keyed by user_id directly. So the army user who did the work could
--   NOT read their own approved assignment → getTotalEarnings() saw 0
--   task rows → saldo showed 0.
--
-- Fix: also allow SELECT/UPDATE when user_id = auth.uid().
-- =============================================================

-- SELECT: owner can read their own assignments (by user_id OR reddit account)
DROP POLICY IF EXISTS "assignments_select_own" ON public.task_assignments;
CREATE POLICY "assignments_select_own" ON public.task_assignments
  FOR SELECT USING (
    user_id = auth.uid()
    OR reddit_account_id IN (SELECT id FROM public.reddit_accounts WHERE user_id = auth.uid())
    OR public.is_admin()
  );

-- UPDATE: owner can update their own assignments (by user_id OR reddit account)
DROP POLICY IF EXISTS "assignments_update_own" ON public.task_assignments;
CREATE POLICY "assignments_update_own" ON public.task_assignments
  FOR UPDATE USING (
    user_id = auth.uid()
    OR reddit_account_id IN (SELECT id FROM public.reddit_accounts WHERE user_id = auth.uid())
    OR public.is_admin()
  );

-- INSERT: owner can insert their own forum_comment assignments directly
-- (the claim_task_assignment RPC uses SECURITY DEFINER so it bypasses RLS,
--  but keep this for completeness of direct writes.)
DROP POLICY IF EXISTS "assignments_insert_own" ON public.task_assignments;
CREATE POLICY "assignments_insert_own" ON public.task_assignments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR reddit_account_id IN (SELECT id FROM public.reddit_accounts WHERE user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
