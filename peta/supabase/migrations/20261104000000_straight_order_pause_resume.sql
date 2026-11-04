-- ============================================================
-- Migration: 20261104000000_straight_order_pause_resume.sql
--
-- Enables order pausing and resuming across Straight.ltd & PeTa:
--   1. Updates reddit_upvote_orders_status_check to include 'paused'
--   2. Updates tg_sync_task_from_order_status trigger so PeTa task
--      automatically pauses when order is paused, and unpauses
--      back to active when resumed.
--   3. RPCs for Admin and Client:
--      - admin_pause_order(order_id, reason)
--      - admin_resume_order(order_id)
--      - fn_client_pause_order(order_id, reason)
--      - fn_client_resume_order(order_id)
-- ============================================================

BEGIN;

-- 1. Allow 'paused' in reddit_upvote_orders status
ALTER TABLE public.reddit_upvote_orders
  DROP CONSTRAINT IF EXISTS reddit_upvote_orders_status_check;

ALTER TABLE public.reddit_upvote_orders
  ADD CONSTRAINT reddit_upvote_orders_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'paused'));

-- 2. Update task sync trigger to handle 'paused' status
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
      WHEN NEW.status IN ('cancelled', 'refunded', 'paused') THEN 'paused'
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

-- 3. Admin Pause & Resume RPCs
CREATE OR REPLACE FUNCTION public.admin_pause_order(p_order_id INT, p_reason TEXT DEFAULT NULL)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_order public.reddit_upvote_orders;
  v_caller_role TEXT;
  v_note TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'lead') THEN
    RAISE EXCEPTION 'unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'cannot pause completed or cancelled order' USING ERRCODE = 'P0001';
  END IF;

  v_note := COALESCE(v_order.admin_notes, '');
  IF p_reason IS NOT NULL AND length(btrim(p_reason)) > 0 THEN
    v_note := CASE WHEN length(v_note) > 0 THEN v_note || E'\n' ELSE '' END || '[Paused]: ' || btrim(p_reason);
  END IF;

  UPDATE public.reddit_upvote_orders
  SET status = 'paused',
      admin_notes = NULLIF(v_note, ''),
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Ensure matching PeTa task is paused immediately
  UPDATE public.tasks
  SET status = 'paused', updated_at = NOW()
  WHERE source_order_id = p_order_id;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resume_order(p_order_id INT)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_order public.reddit_upvote_orders;
  v_caller_role TEXT;
  v_next_status TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'lead') THEN
    RAISE EXCEPTION 'unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status <> 'paused' THEN
    RAISE EXCEPTION 'order is not paused' USING ERRCODE = 'P0001';
  END IF;

  v_next_status := CASE WHEN v_order.delivered_upvotes > 0 THEN 'processing' ELSE 'pending' END;

  UPDATE public.reddit_upvote_orders
  SET status = v_next_status,
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Ensure matching PeTa task is active immediately
  UPDATE public.tasks
  SET status = 'active', updated_at = NOW()
  WHERE source_order_id = p_order_id;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_pause_order(INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resume_order(INT) TO authenticated;

-- 4. Client Pause & Resume RPCs (Clients can pause their own orders)
CREATE OR REPLACE FUNCTION public.fn_client_pause_order(p_order_id INT, p_reason TEXT DEFAULT NULL)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_order public.reddit_upvote_orders;
  v_note TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.user_id <> v_user_id THEN
    -- Check if admin
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND role IN ('admin', 'lead')) THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_order.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'only pending or processing orders can be paused' USING ERRCODE = 'P0001';
  END IF;

  v_note := COALESCE(v_order.notes, '');
  IF p_reason IS NOT NULL AND length(btrim(p_reason)) > 0 THEN
    v_note := CASE WHEN length(v_note) > 0 THEN v_note || E'\n' ELSE '' END || '[Client Paused]: ' || btrim(p_reason);
  END IF;

  UPDATE public.reddit_upvote_orders
  SET status = 'paused',
      notes = NULLIF(v_note, ''),
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Pause corresponding PeTa task
  UPDATE public.tasks
  SET status = 'paused', updated_at = NOW()
  WHERE source_order_id = p_order_id;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_client_resume_order(p_order_id INT)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_order public.reddit_upvote_orders;
  v_next_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.user_id <> v_user_id THEN
    -- Check if admin
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND role IN ('admin', 'lead')) THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_order.status <> 'paused' THEN
    RAISE EXCEPTION 'order is not paused' USING ERRCODE = 'P0001';
  END IF;

  v_next_status := CASE WHEN v_order.delivered_upvotes > 0 THEN 'processing' ELSE 'pending' END;

  UPDATE public.reddit_upvote_orders
  SET status = v_next_status,
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Resume corresponding PeTa task
  UPDATE public.tasks
  SET status = 'active', updated_at = NOW()
  WHERE source_order_id = p_order_id;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_client_pause_order(INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_client_resume_order(INT) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
