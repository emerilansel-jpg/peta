-- Migration: 20260910130000_enable_reddit_workflow_globally.sql
-- Enable Reddit contributor workflow (screening + eligibility review + 72h proof) globally.
-- Non-Reddit tasks (LinkedIn, YouTube, Preferred Source Google, non-Reddit forums)
-- remain untouched and continue to use their existing legacy auto-activation flow.

BEGIN;

CREATE OR REPLACE FUNCTION public.contributor_pilot_enabled(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT true;
$$;

REVOKE ALL ON FUNCTION public.contributor_pilot_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contributor_pilot_enabled(uuid) TO authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
