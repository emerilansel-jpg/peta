-- ============================================================
-- PeTa — Permanent fix: task slot counter sync + Straight order sync
--
-- Problem: current_assignments counter drifts from the real live count
-- because admin_reject_assignment and retry_rejected_assignment don't
-- call sync_task_slot_count. UI shows tasks as "full" when slots are
-- actually free.
--
-- Fix strategy: ONE trigger fires on EVERY assignment status change,
-- so counter stays correct regardless of which code path changed it.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1. New trigger function: always sync slot count on status change
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sync_slot_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sync counter for the task whose assignment changed
  PERFORM public.sync_task_slot_count(NEW.task_id);
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------
-- 2. Create the trigger (idempotent)
-- ------------------------------------------------------------------
DROP TRIGGER IF EXISTS tg_sync_slot_on_status_change ON public.task_assignments;
CREATE TRIGGER tg_sync_slot_on_status_change
  AFTER UPDATE OF status ON public.task_assignments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_sync_slot_on_status_change();

-- ------------------------------------------------------------------
-- 3. Fix retry_rejected_assignment: add expires_at + sync counter
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_rejected_assignment(
  p_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_assignment record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
    AND user_id = v_uid
    AND status = 'rejected'
    AND can_retry = true;

  IF v_assignment IS NULL THEN
    RAISE EXCEPTION 'Assignment ini tidak bisa di-retry.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.task_assignments
  SET status = 'in_progress',
      expires_at = NOW() + INTERVAL '24 hours',
      proof_url = NULL,
      proof_image_url = NULL,
      submitted_url = NULL,
      submitted_username = NULL,
      draft_comment = NULL,
      user_note = NULL,
      admin_notes = NULL,
      can_retry = false,
      updated_at = NOW()
  WHERE id = p_assignment_id;

  -- Sync counter (the new trigger handles this, but be explicit for safety)
  PERFORM public.sync_task_slot_count(v_assignment.task_id);
END;
$$;

-- ------------------------------------------------------------------
-- 4. Auto-set order to 'processing' when task is activated
--    (so Straight knows the task is live)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_on_task_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When task goes from draft/paused/completed -> active, update linked order
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    IF NEW.source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET status = 'processing'
      WHERE id = NEW.source_order_id
        AND status IN ('pending', 'processing');
    END IF;
  END IF;

  -- When task is completed, if all assignments are done, auto-complete order
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF NEW.source_order_id IS NOT NULL THEN
      PERFORM public.sync_order_completion(NEW.source_order_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_on_task_activated ON public.tasks;
CREATE TRIGGER tg_on_task_activated
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_on_task_activated();

-- ------------------------------------------------------------------
-- 5. Order completion sync helper
--    Checks if all assignments for an order's tasks are done,
--    and updates the order status accordingly.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_order_completion(
  p_order_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_total_tasks int;
  v_completed_tasks int;
  v_has_pending_tasks boolean;
BEGIN
  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id;

  IF v_order IS NULL THEN RETURN; END IF;

  -- Count tasks linked to this order
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE t.status = 'completed')
  INTO v_total_tasks, v_completed_tasks
  FROM public.tasks t
  WHERE t.source_order_id = p_order_id;

  -- Check if any task still has live (non-rejected) assignments
  SELECT EXISTS(
    SELECT 1
    FROM public.tasks t
    JOIN public.task_assignments ta ON ta.task_id = t.id
    WHERE t.source_order_id = p_order_id
      AND t.status = 'active'
      AND ta.status IN ('in_progress', 'submitted', 'approved')
      AND (ta.expires_at IS NULL OR ta.expires_at > NOW())
  ) INTO v_has_pending_tasks;

  -- Auto-complete order if all tasks are completed
  IF v_total_tasks > 0 AND v_completed_tasks = v_total_tasks THEN
    UPDATE public.reddit_upvote_orders
    SET status = 'completed',
        completed_at = NOW()
    WHERE id = p_order_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- 6. Backfill: sync ALL tasks right now to fix any existing drift
-- ------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tasks WHERE status IN ('active', 'completed')
  LOOP
    PERFORM public.sync_task_slot_count(r.id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
