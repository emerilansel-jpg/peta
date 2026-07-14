-- =============================================================
-- Backend fixes — 2026-07-14
--
-- 1. Add expires_at to task_assignments and set it on claim (24h window).
-- 2. Exclude expired in_progress rows from live slot count so slots are not
--    locked forever if the cron job is delayed.
-- 3. Auto-cancel expired assignments via cancel_expired_assignments() + pg_cron.
-- 4. Add admin_update_task_status RPC so TaskQueue toggleStatus uses SECURITY DEFINER.
-- =============================================================

-- 1. Add expires_at column
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

-- Backfill existing in_progress rows so they don't live forever
UPDATE public.task_assignments
SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '24 hours'
WHERE status = 'in_progress' AND expires_at IS NULL;

-- 2. Update live count to ignore expired in_progress rows
CREATE OR REPLACE FUNCTION public.task_live_assignment_count(p_task_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.task_assignments
  WHERE task_id = p_task_id
    AND (
      status IN ('submitted','approved')
      OR (status = 'in_progress' AND (expires_at IS NULL OR expires_at > NOW()))
    )
$$;

-- 3. Update claim_task_assignment to set expires_at
DROP FUNCTION IF EXISTS public.claim_task_assignment(uuid, uuid);
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task record;
  v_account record;
  v_assignment public.task_assignments;
  v_live int;
  v_draft record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.status <> 'active'
    OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
    OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_task.task_category, '') = 'forum_comment' THEN
    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

    -- Assign the next unused unique draft for this source order.
    SELECT d.id, d.comment_text
    INTO v_draft
    FROM public.reddit_order_comment_drafts d
    WHERE d.order_id = v_task.source_order_id
      AND d.assignment_id IS NULL
    ORDER BY d.draft_index
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_draft.id IS NOT NULL THEN
      UPDATE public.task_assignments
      SET draft_comment = v_draft.comment_text
      WHERE id = v_assignment.id;

      UPDATE public.reddit_order_comment_drafts
      SET assignment_id = v_assignment.id
      WHERE id = v_draft.id;

      v_assignment.draft_comment := v_draft.comment_text;
    END IF;
  ELSE
    SELECT *
    INTO v_account
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id
      AND user_id = v_uid;

    IF v_account.id IS NULL THEN
      RAISE EXCEPTION 'Pilih akun Reddit yang valid.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.is_admin() THEN
      IF v_account.karma < COALESCE(v_task.min_karma, 0)
        OR v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0)
        OR v_account.status_flag IN ('suspended','not_found') THEN
        RAISE EXCEPTION 'Akun ini belum eligible untuk task ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_task_assignment(uuid, uuid) TO authenticated;

-- 4. Function to cancel expired assignments and release slots
CREATE OR REPLACE FUNCTION public.cancel_expired_assignments()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_task_ids uuid[];
BEGIN
  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: tidak submit dalam 24 jam',
      can_retry = false,
      updated_at = NOW()
  WHERE status = 'in_progress'
    AND expires_at < NOW()
    AND (admin_notes IS NULL OR admin_notes NOT LIKE 'Auto-cancelled:%');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Re-sync slot counts for affected tasks
  SELECT ARRAY_AGG(DISTINCT task_id) INTO v_task_ids
  FROM public.task_assignments
  WHERE status = 'rejected'
    AND admin_notes = 'Auto-cancelled: tidak submit dalam 24 jam'
    AND updated_at > NOW() - INTERVAL '1 hour';

  IF v_task_ids IS NOT NULL THEN
    PERFORM public.sync_task_slot_count(tid) FROM unnest(v_task_ids) AS tid;
  END IF;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_expired_assignments() TO authenticated;

-- 5. Admin update task status RPC
CREATE OR REPLACE FUNCTION public.admin_update_task_status(
  p_task_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_status NOT IN ('draft', 'active', 'paused', 'completed') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  UPDATE public.tasks
  SET status = p_status,
      updated_at = NOW()
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task tidak ditemukan';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_update_task_status(uuid, text) TO authenticated;

-- 6. Schedule cron job to run every 30 minutes
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'cancel-expired-assignments',
  '*/30 * * * *',
  'SELECT public.cancel_expired_assignments();'
);
