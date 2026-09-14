-- Migration: 20260914100000_add_task_assignments_submitted_at.sql
-- Fix: Add missing submitted_at column on public.task_assignments
-- Root cause: Client and DB RPCs write to submitted_at, but the column was never added to table DDL.
--             PostgREST fails schema validation: "Could not find the 'submitted_at' column of 'task_assignments' in the schema cache"

BEGIN;

-- 1. Add column to task_assignments
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- 2. Update guard_assignment_authorization FIRST so that submitted_at is recognized in allowed fields
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'guard_assignment_authorization') THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.guard_assignment_authorization()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $body$
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
          NEW.submitted_at := NULL;
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

          -- Ensure submitted_at is populated when assignment is submitted
          IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
            NEW.submitted_at := now();
          END IF;

          IF NOT v_admin THEN
            -- Allow only proof/draft fields. Protect future server columns by default.
            IF (to_jsonb(NEW) - ARRAY['status','proof_url','proof_image_url','proof_media','proof_urls',
                 'submitted_url','submitted_username','user_note','draft_comment','updated_at',
                 'first_proof_submitted_at','visibility_check_after','submitted_at']) IS DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['status','proof_url','proof_image_url','proof_media','proof_urls',
                 'submitted_url','submitted_username','user_note','draft_comment','updated_at',
                 'first_proof_submitted_at','visibility_check_after','submitted_at']) THEN
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
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- 3. Backfill existing submitted/approved/rejected assignments (disable triggers during backfill)
ALTER TABLE public.task_assignments DISABLE TRIGGER USER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_assignments' AND column_name = 'first_proof_submitted_at'
  ) THEN
    EXECUTE 'UPDATE public.task_assignments SET submitted_at = COALESCE(first_proof_submitted_at, updated_at, created_at) WHERE status IN (''submitted'', ''approved'', ''rejected'') AND submitted_at IS NULL';
  ELSE
    EXECUTE 'UPDATE public.task_assignments SET submitted_at = COALESCE(updated_at, created_at) WHERE status IN (''submitted'', ''approved'', ''rejected'') AND submitted_at IS NULL';
  END IF;
END $$;

ALTER TABLE public.task_assignments ENABLE TRIGGER USER;

-- 4. Index for quick filtering / sorting by submission time
CREATE INDEX IF NOT EXISTS idx_task_assignments_submitted_at
  ON public.task_assignments(submitted_at)
  WHERE submitted_at IS NOT NULL;

-- 5. Update submit_assignment_proof RPC if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'submit_assignment_proof') THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.submit_assignment_proof(
        p_assignment_id uuid,
        p_proof_url text,
        p_submitted_url text DEFAULT NULL,
        p_submitted_username text DEFAULT NULL,
        p_draft_comment text DEFAULT NULL,
        p_proof_urls jsonb DEFAULT '[]'::jsonb,
        p_user_note text DEFAULT NULL,
        p_proof_image_url text DEFAULT NULL
      )
      RETURNS public.task_assignments
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $body$
      DECLARE
        v_assignment public.task_assignments;
        v_task public.tasks;
        v_first_submitted timestamptz;
        v_visibility_check timestamptz;
        v_contributor boolean;
        v_proof_urls jsonb;
      BEGIN
        IF auth.uid() IS NULL THEN
          RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_assignment
        FROM public.task_assignments
        WHERE id = p_assignment_id
        FOR UPDATE;

        IF v_assignment.id IS NULL THEN
          RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
        END IF;

        IF COALESCE(v_assignment.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = v_assignment.reddit_account_id)) IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
          RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
        END IF;

        IF NOT (
          v_assignment.status IN ('in_progress', 'submitted')
          OR (v_assignment.status = 'rejected' AND COALESCE(v_assignment.can_retry, false) = true)
        ) THEN
          RAISE EXCEPTION 'Assignment status tidak valid untuk submit bukti: %', v_assignment.status USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_task FROM public.tasks WHERE id = v_assignment.task_id;

        v_proof_urls := COALESCE(p_proof_urls, '[]'::jsonb);
        IF jsonb_typeof(v_proof_urls) IS DISTINCT FROM 'array' THEN
          v_proof_urls := '[]'::jsonb;
        END IF;

        -- 72h visibility check window
        v_first_submitted := v_assignment.first_proof_submitted_at;
        v_visibility_check := v_assignment.visibility_check_after;

        IF v_first_submitted IS NULL THEN
          v_first_submitted := NOW();
          v_visibility_check := v_first_submitted + INTERVAL '72 hours';
        END IF;

        v_contributor := COALESCE(v_assignment.contributor_workflow, false);

        UPDATE public.task_assignments
        SET status = 'submitted',
            proof_url = COALESCE(p_proof_url, proof_url),
            submitted_url = COALESCE(p_submitted_url, submitted_url),
            submitted_username = COALESCE(p_submitted_username, submitted_username),
            draft_comment = COALESCE(p_draft_comment, draft_comment),
            proof_urls = v_proof_urls,
            user_note = COALESCE(p_user_note, user_note),
            proof_image_url = COALESCE(p_proof_image_url, proof_image_url),
            first_proof_submitted_at = v_first_submitted,
            submitted_at = COALESCE(v_assignment.submitted_at, NOW()),
            visibility_check_after = v_visibility_check,
            contributor_workflow = v_contributor,
            updated_at = NOW()
        WHERE id = p_assignment_id
        RETURNING * INTO v_assignment;

        RETURN v_assignment;
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- 6. Update admin_pending_approvals RPC if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_pending_approvals') THEN
    DROP FUNCTION IF EXISTS public.admin_pending_approvals();
    EXECUTE $fn$
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
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $body$
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
          COALESCE(ta.submitted_at, ta.updated_at, ta.created_at) AS submitted_at,
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
        ORDER BY COALESCE(ta.submitted_at, ta.updated_at, ta.created_at) DESC;
      END;
      $body$;

      GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;
      REVOKE ALL ON FUNCTION public.admin_pending_approvals() FROM PUBLIC, anon;
    $fn$;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
