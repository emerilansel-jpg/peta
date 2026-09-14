-- Migration: 20260914110000_fix_security_and_qa_regressions.sql
-- Fixes:
-- 1. B02: Drop payouts_insert_own policy and revoke direct INSERT on payouts table for regular members.
-- 2. B03: Add pg_advisory_xact_lock per user in request_payout to serialize requests and prevent double-spending races.
-- 3. B06: Check final rejection (status = 'rejected' AND can_retry = false) in claim_challenge_task.
-- 4. B07: In guard_assignment_authorization, unconditionally force submitted_at = now() on status = 'submitted'.
-- 5. B09: Fix founding cap check in claim_onboarding_bonus to verify if user is among first 100 registered army users.

BEGIN;

-- 1. B02: Payout Direct Insert Hardening
DROP POLICY IF EXISTS payouts_insert_own ON public.payouts;
DROP POLICY IF EXISTS payouts_admin_insert ON public.payouts;
CREATE POLICY payouts_admin_insert ON public.payouts FOR INSERT TO authenticated WITH CHECK (public.is_admin());
REVOKE INSERT ON public.payouts FROM authenticated, anon;
GRANT INSERT ON public.payouts TO service_role;

-- 2. B03: Payout Advisory Locking for Race Prevention
CREATE OR REPLACE FUNCTION public.request_payout(p_amount integer)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  -- Acquire transaction advisory lock for this user to serialize concurrent payout attempts
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  v_eligibility := public.validate_payout_eligibility(v_uid, p_amount);
  IF NOT (v_eligibility->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_eligibility->>'message';
  END IF;

  INSERT INTO public.payouts (user_id, amount, status)
  VALUES (v_uid, p_amount, 'pending')
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.request_payout(
  p_amount integer,
  p_payment_type text,
  p_provider text,
  p_account_number text,
  p_account_holder_name text
)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_amount < 20000 THEN RAISE EXCEPTION 'Minimum payout Rp20.000'; END IF;
  IF p_payment_type IS NULL OR p_payment_type NOT IN ('ewallet', 'bank') THEN
    RAISE EXCEPTION 'Pilih metode penarikan (E-wallet atau Bank)';
  END IF;
  IF NULLIF(trim(p_provider), '') IS NULL THEN
    RAISE EXCEPTION 'Pilih provider (misal Dana, BCA, dll)';
  END IF;
  IF NULLIF(trim(p_account_number), '') IS NULL THEN
    RAISE EXCEPTION 'Nomor rekening/e-wallet wajib diisi';
  END IF;
  IF NULLIF(trim(p_account_holder_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pemilik rekening/e-wallet wajib diisi';
  END IF;

  -- Acquire transaction advisory lock for this user to serialize concurrent payout attempts
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  v_eligibility := public.validate_payout_eligibility(v_uid, p_amount);
  IF NOT (v_eligibility->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_eligibility->>'message';
  END IF;

  INSERT INTO public.payouts (
    user_id,
    amount,
    status,
    payment_method,
    payment_type,
    provider,
    account_number,
    account_holder_name
  )
  VALUES (
    v_uid,
    p_amount,
    'pending',
    p_provider,
    p_payment_type,
    p_provider,
    trim(p_account_number),
    trim(p_account_holder_name)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

-- 3. B06: Check final rejection in claim_challenge_task
CREATE OR REPLACE FUNCTION public.claim_challenge_task(
  p_task_id uuid,
  p_reddit_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_task public.tasks;
  v_account_id uuid;
  v_assignment_id uuid;
  v_live int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status != 'phase1_active' THEN
    RAISE EXCEPTION 'Program challenge belum aktif untuk kamu.';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF v_task IS NULL OR v_task.task_category != 'reddit_challenge' THEN
    RAISE EXCEPTION 'Task ini bukan task challenge.';
  END IF;
  IF v_task.status <> 'active'
     OR (v_task.start_at IS NOT NULL AND NOW() < v_task.start_at)
     OR (v_task.end_at IS NOT NULL AND NOW() >= v_task.end_at) THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.';
  END IF;

  IF v_task.challenge_level_id IS NULL THEN
    RAISE EXCEPTION 'Task challenge tidak memiliki level target.';
  END IF;

  PERFORM 1 FROM public.reddit_challenge_levels rcl
   WHERE rcl.id = v_task.challenge_level_id
     AND rcl.level_number = v_profile.current_challenge_level + 1
     AND rcl.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task ini bukan untuk level kamu saat ini.';
  END IF;

  -- Account must be active, owned by member or assigned warmed, and not suspended/not_found
  SELECT ra.id INTO v_account_id
    FROM public.reddit_accounts ra
   WHERE ra.id = p_reddit_account_id
     AND (ra.user_id = v_uid OR ra.id = v_profile.warmed_account_id)
     AND COALESCE(ra.is_active, true) = true
     AND ra.status_flag NOT IN ('suspended','not_found')
   LIMIT 1;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Reddit tidak aktif atau tidak valid untuk misi ini.';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.';
  END IF;

  -- Block if already has active/submitted/approved assignment OR permanent rejection (can_retry = false)
  PERFORM 1 FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND (
        status IN ('in_progress','submitted','approved')
        OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
      )
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Kamu sudah pernah mengerjakan misi ini atau tugas tidak dapat diulang.';
  END IF;

  INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
  VALUES (p_task_id, v_uid, v_account_id, 'in_progress')
  RETURNING id INTO v_assignment_id;

  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment_id;
END;
$$;

-- 4. B07: Server Timestamp Enforcement in guard_assignment_authorization
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

          -- Always enforce server timestamp when assignment is submitted (B07 fix)
          IF NEW.status = 'submitted' THEN
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

-- 5. B09: Founding Cap Registration Order Verification
CREATE OR REPLACE FUNCTION public.claim_onboarding_bonus(p_step text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID;
  v_amount INTEGER;
  v_description TEXT;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Founding cap: hanya 100 pendaftar pertama (berdasarkan created_at) yang berhak mendapat bonus founding
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT id FROM public.users WHERE role = 'army' ORDER BY created_at ASC LIMIT 100
    ) u WHERE u.id = v_user
  ) THEN
    RAISE EXCEPTION 'Founding bonus sudah penuh (hanya untuk 100 member pertama)';
  END IF;

  CASE p_step
    WHEN 'signup'         THEN v_amount := 25000; v_description := 'Bonus pendaftaran';
    WHEN 'wa_group'       THEN v_amount := 10000; v_description := 'Bonus gabung grup WhatsApp';
    WHEN 'warp'           THEN v_amount := 15000; v_description := 'Bonus setup WARP';
    WHEN 'reddit_account' THEN v_amount :=  5000; v_description := 'Bonus buat akun Reddit';
    WHEN 'reddit_url'     THEN v_amount :=  5000; v_description := 'Bonus verifikasi profil Reddit';
    ELSE RAISE EXCEPTION 'Unknown onboarding step: %', p_step;
  END CASE;

  INSERT INTO public.user_credits (user_id, amount, source, description)
  VALUES (v_user, v_amount, 'signup_bonus', v_description)
  ON CONFLICT (user_id, description) WHERE source = 'signup_bonus'
  DO NOTHING;

  RETURN v_amount;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_onboarding_bonus(text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
