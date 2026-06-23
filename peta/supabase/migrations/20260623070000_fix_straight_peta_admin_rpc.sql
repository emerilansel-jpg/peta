-- =============================================================
-- Straight Ltd + PeTa — fix admin RPCs used to import Straight
-- orders into PeTa tasks.
--
-- 1) admin_list_pending_reddit_orders returned au.email as
--    varchar(255) but the function declared it as text, causing
--    PostgREST error 42804. Cast to text.
-- 2) admin_update_task had two overloaded signatures; PeTa admin
--    edit sheet uses the 16-param version. Drop the old 14-param
--    version to resolve ambiguity.
-- =============================================================

-- Fix #1: cast auth.users.email to text to match declared return type.
CREATE OR REPLACE FUNCTION public.admin_list_pending_reddit_orders()
RETURNS TABLE(
  id bigint,
  status text,
  subreddit text,
  thread_url text,
  target_type text,
  requested_upvotes integer,
  notes text,
  created_at timestamp with time zone,
  client_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.status,
    o.subreddit,
    o.thread_url,
    o.target_type,
    o.requested_upvotes,
    o.notes,
    o.created_at,
    au.email::text
  FROM public.reddit_upvote_orders o
  LEFT JOIN auth.users au ON au.id = o.user_id
  WHERE o.status IN ('pending', 'processing')
    AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.source_order_id = o.id)
  ORDER BY o.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_pending_reddit_orders() TO authenticated;

-- Fix #2: remove obsolete overloads so PostgREST can unambiguously
-- route to the version that matches the frontend.
DROP FUNCTION IF EXISTS public.admin_update_task(
  uuid, text, text, text, text, text, integer, integer, integer, integer, integer,
  timestamp with time zone, timestamp with time zone, text
);
DROP FUNCTION IF EXISTS public.admin_update_task(
  uuid, text, text, text, text, text, integer, integer, integer, integer, integer,
  timestamp with time zone, timestamp with time zone, text, boolean, text
);

-- Ensure the surviving version matches the frontend call exactly.
CREATE OR REPLACE FUNCTION public.admin_update_task(
  p_task_id uuid,
  p_title text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_brief text DEFAULT NULL::text,
  p_post_to_wa_group boolean DEFAULT NULL::boolean,
  p_wa_group_draft text DEFAULT NULL::text,
  p_target_url text DEFAULT NULL::text,
  p_task_category text DEFAULT NULL::text,
  p_reward_amount integer DEFAULT NULL::integer,
  p_max_assignments integer DEFAULT NULL::integer,
  p_per_account_limit integer DEFAULT NULL::integer,
  p_min_karma integer DEFAULT NULL::integer,
  p_min_account_age_days integer DEFAULT NULL::integer,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task_type text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote'      THEN 'upvote'
    WHEN 'reddit_comment'     THEN 'comment'
    WHEN 'forum_comment'      THEN 'comment'
    WHEN 'reddit_post_thread' THEN 'comment'
    ELSE NULL
  END;

  UPDATE public.tasks SET
    title                 = COALESCE(p_title, title),
    description           = COALESCE(p_description, description),
    brief                 = COALESCE(p_brief, brief),
    post_to_wa_group      = COALESCE(p_post_to_wa_group, post_to_wa_group),
    wa_group_draft        = COALESCE(p_wa_group_draft, wa_group_draft),
    target_url            = COALESCE(p_target_url, target_url),
    task_category         = COALESCE(p_task_category, task_category),
    task_type             = COALESCE(v_task_type, task_type),
    reward_amount         = COALESCE(p_reward_amount, reward_amount),
    max_assignments       = COALESCE(p_max_assignments, max_assignments),
    per_account_limit     = COALESCE(p_per_account_limit, per_account_limit),
    min_karma             = COALESCE(p_min_karma, min_karma),
    min_account_age_days  = COALESCE(p_min_account_age_days, min_account_age_days),
    start_at              = CASE WHEN p_start_at IS NOT NULL THEN p_start_at ELSE start_at END,
    end_at                = CASE WHEN p_end_at IS NOT NULL THEN p_end_at ELSE end_at END,
    status                = COALESCE(p_status, status)
  WHERE id = p_task_id;

  RETURN p_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_task(
  uuid, text, text, text, boolean, text, text, text, integer, integer, integer,
  integer, integer, timestamp with time zone, timestamp with time zone, text
) TO authenticated;
