-- Server boundary for direct writes AND SECURITY DEFINER RPCs. No JWT role assumption.
BEGIN;
-- Transaction-scoped capabilities: inaccessible to API roles; never trust custom GUC flags.
CREATE TABLE public.assignment_write_capabilities (
  transaction_id bigint NOT NULL, backend_id integer NOT NULL,
  operation text NOT NULL, task_id uuid,
  PRIMARY KEY (transaction_id, backend_id, operation)
);
ALTER TABLE public.assignment_write_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assignment_write_capabilities FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.claim_task_assignment(uuid,uuid) RENAME TO claim_task_assignment_internal;
REVOKE ALL ON FUNCTION public.claim_task_assignment_internal(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.claim_task_assignment(p_task_id uuid, p_reddit_account_id uuid DEFAULT NULL)
RETURNS public.task_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result public.task_assignments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.assignment_write_capabilities VALUES (txid_current(),pg_backend_pid(),'claim',p_task_id);
  result := public.claim_task_assignment_internal(p_task_id,p_reddit_account_id);
  DELETE FROM public.assignment_write_capabilities WHERE transaction_id=txid_current() AND backend_id=pg_backend_pid() AND operation='claim';
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_task_assignment(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_task_assignment(uuid,uuid) TO authenticated;

ALTER FUNCTION public.cancel_expired_assignments() RENAME TO cancel_expired_assignments_internal;
REVOKE ALL ON FUNCTION public.cancel_expired_assignments_internal() FROM PUBLIC, anon, authenticated, service_role;
-- Proof-bearing retries are review work, not abandoned claims. Keep them out of expiry.
CREATE OR REPLACE FUNCTION public.cancel_expired_assignments_internal() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result integer; affected uuid[];
BEGIN
  WITH expired AS (
    UPDATE public.task_assignments SET status='rejected',
      admin_notes='Auto-cancelled: tidak submit dalam 24 jam',can_retry=false,updated_at=now()
    WHERE status='in_progress' AND expires_at < now()
      AND first_proof_submitted_at IS NULL AND balance_credited_at IS NULL
      AND (admin_notes IS NULL OR admin_notes NOT LIKE 'Auto-cancelled:%')
    RETURNING task_id
  ) SELECT count(*)::integer,array_agg(DISTINCT task_id) INTO result,affected FROM expired;
  PERFORM public.sync_task_slot_count(id) FROM unnest(affected) AS id;
  RETURN result;
END $$;
CREATE FUNCTION public.cancel_expired_assignments() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result integer;
BEGIN
  INSERT INTO public.assignment_write_capabilities VALUES (txid_current(),pg_backend_pid(),'expire',NULL);
  result := public.cancel_expired_assignments_internal();
  DELETE FROM public.assignment_write_capabilities WHERE transaction_id=txid_current() AND backend_id=pg_backend_pid() AND operation='expire';
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cancel_expired_assignments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_assignments() TO service_role;

CREATE FUNCTION public.guard_contributor_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.eligibility_status IS DISTINCT FROM 'legacy'
     AND NEW.eligibility_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'task_eligibility_required';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.eligibility_status IS DISTINCT FROM 'legacy'
     AND NEW.eligibility_status IS NOT DISTINCT FROM 'legacy' THEN
    RAISE EXCEPTION 'task_workflow_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_contributor_task BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.guard_contributor_task();

CREATE FUNCTION public.guard_assignment_authorization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admin boolean := COALESCE(public.is_admin(), false);
  v_owner uuid;
  v_task public.tasks;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = NEW.task_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF v_task.eligibility_status IS DISTINCT FROM 'legacy' THEN
      IF v_task.eligibility_status IS DISTINCT FROM 'approved'
         OR NOT public.contributor_pilot_enabled(auth.uid()) THEN
        RAISE EXCEPTION 'task_eligibility_or_pilot_required';
      END IF;
    END IF;
    NEW.contributor_workflow := v_task.eligibility_status IS DISTINCT FROM 'legacy';
    NEW.first_proof_submitted_at := NULL;
    NEW.visibility_check_after := NULL;
    IF NOT v_admin AND (NEW.status IS DISTINCT FROM 'in_progress'
        OR NEW.visibility_status IS NOT NULL OR NEW.visibility_reason IS NOT NULL
        OR NEW.balance_credited_at IS NOT NULL) THEN
      RAISE EXCEPTION 'assignment_server_fields';
    END IF;
    v_owner := COALESCE(NEW.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = NEW.reddit_account_id));
  ELSE
    -- Only the scheduler wrapper can expire untouched, overdue work. No proof/reward bypass.
    IF EXISTS (SELECT 1 FROM public.assignment_write_capabilities WHERE transaction_id=txid_current()
        AND backend_id=pg_backend_pid() AND operation='expire')
       AND OLD.status='in_progress' AND OLD.expires_at < now()
       AND OLD.first_proof_submitted_at IS NULL AND OLD.balance_credited_at IS NULL
       AND NEW.status='rejected' AND NEW.can_retry IS FALSE
       AND NEW.admin_notes='Auto-cancelled: tidak submit dalam 24 jam'
       AND (to_jsonb(NEW)-ARRAY['status','admin_notes','can_retry','updated_at']) =
           (to_jsonb(OLD)-ARRAY['status','admin_notes','can_retry','updated_at']) THEN
      RETURN NEW;
    END IF;
    v_owner := COALESCE(OLD.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = OLD.reddit_account_id));
    IF NEW.contributor_workflow IS DISTINCT FROM OLD.contributor_workflow THEN
      RAISE EXCEPTION 'assignment_workflow_immutable';
    END IF;
    IF OLD.first_proof_submitted_at IS NOT NULL THEN
      IF NEW.first_proof_submitted_at IS DISTINCT FROM OLD.first_proof_submitted_at
         OR NEW.visibility_check_after IS DISTINCT FROM OLD.visibility_check_after THEN
        RAISE EXCEPTION 'assignment_deadline_immutable';
      END IF;
    ELSIF NEW.status = 'submitted' THEN
      NEW.first_proof_submitted_at := now();
      NEW.visibility_check_after := now() + interval '72 hours';
    ELSIF NEW.first_proof_submitted_at IS NOT NULL OR NEW.visibility_check_after IS NOT NULL THEN
      RAISE EXCEPTION 'assignment_deadline_server_managed';
    END IF;
    IF NOT v_admin THEN
      -- Allow only proof/draft fields. Protect future server columns by default.
      IF (to_jsonb(NEW) - ARRAY['status','proof_url','proof_image_url','proof_media','proof_urls',
           'submitted_url','submitted_username','user_note','draft_comment','updated_at',
           'first_proof_submitted_at','visibility_check_after']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status','proof_url','proof_image_url','proof_media','proof_urls',
           'submitted_url','submitted_username','user_note','draft_comment','updated_at',
           'first_proof_submitted_at','visibility_check_after']) THEN
        RAISE EXCEPTION 'assignment_server_fields';
      END IF;
      IF NOT (OLD.status IN ('in_progress','submitted') OR (OLD.status = 'rejected' AND OLD.can_retry IS TRUE))
         OR NEW.status NOT IN ('in_progress','submitted') THEN
        RAISE EXCEPTION 'assignment_status_forbidden';
      END IF;
      IF v_task.task_category = 'forum_comment' AND NEW.draft_comment IS DISTINCT FROM OLD.draft_comment
         AND NOT (OLD.draft_comment IS NULL AND OLD.status='in_progress' AND NEW.status='in_progress'
           AND EXISTS (SELECT 1 FROM public.assignment_write_capabilities WHERE transaction_id=txid_current()
             AND backend_id=pg_backend_pid() AND operation='claim' AND task_id=NEW.task_id)) THEN
        RAISE EXCEPTION 'assignment_draft_immutable';
      END IF;
    END IF;
  END IF;
  IF NOT v_admin AND (auth.uid() IS NULL OR v_owner IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'assignment_owner_required';
  END IF;
  IF NEW.contributor_workflow IS TRUE THEN
    IF NEW.status = 'approved' AND NEW.visibility_status IS DISTINCT FROM 'visible' THEN
      RAISE EXCEPTION 'contributor_workflow_requires_visible';
    END IF;
    IF NEW.status = 'rejected' AND (NEW.visibility_status IS NULL OR NEW.visibility_status = 'unknown'
       OR (NEW.visibility_status = 'not_visible' AND
         (NEW.visibility_check_after IS NULL OR now() < NEW.visibility_check_after))) THEN
      RAISE EXCEPTION 'contributor_workflow_rejection_not_ready';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- Runs after existing BEFORE triggers normalize ownership, before any AFTER ledger credit.
CREATE TRIGGER zz_guard_assignment_authorization BEFORE INSERT OR UPDATE ON public.task_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_authorization();
DROP FUNCTION public.admin_pending_approvals();
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
  proof_media     jsonb,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text,
  contributor_workflow boolean,
  first_proof_submitted_at timestamptz,
  visibility_check_after timestamptz,
  visibility_status text,
  visibility_reason text,
  proof_urls jsonb
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
    ta.proof_media,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name,
    ta.contributor_workflow, ta.first_proof_submitted_at, ta.visibility_check_after,
    ta.visibility_status, ta.visibility_reason, ta.proof_urls
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = COALESCE(ta.user_id, ra.user_id)
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_pending_approvals() FROM PUBLIC, anon;
COMMIT;
NOTIFY pgrst, 'reload schema';
