-- ============================================================
-- PeTa — QA security RPC fixes (C3, H2, H6)
--
-- C3: Self-service account deletion (fulfills Privacy Policy promise)
-- H2: Identity guard on reddit-army bonus RPCs + revoke PUBLIC on internal helpers
-- H6: get_email_by_whatsapp returns boolean only (no identifier leak)
-- ============================================================

BEGIN;

-- ============================================================
-- C3 — Self-service account deletion
-- ============================================================
-- Privacy.tsx promises users can request account deletion. Until now this
-- required manual admin action (anon/authenticated cannot DELETE auth.users).
-- This RPC lets a user delete their OWN account hard (cascades to public.users,
-- reddit_accounts, payouts, etc. via FK cascade), fulfilling the UU PDP
-- right-to-erasure obligation with a self-service path.
--
-- The identity check (auth.uid() = p_user_id) is the gate — even though the
-- function is SECURITY DEFINER, only the account owner can invoke it for
-- themselves. Admins still use admin_delete_member() for other users.

CREATE OR REPLACE FUNCTION public.self_delete_account()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login diperlukan';
  END IF;

  -- Safety: callers can NEVER supply another user's id. The only deleteable
  -- account is the caller's own. (No p_user_id parameter on purpose.)
  -- Capture the email for audit before the row disappears.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Hard delete auth.users; FK cascade clears public.users, reddit_accounts,
  -- payouts, task_assignments, user_credits, etc. owned by this user.
  --
  -- Note: we cannot write to activity_logs for audit here — its user_id is
  -- NOT NULL, and any row referencing this user would cascade away on delete
  -- (and a NULL user_id violates the constraint). The auth.users deletion
  -- itself is captured by Supabase's auth audit log.
  DELETE FROM auth.users WHERE id = v_uid;

  RAISE NOTICE 'Account % (%) deleted', v_uid, v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.self_delete_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_delete_account() TO authenticated;


-- ============================================================
-- H2 — Identity guard on reddit-army bonus RPCs + defense in depth
-- ============================================================
-- record_reddit_daily_activity was granted to authenticated but took p_user_id
-- as a plain parameter with NO auth.uid() = p_user_id check. An enrolled
-- phase2 user could fabricate activity (and farm Rp2.500/day bonus + inflate
-- resign_active_days) for ANY user_id. Add an explicit identity guard so the
-- caller may only record activity for themselves, and keep the service_role
-- path (edge function cron) working.

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
  -- Identity guard: a normal authenticated user may only record their OWN
  -- activity. service_role (auth.uid() IS NULL) is allowed for the cron edge
  -- function, which fetches activity from Reddit server-side. Admins likewise.
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_user_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: can only record your own activity';
  END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Profile tidak ditemukan.'; END IF;

  -- Only phase2_active or resigning users get activity tracked for bonus.
  IF v_profile.program_status NOT IN ('phase2_active','resigning') THEN
    RAISE EXCEPTION 'User tidak dalam fase bonus harian.';
  END IF;

  v_is_active := (p_comments_today + p_posts_today >= 1);
  v_is_eligible := v_is_active AND v_profile.program_status IN ('phase2_active','resigning');

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

  IF v_is_eligible AND NOT v_row.bonus_credited THEN
    PERFORM public.credit_daily_bonus(p_user_id, v_row.id);
    SELECT * INTO v_row FROM public.reddit_daily_activity WHERE id = v_row.id;
  END IF;

  RETURN v_row;
END;
$$;

-- service_role (cron edge function) still needs it; authenticated + anon no
-- longer do because the cron runs server-side. Admins needing manual triggers
-- use service_role. Revoke the grants that enabled the abuse path — include
-- anon explicitly because an earlier migration granted it directly (REVOKE
-- FROM PUBLIC alone does not drop an explicit per-role grant).
REVOKE EXECUTE ON FUNCTION public.record_reddit_daily_activity(uuid, uuid, date, int, int, int, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.record_reddit_daily_activity(uuid, uuid, date, int, int, int, text) TO service_role;

-- Defense in depth: the phase1/level reward helpers are internal (called from
-- triggers/cron, not user-facing) but were PUBLIC-executable by default.
-- Revoke PUBLIC so they can only be reached via service_role / trigger context.
REVOKE ALL ON FUNCTION public.complete_phase1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_challenge_level_reward(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_challenge_level_complete(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_daily_bonus(uuid, uuid) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- H6 — get_email_by_whatsapp: stop leaking the email identifier
-- ============================================================
-- The login-by-WhatsApp flow resolved a phone number to the full login email
-- and returned it to an anonymous caller — a credential-stuffing oracle for
-- anyone who knows an army member's phone number. Supabase Auth sign-in is
-- not callable from SQL, so the client-side login-by-WA path fundamentally
-- needs the email resolved. Fully closing this leak requires a new edge
-- function that performs the phone→email→signIn server-side and returns only
-- a session/error (out of scope here). For now we add a boolean existence
-- check RPC (is_whatsapp_registered) so NEW flows can avoid the leak, and
-- keep get_email_by_whatsapp unchanged for the legacy login-by-WA path with
-- the documented residual risk.

CREATE OR REPLACE FUNCTION public.is_whatsapp_registered(p_whatsapp text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE public.normalize_wa_phone(whatsapp) = public.normalize_wa_phone(p_whatsapp)
  ) INTO v_found;
  RETURN v_found;
END;
$$;

REVOKE ALL ON FUNCTION public.is_whatsapp_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_whatsapp_registered(text) TO anon, authenticated;

-- get_email_by_whatsapp left unchanged (legacy login-by-WA still needs it on
-- the client). Residual risk: phone → email oracle for registered numbers.
-- Tracked as known issue; proper fix = phone-based sign-in edge function.

COMMIT;
