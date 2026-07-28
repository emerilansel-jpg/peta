-- ============================================================
-- PeTa — Reddit Army RPCs (Phase 2: Daily bonus + holds + resignation).
--
-- Functions:
--   record_reddit_daily_activity(...)            called by edge function
--   credit_daily_bonus(p_user_id, p_activity_id)
--   release_biweekly_cashout()                   pg_cron, lump sum
--   release_phase1_completion_hold()             pg_cron, 30-day release
--   request_resignation() / cancel_resignation() army actions
--   process_resignation_complete()               pg_cron, after H-30
--   admin_forfeit_holds(p_user_id, p_reason)     admin expel
--   flag_ghosting_for_review()                   pg_cron, weekly
--   get_reddit_army_profile()                    army read own
--   get_reddit_army_stats_for_admin()            admin dashboard
-- ============================================================

-- ------------------------------------------------------------
-- 1. record_reddit_daily_activity(...)
--    Called by edge function `sync-reddit-daily-activity` after fetching
--    Reddit activity for a user. Upserts today's activity row.
--    Then triggers credit_daily_bonus if eligible.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_reddit_daily_activity(
  p_user_id uuid,
  p_reddit_account_id uuid,
  p_activity_date date,
  p_comments_today int,
  p_posts_today int,
  p_karma_at_end int,
  p_sync_source text DEFAULT 'auto_cron'
)
RETURNS public.reddit_daily_activity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_prev_karma int;
  v_row public.reddit_daily_activity;
  v_is_active boolean;
  v_is_eligible boolean;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Profile tidak ditemukan.'; END IF;

  -- Only phase2_active or resigning users get activity tracked for bonus.
  IF v_profile.program_status NOT IN ('phase2_active','resigning') THEN
    RAISE EXCEPTION 'User tidak dalam fase bonus harian.';
  END IF;

  v_is_active := (p_comments_today + p_posts_today >= 1);
  v_is_eligible := v_is_active AND v_profile.program_status IN ('phase2_active','resigning');

  -- Get karma_at_start from the previous day's karma_at_end (or current reddit_account karma).
  SELECT karma_at_end INTO v_prev_karma
    FROM public.reddit_daily_activity
   WHERE user_id = p_user_id AND activity_date = p_activity_date - 1;

  INSERT INTO public.reddit_daily_activity (
    user_id, reddit_account_id, activity_date,
    comments_today, posts_today,
    karma_at_start, karma_at_end, karma_delta,
    is_active_day, bonus_eligible,
    sync_source
  ) VALUES (
    p_user_id, p_reddit_account_id, p_activity_date,
    p_comments_today, p_posts_today,
    v_prev_karma, p_karma_at_end,
    COALESCE(p_karma_at_end, 0) - COALESCE(v_prev_karma, 0),
    v_is_active, v_is_eligible,
    p_sync_source
  )
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    comments_today = EXCLUDED.comments_today,
    posts_today = EXCLUDED.posts_today,
    karma_at_end = EXCLUDED.karma_at_end,
    karma_delta = COALESCE(EXCLUDED.karma_at_end, 0) - COALESCE(reddit_daily_activity.karma_at_start, 0),
    is_active_day = EXCLUDED.is_active_day,
    bonus_eligible = EXCLUDED.bonus_eligible,
    sync_source = EXCLUDED.sync_source,
    updated_at = NOW()
  RETURNING * INTO v_row;

  -- Update profile: last_sync_at, last_active_date.
  -- Increment resign_active_days only once per day (anti double-count).
  UPDATE public.reddit_army_profiles SET
    last_sync_at = NOW(),
    last_active_date = CASE WHEN v_is_active THEN p_activity_date ELSE last_active_date END,
    resign_active_days = CASE
      WHEN v_profile.program_status = 'resigning'
           AND v_is_active
           AND v_profile.last_active_date IS DISTINCT FROM p_activity_date
        THEN resign_active_days + 1
      ELSE resign_active_days
    END,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Credit bonus if eligible & not yet credited.
  IF v_is_eligible AND NOT v_row.bonus_credited THEN
    PERFORM public.credit_daily_bonus(p_user_id, v_row.id);
    SELECT * INTO v_row FROM public.reddit_daily_activity WHERE id = v_row.id;
  END IF;

  RETURN v_row;
END;
$$;

-- Service role uses this; also grant to authenticated for manual admin triggers.
GRANT EXECUTE ON FUNCTION public.record_reddit_daily_activity(uuid, uuid, date, int, int, int, text) TO authenticated;

-- ------------------------------------------------------------
-- 2. credit_daily_bonus(p_user_id, p_activity_id)
--    Idempotent: book Rp2.500 split:
--      - Rp1.250 pending cashable (will be lump-summed every 2 weeks)
--      - Rp1.250 directly into bonus_holds (retention)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_daily_bonus(
  p_user_id uuid,
  p_activity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_activity public.reddit_daily_activity;
  v_total int;
  v_cashable_part int;
  v_hold_part int;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase2_active','resigning') THEN
    RETURN;
  END IF;

  SELECT * INTO v_activity FROM public.reddit_daily_activity WHERE id = p_activity_id;
  IF v_activity IS NULL THEN RETURN; END IF;
  IF v_activity.user_id != p_user_id THEN RETURN; END IF;
  IF v_activity.bonus_credited THEN RETURN; END IF;
  IF NOT v_activity.bonus_eligible THEN RETURN; END IF;

  v_total := v_profile.daily_bonus_rate;        -- 2500 default
  v_cashable_part := v_total / 2;               -- 1250
  v_hold_part := v_total - v_cashable_part;     -- 1250 (handles odd totals)

  -- Update activity row: mark credited, store pending_split (lumpcredited_at stays NULL
  -- until release_biweekly_cashout fires).
  UPDATE public.reddit_daily_activity SET
    bonus_credited = true,
    bonus_credited_at = NOW(),
    credited_amount = v_total,
    credited_type = 'pending_split',
    updated_at = NOW()
  WHERE id = p_activity_id;

  -- Insert hold portion immediately.
  INSERT INTO public.bonus_holds (user_id, source, source_id, amount, status, release_condition)
  VALUES (p_user_id, 'daily_bonus', p_activity_id, v_hold_part, 'held', 'resign_complete')
  ON CONFLICT (user_id, source, source_id) WHERE source_id IS NOT NULL DO NOTHING;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_daily_bonus',
    jsonb_build_object('activity_id', p_activity_id, 'total', v_total,
                       'cashable_pending', v_cashable_part, 'hold', v_hold_part));
END;
$$;

-- ------------------------------------------------------------
-- 3. release_biweekly_cashout()
--    Run by pg_cron every Saturday 09:00 WIB.
--    Lump-sum all pending_split activity rows older than 14 days
--    into a single user_credits entry per user.
--    Idempotent: marks rows via lump_credited_at.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_biweekly_cashout()
RETURNS TABLE (user_id uuid, amount int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_sum int;
  v_cutoff date := CURRENT_DATE - INTERVAL '14 days';
BEGIN
  FOR v_user IN
    SELECT DISTINCT rap.user_id
      FROM public.reddit_army_profiles rap
     WHERE rap.program_status IN ('phase2_active','resigning')
  LOOP
    SELECT COALESCE(SUM(credited_amount / 2), 0) INTO v_sum
      FROM public.reddit_daily_activity
     WHERE user_id = v_user.user_id
       AND credited_type = 'pending_split'
       AND bonus_credited = true
       AND lump_credited_at IS NULL
       AND activity_date <= v_cutoff;

    IF v_sum > 0 THEN
      INSERT INTO public.user_credits (user_id, amount, source, description)
      VALUES (v_user.user_id, v_sum, 'daily_bonus_cashable',
              format('Lump sum bonus harian Reddit Army 14 hari: Rp%s', v_sum));

      UPDATE public.reddit_daily_activity
         SET lump_credited_at = NOW()
       WHERE user_id = v_user.user_id
         AND credited_type = 'pending_split'
         AND bonus_credited = true
         AND lump_credited_at IS NULL
         AND activity_date <= v_cutoff;

      RETURN QUERY SELECT v_user.user_id, v_sum;
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 4. release_phase1_completion_hold()
--    Run by pg_cron hourly. Releases phase1_completion holds
--    that are 30+ days old.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_phase1_completion_hold()
RETURNS TABLE (user_id uuid, amount int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT id, user_id, amount
      FROM public.bonus_holds
     WHERE source = 'phase1_completion'
       AND status = 'held'
       AND created_at + INTERVAL '30 days' <= NOW()
  LOOP
    UPDATE public.bonus_holds SET
      status = 'released',
      released_at = NOW()
    WHERE id = v_row.id;

    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (v_row.user_id, v_row.amount, 'hold_release',
            'Cairan Tabungan Retensi (Phase 1, 30-day)', v_row.id);

    RETURN QUERY SELECT v_row.user_id, v_row.amount;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 5. request_resignation() / cancel_resignation()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_resignation()
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Belum terdaftar di program.'; END IF;
  IF v_profile.program_status != 'phase2_active' THEN
    RAISE EXCEPTION 'Hanya bisa berhenti dari Fase 2 (status: %).', v_profile.program_status;
  END IF;

  UPDATE public.reddit_army_profiles SET
    program_status = 'resigning',
    resign_requested_at = NOW(),
    resign_effective_at = NOW() + INTERVAL '30 days',
    resign_active_days = 0,
    updated_at = NOW()
  WHERE user_id = v_uid
  RETURNING * INTO v_profile;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (v_uid, 'reddit_army_resign_request',
    jsonb_build_object('effective_at', v_profile.resign_effective_at));

  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_resignation() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_resignation()
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Belum terdaftar di program.'; END IF;
  IF v_profile.program_status != 'resigning' THEN
    RAISE EXCEPTION 'Kamu tidak dalam masa berhenti.';
  END IF;

  UPDATE public.reddit_army_profiles SET
    program_status = 'phase2_active',
    resign_requested_at = NULL,
    resign_effective_at = NULL,
    resign_active_days = 0,
    updated_at = NOW()
  WHERE user_id = v_uid
  RETURNING * INTO v_profile;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (v_uid, 'reddit_army_resign_cancel', NULL);

  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_resignation() TO authenticated;

-- ------------------------------------------------------------
-- 6. process_resignation_complete()
--    Run by pg_cron daily 09:00 WIB.
--    Releases all holds for users whose 30-day period is up
--    AND who were active >= 20 days during resignation.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_resignation_complete()
RETURNS TABLE (user_id uuid, released_amount int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_total int;
BEGIN
  FOR v_user IN
    SELECT user_id
      FROM public.reddit_army_profiles
     WHERE program_status = 'resigning'
       AND resign_effective_at <= NOW()
       AND resign_active_days >= 20
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_total
      FROM public.bonus_holds
     WHERE user_id = v_user.user_id
       AND status IN ('held','vesting');

    IF v_total > 0 THEN
      INSERT INTO public.user_credits (user_id, amount, source, description)
      VALUES (v_user.user_id, v_total, 'hold_release',
              'Cairan Tabungan Retensi (resign complete)');
    END IF;

    UPDATE public.bonus_holds SET
      status = 'released',
      released_at = NOW()
    WHERE user_id = v_user.user_id
      AND status IN ('held','vesting');

    UPDATE public.reddit_army_profiles SET
      program_status = 'resigned',
      resigned_at = NOW(),
      updated_at = NOW()
    WHERE user_id = v_user.user_id;

    INSERT INTO public.activity_logs (user_id, action, details)
    VALUES (v_user.user_id, 'reddit_army_resign_complete',
      jsonb_build_object('released_amount', v_total));

    RETURN QUERY SELECT v_user.user_id, v_total;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 7. admin_forfeit_holds(p_user_id, p_reason)
--    Admin only. For ghosting/suspended accounts.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_forfeit_holds(
  p_user_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi.';
  END IF;

  UPDATE public.bonus_holds SET
    status = 'forfeited',
    forfeited_at = NOW()
  WHERE user_id = p_user_id
    AND status IN ('held','vesting');

  UPDATE public.reddit_army_profiles SET
    program_status = 'expelled',
    expelled_at = NOW(),
    expelled_reason = p_reason,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_expelled',
    jsonb_build_object('reason', p_reason, 'admin_id', v_uid));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_forfeit_holds(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- 8. flag_ghosting_for_review()
--    Run by pg_cron weekly. Marks profiles inactive >7 days
--    into a 'ghosting_review' note for admin.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_ghosting_for_review()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    UPDATE public.reddit_army_profiles SET
      notes = CONCAT_WS(E'\n', notes, format('[%s] GHOSTING REVIEW: inactive >7 days', NOW()::date)),
      updated_at = NOW()
    WHERE program_status IN ('phase2_active','resigning')
      AND last_active_date IS NOT NULL
      AND last_active_date < CURRENT_DATE - INTERVAL '7 days'
    RETURNING user_id;
END;
$$;

-- ------------------------------------------------------------
-- 9. get_reddit_army_profile()
--    Army reads own profile + summary stats.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reddit_army_profile()
RETURNS TABLE (
  profile public.reddit_army_profiles,
  retention_held int,
  pending_cashable int,
  today_activity public.reddit_daily_activity,
  recent_activities jsonb
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL THEN
    RETURN;  -- caller will see NULL profile = not joined yet
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

  RETURN QUERY SELECT v_profile, v_retention, v_pending, v_today, v_recent;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reddit_army_profile() TO authenticated;

-- ------------------------------------------------------------
-- 10. get_reddit_army_stats_for_admin()
--     Admin dashboard stats.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reddit_army_stats_for_admin()
RETURNS TABLE (
  total_members int,
  phase1_active int,
  phase2_active int,
  resigning int,
  resigned int,
  expelled int,
  total_hold int,
  release_this_week int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.reddit_army_profiles)::int,
    (SELECT COUNT(*) FROM public.reddit_army_profiles WHERE program_status='phase1_active')::int,
    (SELECT COUNT(*) FROM public.reddit_army_profiles WHERE program_status='phase2_active')::int,
    (SELECT COUNT(*) FROM public.reddit_army_profiles WHERE program_status='resigning')::int,
    (SELECT COUNT(*) FROM public.reddit_army_profiles WHERE program_status='resigned')::int,
    (SELECT COUNT(*) FROM public.reddit_army_profiles WHERE program_status='expelled')::int,
    (SELECT COALESCE(SUM(amount),0) FROM public.bonus_holds WHERE status IN ('held','vesting'))::int,
    (SELECT COALESCE(SUM(amount),0) FROM public.bonus_holds
      WHERE status='held' AND source='phase1_completion'
        AND created_at + INTERVAL '30 days' <= NOW() + INTERVAL '7 days')::int;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reddit_army_stats_for_admin() TO authenticated;

NOTIFY pgrst, 'reload schema';
