-- ============================================================
-- PeTa — Surface Firecrawl verification status in admin approval RPCs.
--
-- The ApprovalQueue UI already has a Firecrawl filter + badge, but the
-- underlying RPCs (admin_pending_approvals, admin_approval_history) never
-- returned is_verified_firecrawl — so the filter was inert. This recreates
-- both functions to include the two Firecrawl columns.
--
-- ADDITIVE: no data changes, only function definitions.
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_pending_approvals() — add is_verified_firecrawl + firecrawl_verified_at
--    NOTE: CREATE OR REPLACE cannot change RETURNS TABLE column list, so DROP first.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_pending_approvals();

CREATE OR REPLACE FUNCTION public.admin_pending_approvals()
RETURNS TABLE(
  assignment_id   uuid,
  status          text,
  proof_url       text,
  draft_comment   text,
  user_note       text,
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
  submitted_url   text,
  submitted_username text,
  proof_image_url text,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text,
  is_verified_firecrawl boolean,
  firecrawl_verified_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    ta.draft_comment::text,
    ta.user_note::text,
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
    ta.submitted_url::text,
    ta.submitted_username::text,
    ta.proof_image_url::text,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name,
    COALESCE(ta.is_verified_firecrawl, false) AS is_verified_firecrawl,
    ta.firecrawl_verified_at
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = COALESCE(ta.user_id, ra.user_id)
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;

-- ------------------------------------------------------------
-- 2) admin_approval_history(text, date, date) — add Firecrawl columns.
--    Branch 1 (task_assignments) reads the live columns; branch 2
--    (task_assignment_history) has no such columns, so emit NULLs to
--    keep the UNION shape consistent.
--    NOTE: DROP first because RETURNS TABLE column list changes.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_approval_history(text, date, date);

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
  user_note       text,
  is_verified_firecrawl boolean,
  firecrawl_verified_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filter text := lower(trim(coalesce(p_status, '')));
  v_from timestamptz := p_from::timestamptz;
  -- p_to inclusive of the full end day (23:59:59.999999).
  v_to timestamptz := (p_to::timestamp + interval '1 day')::timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- 1) Approved/rejected still on task_assignments (not yet reverted).
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
    ta.user_note::text,
    COALESCE(ta.is_verified_firecrawl, false) AS is_verified_firecrawl,
    ta.firecrawl_verified_at
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = ra.user_id
  LEFT JOIN public.users army_u ON army_u.id = ta.user_id
  LEFT JOIN auth.users au ON au.id = COALESCE(ta.user_id, ra.user_id)
  WHERE ta.status IN ('approved', 'rejected')
    AND (v_filter = '' OR v_filter IS NULL OR v_filter != 'reverted')
    AND (v_from IS NULL OR COALESCE(ta.updated_at, ta.created_at) >= v_from)
    AND (v_to IS NULL OR COALESCE(ta.updated_at, ta.created_at) < v_to)

  UNION ALL

  -- 2) Reverted records from the immutable history table.
  --    task_assignment_history has no Firecrawl columns → NULL placeholders.
  SELECT
    tah.assignment_id AS id,
    'reverted'::text AS status,
    tah.proof_url::text,
    tah.draft_comment::text,
    tah.admin_notes::text,
    tah.created_at,
    tah.created_at AS updated_at,
    tah.event_at AS resolved_at,
    COALESCE(tah.can_retry, false) AS can_retry,
    t2.id AS task_id,
    t2.title::text AS task_title,
    t2.target_url::text AS task_target_url,
    t2.task_category::text,
    t2.task_type::text,
    t2.reward_amount AS task_reward,
    NULL::text AS submitted_url,
    NULL::text AS submitted_username,
    NULL::text AS proof_image_url,
    NULL::uuid AS reddit_account_id,
    NULL::text AS reddit_username,
    tah.user_id AS army_user_id,
    au2.email::text AS army_email,
    COALESCE(u2.full_name, u2.full_name)::text AS army_name,
    NULL::text AS user_note,
    NULL::boolean AS is_verified_firecrawl,
    NULL::timestamptz AS firecrawl_verified_at
  FROM public.task_assignment_history tah
  LEFT JOIN public.tasks t2 ON t2.id = tah.task_id
  LEFT JOIN public.users u2 ON u2.id = tah.user_id
  LEFT JOIN auth.users au2 ON au2.id = tah.user_id
  WHERE tah.status = 'reverted'
    AND (v_filter = '' OR v_filter IS NULL OR v_filter = 'reverted')
    AND (v_from IS NULL OR tah.event_at >= v_from)
    AND (v_to IS NULL OR tah.event_at < v_to)

  ORDER BY resolved_at DESC
  LIMIT 200;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_approval_history(text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
