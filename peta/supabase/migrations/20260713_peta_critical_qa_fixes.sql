-- =============================================================
-- PeTa critical/high QA fixes — 2026-07-13
--
-- 1. RPC for admin approve (currently direct update in ApprovalQueue.tsx).
-- 2. Guard admin_reject_assignment so already-credited rows cannot be rejected.
-- 3. RPC for admin mark payout paid (currently direct update in Payroll.tsx).
-- 4. Add user_note column so forum_comment draft_comment stays immutable.
-- 5. Recreate triggers / sync slot helper if needed after schema changes.
-- 6. Backfill/fix any slot-count drift.
-- =============================================================

-- Clean up any legacy/overloaded signatures so PostgREST resolves unambiguously.
DROP FUNCTION IF EXISTS public.admin_reject_assignment(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_reject_assignment(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.admin_mark_payout_paid(uuid, text, text);

-- 1) Admin approve assignment via SECURITY DEFINER RPC.
--    Only allows status transition 'submitted' -> 'approved'.
CREATE OR REPLACE FUNCTION public.admin_approve_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.task_assignments
  SET status = 'approved'
  WHERE id = p_assignment_id
    AND status = 'submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status bukan submitted';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_approve_assignment(uuid) TO authenticated;

-- 2) Tighten admin_reject_assignment: do not allow rejecting an assignment
--    whose task_reward credit has already been written. This prevents
--    money leakage / double-spend confusion.
CREATE OR REPLACE FUNCTION public.admin_reject_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_can_retry boolean DEFAULT true
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

  IF EXISTS (
    SELECT 1 FROM public.task_assignments
    WHERE id = p_assignment_id AND balance_credited_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Tidak bisa reject assignment yang sudah dicairkan kreditnya. Hubungi lead engineer.';
  END IF;

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = p_reason,
      can_retry = p_can_retry,
      updated_at = NOW()
  WHERE id = p_assignment_id
    AND status IN ('submitted', 'in_progress');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status tidak bisa direject';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reject_assignment(uuid, text, boolean) TO authenticated;

-- 3) Admin mark payout paid via SECURITY DEFINER RPC.
--    Only allows pending -> paid transition and writes an audit log.
CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(p_payout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.payouts
  SET status = 'paid', paid_at = NOW()
  WHERE id = p_payout_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout tidak ditemukan atau status bukan pending';
  END IF;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (
    auth.uid(),
    'payout_marked_paid',
    jsonb_build_object('payout_id', p_payout_id, 'admin_id', auth.uid())
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_mark_payout_paid(uuid) TO authenticated;

-- 4) Admin create task via SECURITY DEFINER RPC.
--    Replaces the direct client insert in TaskQueue.tsx to avoid RLS/policy drift.
CREATE OR REPLACE FUNCTION public.admin_create_task(
  p_title text,
  p_description text,
  p_brief text,
  p_target_url text,
  p_task_category text,
  p_reward_amount int,
  p_max_assignments int,
  p_per_account_limit int,
  p_min_karma int DEFAULT 0,
  p_min_account_age_days int DEFAULT 0,
  p_start_at timestamptz DEFAULT NULL,
  p_end_at timestamptz DEFAULT NULL,
  p_post_to_wa_group boolean DEFAULT false,
  p_wa_group_draft text DEFAULT NULL,
  p_status text DEFAULT 'draft'
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.tasks;
  v_task_type text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_end_at IS NOT NULL AND p_start_at IS NOT NULL AND p_end_at < p_start_at THEN
    RAISE EXCEPTION 'End time tidak boleh lebih awal dari start time';
  END IF;

  v_task_type := CASE WHEN p_task_category = 'reddit_upvote' THEN 'upvote' ELSE 'comment' END;

  INSERT INTO public.tasks (
    title, description, brief, target_url, task_category, task_type,
    reward_amount, max_assignments, per_account_limit, min_karma, min_account_age_days,
    start_at, end_at, post_to_wa_group, wa_group_draft, status, created_by
  ) VALUES (
    p_title, p_description, p_brief, p_target_url, p_task_category, v_task_type,
    GREATEST(p_reward_amount, 0), GREATEST(p_max_assignments, 1), GREATEST(p_per_account_limit, 1),
    GREATEST(p_min_karma, 0), GREATEST(p_min_account_age_days, 0),
    p_start_at, p_end_at, COALESCE(p_post_to_wa_group, false), p_wa_group_draft,
    p_status, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_create_task(
  text, text, text, text, text, int, int, int, int, int, timestamptz, timestamptz, boolean, text, text
) TO authenticated;

-- 5) Add user_note column so forum_comment draft_comment stays immutable.
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS user_note TEXT NULL;

-- 7) Update admin_pending_approvals to return user_note for richer context.
DROP FUNCTION IF EXISTS public.admin_pending_approvals();

CREATE OR REPLACE FUNCTION public.admin_pending_approvals()
RETURNS TABLE(
  assignment_id   uuid,
  status          text,
  proof_url       text,
  draft_comment   text,
  user_note       text,
  admin_notes     text,
  created_at      timestamptz,
  updated_at      timestamptz,
  submitted_at    timestamptz,
  task_id         uuid,
  task_title      text,
  task_target_url text,
  task_category   text,
  task_type       text,
  task_reward     int,
  submitted_url   text,
  submitted_username text,
  proof_image_url text,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    ta.draft_comment::text,
    ta.user_note::text,
    ta.admin_notes::text,
    ta.created_at,
    ta.updated_at,
    COALESCE(ta.updated_at, ta.created_at) AS submitted_at,
    t.id AS task_id,
    t.title::text AS task_title,
    t.target_url::text AS task_target_url,
    t.task_category::text,
    t.task_type::text,
    t.reward_amount AS task_reward,
    ta.submitted_url::text,
    ta.submitted_username::text,
    ta.proof_image_url::text,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = COALESCE(ta.user_id, ra.user_id)
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;

-- 8) Backfill any existing drift: if a task has current_assignments out of sync,
--    run sync_task_slot_count for every task. This is idempotent.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tasks LOOP
    PERFORM public.sync_task_slot_count(r.id);
  END LOOP;
END $$;
