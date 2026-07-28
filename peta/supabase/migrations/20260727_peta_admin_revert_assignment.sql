-- ============================================================
-- PeTa — admin revert approval/rejection back to submitted.
--
-- When reverting an APPROVED assignment:
--   1. Reverse the task_reward credit in user_credits (insert negative).
--   2. Decrement current_assignments on the task.
--   3. Decrement delivered_upvotes on the linked order (if any).
--   4. If the order/task was marked completed by this slot, revert that.
--   5. Set assignment status back to 'submitted'.
--
-- When reverting a REJECTED assignment:
--   1. No balance change (rejected never credited).
--   2. Set status back to 'submitted', clear rejection fields.
--
-- Both cases: clear balance_credited_at, record history, update timestamps.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_revert_assignment(
  p_assignment_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev_status text;
  v_user_id uuid;
  v_reward int;
  v_order_id int;
  v_task_id uuid;
  v_balance_credited timestamptz;
  v_order_requested int;
  v_order_delivered int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan revert wajib diisi';
  END IF;

  -- Fetch assignment + task + order in one query.
  SELECT
    ta.status,
    COALESCE(ta.user_id, ra.user_id),
    t.reward_amount,
    t.id,
    t.source_order_id,
    ta.balance_credited_at
  INTO v_prev_status, v_user_id, v_reward, v_task_id, v_order_id, v_balance_credited
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.id = p_assignment_id;

  IF v_prev_status IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan';
  END IF;

  IF v_prev_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Hanya bisa revert assignment dengan status approved atau rejected. Status saat ini: %', v_prev_status;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Assignment ini tidak memiliki pemilik (user_id null). Tidak bisa revert.';
  END IF;

  -- 1. REVERSE BALANCE if it was credited.
  IF v_prev_status = 'approved' AND v_balance_credited IS NOT NULL THEN
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (
      v_user_id,
      -v_reward,
      'task_revert',
      format('Revert task reward: %s', p_reason),
      p_assignment_id
    );

    INSERT INTO public.activity_logs (user_id, action, details)
    VALUES (
      v_user_id,
      'task_reward_reverted',
      jsonb_build_object(
        'assignment_id', p_assignment_id,
        'task_id', v_task_id,
        'amount', -v_reward,
        'reason', p_reason
      )
    );
  END IF;

  -- 2. DECREMENT TASK SLOT COUNT.
  UPDATE public.tasks
  SET current_assignments = GREATEST(current_assignments - 1, 0)
  WHERE id = v_task_id AND current_assignments > 0;

  -- 3. DECREMENT DELIVERED UPVOTES on linked order (if any).
  IF v_order_id IS NOT NULL THEN
    UPDATE public.reddit_upvote_orders
    SET delivered_upvotes = GREATEST(delivered_upvotes - 1, 0)
    WHERE id = v_order_id AND delivered_upvotes > 0;

    -- Check if the order was previously marked completed due to this assignment
    -- and revert it back to processing.
    SELECT requested_upvotes, delivered_upvotes
    INTO v_order_requested, v_order_delivered
    FROM public.reddit_upvote_orders WHERE id = v_order_id;

    IF v_order_requested IS NOT NULL AND v_order_delivered < v_order_requested THEN
      UPDATE public.reddit_upvote_orders
      SET status = 'processing', completed_at = NULL
      WHERE id = v_order_id AND status = 'completed';
      UPDATE public.tasks
      SET status = 'active'
      WHERE id = v_task_id AND status = 'completed';
    END IF;
  END IF;

  -- 4. UPDATE ASSIGNMENT: back to submitted, clear rejection/approval fields.
  UPDATE public.task_assignments
  SET
    status = 'submitted',
    admin_notes = NULL,
    can_retry = true,
    balance_credited_at = NULL,
    updated_at = NOW()
  WHERE id = p_assignment_id;

  -- 5. Record in immutable history (the trigger will fire automatically
  --    because status changed from approved/rejected → submitted,
  --    but we also insert an explicit 'reverted' event for audit clarity).
  INSERT INTO public.task_assignment_history (
    assignment_id, user_id, task_id, status, admin_notes,
    can_retry, proof_url, draft_comment, event_at
  ) VALUES (
    p_assignment_id, v_user_id, v_task_id, 'reverted', p_reason,
    true,
    (SELECT proof_url FROM public.task_assignments WHERE id = p_assignment_id),
    (SELECT draft_comment FROM public.task_assignments WHERE id = p_assignment_id),
    NOW()
  );

  RAISE NOTICE 'Assignment % reverted from % to submitted. Reason: %', p_assignment_id, v_prev_status, p_reason;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revert_assignment(uuid, text) TO authenticated;

-- Add 'task_revert' to the user_credits source CHECK constraint.
ALTER TABLE public.user_credits
  DROP CONSTRAINT IF EXISTS user_credits_source_check;
ALTER TABLE public.user_credits
  ADD CONSTRAINT user_credits_source_check
  CHECK ((source = ANY (ARRAY[
    'referral_bonus_referrer'::text,
    'referral_bonus_referee'::text,
    'signup_bonus'::text,
    'manual_adjustment'::text,
    'karma_milestone'::text,
    'task_reward'::text,
    'task_revert'::text,
    'wa_group_verified'::text
  ])));

-- Allow 'reverted' status in task_assignment_history CHECK constraint
-- so the revert migration can record audit events.
ALTER TABLE public.task_assignment_history
  DROP CONSTRAINT IF EXISTS task_assignment_history_status_check;
ALTER TABLE public.task_assignment_history
  ADD CONSTRAINT task_assignment_history_status_check
  CHECK (status IN ('approved', 'rejected', 'reverted'));

NOTIFY pgrst, 'reload schema';
