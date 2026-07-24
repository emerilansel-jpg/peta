-- ============================================================
-- PeTa — extend admin_approval_history with date range filter.
--
-- Adds optional p_from / p_to params (inclusive day bounds) so the
-- admin calendar filter can scope the history to a specific period.
-- Defaults to NULL = unbounded (preserves existing behavior).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_approval_history(
  p_status text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  status          text,
  proof_url       text,
  draft_comment   text,
  admin_notes     text,
  created_at      timestamptz,
  updated_at      timestamptz,
  resolved_at     timestamptz,
  can_retry       boolean,
  task_id         uuid,
  task_title      text,
  task_target_url text,
  task_category   text,
  task_type       text,
  task_reward     int,
  submitted_url   text,
  submitted_username text,
  proof_image_url text,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text,
  user_note       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filter text := lower(trim(coalesce(p_status, '')));
  v_from timestamptz := p_from::timestamptz;
  -- p_to inclusive of the full end day (23:59:59.999999).
  v_to timestamptz := (p_to::timestamp + interval '1 day')::timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    ta.draft_comment::text,
    ta.admin_notes::text,
    ta.created_at,
    ta.updated_at,
    COALESCE(ta.updated_at, ta.created_at) AS resolved_at,
    COALESCE(ta.can_retry, false) AS can_retry,
    t.id AS task_id,
    t.title::text AS task_title,
    t.target_url::text AS task_target_url,
    t.task_category::text,
    t.task_type::text,
    t.reward_amount AS task_reward,
    ta.submitted_url::text,
    ta.submitted_username::text,
    ta.proof_image_url::text,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    COALESCE(ta.user_id, ra.user_id) AS army_user_id,
    au.email::text AS army_email,
    COALESCE(army_u.full_name, u.full_name)::text AS army_name,
    ta.user_note::text
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = ra.user_id
  LEFT JOIN public.users army_u ON army_u.id = ta.user_id
  LEFT JOIN auth.users au ON au.id = COALESCE(ta.user_id, ra.user_id)
  WHERE ta.status IN ('approved', 'rejected')
    AND (v_filter = '' OR v_filter IS NULL OR ta.status = v_filter)
    AND (v_from IS NULL OR COALESCE(ta.updated_at, ta.created_at) >= v_from)
    AND (v_to IS NULL OR COALESCE(ta.updated_at, ta.created_at) < v_to)
  ORDER BY ta.updated_at DESC
  LIMIT 200;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_approval_history(text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
