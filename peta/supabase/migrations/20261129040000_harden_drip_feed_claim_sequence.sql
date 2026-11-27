-- Harden one-brief-at-a-time drip-feed delivery.
--
-- One client order remains one PeTa task. Each released slot gets exactly one
-- client draft through task_assignments.draft_comment. The task-level brief
-- only exposes the currently released slot (patched in the preceding migration).

BEGIN;

-- The old trigger listed non-Reddit categories manually. New catalog services
-- then fell into the Reddit-account branch and could not be claimed.
CREATE OR REPLACE FUNCTION public.tg_enforce_assignment_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_limit int;
  v_existing int;
  v_live int;
BEGIN
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  v_limit := COALESCE(v_task.per_account_limit, 1);

  IF TG_OP = 'INSERT' THEN
    IF v_task.status <> 'active'
       OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
       OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at)
       OR COALESCE(v_task.is_hidden, false) THEN
      RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.task_live_assignment_count(NEW.task_id) INTO v_live;
    IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
      PERFORM public.sync_task_slot_count(NEW.task_id);
      RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.task_category, '') NOT LIKE 'reddit_%' THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND user_id = NEW.user_id
        AND (
          status IN ('in_progress', 'submitted', 'approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per member). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF NEW.reddit_account_id IS NULL THEN
        RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.' USING ERRCODE = 'P0001';
      END IF;

      SELECT user_id INTO NEW.user_id
      FROM public.reddit_accounts
      WHERE id = NEW.reddit_account_id;

      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Akun tidak valid.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND reddit_account_id = NEW.reddit_account_id
        AND (
          status IN ('in_progress', 'submitted', 'approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per akun). Coba task lain.', v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF NEW.draft_comment IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.draft_comment IS DISTINCT FROM OLD.draft_comment OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.enforce_unique_forum_comment(NEW.id, NEW.task_id, NEW.draft_comment);
  END IF;

  RETURN NEW;
END;
$$;

-- Allow the claim RPC to release its own expired in-progress row. The old
-- guard only allowed the scheduler's 24-hour expiry shape, while claim uses a
-- 3-hour retryable expiry shape before taking the next slot.
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

-- Keep the non-Reddit helper correct even if another migration rebinds it.
CREATE OR REPLACE FUNCTION public.tg_enforce_per_account_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
  v_existing int;
  v_category text;
BEGIN
  SELECT COALESCE(per_account_limit, 1), task_category
  INTO v_limit, v_category
  FROM public.tasks
  WHERE id = NEW.task_id;

  IF COALESCE(v_category, '') NOT LIKE 'reddit_%' THEN
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND user_id = NEW.user_id
      AND status IN ('in_progress', 'submitted', 'approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini (max % per member). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.reddit_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.' USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND reddit_account_id = NEW.reddit_account_id
      AND status IN ('in_progress', 'submitted', 'approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini (max % per akun). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Final claim function: assign one ordered draft, bind it to the assignment,
-- then leave the next draft locked behind the next released drip slot.
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL::uuid
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks;
  v_assignment public.task_assignments;
  v_reddit_acc public.reddit_accounts;
  v_is_admin boolean := false;
  v_active_claims_count int;
  v_active_total int;
  v_norm_target text;
  v_timeout_interval interval;
  v_is_reddit_task boolean := false;
  v_draft_id uuid := NULL;
  v_draft_text text := NULL;
  v_order_notes jsonb := '{}'::jsonb;
  v_image_id uuid := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation, task_id)
  VALUES (txid_current(), pg_backend_pid(), 'claim', p_task_id);

  -- Purge an expired claim before checking quota. The authorization trigger
  -- permits this exact transition only while the claim capability is present.
  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = 'Auto-cancelled: batas waktu pengerjaan habis (tidak disubmit)',
      can_retry = true,
      updated_at = NOW()
  WHERE task_id = p_task_id
    AND status = 'in_progress'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  PERFORM public.sync_task_slot_count(p_task_id);

  SELECT COUNT(*) INTO v_active_total
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = v_uid
    AND ta.status = 'in_progress'
    AND (ta.expires_at IS NULL OR ta.expires_at > NOW())
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  IF v_active_total >= 2 THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Kamu sedang mengerjakan % tugas lain. Selesaikan dan submit bukti terlebih dahulu sebelum mengambil tugas baru.', v_active_total
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task tidak ditemukan atau sudah tidak tersedia.' USING ERRCODE = 'P0001';
  END IF;

  v_is_admin := public.is_admin();

  IF v_task.status <> 'active' OR COALESCE(v_task.is_hidden, false) THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_task.task_category, '') <> 'reddit_challenge'
     AND (
       public.fn_is_invalid_task_url(v_task.target_url)
       OR COALESCE(v_task.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
     ) THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Link task ini tidak valid atau thread sudah ditutup (410/Closed). Silakan pilih task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.current_assignments >= v_task.max_assignments THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    v_timeout_interval := INTERVAL '4 hours';
  ELSE
    v_timeout_interval := INTERVAL '3 hours';
  END IF;

  v_is_reddit_task := (COALESCE(v_task.task_category, '') LIKE 'reddit_%');

  -- Select the lowest available client draft. A rejected/expired assignment
  -- may retry its own draft; active, submitted, and approved assignments keep
  -- their draft reserved permanently.
  IF v_task.source_order_id IS NOT NULL
     AND NOT v_is_reddit_task
     AND (
       COALESCE(v_task.task_type, '') = 'comment'
       OR COALESCE(v_task.task_category, '') IN (
         'forum_comment', 'comment', 'linkedin_comment', 'trustpilot_review',
         'google_maps_review', 'yelp_review', 'clutch_review',
         'facebook_group_comment', 'avvo_comment', 'avvo_review',
         'facebook_page_review'
       )
     ) THEN
    SELECT cd.id, cd.comment_text
    INTO v_draft_id, v_draft_text
    FROM public.reddit_order_comment_drafts cd
    WHERE cd.order_id = v_task.source_order_id
      AND (
        cd.assignment_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.task_assignments ta_bound
          WHERE ta_bound.id = cd.assignment_id
            AND ta_bound.status IN ('in_progress', 'submitted', 'approved')
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_d
        WHERE ta_d.task_id = v_task.id
          AND ta_d.status IN ('in_progress', 'submitted', 'approved')
          AND public.normalize_forum_comment(ta_d.draft_comment) = public.normalize_forum_comment(cd.comment_text)
      )
    ORDER BY cd.draft_index ASC, cd.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_draft_text IS NULL AND COALESCE(v_task.max_assignments, 1) = 1 THEN
      BEGIN
        SELECT COALESCE(o.notes, '{}')::jsonb INTO v_order_notes
        FROM public.reddit_upvote_orders o
        WHERE o.id = v_task.source_order_id;
        v_draft_text := NULLIF(btrim(v_order_notes->>'comment_text'), '');
      EXCEPTION WHEN others THEN
        v_draft_text := NULL;
      END;
    END IF;
  END IF;

  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.youtube_accounts ya
      WHERE ya.user_id = v_uid
        AND ya.verified_at IS NOT NULL
        AND ya.verification_status = 'approved'
        AND COALESCE(ya.is_active, true) = true
    ) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Wajib verifikasi akun YouTube (Advanced Features) dan disetujui admin sebelum mengambil task YouTube.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval)
    RETURNING * INTO v_assignment;

  ELSIF NOT v_is_reddit_task THEN
    IF COALESCE(v_task.task_category, '') IN (
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review', 'facebook_group_comment',
      'avvo_comment', 'avvo_review', 'facebook_page_review'
    ) THEN
      v_norm_target := regexp_replace(lower(btrim(COALESCE(v_task.target_url, ''))), '[/?#]+$', '');
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments ta2
        JOIN public.tasks t2 ON t2.id = ta2.task_id
        WHERE ta2.user_id = v_uid
          AND t2.task_category = v_task.task_category
          AND ta2.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t2.target_url, ''))), '[/?#]+$', '') = v_norm_target
      ) THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task untuk URL ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND (
        status IN ('in_progress', 'submitted', 'approved')
        OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
      );

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Kamu sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at, draft_comment)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + v_timeout_interval, v_draft_text)
    RETURNING * INTO v_assignment;

    IF v_draft_id IS NOT NULL THEN
      UPDATE public.reddit_order_comment_drafts
      SET assignment_id = v_assignment.id
      WHERE id = v_draft_id;
    END IF;

    IF COALESCE(v_task.task_category, '') = 'google_maps_review'
       AND v_task.source_order_id IS NOT NULL THEN
      SELECT i.id
      INTO v_image_id
      FROM public.reddit_order_review_images i
      WHERE i.order_id = v_task.source_order_id
        AND (
          i.assignment_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.task_assignments ta_img
            WHERE ta_img.id = i.assignment_id
              AND ta_img.status IN ('in_progress', 'submitted', 'approved')
          )
        )
      ORDER BY i.image_index
      LIMIT 1
      FOR UPDATE OF i SKIP LOCKED;

      IF v_image_id IS NOT NULL THEN
        UPDATE public.reddit_order_review_images
        SET assignment_id = v_assignment.id
        WHERE id = v_image_id;
      END IF;
    END IF;

  ELSE
    IF p_reddit_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit harus dipilih untuk task Reddit ini.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_reddit_acc
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id;

    IF v_reddit_acc.id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak ditemukan.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.user_id <> v_uid AND NOT v_is_admin THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit bukan milik kamu.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.status <> 'active' OR v_reddit_acc.is_active = FALSE THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    IF v_reddit_acc.status_flag IS NOT NULL AND v_reddit_acc.status_flag <> '' THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang bermasalah (%s). Gunakan akun lain.', v_reddit_acc.status_flag USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.min_karma, 0) > 0 AND v_reddit_acc.karma < v_task.min_karma THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Karma akun Reddit belum cukup (minimal % karma).', v_task.min_karma USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.min_account_age_days, 0) > 0 AND v_reddit_acc.account_age_days < v_task.min_account_age_days THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Umur akun Reddit belum cukup (minimal % hari).', v_task.min_account_age_days USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_active_claims_count
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND reddit_account_id = p_reddit_account_id
      AND status IN ('in_progress', 'submitted', 'approved');

    IF v_active_claims_count >= COALESCE(v_task.per_account_limit, 1) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit ini sudah mencapai batas pengerjaan untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at, draft_comment)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress', NOW() + v_timeout_interval, v_draft_text)
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current()
    AND backend_id = pg_backend_pid()
    AND operation = 'claim';

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END;
$function$;

-- The existing draft trigger was INSERT/UPDATE-only and dereferenced NEW on
-- DELETE. Rebuild it so admin/order edits cannot leave a stale visible brief.
CREATE OR REPLACE FUNCTION public.sync_order_drafts_to_task_brief()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_sync_order_drafts_to_task_brief(OLD.order_id);
    RETURN OLD;
  END IF;

  PERFORM public.fn_sync_order_drafts_to_task_brief(NEW.order_id);
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM public.fn_sync_order_drafts_to_task_brief(OLD.order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_drafts_to_task_brief ON public.reddit_order_comment_drafts;
DROP TRIGGER IF EXISTS trg_sync_order_drafts_to_task_brief_insert ON public.reddit_order_comment_drafts;
DROP TRIGGER IF EXISTS trg_sync_order_drafts_to_task_brief_update ON public.reddit_order_comment_drafts;
DROP TRIGGER IF EXISTS trg_sync_order_drafts_to_task_brief_delete ON public.reddit_order_comment_drafts;

CREATE TRIGGER trg_sync_order_drafts_to_task_brief_insert
  AFTER INSERT ON public.reddit_order_comment_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_drafts_to_task_brief();

CREATE TRIGGER trg_sync_order_drafts_to_task_brief_update
  AFTER UPDATE OF order_id, comment_text, draft_index ON public.reddit_order_comment_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_drafts_to_task_brief();

CREATE TRIGGER trg_sync_order_drafts_to_task_brief_delete
  AFTER DELETE ON public.reddit_order_comment_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_drafts_to_task_brief();

COMMIT;
NOTIFY pgrst, 'reload schema';
