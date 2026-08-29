-- ============================================================
-- PeTa — Reddit Army: Phase 2 check-in (honor system) + multi-proof
--
-- Context (2026-08-29):
--   * Reddit blocks ALL unauthenticated sync (proxies/OAuth-unset), so
--     Phase 2 daily-activity detection is dead. This migration pivots
--     Phase 2 to member self-report ("check-in") with optional proof —
--     record_reddit_daily_activity stays the single write path so the
--     existing crons (biweekly cashout, resignation release, ghosting)
--     all start working the moment real rows exist.
--   * Challenge + check-in proofs must support >1 screenshot AND >1 URL.
--     Additive JSONB `proof_media` columns; legacy single columns stay
--     in sync (first image/url) for backward compatibility.
--   * Bundled bug fixes from the 2026-08-29 audit:
--       - get_reddit_army_profile now returns reddit_username
--       - submit_challenge_task_with_proof no longer gates on dead
--         reddit_daily_activity counts (verification is manual now)
--       - list_challenge_tasks_for_user dedupes rows per task (retry
--         path could return duplicates)
--       - flag_ghosting_for_review no longer appends the same GHOSTING
--         marker every week
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ADDITIVE: no existing column is dropped or retyped.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) task_assignments.proof_media — array of {type,url,name}
--    type: 'image' (uploaded screenshot) | 'url' (external link)
-- ------------------------------------------------------------
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS proof_media jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ------------------------------------------------------------
-- 2) reddit_daily_activity — check-in extras
-- ------------------------------------------------------------
ALTER TABLE public.reddit_daily_activity
  ADD COLUMN IF NOT EXISTS proof_media jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS verified_by_admin boolean,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- ------------------------------------------------------------
-- 3) self_report_daily_activity() — army check-in (honor system)
--    Reuses record_reddit_daily_activity so bonuses, resign_active_days,
--    last_active_date (ghosting) and biweekly cashout all stay in sync.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.self_report_daily_activity(
  p_comments_today int,
  p_posts_today int,
  p_proofs jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL
)
RETURNS public.reddit_daily_activity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_account_id uuid;
  v_proofs jsonb;
  v_row public.reddit_daily_activity;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase2_active','resigning') THEN
    RAISE EXCEPTION 'Check-in cuma buat member Fase 2 / sedang resign.';
  END IF;

  -- Sanity caps: honor system, but no absurd numbers.
  IF p_comments_today IS NULL OR p_posts_today IS NULL
     OR p_comments_today < 0 OR p_posts_today < 0
     OR p_comments_today + p_posts_today < 1 THEN
    RAISE EXCEPTION 'Minimal 1 aktivitas (komentar atau post) buat check-in.';
  END IF;
  IF p_comments_today > 50 OR p_posts_today > 50 THEN
    RAISE EXCEPTION 'Jumlah aktivitas nggak wajar (max 50 per jenis).';
  END IF;

  v_proofs := COALESCE(p_proofs, '[]'::jsonb);
  IF jsonb_typeof(v_proofs) <> 'array' THEN
    RAISE EXCEPTION 'proof_media harus array.';
  END IF;
  IF jsonb_array_length(v_proofs) > 10 THEN
    RAISE EXCEPTION 'Maksimal 10 bukti per check-in.';
  END IF;

  v_account_id := v_profile.warmed_account_id;
  IF v_account_id IS NULL THEN
    -- Fallback: newest reddit account owned by the member.
    SELECT id INTO v_account_id
      FROM public.reddit_accounts
     WHERE user_id = v_uid
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Reddit tidak ditemukan. Hubungi admin.';
  END IF;

  v_row := public.record_reddit_daily_activity(
    v_uid, v_account_id, CURRENT_DATE,
    p_comments_today, p_posts_today,
    NULL,                      -- karma_at_end unknown in self-report
    'self_report'
  );

  UPDATE public.reddit_daily_activity SET
    proof_media = v_proofs,
    note = NULLIF(trim(p_note), ''),
    updated_at = NOW()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (user_id, reddit_account_id, action, details)
  VALUES (v_uid, v_account_id, 'reddit_army_checkin',
          jsonb_build_object('activity_id', v_row.id,
                             'comments', p_comments_today,
                             'posts', p_posts_today,
                             'proofs', jsonb_array_length(v_proofs)));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.self_report_daily_activity(int, int, jsonb, text) TO authenticated;

-- Close the side door: record_reddit_daily_activity was granted to
-- authenticated (legacy manual-trigger path). Direct calls bypass the
-- check-in caps + activity_logs. Edge function uses service_role, so
-- revoking from authenticated is safe.
REVOKE EXECUTE ON FUNCTION public.record_reddit_daily_activity(uuid, uuid, date, int, int, int, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_reddit_daily_activity(uuid, uuid, date, int, int, int, text) FROM anon, public;

-- ------------------------------------------------------------
-- 4) admin_release_hold(p_hold_id, p_reason) — manual repair valve.
--    Releases ONE held/vesting hold + credits it, admin-only, logged.
--    (Complements admin_forfeit_holds: admin previously had no way to
--    release stuck money, only burn it.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_release_hold(
  p_hold_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hold public.bonus_holds;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi.';
  END IF;

  SELECT * INTO v_hold FROM public.bonus_holds WHERE id = p_hold_id FOR UPDATE;
  IF v_hold.id IS NULL THEN RAISE EXCEPTION 'Hold tidak ditemukan.'; END IF;
  IF v_hold.status NOT IN ('held','vesting') THEN
    RAISE EXCEPTION 'Hold ini sudah % — tidak bisa dilepas ulang.', v_hold.status;
  END IF;

  UPDATE public.bonus_holds SET
    status = 'released',
    released_at = NOW()
   WHERE id = v_hold.id;

  INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
  VALUES (v_hold.user_id, v_hold.amount, 'hold_release',
          format('Release manual oleh admin: %s', trim(p_reason)), v_hold.id);

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (v_uid, 'admin_release_hold',
          jsonb_build_object('hold_id', v_hold.id,
                             'target_user', v_hold.user_id,
                             'amount', v_hold.amount,
                             'reason', trim(p_reason)));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_release_hold(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 5) get_reddit_army_profile — add reddit_username (warmed account)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reddit_army_profile()
RETURNS TABLE (
  profile public.reddit_army_profiles,
  retention_held int,
  pending_cashable int,
  today_activity public.reddit_daily_activity,
  recent_activities jsonb,
  reddit_username text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_retention int;
  v_pending int;
  v_today public.reddit_daily_activity;
  v_recent jsonb;
  v_username text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_retention
    FROM public.bonus_holds
   WHERE user_id = v_uid AND status IN ('held','vesting');

  SELECT COALESCE(SUM(credited_amount / 2), 0) INTO v_pending
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND credited_type = 'pending_split'
     AND bonus_credited = true
     AND lump_credited_at IS NULL;

  SELECT * INTO v_today
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid AND activity_date = CURRENT_DATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date,
    'active', is_active_day,
    'credited', bonus_credited,
    'amount', credited_amount,
    'comments', comments_today,
    'posts', posts_today,
    'karma_delta', karma_delta
  ) ORDER BY activity_date DESC), '[]'::jsonb) INTO v_recent
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date > CURRENT_DATE - INTERVAL '30 days';

  SELECT ra.username INTO v_username
    FROM public.reddit_accounts ra
   WHERE ra.id = v_profile.warmed_account_id;
  IF v_username IS NULL THEN
    SELECT ra.username INTO v_username
      FROM public.reddit_accounts ra
     WHERE ra.user_id = v_uid
     ORDER BY ra.created_at DESC LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_profile, v_retention, v_pending, v_today, v_recent, v_username;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reddit_army_profile() TO authenticated;

-- ------------------------------------------------------------
-- 6) submit_challenge_task_with_proof — drop the dead activity-count
--    gate (verification is manual now); keep proof requirement.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_challenge_task_with_proof(
  p_task_id uuid,
  p_proof_url text DEFAULT NULL,
  p_proof_image_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_assignment public.task_assignments;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_assignment FROM public.task_assignments
   WHERE task_id = p_task_id
     AND user_id = v_uid
     AND status IN ('in_progress','submitted','rejected')
   ORDER BY created_at DESC LIMIT 1;

  IF v_assignment IS NULL THEN
    RAISE EXCEPTION 'Task belum di-claim. Mulai misi dulu ya.';
  END IF;

  IF v_assignment.status = 'submitted' THEN
    RAISE EXCEPTION 'Task ini sudah di-submit. Tunggu admin review ya.';
  END IF;

  IF NULLIF(trim(p_proof_url), '') IS NULL AND NULLIF(trim(p_proof_image_url), '') IS NULL THEN
    RAISE EXCEPTION 'Wajib upload screenshot profil Reddit atau link sebelum selesaikan misi.';
  END IF;

  UPDATE public.task_assignments SET
    status = 'submitted',
    proof_url = COALESCE(p_proof_url, proof_url),
    proof_image_url = COALESCE(p_proof_image_url, proof_image_url),
    submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = v_assignment.id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (v_uid, 'reddit_army_challenge_submitted',
    jsonb_build_object('task_id', p_task_id, 'assignment_id', v_assignment.id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_challenge_task_with_proof(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 7) list_challenge_tasks_for_user — dedupe per task (retry path could
--    emit one row per assignment). Latest assignment wins.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_challenge_tasks_for_user()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_target_level public.reddit_challenge_levels;
  v_days_at_level int;
  v_is_time_locked boolean;
  v_activity_sum int;
  v_target_count int;
  v_username text;
  v_account_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN
    RETURN;
  END IF;

  SELECT * INTO v_target_level FROM public.reddit_challenge_levels
    WHERE level_number = v_profile.current_challenge_level + 1
      AND is_active = true;
  IF v_target_level IS NULL THEN RETURN; END IF;

  v_days_at_level := CASE
    WHEN v_profile.current_level_started_at IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - v_profile.current_level_started_at))::int
    ELSE v_target_level.min_days_at_level
  END;
  v_is_time_locked := v_days_at_level < v_target_level.min_days_at_level;
  v_target_count := GREATEST(COALESCE(v_target_level.target_count, 1), 1);

  -- Informational only (Reddit auto-sync is off; verification is manual).
  SELECT COALESCE(SUM(comments_today + posts_today), 0)::int INTO v_activity_sum
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date >= COALESCE(v_profile.phase1_started_at::date, CURRENT_DATE - 60);

  SELECT ra.username, ra.id INTO v_username, v_account_id
    FROM public.reddit_accounts ra WHERE ra.id = v_profile.warmed_account_id;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'description', t.description,
    'target_url', t.target_url,
    'reward_amount', t.reward_amount,
    'level_number', rcl.level_number,
    'level_name', rcl.level_name,
    'assignment_id', ta.id,
    'assignment_status', ta.status,
    'can_retry', ta.can_retry,
    'level_locked', v_is_time_locked,
    'days_until_unlock', GREATEST(v_target_level.min_days_at_level - v_days_at_level, 0),
    'min_days_at_level', v_target_level.min_days_at_level,
    'progress_count', v_activity_sum,
    'target_count', v_target_count,
    'progress_complete', (ta.status = 'in_progress'),
    'can_submit', (ta.status = 'in_progress'),
    'reddit_username', v_username,
    'reddit_account_id', v_account_id
  )
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status IN ('active','paused')
    AND t.is_hidden = false
    AND rcl.level_number = v_target_level.level_number
    AND rcl.is_active = true
  ORDER BY t.id, ta.created_at DESC NULLS LAST, rcl.level_number, t.display_order;
END;
$$;

-- ------------------------------------------------------------
-- 8) flag_ghosting_for_review — dedup: skip users already flagged today
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_ghosting_for_review()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marker text := format('[%s] GHOSTING REVIEW', NOW()::date);
BEGIN
  RETURN QUERY
    UPDATE public.reddit_army_profiles SET
      notes = CONCAT_WS(E'\n', notes, format('%s: inactive >7 days', v_marker)),
      updated_at = NOW()
    WHERE program_status IN ('phase2_active','resigning')
      AND last_active_date IS NOT NULL
      AND last_active_date < CURRENT_DATE - INTERVAL '7 days'
      AND (notes IS NULL OR notes NOT LIKE '%' || v_marker || '%')
    RETURNING user_id;
END;
$$;

-- ------------------------------------------------------------
-- 9) admin_pending_approvals + admin_approval_history — expose proof_media
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
  proof_media     jsonb,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text
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
    u.full_name::text AS army_name
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = COALESCE(ta.user_id, ra.user_id)
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;

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
  proof_media     jsonb,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text,
  user_note       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filter text := lower(trim(coalesce(p_status, '')));
  v_from timestamptz := p_from::timestamptz;
  v_to timestamptz := (p_to::timestamp + interval '1 day')::timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

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
    ta.can_retry,
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
    COALESCE(ta.user_id, ra.user_id) AS army_user_id,
    au.email::text AS army_email,
    COALESCE(army_u.full_name, u.full_name)::text AS army_name,
    ta.user_note::text
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
    NULL::jsonb AS proof_media,
    NULL::uuid AS reddit_account_id,
    NULL::text AS reddit_username,
    tah.user_id AS army_user_id,
    au2.email::text AS army_email,
    COALESCE(u2.full_name, u2.full_name)::text AS army_name,
    NULL::text AS user_note
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

COMMIT;
