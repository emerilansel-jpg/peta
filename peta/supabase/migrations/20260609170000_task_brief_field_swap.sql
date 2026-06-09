-- =============================================================
-- PeTa — task field-swap: description = full brief/instructions, brief = comment only.
--
-- The army Task page shows: a yellow "Komentar yang harus diposting" box (from
-- tasks.brief, copyable) + a blue "Cara posting aman" box (from tasks.description).
-- The admin form was updated to enter instructions in description and the bare
-- comment in brief. This migration makes the same split happen for:
--   1. auto-imported Straight Ltd orders (admin_import_reddit_order)
--   2. existing tasks (backfill), so editing them later doesn't lose instructions.
--
-- Legacy "packed" briefs put both into tasks.brief with markers; the frontend
-- still splits those, but backfilling avoids an edit-time regression.
-- =============================================================

-- Instructions-only text (the packed brief minus the comment block) for a forum task.
CREATE OR REPLACE FUNCTION public.forum_comment_instructions(
  p_url text,
  p_platform text,
  p_brand text,
  p_mention_mode text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN position('DETAIL ORDER:' in b) > 0 THEN trim(substring(b FROM position('DETAIL ORDER:' in b)))
    ELSE b
  END
  FROM (SELECT public.forum_comment_task_brief(p_url, p_platform, NULL::text, p_brand, p_mention_mode) AS b) x;
$$;

-- Re-create the import RPC with the new field mapping for forum comment orders.
CREATE OR REPLACE FUNCTION public.admin_import_reddit_order(
  p_order_id bigint,
  p_reward_amount integer DEFAULT NULL::integer,
  p_min_level integer DEFAULT 0,
  p_title_override text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order reddit_upvote_orders%ROWTYPE;
  v_notes jsonb := '{}'::jsonb;
  v_is_forum_comment boolean := false;
  v_task_type text;
  v_task_category text;
  v_reward int;
  v_title text;
  v_description text;
  v_brief text;
  v_task_id uuid;
  v_platform text;
  v_brand text;
  v_comment_text text;
  v_mention_mode text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO v_order FROM reddit_upvote_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order not found'; END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE source_order_id = p_order_id) THEN
    RAISE EXCEPTION 'order already imported as task';
  END IF;

  BEGIN
    v_notes := COALESCE(v_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment := COALESCE(v_order.target_type, 'upvote') = 'comment'
    OR v_notes->>'service' = 'forum_comment';
  v_task_type := CASE WHEN v_order.target_type = 'upvote' THEN 'upvote' ELSE 'comment' END;
  v_task_category := CASE
    WHEN v_order.target_type = 'upvote' THEN 'reddit_upvote'
    WHEN v_is_forum_comment THEN 'forum_comment'
    ELSE 'reddit_comment'
  END;

  v_platform := public.forum_platform_label(v_order.thread_url, COALESCE(v_notes->>'platform', v_order.subreddit));
  v_brand := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_reward := COALESCE(p_reward_amount, CASE WHEN v_task_type = 'upvote' THEN 500 ELSE 5000 END);
  v_title := COALESCE(
    NULLIF(trim(p_title_override), ''),
    CASE
      WHEN v_is_forum_comment THEN format('%s comment task%s', v_platform, CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
      WHEN v_order.subreddit IS NOT NULL THEN format('r/%s - %s', v_order.subreddit, v_task_type)
      ELSE format('Reddit %s task', v_task_type)
    END
  );

  IF v_is_forum_comment THEN
    -- NEW model: instructions -> description, bare comment -> brief.
    v_description := public.forum_comment_instructions(v_order.thread_url, v_platform, v_brand, v_mention_mode);
    v_brief := COALESCE(v_comment_text, '');
  ELSE
    v_description := COALESCE(v_order.notes, 'Sourced from Straight Ltd order #' || p_order_id);
    v_brief := NULL;
  END IF;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category, min_level,
    max_assignments, per_account_limit, reward_amount, status, created_by, source_order_id
  ) VALUES (
    v_title, v_description, v_brief, v_order.thread_url, v_task_type, v_task_category,
    GREATEST(0, COALESCE(p_min_level, 0)),
    GREATEST(1, v_order.requested_upvotes),
    1,
    v_reward,
    'paused',
    v_uid,
    v_order.id
  )
  RETURNING id INTO v_task_id;

  UPDATE reddit_upvote_orders SET status = 'processing', updated_at = now()
  WHERE id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object('task_id', v_task_id, 'order_id', p_order_id, 'task_type', v_task_type, 'task_category', v_task_category);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_import_reddit_order(bigint, integer, integer, text) TO authenticated;

-- Backfill existing packed forum/comment tasks into the new shape:
--   description <- instructions (from 'DETAIL ORDER:' onward)
--   brief       <- comment only (between the comment marker and 'DETAIL ORDER:')
-- Idempotent: after running, brief no longer contains the marker so it won't re-match.
UPDATE public.tasks
SET
  description = trim(substring(brief FROM position('DETAIL ORDER:' in brief))),
  brief = trim(split_part(split_part(brief, 'DETAIL ORDER:', 1), 'COMMENT/POST YANG HARUS DIISI:', 2))
WHERE brief LIKE '%COMMENT/POST YANG HARUS DIISI:%'
  AND brief LIKE '%DETAIL ORDER:%';
