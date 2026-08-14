-- ============================================================
-- PeTa — Fix stale sync_task_slot_count in BEFORE trigger + resync
--
-- BUG: tg_on_assignment_approved (BEFORE trigger) calls
--   sync_task_slot_count DURING the UPDATE, when the assignment row
--   in DB still has the OLD status. This caused tasks to be
--   momentarily reopened to 'active' even when being approved.
--   Combined with fix 3c from the previous migration (which reopened
--   tasks based on order status), tasks with approved assignments
--   ended up stuck on 'active'.
--
-- FIX:
--   1) Remove sync_task_slot_count call from the BEFORE trigger
--      (the AFTER trigger tg_sync_slot_on_status_change handles it
--      with fresh data).
--   2) Resync ALL tasks: completed when approved >= max_assignments.
--   3) Resync ALL orders: completed when approved >= requested.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Remove sync_task_slot_count from BEFORE trigger
--    (AFTER trigger tg_sync_slot_on_status_change already does this
--    with fresh, post-UPDATE data)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_reward int;
  v_task_title text;
  v_source_order_id int;
  v_requested int;
  v_delivered int;
  v_proof_text text;
  v_task_category text;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT COALESCE(ta.user_id, ra.user_id), t.reward_amount, t.title, t.source_order_id, t.task_category
      INTO v_user_id, v_reward, v_task_title, v_source_order_id, v_task_category
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.id = NEW.id;

    -- Credit cashable task reward ONLY for regular tasks.
    IF v_task_category IS DISTINCT FROM 'reddit_challenge' THEN
      INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
      VALUES (
        v_user_id, v_reward, 'task_reward',
        format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
        NEW.id
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (
        v_user_id,
        'task_reward_credited',
        jsonb_build_object(
          'assignment_id', NEW.id,
          'task_id', NEW.task_id,
          'amount', v_reward,
          'source_order_id', v_source_order_id
        )
      );
    END IF;

    NEW.balance_credited_at := NOW();
    -- NOTE: sync_task_slot_count is NOT called here anymore.
    -- The AFTER trigger tg_sync_slot_on_status_change handles it
    -- with post-UPDATE data (assignment already 'approved' in DB).

    -- Straight order sync (B2B orders)
    IF v_source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET delivered_upvotes = COALESCE(delivered_upvotes, 0) + 1
      WHERE id = v_source_order_id;

      SELECT requested_upvotes, delivered_upvotes INTO v_requested, v_delivered
      FROM public.reddit_upvote_orders WHERE id = v_source_order_id;

      IF v_delivered >= v_requested THEN
        UPDATE public.reddit_upvote_orders
        SET status = 'completed', completed_at = NOW()
        WHERE id = v_source_order_id AND status NOT IN ('completed','refunded');
        UPDATE public.tasks SET status = 'completed'
        WHERE id = NEW.task_id AND status = 'active';
      END IF;

      v_proof_text := format(
        'Comment by %s:\n%s%s',
        COALESCE(NULLIF(trim(NEW.submitted_username), ''), 'Unknown'),
        COALESCE(NEW.draft_comment, '(no comment text)'),
        CASE WHEN NEW.user_note IS NOT NULL AND length(trim(NEW.user_note)) > 0
          THEN E'\nNote: ' || trim(NEW.user_note)
          ELSE ''
        END
      );

      UPDATE public.reddit_upvote_orders
      SET
        delivery_proof_text = CASE
          WHEN delivery_proof_text IS NULL THEN v_proof_text
          ELSE delivery_proof_text || E'\n\n---\n\n' || v_proof_text
        END,
        delivery_proof_url = COALESCE(NEW.proof_image_url, NEW.proof_url, delivery_proof_url)
      WHERE id = v_source_order_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2) Resync ALL regular tasks with source orders:
--    completed iff approved_count >= max_assignments
-- ------------------------------------------------------------
UPDATE public.tasks t
SET status = CASE
  WHEN (SELECT count(*)::integer FROM public.task_assignments ta
        WHERE ta.task_id = t.id AND ta.status = 'approved')
       >= COALESCE(t.max_assignments, 0)
  THEN 'completed'
  ELSE 'active'
END,
updated_at = now()
WHERE t.task_category <> 'reddit_challenge'
  AND t.source_order_id IS NOT NULL
  AND t.status IN ('active', 'completed');

-- ------------------------------------------------------------
-- 3) Resync ALL orders: completed iff approved >= requested
-- ------------------------------------------------------------
UPDATE public.reddit_upvote_orders o
SET delivered_upvotes = GREATEST(
  COALESCE(o.delivered_upvotes, 0),
  (SELECT count(*)::integer FROM public.task_assignments ta
   JOIN public.tasks t ON t.id = ta.task_id
   WHERE t.source_order_id = o.id AND ta.status = 'approved')
),
status = CASE
  WHEN o.status IN ('refunded', 'cancelled') THEN o.status
  WHEN (SELECT count(*)::integer FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE t.source_order_id = o.id AND ta.status = 'approved')
       >= o.requested_upvotes
  THEN 'completed'
  ELSE 'processing'
END,
completed_at = CASE
  WHEN (SELECT count(*)::integer FROM public.task_assignments ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE t.source_order_id = o.id AND ta.status = 'approved')
       >= o.requested_upvotes
  THEN COALESCE(o.completed_at, NOW())
  ELSE NULL
END
WHERE EXISTS (SELECT 1 FROM public.tasks t WHERE t.source_order_id = o.id)
  AND o.status IN ('active', 'processing', 'completed');

NOTIFY pgrst, 'reload schema';
