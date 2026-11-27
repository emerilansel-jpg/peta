-- Keep client-supplied Facebook/Avvo texts visible in Army task briefs.
-- Generic order RPC inserts the task before it inserts draft rows, so an AFTER
-- INSERT draft trigger closes that ordering gap.

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
  v_service public.straight_services;
  v_notes jsonb := '{}'::jsonb;
  v_base text;
  v_drafts text;
BEGIN
  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_task_id FROM public.tasks
  WHERE source_order_id = p_order_id ORDER BY created_at DESC LIMIT 1;
  IF v_task_id IS NULL THEN RETURN; END IF;

  BEGIN
    v_notes := COALESCE(v_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  SELECT * INTO v_service FROM public.straight_services
  WHERE slug = COALESCE(v_order.target_type, v_notes->>'service');

  v_base := COALESCE(
    NULLIF(btrim(v_notes->>'review_brief'), ''),
    NULLIF(btrim(v_notes->>'client_notes'), ''),
    NULLIF(btrim(v_service.worker_brief_template), ''),
    NULLIF(btrim(v_service.worker_sop), ''),
    'Kerjakan tugas sesuai instruksi.'
  );

  SELECT string_agg(format('TEXT REVIEW #%s:\n%s', d.draft_index + 1, d.comment_text), E'\n\n' ORDER BY d.draft_index)
  INTO v_drafts
  FROM public.reddit_order_comment_drafts d
  WHERE d.order_id = p_order_id;

  UPDATE public.tasks
  SET brief = CASE WHEN v_drafts IS NULL OR v_drafts = '' THEN v_base
                   ELSE v_base || E'\n\nCLIENT-SUPPLIED TEXTS:\n' || v_drafts END,
      updated_at = now()
  WHERE id = v_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_drafts_to_task_brief()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_sync_order_drafts_to_task_brief(NEW.order_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_drafts_to_task_brief ON public.reddit_order_comment_drafts;
CREATE TRIGGER trg_sync_order_drafts_to_task_brief
  AFTER INSERT OR UPDATE OF comment_text, draft_index ON public.reddit_order_comment_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_drafts_to_task_brief();

-- Backfill tasks created before this trigger existed.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT d.order_id
    FROM public.reddit_order_comment_drafts d
    JOIN public.reddit_upvote_orders o ON o.id = d.order_id
    WHERE o.target_type IN ('facebook_page_review', 'avvo_review', 'avvo_comment')
  LOOP
    PERFORM public.fn_sync_order_drafts_to_task_brief(r.order_id);
  END LOOP;
END;
$$;

-- Remove the control-character artifact introduced by the old client_notes regexp replacement.
UPDATE public.reddit_upvote_orders
SET notes = replace(notes, chr(1), '')
WHERE target_type IN ('facebook_page_review', 'avvo_review', 'avvo_comment')
  AND position(chr(1) in notes) > 0;

COMMIT;
NOTIFY pgrst, 'reload schema';
