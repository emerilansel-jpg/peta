-- =============================================================
-- Straight Ltd — auto-import Reddit/forum orders into PeTa tasks.
--
-- Production has been running this trigger for a while but it was
-- never added to the repo migrations. Re-adding it makes the repo
-- match production and documents the intended flow:
--   client pays -> order row created -> task auto-created as draft
--   -> admin activates -> army claims/submits -> admin approves.
--
-- Orders for forum_comment still flow through admin_import_reddit_order
-- when the auto-import doesn't cover them, but the happy path for
-- upvotes/standard comments is fully automatic.
-- =============================================================

CREATE OR REPLACE FUNCTION public.auto_import_reddit_order_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_notes           jsonb   := '{}'::jsonb;
  v_is_forum_comment boolean := false;
  v_task_type       text;
  v_task_category   text;
  v_reward          int;
  v_title           text;
  v_description     text;
  v_brief           text;
  v_platform        text;
  v_brand           text;
  v_comment_text    text;
  v_mention_mode    text;
  v_creator         uuid;
BEGIN
  IF NEW.status NOT IN ('pending', 'processing') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE source_order_id = NEW.id) THEN RETURN NEW; END IF;

  -- Parse order notes as JSON when possible (forum orders carry a structured payload).
  BEGIN
    v_notes := COALESCE(NEW.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment := COALESCE(NEW.target_type, 'upvote') = 'comment'
                        OR v_notes->>'service' = 'forum_comment';

  v_task_type := CASE WHEN NEW.target_type = 'upvote' THEN 'upvote' ELSE 'comment' END;

  v_task_category := CASE
    WHEN NEW.target_type = 'upvote'     THEN 'reddit_upvote'
    WHEN v_is_forum_comment             THEN 'forum_comment'
    WHEN NEW.target_type = 'thread'     THEN 'reddit_post_thread'
    ELSE 'reddit_comment'
  END;

  v_platform     := public.forum_platform_label(NEW.thread_url, COALESCE(v_notes->>'platform', NEW.subreddit));
  v_brand        := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_reward := CASE WHEN v_task_type = 'upvote' THEN 500 ELSE 5000 END;

  v_title := CASE
    WHEN v_is_forum_comment THEN
      format('Komen di %s%s', v_platform,
             CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
    WHEN NEW.subreddit IS NOT NULL THEN format('r/%s - %s', NEW.subreddit, v_task_type)
    ELSE format('Reddit %s task', v_task_type)
  END;

  IF v_is_forum_comment THEN
    v_description := format(
      'Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot buat bukti.',
      v_platform);
    v_brief := public.forum_comment_task_brief(NEW.thread_url, v_platform, v_comment_text, v_brand, v_mention_mode);
  ELSE
    -- Reddit order: keep plain-text notes, but never echo a raw JSON blob.
    IF NEW.notes IS NOT NULL AND btrim(NEW.notes) LIKE '{%' THEN
      v_description := 'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.';
    ELSE
      v_description := COALESCE(NULLIF(btrim(NEW.notes), ''),
                               'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.');
    END IF;
    v_brief := NULL;
  END IF;

  SELECT id INTO v_creator FROM users WHERE role = 'admin' LIMIT 1;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    min_karma, min_account_age_days, per_account_limit, min_level,
    max_assignments, reward_amount, status, created_by, source_order_id
  ) VALUES (
    v_title, v_description, v_brief,
    NEW.thread_url, v_task_type, v_task_category,
    0, 0, 1, 0,
    GREATEST(1, NEW.requested_upvotes),
    v_reward, 'draft', v_creator, NEW.id
  );

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_auto_import_reddit_order ON public.reddit_upvote_orders;
CREATE TRIGGER trg_auto_import_reddit_order
  AFTER INSERT ON public.reddit_upvote_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_import_reddit_order_to_task();
