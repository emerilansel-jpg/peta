-- Make avvo_review the active product slug while preserving avvo_comment history.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL::uuid
)
RETURNS task_assignments
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
  v_draft_text text := NULL;
  v_order_notes jsonb := '{}'::jsonb;
  v_image_id uuid := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Purge expired in_progress assignments for this task first
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

  -- 2. Anti-hoarding: Max 2 concurrent in_progress tasks per member (excluding Reddit challenge)
  SELECT COUNT(*) INTO v_active_total
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = v_uid
    AND ta.status = 'in_progress'
    AND (ta.expires_at IS NULL OR ta.expires_at > NOW())
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  IF v_active_total >= 2 THEN
    RAISE EXCEPTION 'Kamu sedang mengerjakan % tugas lain. Selesaikan dan submit bukti terlebih dahulu sebelum mengambil tugas baru.', v_active_total
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock task
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation)
  VALUES (txid_current(), pg_backend_pid(), 'claim');

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

  IF v_task.status <> 'active' THEN
    DELETE FROM public.assignment_write_capabilities
    WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
    RAISE EXCEPTION 'Task sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  -- Guard against broken / missing / search-page URLs
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

  -- 3 hours for micro-tasks (was 1h: caused 60% auto-cancel flood), 4 hours for YouTube
  IF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    v_timeout_interval := INTERVAL '4 hours';
  ELSE
    v_timeout_interval := INTERVAL '3 hours';
  END IF;

  v_is_reddit_task := (COALESCE(v_task.task_category, '') LIKE 'reddit_%');

  -- Fetch available comment/review draft if linked to a Straight order
  IF v_task.source_order_id IS NOT NULL
     AND COALESCE(v_task.task_category, '') IN ('forum_comment', 'comment', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'yelp_review', 'clutch_review', 'facebook_group_comment', 'avvo_comment', 'avvo_review', 'facebook_page_review') THEN
    SELECT cd.comment_text INTO v_draft_text
    FROM public.reddit_order_comment_drafts cd
    WHERE cd.order_id = v_task.source_order_id
      AND NOT EXISTS (
        SELECT 1 FROM public.task_assignments ta_d
        WHERE ta_d.task_id = v_task.id
          AND ta_d.status IN ('in_progress', 'submitted', 'approved')
          AND public.normalize_forum_comment(ta_d.draft_comment) = public.normalize_forum_comment(cd.comment_text)
      )
    ORDER BY cd.draft_index ASC
    LIMIT 1;

    IF v_draft_text IS NULL AND COALESCE(v_task.max_assignments, 1) = 1 THEN
      BEGIN
        SELECT COALESCE(o.notes, '{}')::jsonb INTO v_order_notes
        FROM public.reddit_upvote_orders o WHERE o.id = v_task.source_order_id;
        v_draft_text := NULLIF(btrim(v_order_notes->>'comment_text'), '');
      EXCEPTION WHEN others THEN
        v_draft_text := NULL;
      END;
    END IF;
  END IF;

  -- BRANCH A: YouTube Upload
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

  -- BRANCH B: NON-REDDIT TASKS
  ELSIF NOT v_is_reddit_task THEN
    IF COALESCE(v_task.task_category, '') IN (
      'linkedin_like', 'linkedin_follow', 'linkedin_comment',
      'trustpilot_review', 'google_maps_review', 'quora_upvote',
      'yelp_review', 'clutch_review', 'facebook_group_comment', 'avvo_comment', 'avvo_review', 'facebook_page_review'
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

    -- Bind a unique client photo for Google Maps review orders.
    -- FOR UPDATE OF i SKIP LOCKED: concurrent claims never receive the
    -- same photo; an image whose bound assignment is expired/rejected
    -- (or hard-deleted via ON DELETE SET NULL) returns to the pool.
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

  -- BRANCH C: REDDIT TASKS ONLY
  ELSE
    IF p_reddit_account_id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit harus dipilih untuk task Reddit ini.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_reddit_acc FROM public.reddit_accounts WHERE id = p_reddit_account_id;

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
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(id uuid, title text, description text, brief text, target_url text, task_type text, task_category text, reward_amount integer, max_assignments integer, current_assignments integer, min_karma integer, min_account_age_days integer, per_account_limit integer, status text, start_at timestamp with time zone, end_at timestamp with time zone, created_at timestamp with time zone, can_do_with_account_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user uuid;
  v_is_admin boolean;
  v_invited boolean;
  v_yt_verified boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND u.is_active = true) THEN
    RETURN;
  END IF;

  v_is_admin := public.is_admin();

  SELECT (
    v_is_admin
    OR EXISTS (SELECT 1 FROM public.reddit_army_profiles rap WHERE rap.user_id = v_user)
    OR COALESCE(u.role, '') IN ('admin', 'army', 'worker')
  ) INTO v_invited
  FROM public.users u
  WHERE u.id = v_user;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  -- 1. ALL NON-REDDIT TASKS
  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND NOT (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND NOT public.fn_is_invalid_task_url(t.target_url)
    AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    AND (COALESCE(t.task_category, '') <> 'youtube_upload' OR v_yt_verified)
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND (
          ta.status IN ('in_progress','submitted','approved')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    AND (
      COALESCE(t.task_category, '') NOT IN (
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'yelp_review', 'clutch_review', 'facebook_page_review', 'avvo_comment', 'avvo_review'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND ta_dedup.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. REDDIT TASKS ONLY
  IF v_invited THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, ra.id AS can_do_with_account_id
    FROM public.tasks t
    JOIN public.reddit_accounts ra ON ra.user_id = v_user
    WHERE t.status = 'active'
      AND t.is_hidden = false
      AND (COALESCE(t.task_category, '') LIKE 'reddit_%')
      AND COALESCE(t.task_category, '') <> 'reddit_challenge'
      AND NOT public.fn_is_invalid_task_url(t.target_url)
      AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
      AND (v_is_admin OR ra.karma >= COALESCE(t.min_karma, 0))
      AND (v_is_admin OR ra.account_age_days >= COALESCE(t.min_account_age_days, 0))
      AND (v_is_admin OR ra.status_flag NOT IN ('suspended','not_found'))
      AND (
        SELECT count(*)
        FROM public.task_assignments ta
        WHERE ta.task_id = t.id
          AND ta.reddit_account_id = ra.id
          AND ta.status IN ('in_progress','submitted','approved')
      ) < COALESCE(t.per_account_limit, 1)
    ORDER BY t.id, t.created_at DESC;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user(p_user_id uuid)
RETURNS TABLE(id uuid, title text, description text, brief text, target_url text, task_type text, task_category text, reward_amount integer, max_assignments integer, current_assignments integer, min_karma integer, min_account_age_days integer, per_account_limit integer, status text, created_at timestamp with time zone, platform text, eligible_account_count integer, brand_domain text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := p_user_id;
  v_yt_verified boolean := false;
BEGIN
  IF v_user IS NULL THEN v_user := auth.uid(); END IF;
  IF v_user IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.youtube_accounts ya
    WHERE ya.user_id = v_user
      AND ya.verified_at IS NOT NULL
      AND ya.verification_status = 'approved'
      AND COALESCE(ya.is_active, true) = true
  ) INTO v_yt_verified;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    COALESCE(public.forum_platform_label(t.target_url, NULL), 'Forum') AS platform,
    1 AS eligible_account_count,
    NULL::text AS brand_domain
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND NOT (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND NOT public.fn_is_invalid_task_url(t.target_url)
    AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    AND (COALESCE(t.task_category, '') <> 'youtube_upload' OR v_yt_verified)
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND (
          ta.status IN ('claimed', 'submitted', 'approved', 'in_progress')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    ) < COALESCE(t.per_account_limit, 1)
    AND (
      COALESCE(t.task_category, '') NOT IN (
        'linkedin_like', 'linkedin_follow', 'linkedin_comment',
        'trustpilot_review', 'google_maps_review', 'quora_upvote',
        'yelp_review', 'clutch_review', 'facebook_page_review', 'avvo_comment', 'avvo_review'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
          AND ta_dedup.status IN ('claimed', 'submitted', 'approved', 'in_progress')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  RETURN QUERY
  SELECT
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.created_at,
    'Reddit'::text AS platform,
    count(ra.id)::int AS eligible_account_count,
    NULL::text AS brand_domain
  FROM public.tasks t
  JOIN public.reddit_accounts ra
    ON ra.user_id = v_user
   AND ra.status = 'active'
   AND ra.is_active = true
   AND ra.karma >= COALESCE(t.min_karma, 0)
   AND ra.account_age_days >= COALESCE(t.min_account_age_days, 0)
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND (COALESCE(t.task_category, '') LIKE 'reddit_%')
    AND COALESCE(t.task_category, '') <> 'reddit_challenge'
    AND NOT public.fn_is_invalid_task_url(t.target_url)
    AND COALESCE(t.url_status, 'ok') NOT IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url')
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND NOT EXISTS (
      SELECT 1
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.reddit_account_id = ra.id
        AND (
          ta.status IN ('claimed', 'submitted', 'approved', 'in_progress')
          OR (ta.status = 'rejected' AND COALESCE(ta.can_retry, false) = false)
        )
    )
  GROUP BY t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
           t.task_category, t.reward_amount, t.max_assignments,
           t.current_assignments, t.min_karma, t.min_account_age_days,
           t.per_account_limit, t.status, t.created_at
  HAVING count(ra.id) > 0
  ORDER BY t.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_enforce_avvo_yelp_submission_sop()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_category text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'submitted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN RETURN NEW; END IF;
  SELECT task_category INTO v_category FROM public.tasks WHERE id = NEW.task_id;
  IF v_category IN ('avvo_comment', 'avvo_review')
     AND (COALESCE(NEW.user_note, '') NOT LIKE '%[VPN-WINDSCRIBE]%'
          OR COALESCE(NEW.user_note, '') NOT LIKE '%[BULE-ACCOUNT]%') THEN
    RAISE EXCEPTION 'Avvo submissions require Windscribe VPN and English-name confirmations.' USING ERRCODE = 'P0001';
  END IF;
  IF v_category = 'yelp_review'
     AND (COALESCE(NEW.user_note, '') NOT LIKE '%[VPN-ACTIVE]%'
          OR COALESCE(NEW.user_note, '') NOT LIKE '%[SEARCH-FIRST]%'
          OR COALESCE(NEW.user_note, '') NOT LIKE '%[BULE-ACCOUNT]%') THEN
    RAISE EXCEPTION 'Yelp submissions require VPN, search-first, and English-name confirmations.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_enforce_avvo_yelp_submission_sop ON public.task_assignments;
CREATE TRIGGER tg_enforce_avvo_yelp_submission_sop
  BEFORE INSERT OR UPDATE OF status, user_note ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_avvo_yelp_submission_sop();

COMMIT;
NOTIFY pgrst, 'reload schema';
