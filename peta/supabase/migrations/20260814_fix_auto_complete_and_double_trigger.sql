-- ============================================================
-- PeTa — Fix auto-complete tasks on claim + double order sync
--
-- BUG 1: sync_task_slot_count marked tasks 'completed' when all
--   slots were CLAIMED (in_progress), not when actually APPROVED.
--   This caused orders to be marked completed prematurely in Straight.
--   Fix: only auto-complete when ALL assignments are approved (not just live).
--
-- BUG 2: tg_on_assignment_approved was registered as BOTH a BEFORE
--   and AFTER UPDATE trigger, so delivered_upvotes incremented 2x
--   per approval and user got double-credited (protected by ON CONFLICT).
--   Fix: remove the AFTER trigger, keep only BEFORE (which does the
--   slot sync + order sync).
--
-- Apply via: supabase db query --linked --file <this file>
-- ============================================================

-- ------------------------------------------------------------
-- 1) Fix sync_task_slot_count: only auto-complete on full approval
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
BEGIN
  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  SELECT COALESCE(max_assignments, 0) INTO v_max FROM public.tasks WHERE id = p_task_id;

  -- Count only approved assignments for task completion check
  SELECT count(*)::integer INTO v_approved
  FROM public.task_assignments
  WHERE task_id = p_task_id AND status = 'approved';

  UPDATE public.tasks
  SET current_assignments = LEAST(v_max, v_live),
      status = CASE
        -- Only mark completed when ALL required slots are APPROVED (not just claimed)
        WHEN status = 'active' AND v_approved >= v_max THEN 'completed'
        -- Reopen if task was completed but assignments got rejected/reverted
        WHEN status = 'completed' AND v_approved < v_max THEN 'active'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_task_id;
END $$;

-- ------------------------------------------------------------
-- 2) Remove duplicate AFTER trigger (keep BEFORE only)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS tg_on_assignment_approved_after_update ON public.task_assignments;

-- ------------------------------------------------------------
-- 3) Fix existing bad data:
--    a) Reopen tasks that were auto-completed but have no approved assignments
--    b) Fix over-counted delivered_upvotes on orders
-- ------------------------------------------------------------

-- 3a) Reopen tasks that are 'completed' but don't have enough approved assignments
UPDATE public.tasks t
SET status = 'active', updated_at = now()
WHERE t.status = 'completed'
  AND t.task_category <> 'reddit_challenge'
  AND t.source_order_id IS NOT NULL
  AND (
    SELECT count(*)::integer
    FROM public.task_assignments ta
    WHERE ta.task_id = t.id AND ta.status = 'approved'
  ) < COALESCE(t.max_assignments, 0);

-- 3b) Fix delivered_upvotes: recalculate from actual approved assignments
UPDATE public.reddit_upvote_orders o
SET delivered_upvotes = (
  SELECT count(*)::integer
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE t.source_order_id = o.id
    AND ta.status = 'approved'
),
status = CASE
  -- If not all delivered yet, revert to processing
  WHEN (SELECT count(*)::integer FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE t.source_order_id = o.id AND ta.status = 'approved')
       < o.requested_upvotes
  THEN 'processing'
  ELSE o.status
END,
completed_at = CASE
  -- Clear completed_at if reverting to processing
  WHEN (SELECT count(*)::integer FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE t.source_order_id = o.id AND ta.status = 'approved')
       < o.requested_upvotes
  THEN NULL
  ELSE o.completed_at
END
WHERE o.status IN ('completed', 'processing')
  AND EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.source_order_id = o.id
  );

-- 3c) Sync task statuses to match the corrected order state
UPDATE public.tasks t
SET status = CASE
  WHEN o.status = 'completed' THEN 'completed'
  ELSE 'active'
END,
updated_at = now()
FROM public.reddit_upvote_orders o
WHERE t.source_order_id = o.id
  AND t.status = 'completed'
  AND o.status <> 'completed';

NOTIFY pgrst, 'reload schema';
