-- ============================================================
-- PeTa — Firecrawl Cron Job for Reddit Army Challenge Verification
--
-- NOTE: The actual Firecrawl edge function is invoked manually
-- or via external scheduler (e.g., GitHub Actions, Vercel Cron).
-- This migration only creates the SQL function that the edge
-- function will call to mark tasks as verified.
--
-- This is an ADDITIVE migration — does NOT replace existing cron jobs.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Helper function: mark_task_firecrawl_verified
--    Called by the edge function after Firecrawl confirms visibility.
--    Updates task_assignments.is_verified_firecrawl = true
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_task_firecrawl_verified(
  p_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.task_assignments
     SET is_verified_firecrawl = true,
         firecrawl_verified_at = NOW(),
         updated_at = NOW()
   WHERE id = p_assignment_id
     AND status = 'in_progress';  -- Only verify if still pending
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_task_firecrawl_verified(uuid) TO service_role;

-- ------------------------------------------------------------
-- 2. Helper function: get_pending_firecrawl_assignments
--    Returns all in_progress reddit_challenge assignments
--    with submitted_url for the edge function to process.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_pending_firecrawl_assignments()
RETURNS TABLE (
  assignment_id uuid,
  submitted_url text,
  username text,
  user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ta.id AS assignment_id,
    ta.submitted_url,
    ra.username,
    ta.user_id
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  WHERE ta.status = 'in_progress'
    AND t.task_category = 'reddit_challenge'
    AND ta.submitted_url IS NOT NULL
    AND ta.is_verified_firecrawl = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_firecrawl_assignments() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
