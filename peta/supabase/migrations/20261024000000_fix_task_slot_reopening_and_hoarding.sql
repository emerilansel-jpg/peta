-- ============================================================
-- Migration: 20261024000000_fix_task_slot_reopening_and_hoarding.sql
--
-- Fixes root causes of tasks being blocked after admin rejection:
--   1. Reduces in-progress reservation lock from 24h to 2h (6h for YouTube).
--      Prevents one user from locking a task for a whole day without submitting.
--   2. Auto-cancels expired in_progress claims automatically on claim check.
--   3. Enforces max 2 concurrent in_progress tasks per user to prevent task hoarding.
--   4. Ensures admin_reject_assignment explicitly synchronizes task slot count immediately.
--   5. Adds admin_cancel_in_progress_assignment RPC so admin can release hoarded slots manually.
--   6. Cleans up existing stale in_progress assignments older than 2 hours.
-- ============================================================

-- 1. Hardened sync_task_slot_count: ensure live count accurately respects active in_progress
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
      status IN ('submitted', 'approved')
      OR (status = 'in_progress' AND (expires_at IS NULL OR expires_at > NOW()))
    );
$$;

-- 2. Immediate auto-cancel of expired assignments function
CREATE OR REPLACE FUNCTION public.cancel_expired_assignments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_task_ids uuid[];
BEGIN
  -- Find all expired in_progress assignments
  SELECT ARRAY_AGG(DISTINCT task_id) INTO v_task_ids
  FROM public.task_assignments
  WHERE status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)',
      can_retry = true,
      updated_at = NOW()
  WHERE status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Re-sync slot counts for affected tasks
  IF v_task_ids IS NOT NULL THEN
    PERFORM public.sync_task_slot_count(tid) FROM unnest(v_task_ids) AS tid;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_expired_assignments() TO authenticated, service_role;

-- 3. Explicit sync in admin_reject_assignment
CREATE OR REPLACE FUNCTION public.admin_reject_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_can_retry boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_assignment public.task_assignments;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF v_assignment.balance_credited_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tidak bisa reject assignment yang sudah dicairkan kreditnya. Hubungi lead engineer.' USING ERRCODE = 'P0001';
  END IF;

  -- Contributor workflow rejection rules
  IF COALESCE(v_assignment.contributor_workflow, false) = true THEN
    IF v_assignment.visibility_status IS NULL OR v_assignment.visibility_status = 'unknown' THEN
      RAISE EXCEPTION 'contributor_workflow_unknown_visibility: Assignment dengan status visibility unknown tidak bisa ditolak otomatis. Harap lakukan verifikasi manual.' USING ERRCODE = 'P0001';
    ELSIF v_assignment.visibility_status = 'not_visible' THEN
      IF v_assignment.visibility_check_after IS NULL OR NOW() < v_assignment.visibility_check_after THEN
        RAISE EXCEPTION 'contributor_workflow_wait_72h: Penolakan tugas not_visible hanya diizinkan setelah 72 jam : masa tunggu belum selesai.' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = p_reason,
      can_retry = p_can_retry,
      updated_at = NOW()
  WHERE id = p_assignment_id
    AND status IN ('submitted', 'in_progress');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status tidak bisa direject' USING ERRCODE = 'P0001';
  END IF;

  -- Immediately sync task slot count & status in same transaction
  PERFORM public.sync_task_slot_count(v_assignment.task_id);
END $function$;

-- 4. Admin RPC to cancel/release any in_progress assignment
CREATE OR REPLACE FUNCTION public.admin_cancel_in_progress_assignment(
  p_assignment_id uuid,
  p_reason text DEFAULT 'Dibatalkan admin: pengerjaan idle / dilepas kembali ke antrean'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_assignment public.task_assignments;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF v_assignment.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Hanya assignment dengan status in_progress yang bisa dibatalkan/dilepas.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = p_reason,
      can_retry = true,
      updated_at = NOW()
  WHERE id = p_assignment_id
    AND status = 'in_progress';

  PERFORM public.sync_task_slot_count(v_assignment.task_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_in_progress_assignment(uuid, text) TO authenticated;

-- 5. Updated claim_task_assignment with 2h expiration and anti-hoarding limit
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_assignment public.task_assignments;
  v_reddit_acc public.reddit_accounts;
  v_is_admin boolean := false;
  v_active_claims_count int;
  v_active_total int;
  v_norm_target text;
  v_timeout_interval interval;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  -- 1. First, purge any expired in_progress assignments for this task
  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)',
      can_retry = true,
      updated_at = NOW()
  WHERE task_id = p_task_id
    AND status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  -- Synchronize task counter
  PERFORM public.sync_task_slot_count(p_task_id);

  -- 2. Anti-hoarding: Max 2 concurrent in_progress tasks per member (excluding Reddit challenge)
  SELECT COUNT(*) INTO v_active_total
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = v_uid
    AND ta.status = 'in_progress'
    AND (ta.expires_at IS NULL OR ta.expires_at > NOW())
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  IF v_active_total >= 2 THEN
    RAISE EXCEPTION 'Kamu sedang mengerjakan % tugas lain. Selesaikan dan submit bukti terlebih dahulu sebelum mengambil tugas baru.', v_active_total
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Concurrency lock
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation)
  VALUES (txid_current(), pg_backend_pid(), 'claim');

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task tidak ditemukan atau sudah tidak tersedia.' USING ERRCODE = 'P0001';
  END IF;

  v_is_admin := public.is_admin();

  IF v_task.status <> 'active' THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.current_assignments >= v_task.max_assignments THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  -- Determine timeout window: 6 hours for YouTube video upload, 2 hours for other tasks
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    v_timeout_interval := INTERVAL '6 hours';
  ELSE
    v_timeout_interval := INTERVAL '2 hours';
  END IF;

  -- YouTube Upload category
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.youtube_accounts ya
      WHERE ya.user_id = v_uid
        AND ya.verified_at IS NOT NULL
        AND ya.verification_status = 'approved'
        AND COALESCE(ya.is_active, true) = true
    ) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Wajib verifikasi akun YouTube (Advanced Features) dan disetujui admin sebelum mengambil task YouTube.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;

  -- Accountless categories
  ELSIF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment',
    'trustpilot_review', 'google_maps_review', 'quora_upvote'
  ) THEN
    IF v_task.task_category IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'quora_upvote') THEN
      v_norm_target := regexp_replace(lower(btrim(COALESCE(v_task.target_url, ''))), '[/?#]+$', '');
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments ta2
        JOIN public.tasks t2 ON t2.id = ta2.task_id
        WHERE ta2.user_id = v_uid
          AND t2.task_category = v_task.task_category
          AND ta2.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t2.target_url, ''))), '[/?#]+$', '') = v_norm_target
      ) THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task untuk URL ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND (
        status IN ('in_progress', 'submitted', 'approved')
        OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
      );

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Kamu sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;

  -- Reddit categories
  ELSE
    IF p_reddit_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit harus dipilih untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_reddit_acc
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id;

    IF v_reddit_acc.id IS NULL OR v_reddit_acc.user_id <> v_uid THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak valid atau bukan milik kamu.' USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND reddit_account_id = p_reddit_account_id
      AND status IN ('in_progress', 'submitted', 'approved');

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit ini sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  -- Update task counter immediately
  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment;
END;
$fn$;

-- 6. Clean up existing stale in_progress assignments older than 2 hours
UPDATE public.task_assignments
SET status = 'rejected',
    admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit dalam 2 jam)',
    can_retry = true,
    updated_at = NOW()
WHERE status = 'in_progress'
  AND created_at < NOW() - INTERVAL '2 hours'
  AND task_id NOT IN (
    SELECT id FROM public.tasks WHERE task_category = 'reddit_challenge'
  );

-- Re-sync all task counters
SELECT public.sync_task_slot_count(id) FROM public.tasks WHERE status = 'active';

NOTIFY pgrst, 'reload schema';
