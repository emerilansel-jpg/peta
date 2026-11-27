-- Restore submit-path fields to the assignment authorization allowlist.
-- proof_image_hash (added 2026-11-05) never made it in, and the 2026-11-29
-- guard rewrite accidentally dropped submitted_at (added 2026-09-14).
-- Any submit carrying a screenshot hash then failed with
-- 'assignment_server_fields' after passing all category validations.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_assignment_authorization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean := COALESCE(public.is_admin(), false);
  v_owner uuid;
  v_task public.tasks;
BEGIN
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

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
        OR NEW.visibility_status IS NOT NULL
        OR NEW.visibility_reason IS NOT NULL
        OR NEW.balance_credited_at IS NOT NULL) THEN
      RAISE EXCEPTION 'assignment_server_fields';
    END IF;

    v_owner := COALESCE(
      NEW.user_id,
      (SELECT user_id FROM public.reddit_accounts WHERE id = NEW.reddit_account_id)
    );
  ELSE
    -- Claim-time expiry release. Capability is transaction-scoped and created
    -- by the SECURITY DEFINER claim function before this UPDATE.
    IF EXISTS (
         SELECT 1
         FROM public.assignment_write_capabilities
         WHERE transaction_id = txid_current()
           AND backend_id = pg_backend_pid()
           AND operation = 'claim'
           AND task_id = NEW.task_id
       )
       AND OLD.status = 'in_progress'
       AND OLD.expires_at IS NOT NULL
       AND OLD.expires_at < now()
       AND OLD.first_proof_submitted_at IS NULL
       AND OLD.balance_credited_at IS NULL
       AND NEW.status = 'rejected'
       AND NEW.can_retry IS TRUE
       AND NEW.admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)'
       AND (to_jsonb(NEW) - ARRAY['status','admin_notes','can_retry','updated_at']) =
           (to_jsonb(OLD) - ARRAY['status','admin_notes','can_retry','updated_at']) THEN
      RETURN NEW;
    END IF;

    -- Only the scheduler wrapper can expire untouched, overdue work. No
    -- proof/reward bypass.
    IF EXISTS (
         SELECT 1
         FROM public.assignment_write_capabilities
         WHERE transaction_id = txid_current()
           AND backend_id = pg_backend_pid()
           AND operation = 'expire'
       )
       AND OLD.status = 'in_progress'
       AND OLD.expires_at IS NOT NULL
       AND OLD.expires_at < now()
       AND OLD.first_proof_submitted_at IS NULL
       AND OLD.balance_credited_at IS NULL
       AND NEW.status = 'rejected'
       AND NEW.can_retry IS FALSE
       AND NEW.admin_notes = 'Auto-cancelled: tidak submit dalam 24 jam'
       AND (to_jsonb(NEW) - ARRAY['status','admin_notes','can_retry','updated_at']) =
           (to_jsonb(OLD) - ARRAY['status','admin_notes','can_retry','updated_at']) THEN
      RETURN NEW;
    END IF;

    v_owner := COALESCE(
      OLD.user_id,
      (SELECT user_id FROM public.reddit_accounts WHERE id = OLD.reddit_account_id)
    );

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
      -- Worker-submittable fields only. submitted_at and proof_image_hash are
      -- written by the submit RPC server-side; every other column is protected.
      IF (to_jsonb(NEW) - ARRAY['status','proof_url','proof_image_url','proof_media','proof_urls',
           'submitted_url','submitted_username','user_note','draft_comment','updated_at',
           'first_proof_submitted_at','visibility_check_after','submitted_at','proof_image_hash']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status','proof_url','proof_image_url','proof_media','proof_urls',
           'submitted_url','submitted_username','user_note','draft_comment','updated_at',
           'first_proof_submitted_at','visibility_check_after','submitted_at','proof_image_hash']) THEN
        RAISE EXCEPTION 'assignment_server_fields';
      END IF;

      IF NOT (OLD.status IN ('in_progress','submitted') OR (OLD.status = 'rejected' AND OLD.can_retry IS TRUE))
         OR NEW.status NOT IN ('in_progress','submitted') THEN
        RAISE EXCEPTION 'assignment_status_forbidden';
      END IF;

      IF v_task.task_category = 'forum_comment'
         AND NEW.draft_comment IS DISTINCT FROM OLD.draft_comment
         AND NOT (
           OLD.draft_comment IS NULL
           AND OLD.status = 'in_progress'
           AND NEW.status = 'in_progress'
           AND EXISTS (
             SELECT 1
             FROM public.assignment_write_capabilities
             WHERE transaction_id = txid_current()
               AND backend_id = pg_backend_pid()
               AND operation = 'claim'
               AND task_id = NEW.task_id
           )
         ) THEN
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
    IF NEW.status = 'rejected'
       AND (NEW.visibility_status IS NULL OR NEW.visibility_status = 'unknown'
         OR (NEW.visibility_status = 'not_visible'
           AND (NEW.visibility_check_after IS NULL OR now() < NEW.visibility_check_after))) THEN
      RAISE EXCEPTION 'contributor_workflow_rejection_not_ready';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
