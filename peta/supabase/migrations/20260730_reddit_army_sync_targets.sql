-- ============================================================
-- PeTa — Reddit Army: helper RPC for the sync edge function.
--
-- list_reddit_army_sync_targets(p_user_ids) returns rows the edge
-- function needs: (user_id, username, reddit_account_id) for every
-- member whose program_status is phase2_active or resigning.
--
-- If p_user_ids is non-null, filter to those users (manual admin sync).
-- Otherwise return all eligible members.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_reddit_army_sync_targets(
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  username text,
  reddit_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rap.user_id,
    ra.username,
    rap.warmed_account_id AS reddit_account_id
  FROM public.reddit_army_profiles rap
  JOIN public.reddit_accounts ra ON ra.id = rap.warmed_account_id
  WHERE rap.program_status IN ('phase2_active','resigning')
    AND rap.warmed_account_id IS NOT NULL
    AND (p_user_ids IS NULL OR rap.user_id = ANY(p_user_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_reddit_army_sync_targets(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
