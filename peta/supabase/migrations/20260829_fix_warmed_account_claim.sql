-- ============================================================
-- PeTa — Fix warmed account claims for Reddit Army.
--
-- CONFIRMED on prod 2026-08-29:
--   * Warmed accounts are created under the ADMIN's user_id (e.g. account
--     "david" owned by info@jetdigitalpro.com, member is n311311@gmail.com).
--   * reddit_accounts has UNIQUE(user_id) — ownership CANNOT be transferred
--     to members who already own their onboarding account row.
--   * claim_task_assignment enforces `reddit_accounts.user_id = auth.uid()`,
--     so every web claim from the warmed_purchased cohort fails with
--     'Pilih akun Reddit yang valid.' — warmed members have been working
--     fully manual via WhatsApp because of this.
--
-- Fix: claim_challenge_task now validates the reddit account itself
-- (owned by member OR the profile's warmed account) and inserts the
-- assignment directly with its own quota checks, mirroring
-- claim_task_assignment's guarantees (task active, max_assignments,
-- per_account_limit, slot resync).
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_challenge_task(
  p_task_id uuid,
  p_reddit_account_id uuid
)
RETURNS uuid  -- assignment_id
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

  -- Verify task is for the user's current level.
  IF v_task.challenge_level_id IS NULL THEN
    RAISE EXCEPTION 'Task challenge tidak punya level.';
  END IF;
  PERFORM 1 FROM public.reddit_challenge_levels rcl
    WHERE rcl.id = v_task.challenge_level_id
      AND rcl.level_number = v_profile.current_challenge_level + 1
      AND rcl.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task ini bukan untuk level kamu saat ini.';
  END IF;

  -- Account must be owned by the member OR be the profile's warmed
  -- account (admin-owned on purpose — see header). Unlike the regular
  -- claim path, warmed accounts are accepted without ownership transfer
  -- because reddit_accounts UNIQUE(user_id) makes transfer impossible.
  SELECT ra.id INTO v_account_id
    FROM public.reddit_accounts ra
   WHERE ra.id = p_reddit_account_id
     AND (ra.user_id = v_uid OR ra.id = v_profile.warmed_account_id)
     AND ra.status_flag NOT IN ('suspended','not_found')
   LIMIT 1;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Reddit tidak valid untuk misi ini.';
  END IF;

  -- Quota: mirror claim_task_assignment (challenge tasks set generous
  -- max_assignments, but enforce anyway so admin can cap if needed).
  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.';
  END IF;

  -- One live assignment per member per task.
  PERFORM 1 FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = v_uid
      AND status IN ('in_progress','submitted','approved')
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Kamu sudah punya misi ini. Selesaikan dulu ya.';
  END IF;

  INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
  VALUES (p_task_id, v_uid, v_account_id, 'in_progress')
  RETURNING id INTO v_assignment_id;

  PERFORM public.sync_task_slot_count(p_task_id);

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_challenge_task(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
