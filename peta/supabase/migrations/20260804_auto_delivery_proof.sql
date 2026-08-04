-- QA4: Auto-populate delivery proof on reddit_upvote_orders when PeTa army
-- assignment is approved. Client sees proof without admin manual copy-paste.

DROP TRIGGER IF EXISTS tg_on_assignment_approved ON public.task_assignments;

CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_reward int;
  v_task_title text;
  v_source_order_id int;
  v_requested int;
  v_delivered int;
  v_proof_text text;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT COALESCE(ta.user_id, ra.user_id), t.reward_amount, t.title, t.source_order_id
      INTO v_user_id, v_reward, v_task_title, v_source_order_id
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.id = NEW.id;

    -- Credit the army member.
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (
      v_user_id, v_reward, 'task_reward',
      format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
      NEW.id
    )
    ON CONFLICT DO NOTHING;

    NEW.balance_credited_at := NOW();

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

    PERFORM public.sync_task_slot_count(NEW.task_id);

    -- Straight order sync: increment delivered count + auto-complete.
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

      -- ============================================================
      -- QA4: Auto-populate delivery proof from army submission
      -- Compose text from: submitted_username, draft_comment, user_note
      -- URL: prefer screenshot (proof_image_url) over URL (proof_url)
      -- ============================================================
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
END $$;

DROP TRIGGER IF EXISTS tg_on_assignment_approved ON public.task_assignments;
CREATE TRIGGER tg_on_assignment_approved
  BEFORE UPDATE OF status ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_on_assignment_approved();

NOTIFY pgrst, 'reload schema';
