-- ============================================================
-- PeTa / Straight Ltd — Fix "function jsonb_typeof(text) does not exist"
--
-- Symptom: creating any comment/forum order fails at runtime with
--   "function jsonb_typeof(text) does not exist".
--
-- Root cause: the AFTER INSERT trigger auto_import_reddit_order_to_task()
-- does `jsonb_typeof(NEW.notes)`, but reddit_upvote_orders.notes is a TEXT
-- column (see 20260511_reddit_upvotes_schema.sql:35). jsonb_typeof() only
-- accepts jsonb, so the cast error is raised inside the trigger and the
-- whole INSERT is rolled back — the order never gets created.
--
-- Fix: cast NEW.notes to jsonb first. The cast is wrapped in a sub-block
-- with an EXCEPTION handler so older upvote orders that stored arbitrary
-- (non-JSON) text in notes degrade gracefully to an empty JSON object
-- instead of crashing the trigger.
--
-- Safe to run on any environment regardless of whether 20260804 was
-- applied, since it re-creates the whole function.
--
-- NOTE: this migration also creates public.platform_for_url(text), which
-- forum_comment_task_brief() (replaced in 20260804) calls but which was
-- never actually defined anywhere. Without it the trigger fails again with
-- "function public.platform_for_url(text) does not exist".
-- ============================================================

BEGIN;

-- ------------------------------------------------------------------
-- 0. Create the missing platform_for_url(text) helper.
--    It is a thin wrapper over the existing forum_platform_label() so the
--    platform detection stays consistent everywhere.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_for_url(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN public.forum_platform_label(p_url, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_for_url(TEXT) TO authenticated;

DROP TRIGGER IF EXISTS trg_auto_import_reddit_order ON public.reddit_upvote_orders;

CREATE OR REPLACE FUNCTION public.auto_import_reddit_order_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_notes jsonb;
  v_service text;
  v_platform text;
  v_brand text;
  v_mention_mode text;
  v_comment_text text;
  v_is_reply boolean;
  v_reply_to text;
  v_category text;
  v_task_type text;
  v_brief text;
  v_desc text;
  v_reward integer;
BEGIN
  -- reddit_upvote_orders.notes is TEXT. Cast to jsonb defensively: older
  -- upvote orders stored arbitrary text here, so fall back to '{}' on a
  -- bad cast instead of crashing the trigger with jsonb_typeof(text).
  BEGIN
    v_notes := NEW.notes::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;
  v_service := coalesce(v_notes->>'service', 'upvote');

  -- Only import comment-type orders
  IF NEW.target_type <> 'comment' AND v_service <> 'forum_comment' THEN
    RETURN NEW;
  END IF;

  v_platform := coalesce(v_notes->>'platform', NEW.subreddit);
  v_brand := coalesce(v_notes->>'brand_name', '');
  v_mention_mode := coalesce(v_notes->>'brand_mention_mode', 'none');
  v_comment_text := v_notes->>'comment_text';
  v_is_reply := COALESCE((v_notes->>'is_reply')::boolean, false);
  v_reply_to := v_notes->>'reply_to_comment';

  -- Detect category
  IF lower(coalesce(NEW.thread_url, '')) LIKE '%reddit.com%' THEN
    v_category := 'reddit_comment';
    v_task_type := 'comment';
  ELSE
    v_category := 'forum_comment';
    v_task_type := 'comment';
  END IF;

  -- Build brief with reply support (6-param signature from 20260804).
  -- If that signature is unavailable for any reason, the inner block
  -- falls back to the plain 4-arg variant.
  BEGIN
    v_brief := public.forum_comment_task_brief(NEW.thread_url, v_comment_text, v_brand, v_mention_mode, v_is_reply, v_reply_to);
  EXCEPTION WHEN undefined_function THEN
    v_brief := public.forum_comment_task_brief(NEW.thread_url, v_comment_text, v_brand, v_mention_mode);
  END;

  v_desc := format('Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot bukti.', coalesce(v_platform, 'forum'));
  v_reward := 5000;

  -- Insert the task
  INSERT INTO public.tasks (
    title, description, brief, target_url,
    task_type, task_category, reward_amount,
    status, max_assignments, current_assignments,
    created_by, source_order_id
  ) VALUES (
    format('Komen di %s%s', coalesce(v_platform, 'Forum'), CASE WHEN v_brand IS NOT NULL AND length(v_brand) > 0 THEN ' - ' || v_brand ELSE '' END),
    v_desc,
    v_brief,
    NEW.thread_url,
    v_task_type,
    v_category,
    v_reward,
    'draft',
    GREATEST(1, NEW.requested_upvotes),
    0,
    (SELECT id FROM public.users WHERE role = 'admin' ORDER BY created_at LIMIT 1),
    NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_import_reddit_order
  AFTER INSERT ON public.reddit_upvote_orders
  FOR EACH ROW
  WHEN (NEW.target_type = 'comment')
  EXECUTE FUNCTION public.auto_import_reddit_order_to_task();

NOTIFY pgrst, 'reload schema';

COMMIT;
