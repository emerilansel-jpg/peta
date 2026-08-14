-- ============================================================
-- PeTa — Order→Task status sync trigger
--
-- Ensures task status ALWAYS matches its source Straight order:
--   order completed  → task completed
--   order processing → task active (reopens if was completed)
--   order cancelled/refunded → task paused
--
-- This gives admins a single source of truth: whatever Straight
-- shows, PeTa Task Queue follows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_sync_task_from_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.tasks
    SET status = CASE
      WHEN NEW.status = 'completed' THEN 'completed'
      WHEN NEW.status IN ('cancelled','refunded') THEN 'paused'
      ELSE 'active'
    END,
    updated_at = NOW()
    WHERE source_order_id = NEW.id
      AND task_category <> 'reddit_challenge'
      -- don't touch admin-managed draft state
      AND status <> 'draft';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_task_from_order_status ON public.reddit_upvote_orders;
CREATE TRIGGER trg_sync_task_from_order_status
  AFTER UPDATE OF status ON public.reddit_upvote_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_task_from_order_status();

-- ------------------------------------------------------------
-- Resync: fix the paused task whose order is completed (order 22)
-- + ensure all tasks match their order status right now
-- ------------------------------------------------------------
UPDATE public.tasks t
SET status = CASE
  WHEN o.status = 'completed' THEN 'completed'
  WHEN o.status IN ('cancelled','refunded') THEN 'paused'
  ELSE 'active'
END,
updated_at = NOW()
FROM public.reddit_upvote_orders o
WHERE t.source_order_id = o.id
  AND t.task_category <> 'reddit_challenge'
  AND t.status <> 'draft'
  AND t.status <> CASE
    WHEN o.status = 'completed' THEN 'completed'
    WHEN o.status IN ('cancelled','refunded') THEN 'paused'
    ELSE 'active'
  END;

NOTIFY pgrst, 'reload schema';
