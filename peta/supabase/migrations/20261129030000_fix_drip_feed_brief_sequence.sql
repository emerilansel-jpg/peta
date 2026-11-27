-- Show only the client brief for the currently released drip-feed slot.
-- The previous sync used string_agg(), so every review draft leaked into one
-- PeTa task. Drip-feed keeps one task and advances its brief as slots release.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_sync_order_drafts_to_task_brief(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.reddit_upvote_orders;
  v_task_id uuid;
  v_task public.tasks;
  v_service public.straight_services;
  v_notes jsonb := '{}'::jsonb;
  v_base text;
  v_draft text;
  v_slot_index integer := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE source_order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_task.id IS NULL THEN RETURN; END IF;
  v_task_id := v_task.id;

  BEGIN
    v_notes := COALESCE(v_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  SELECT * INTO v_service
  FROM public.straight_services
  WHERE slug = COALESCE(v_order.target_type, v_notes->>'service');

  v_base := COALESCE(
    NULLIF(btrim(replace(v_notes->>'review_brief', chr(1), '')), ''),
    NULLIF(btrim(replace(v_notes->>'client_notes', chr(1), '')), ''),
    NULLIF(btrim(v_service.worker_brief_template), ''),
    NULLIF(btrim(v_service.worker_sop), ''),
    'Kerjakan tugas sesuai instruksi.'
  );

  -- max_assignments is the number of drip slots released so far. Keep the
  -- first brief visible until the first slot is released, then show #2, etc.
  IF COALESCE(v_task.drip_interval_hours, 0) > 0
     AND COALESCE(v_task.drip_total_target, 0) > 0 THEN
    v_slot_index := GREATEST(COALESCE(v_task.max_assignments, 1) - 1, 0);
  END IF;

  IF COALESCE(v_task.drip_interval_hours, 0) > 0
     AND COALESCE(v_task.drip_total_target, 0) > 0 THEN
    SELECT d.comment_text
    INTO v_draft
    FROM public.reddit_order_comment_drafts d
    WHERE d.order_id = p_order_id
    ORDER BY d.draft_index ASC, d.created_at ASC
    OFFSET v_slot_index
    LIMIT 1;

    UPDATE public.tasks
    SET brief = CASE
                  WHEN v_draft IS NULL OR btrim(v_draft) = '' THEN v_base
                  ELSE v_base || E'\n\nCLIENT-SUPPLIED TEXT:\n' || v_draft
                END,
        updated_at = now()
    WHERE id = v_task_id;
  ELSE
    UPDATE public.tasks
    SET brief = v_base || COALESCE(
      (
        SELECT E'\n\nCLIENT-SUPPLIED TEXTS:\n' || string_agg(
          format(E'TEXT REVIEW #%s:\n%s', d.position, d.comment_text),
          E'\n\n' ORDER BY d.draft_index, d.created_at
        )
        FROM (
          SELECT d.*,
                 row_number() OVER (ORDER BY d.draft_index, d.created_at) AS position
          FROM public.reddit_order_comment_drafts d
          WHERE d.order_id = p_order_id
        ) d
      ),
      ''
    ),
        updated_at = now()
    WHERE id = v_task_id;
  END IF;
END;
$$;

-- process_drip_feed_tasks increments max_assignments. This trigger updates the
-- visible brief in the same transaction, without duplicating that function's
-- large release implementation.
CREATE OR REPLACE FUNCTION public.sync_drip_task_brief_on_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_order_id IS NOT NULL
     AND NEW.max_assignments IS DISTINCT FROM OLD.max_assignments
     AND NEW.max_assignments > OLD.max_assignments THEN
    PERFORM public.fn_sync_order_drafts_to_task_brief(NEW.source_order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_drip_task_brief_on_release ON public.tasks;
CREATE TRIGGER trg_sync_drip_task_brief_on_release
  AFTER UPDATE OF max_assignments ON public.tasks
  FOR EACH ROW
  WHEN (NEW.max_assignments IS NOT NULL
        AND OLD.max_assignments IS NOT NULL
        AND NEW.max_assignments > OLD.max_assignments)
  EXECUTE FUNCTION public.sync_drip_task_brief_on_release();

-- Repair tasks created before this fix. Scope: drip tasks (the reported bug)
-- plus the Facebook/Avvo review orders from the original draft-sync backfill.
-- Forum comment tasks keep their historical brief as-is.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT t.source_order_id
    FROM public.tasks t
    JOIN public.reddit_upvote_orders o ON o.id = t.source_order_id
    WHERE t.source_order_id IS NOT NULL
      AND (
        COALESCE(t.drip_interval_hours, 0) > 0
        OR o.target_type IN ('facebook_page_review', 'avvo_review', 'avvo_comment')
      )
  LOOP
    PERFORM public.fn_sync_order_drafts_to_task_brief(r.source_order_id);
  END LOOP;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
