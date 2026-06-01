-- Add army_whatsapp to admin_pending_approvals RPC
-- Needed by ApprovalQueue to build wa.me DM deeplink after bad_work rejection.
-- Also adds proof_image_url / submitted_url / submitted_username columns which
-- were missing from the original migration but used by the client.
DROP FUNCTION IF EXISTS public.admin_pending_approvals();

CREATE FUNCTION public.admin_pending_approvals()
RETURNS TABLE (
  id                uuid,
  status            text,
  proof_url         text,
  proof_image_url   text,
  submitted_url     text,
  submitted_username text,
  draft_comment     text,
  admin_notes       text,
  created_at        timestamptz,
  updated_at        timestamptz,
  submitted_at      timestamptz,
  task_id           uuid,
  task_title        text,
  task_target_url   text,
  task_category     text,
  task_type         text,
  task_reward       int,
  reddit_account_id uuid,
  reddit_username   text,
  army_user_id      uuid,
  army_email        text,
  army_name         text,
  army_whatsapp     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    COALESCE(ta.proof_image_url, '')::text,
    COALESCE(ta.submitted_url, '')::text,
    COALESCE(ta.submitted_username, '')::text,
    ta.draft_comment::text,
    ta.admin_notes::text,
    ta.created_at,
    ta.updated_at,
    COALESCE(ta.submitted_at, ta.updated_at, ta.created_at) AS submitted_at,
    t.id          AS task_id,
    t.title::text AS task_title,
    t.target_url::text AS task_target_url,
    t.task_category::text,
    t.task_type::text,
    t.reward_amount AS task_reward,
    ra.id         AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id          AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name,
    u.whatsapp::text  AS army_whatsapp
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t             ON t.id  = ta.task_id
  LEFT JOIN public.reddit_accounts ra  ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u             ON u.id  = ra.user_id
  LEFT JOIN auth.users au              ON au.id = ra.user_id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;
