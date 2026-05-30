ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS post_to_wa_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_group_draft text;

CREATE OR REPLACE FUNCTION public.forum_wa_group_draft(
  p_title text,
  p_url text,
  p_platform text,
  p_reward integer,
  p_comment_post text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_platform text := public.forum_platform_label(p_url, p_platform);
  v_comment text := nullif(trim(coalesce(p_comment_post, '')), '');
BEGIN
  RETURN concat_ws(E'\n',
    'Task baru tersedia',
    '',
    format('Platform: %s', coalesce(v_platform, 'Forum')),
    format('Task: %s', coalesce(nullif(trim(p_title), ''), 'Forum comment task')),
    format('Reward: Rp%s', to_char(coalesce(p_reward, 5000), 'FM999G999G999')),
    '',
    'Yang dikerjakan:',
    coalesce(v_comment, 'Buka target, baca konteks thread/post, lalu tulis komentar yang natural sesuai brief.'),
    '',
    'Bukti submit:',
    '- URL komentar/thread setelah komentar tampil',
    '- Username yang dipakai di platform',
    '- Screenshot optional tapi disarankan',
    '',
    'Ambil task dari dashboard PeTa. Jangan spam dan ikuti rules platform.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_task(
  p_task_id uuid,
  p_title text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_brief text DEFAULT NULL::text,
  p_target_url text DEFAULT NULL::text,
  p_task_category text DEFAULT NULL::text,
  p_reward_amount integer DEFAULT NULL::integer,
  p_max_assignments integer DEFAULT NULL::integer,
  p_per_account_limit integer DEFAULT NULL::integer,
  p_min_karma integer DEFAULT NULL::integer,
  p_min_account_age_days integer DEFAULT NULL::integer,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_post_to_wa_group boolean DEFAULT NULL::boolean,
  p_wa_group_draft text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task_type text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote'      THEN 'upvote'
    WHEN 'reddit_comment'     THEN 'comment'
    WHEN 'forum_comment'      THEN 'comment'
    WHEN 'reddit_post_thread' THEN 'comment'
    ELSE NULL
  END;
  UPDATE tasks SET
    title                 = COALESCE(p_title, title),
    description           = COALESCE(p_description, description),
    brief                 = COALESCE(p_brief, brief),
    target_url            = COALESCE(p_target_url, target_url),
    task_category         = COALESCE(p_task_category, task_category),
    task_type             = COALESCE(v_task_type, task_type),
    reward_amount         = COALESCE(p_reward_amount, reward_amount),
    max_assignments       = COALESCE(p_max_assignments, max_assignments),
    per_account_limit     = COALESCE(p_per_account_limit, per_account_limit),
    min_karma             = COALESCE(p_min_karma, min_karma),
    min_account_age_days  = COALESCE(p_min_account_age_days, min_account_age_days),
    start_at              = COALESCE(p_start_at, start_at),
    end_at                = COALESCE(p_end_at, end_at),
    status                = COALESCE(p_status, status),
    post_to_wa_group      = COALESCE(p_post_to_wa_group, post_to_wa_group),
    wa_group_draft        = COALESCE(p_wa_group_draft, wa_group_draft)
  WHERE id = p_task_id;
  RETURN p_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_task(
  uuid, text, text, text, text, text, integer, integer, integer, integer, integer,
  timestamp with time zone, timestamp with time zone, text, boolean, text
) TO authenticated;

WITH parsed AS (
  SELECT
    id,
    title,
    target_url,
    public.forum_platform_label(target_url, null) AS platform,
    reward_amount,
    trim(split_part(split_part(coalesce(brief, ''), 'DETAIL ORDER:', 1), 'COMMENT/POST YANG HARUS DIISI:', 2)) AS comment_post
  FROM public.tasks
  WHERE task_category = 'forum_comment'
)
UPDATE public.tasks t
SET wa_group_draft = public.forum_wa_group_draft(p.title, p.target_url, p.platform, p.reward_amount, p.comment_post)
FROM parsed p
WHERE t.id = p.id
  AND t.wa_group_draft IS NULL;
