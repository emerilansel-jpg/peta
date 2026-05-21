-- =============================================================
-- Robust SECURITY DEFINER fallback for the admin approval queue.
--
-- The client previously hit task_assignments directly via PostgREST
-- with embedded joins (tasks(...), reddit_accounts(...)). Combining
-- RLS on three tables plus auth-token edge cases (stale JWT, role
-- mismatch, schema cache miss) made it flaky enough that the queue
-- sometimes rendered empty even when the DB had pending rows.
--
-- This RPC sidesteps all of that: SECURITY DEFINER, explicit admin
-- check, returns a flat JSON row that the client renders as-is.
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_pending_approvals()
RETURNS TABLE (
  id              uuid,
  status          text,
  proof_url       text,
  draft_comment   text,
  admin_notes     text,
  created_at      timestamptz,
  updated_at      timestamptz,
  submitted_at    timestamptz,
  task_id         uuid,
  task_title      text,
  task_target_url text,
  task_category   text,
  task_type       text,
  task_reward     int,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  -- Explicit ::text casts because auth.users.email is varchar (not text);
  -- without them PG raises "structure of query does not match function result type".
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    ta.draft_comment::text,
    ta.admin_notes::text,
    ta.created_at,
    ta.updated_at,
    COALESCE(ta.updated_at, ta.created_at) AS submitted_at,
    t.id AS task_id,
    t.title::text AS task_title,
    t.target_url::text AS task_target_url,
    t.task_category::text,
    t.task_type::text,
    t.reward_amount AS task_reward,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = ra.user_id
  LEFT JOIN auth.users au ON au.id = ra.user_id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;
