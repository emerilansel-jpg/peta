-- ============================================================
-- PeTa — Reddit Army: ONE-FILE APPLY for SQL Editor
-- Generated: 2026-07-30
-- 
-- INSTRUCTIONS:
--   1. Open Supabase Dashboard > SQL Editor
--   2. Paste this whole file
--   3. Click Run (will take ~30 seconds)
--   4. All operations are idempotent — safe to re-run.
-- 
-- This combines 6 migrations:
--   - schema (4 new tables + extend 2)
--   - seed levels (5 levels)
--   - RPCs phase 1 (challenge flow)
--   - RPCs phase 2 (daily bonus + holds + resignation)
--   - cron jobs (4 scheduled)
--   - extend get_user_earnings RPC
--   - sync targets helper RPC
-- ============================================================

\set ECHO all
BEGIN;

============================================================
-- FILE: 20260730_reddit_army_schema.sql
============================================================
-- ============================================================
-- PeTa — Reddit Army Gamification System (Phase 1: Schema).
--
-- Implements the design spec at
--   docs/superpowers/specs/2026-07-29-reddit-army-gamification-design.md
--
-- Adds 4 new tables:
--   - reddit_army_profiles   (program status per army user)
--   - reddit_challenge_levels(template checklist per level)
--   - reddit_daily_activity  (daily sync log + bonus tracking)
--   - bonus_holds            (retention hold ledger)
--
-- Extends 2 existing tables:
--   - tasks                  (add task_category='reddit_challenge' + challenge_level_id)
--   - user_credits           (add 3 new sources)
--
-- No breaking changes to existing flows.
-- ============================================================

-- ------------------------------------------------------------
-- 1. NEW TABLE: reddit_army_profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reddit_army_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  warmed_account_id uuid REFERENCES public.reddit_accounts(id) ON DELETE SET NULL,
  program_status text NOT NULL DEFAULT 'not_started'
    CHECK (program_status IN (
      'not_started','phase1_active','phase1_complete',
      'phase2_active','resigning','resigned','expelled'
    )),
  current_challenge_level int NOT NULL DEFAULT 0,
  phase1_started_at timestamptz,
  phase1_completed_at timestamptz,
  phase2_started_at timestamptz,
  resign_requested_at timestamptz,
  resign_effective_at timestamptz,
  resign_active_days int NOT NULL DEFAULT 0,
  resigned_at timestamptz,
  expelled_at timestamptz,
  expelled_reason text,
  daily_bonus_rate int NOT NULL DEFAULT 2500,
  retention_hold_rate int NOT NULL DEFAULT 2500,
  last_sync_at timestamptz,
  last_active_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reddit_army_profiles_status
  ON public.reddit_army_profiles (program_status);
CREATE INDEX IF NOT EXISTS idx_reddit_army_profiles_warmed_account
  ON public.reddit_army_profiles (warmed_account_id);

-- ------------------------------------------------------------
-- 2. NEW TABLE: reddit_challenge_levels
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reddit_challenge_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number int NOT NULL UNIQUE,
  level_name text NOT NULL,
  title text NOT NULL,
  description text,
  target_type text NOT NULL CHECK (target_type IN (
    'comment_count','post_count','karma_threshold','combined'
  )),
  target_count int,
  target_subreddits text[],
  reward_amount int NOT NULL CHECK (reward_amount >= 0),
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reddit_challenge_levels_active_order
  ON public.reddit_challenge_levels (is_active, display_order);

-- ------------------------------------------------------------
-- 3. NEW TABLE: reddit_daily_activity
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reddit_daily_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reddit_account_id uuid NOT NULL REFERENCES public.reddit_accounts(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  posts_today int NOT NULL DEFAULT 0,
  comments_today int NOT NULL DEFAULT 0,
  karma_at_start int,
  karma_at_end int,
  karma_delta int NOT NULL DEFAULT 0,
  is_active_day boolean NOT NULL DEFAULT false,
  bonus_eligible boolean NOT NULL DEFAULT false,
  bonus_credited boolean NOT NULL DEFAULT false,
  bonus_credited_at timestamptz,
  credited_amount int NOT NULL DEFAULT 0,
  credited_type text CHECK (credited_type IN ('cashable','hold','pending_split')),
  lump_credited_at timestamptz,
  sync_source text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_reddit_daily_activity_date
  ON public.reddit_daily_activity (activity_date);
CREATE INDEX IF NOT EXISTS idx_reddit_daily_activity_pending_lump
  ON public.reddit_daily_activity (activity_date, lump_credited_at)
  WHERE lump_credited_at IS NULL;

-- ------------------------------------------------------------
-- 4. NEW TABLE: bonus_holds
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bonus_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN (
    'challenge_level',
    'phase1_completion',
    'daily_bonus',
    'karma_bonus'
  )),
  source_id uuid,
  amount int NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held','vesting','released','forfeited')),
  vested_at timestamptz,
  released_at timestamptz,
  forfeited_at timestamptz,
  release_condition text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonus_holds_user_status
  ON public.bonus_holds (user_id, status);
CREATE INDEX IF NOT EXISTS idx_bonus_holds_release_due
  ON public.bonus_holds (source, created_at)
  WHERE status = 'held';
-- Idempotency: prevent duplicate holds per (user, source, source_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_holds_user_source_sourceid
  ON public.bonus_holds (user_id, source, source_id)
  WHERE source_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. EXTEND tasks: new task_category value + challenge_level_id
-- ------------------------------------------------------------
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_task_category_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN (
    'reddit_upvote','reddit_comment','reddit_post_thread',
    'forum_comment','youtube_upload','reddit_challenge'
  ));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS challenge_level_id uuid
  REFERENCES public.reddit_challenge_levels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_challenge_level
  ON public.tasks (challenge_level_id)
  WHERE challenge_level_id IS NOT NULL;

-- ------------------------------------------------------------
-- 6. EXTEND user_credits: 3 new sources
-- ------------------------------------------------------------
ALTER TABLE public.user_credits DROP CONSTRAINT IF EXISTS user_credits_source_check;
ALTER TABLE public.user_credits ADD CONSTRAINT user_credits_source_check
  CHECK ((source = ANY (ARRAY[
    'referral_bonus_referrer'::text,
    'referral_bonus_referee'::text,
    'signup_bonus'::text,
    'manual_adjustment'::text,
    'karma_milestone'::text,
    'task_reward'::text,
    'task_revert'::text,
    'wa_group_verified'::text,
    -- Reddit Army (new):
    'phase1_completion'::text,
    'daily_bonus_cashable'::text,
    'hold_release'::text
  ])));

-- ------------------------------------------------------------
-- 7. updated_at triggers for new tables
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reddit_army_profiles_updated ON public.reddit_army_profiles;
CREATE TRIGGER trg_reddit_army_profiles_updated
  BEFORE UPDATE ON public.reddit_army_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_reddit_challenge_levels_updated ON public.reddit_challenge_levels;
CREATE TRIGGER trg_reddit_challenge_levels_updated
  BEFORE UPDATE ON public.reddit_challenge_levels
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_reddit_daily_activity_updated ON public.reddit_daily_activity;
CREATE TRIGGER trg_reddit_daily_activity_updated
  BEFORE UPDATE ON public.reddit_daily_activity
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ------------------------------------------------------------
-- 8. RLS policies
-- ------------------------------------------------------------
ALTER TABLE public.reddit_army_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reddit_challenge_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reddit_daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_holds ENABLE ROW LEVEL SECURITY;

-- reddit_army_profiles: user can SELECT own, admin all.
-- INSERT/UPDATE happen only via SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "rap_select_own" ON public.reddit_army_profiles;
CREATE POLICY "rap_select_own" ON public.reddit_army_profiles
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "rap_admin_all" ON public.reddit_army_profiles;
CREATE POLICY "rap_admin_all" ON public.reddit_army_profiles
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- reddit_challenge_levels: read-only for all authenticated, admin full.
DROP POLICY IF EXISTS "rcl_select_all" ON public.reddit_challenge_levels;
CREATE POLICY "rcl_select_all" ON public.reddit_challenge_levels
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rcl_admin_all" ON public.reddit_challenge_levels;
CREATE POLICY "rcl_admin_all" ON public.reddit_challenge_levels
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- reddit_daily_activity: user SELECT own, admin all.
DROP POLICY IF EXISTS "rda_select_own" ON public.reddit_daily_activity;
CREATE POLICY "rda_select_own" ON public.reddit_daily_activity
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "rda_admin_all" ON public.reddit_daily_activity;
CREATE POLICY "rda_admin_all" ON public.reddit_daily_activity
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bonus_holds: user SELECT own, admin all.
DROP POLICY IF EXISTS "bh_select_own" ON public.bonus_holds;
CREATE POLICY "bh_select_own" ON public.bonus_holds
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "bh_admin_all" ON public.bonus_holds;
CREATE POLICY "bh_admin_all" ON public.bonus_holds
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';


============================================================
-- FILE: 20260730_reddit_army_seed_levels.sql
============================================================
-- ============================================================
-- PeTa — Reddit Army: Seed initial 5 challenge levels.
--
-- Draft values, editable via Admin UI (RedditArmy > Challenges tab).
-- Completing level 5 (Veteran) triggers phase1 completion (Rp100K).
-- ============================================================

INSERT INTO public.reddit_challenge_levels
  (level_number, level_name, title, description, target_type, target_count, target_subreddits, reward_amount, display_order, is_active)
VALUES
  (
    1,
    'Tunas',
    'Comment 3x di r/indonesia',
    'Komen 3 kali di subreddit r/indonesia biar akun keliatan hidup.',
    'comment_count',
    3,
    ARRAY['indonesia'],
    5000,
    1,
    true
  ),
  (
    2,
    'Pemuda',
    'Comment 5x + 1 post',
    'Komen 5 kali di subreddit apa aja + bikin 1 post pendek.',
    'combined',
    5,
    NULL,
    10000,
    2,
    true
  ),
  (
    3,
    'Penggiat',
    'Karma ≥ 20',
    'Akun kamu harus dapet minimal 20 karma (post + comment karma total).',
    'karma_threshold',
    20,
    NULL,
    15000,
    3,
    true
  ),
  (
    4,
    'Pejuang',
    'Karma ≥ 50 + 3 posts',
    'Naikin karma ke 50 + bikin 3 post di subreddit yang relevan.',
    'combined',
    50,
    NULL,
    20000,
    4,
    true
  ),
  (
    5,
    'Veteran',
    'Karma ≥ 100 + 5 posts',
    'Level terakhir: karma 100 + 5 posts. Selesaiin ini = dapet Rp100K lump & masuk Fase 2.',
    'combined',
    100,
    NULL,
    0,  -- level 5 reward is the Rp100K phase1_completion, not a level reward
    5,
    true
  )
ON CONFLICT (level_number) DO UPDATE SET
  level_name = EXCLUDED.level_name,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  target_type = EXCLUDED.target_type,
  target_count = EXCLUDED.target_count,
  target_subreddits = EXCLUDED.target_subreddits,
  reward_amount = EXCLUDED.reward_amount,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';


============================================================
-- FILE: 20260730_reddit_army_rpc_phase1.sql
============================================================
-- ============================================================
-- PeTa — Reddit Army RPCs (Phase 1: Challenge flow).
--
-- Functions:
--   join_reddit_army_program()                 army opts into program
--   list_challenge_tasks_for_user()            army sees checklist
--   claim_challenge_task(p_task_id, p_account_id)
--   award_challenge_level_reward(p_user_id, p_level_id)  internal helper
--   check_challenge_level_complete(p_user_id)  called from trigger or cron
--   complete_phase1(p_user_id)                 credits Rp100K split
--   admin_create_challenge_task(...)           admin helper
-- ============================================================

-- ------------------------------------------------------------
-- 1. join_reddit_army_program()
--    Army opts into the program from /reddit-army.
--    Requires: user has 1 active reddit_account.
--    Sets status to phase1_active.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_reddit_army_program()
RETURNS public.reddit_army_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_existing public.reddit_army_profiles;
  v_result public.reddit_army_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  -- Must have at least one reddit account.
  SELECT id FROM public.reddit_accounts
   WHERE user_id = v_uid
   ORDER BY created_at DESC LIMIT 1
   INTO v_account_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Kamu harus tambah akun Reddit dulu di halaman Akun.';
  END IF;

  SELECT * INTO v_existing FROM public.reddit_army_profiles WHERE user_id = v_uid;

  IF v_existing IS NOT NULL THEN
    -- Re-enroll only from not_started / resigned / expelled.
    IF v_existing.program_status NOT IN ('not_started','resigned','expelled') THEN
      RAISE EXCEPTION 'Kamu sudah terdaftar di program (status: %).', v_existing.program_status;
    END IF;
    -- Reset all progress.
    UPDATE public.reddit_army_profiles SET
      warmed_account_id = v_account_id,
      program_status = 'phase1_active',
      current_challenge_level = 0,
      phase1_started_at = NOW(),
      phase1_completed_at = NULL,
      phase2_started_at = NULL,
      resign_requested_at = NULL,
      resign_effective_at = NULL,
      resign_active_days = 0,
      resigned_at = NULL,
      expelled_at = NULL,
      expelled_reason = NULL,
      last_sync_at = NULL,
      last_active_date = NULL,
      notes = NULL,
      updated_at = NOW()
    WHERE user_id = v_uid
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.reddit_army_profiles (
      user_id, warmed_account_id, program_status, phase1_started_at
    ) VALUES (
      v_uid, v_account_id, 'phase1_active', NOW()
    )
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.activity_logs (user_id, reddit_account_id, action, details)
  VALUES (v_uid, v_account_id, 'reddit_army_join',
          jsonb_build_object('profile_id', v_result.id));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_reddit_army_program() TO authenticated;

-- ------------------------------------------------------------
-- 2. list_challenge_tasks_for_user()
--    Returns challenge tasks for the user's current level,
--    with assignment status (locked/available/in_progress/submitted/approved/rejected).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_challenge_tasks_for_user()
RETURNS TABLE (
  task_id uuid,
  title text,
  description text,
  target_url text,
  reward_amount int,
  level_number int,
  level_name text,
  assignment_id uuid,
  assignment_status text,
  can_retry boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_target_level int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN
    RETURN;  -- not in challenge phase, no tasks
  END IF;

  v_target_level := v_profile.current_challenge_level + 1;

  RETURN QUERY
  SELECT
    t.id AS task_id,
    t.title,
    t.description,
    t.target_url,
    t.reward_amount,
    rcl.level_number,
    rcl.level_name,
    ta.id AS assignment_id,
    ta.status AS assignment_status,
    ta.can_retry
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status = 'active'
    AND t.is_hidden = false
    AND rcl.level_number = v_target_level
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_challenge_tasks_for_user() TO authenticated;

-- ------------------------------------------------------------
-- 3. claim_challenge_task(p_task_id, p_reddit_account_id)
--    Wrapper over claim_task_assignment with program checks.
--    Only callable when program_status='phase1_active'.
-- ------------------------------------------------------------
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
  v_assignment_id uuid;
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

  -- Delegate to existing claim_task_assignment RPC.
  -- It already enforces quota, per_account_limit, account ownership.
  v_assignment_id := public.claim_task_assignment(p_task_id, p_reddit_account_id);

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_challenge_task(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4. award_challenge_level_reward(p_user_id, p_level_id)  [INTERNAL]
--    Idempotently insert a challenge_level bonus_hold row.
--    Called by check_challenge_level_complete() after a level finishes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_challenge_level_reward(
  p_user_id uuid,
  p_level_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level public.reddit_challenge_levels;
BEGIN
  SELECT * INTO v_level FROM public.reddit_challenge_levels WHERE id = p_level_id;
  IF v_level IS NULL THEN RAISE EXCEPTION 'Level tidak ditemukan.'; END IF;
  IF v_level.reward_amount <= 0 THEN
    RETURN;  -- level 5 has no level reward (uses phase1_completion instead)
  END IF;

  -- Idempotency via unique index on (user_id, source, source_id).
  INSERT INTO public.bonus_holds (user_id, source, source_id, amount, status, release_condition)
  VALUES (
    p_user_id,
    'challenge_level',
    p_level_id,
    v_level.reward_amount,
    'held',
    'resign_complete'
  )
  ON CONFLICT (user_id, source, source_id) WHERE source_id IS NOT NULL
  DO NOTHING;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_level_reward',
    jsonb_build_object('level', v_level.level_number, 'amount', v_level.reward_amount));
END;
$$;

-- ------------------------------------------------------------
-- 5. check_challenge_level_complete(p_user_id)
--    Checks if user's current challenge level has all tasks approved.
--    If yes: award level reward, advance current_challenge_level,
--    and if it was the final level, call complete_phase1().
--    Safe to call multiple times (idempotent).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_challenge_level_complete(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_target_level public.reddit_challenge_levels;
  v_total_tasks int;
  v_approved_tasks int;
  v_max_level int;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL OR v_profile.program_status != 'phase1_active' THEN
    RETURN;
  END IF;

  SELECT MAX(level_number) INTO v_max_level FROM public.reddit_challenge_levels WHERE is_active;
  IF v_max_level IS NULL THEN RETURN; END IF;

  -- Already completed all levels? Safety net.
  IF v_profile.current_challenge_level >= v_max_level THEN
    PERFORM public.complete_phase1(p_user_id);
    RETURN;
  END IF;

  LOOP
    SELECT * INTO v_target_level FROM public.reddit_challenge_levels
      WHERE level_number = v_profile.current_challenge_level + 1
        AND is_active = true;
    EXIT WHEN v_target_level IS NULL;

    SELECT COUNT(*) INTO v_total_tasks
      FROM public.tasks t
     WHERE t.challenge_level_id = v_target_level.id
       AND t.task_category = 'reddit_challenge'
       AND t.status IN ('active','completed');

    SELECT COUNT(DISTINCT ta.task_id) INTO v_approved_tasks
      FROM public.task_assignments ta
      JOIN public.tasks t ON t.id = ta.task_id
     WHERE t.challenge_level_id = v_target_level.id
       AND ta.user_id = p_user_id
       AND ta.status = 'approved';

    -- Only advance if there are tasks AND all are approved.
    IF v_total_tasks = 0 OR v_approved_tasks < v_total_tasks THEN
      EXIT;
    END IF;

    -- Level complete!
    PERFORM public.award_challenge_level_reward(p_user_id, v_target_level.id);

    v_profile.current_challenge_level := v_target_level.level_number;
    UPDATE public.reddit_army_profiles
       SET current_challenge_level = v_target_level.level_number,
           updated_at = NOW()
     WHERE user_id = p_user_id;

    IF v_target_level.level_number >= v_max_level THEN
      PERFORM public.complete_phase1(p_user_id);
      RETURN;
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 6. complete_phase1(p_user_id)
--    Marks phase1 complete and transitions to phase2_active.
--    Credits Rp100K: 50% instant + 50% hold (30-day release).
--    Idempotent: a phase1_completion user_credit row prevents double credit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_phase1(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.reddit_army_profiles;
  v_phase1_amount int := 50000;
BEGIN
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = p_user_id;
  IF v_profile IS NULL THEN RETURN; END IF;
  IF v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN RETURN; END IF;

  -- Idempotency: if phase2 already started, don't double-credit.
  IF v_profile.program_status = 'phase1_complete' AND v_profile.phase2_started_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- Idempotency check on user_credits: a phase1_completion row already exists?
  PERFORM 1 FROM public.user_credits
    WHERE user_id = p_user_id AND source = 'phase1_completion'
    LIMIT 1;
  IF FOUND THEN
    -- Already credited, just ensure status advanced.
    UPDATE public.reddit_army_profiles SET
      program_status = 'phase2_active',
      phase1_completed_at = COALESCE(phase1_completed_at, NOW()),
      phase2_started_at = COALESCE(phase2_started_at, NOW()),
      updated_at = NOW()
    WHERE user_id = p_user_id;
    RETURN;
  END IF;

  -- Credit Rp50K instant cashable.
  INSERT INTO public.user_credits (user_id, amount, source, description)
  VALUES (p_user_id, v_phase1_amount, 'phase1_completion',
          'Bonus selesai Phase 1 Challenge (instant cashable)');

  -- Hold Rp50K with 30-day release condition.
  INSERT INTO public.bonus_holds (user_id, source, amount, status, release_condition)
  VALUES (p_user_id, 'phase1_completion', v_phase1_amount, 'held', 'days_30');

  UPDATE public.reddit_army_profiles SET
    program_status = 'phase2_active',
    phase1_completed_at = NOW(),
    phase2_started_at = NOW(),
    current_challenge_level = COALESCE(
      (SELECT MAX(level_number) FROM public.reddit_challenge_levels WHERE is_active),
      current_challenge_level
    ),
    updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (p_user_id, 'reddit_army_phase1_complete',
    jsonb_build_object('instant_amount', v_phase1_amount, 'hold_amount', v_phase1_amount));
END;
$$;

-- ------------------------------------------------------------
-- 7. admin_create_challenge_task(...)
--    Admin helper to create a challenge task linked to a level.
--    Wraps the existing admin_create_task but forces task_category + level.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_challenge_task(
  p_level_id uuid,
  p_title text,
  p_description text,
  p_target_url text,
  p_reward_amount int,
  p_max_assignments int DEFAULT 1,
  p_per_account_limit int DEFAULT 1,
  p_brief text
)
RETURNS uuid  -- task_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_level public.reddit_challenge_levels;
  v_task_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_level FROM public.reddit_challenge_levels WHERE id = p_level_id;
  IF v_level IS NULL THEN RAISE EXCEPTION 'Level tidak ditemukan.'; END IF;

  -- Insert directly to bypass admin_create_task's restrictive param list.
  -- We reuse the existing columns: max_assignments, per_account_limit, brief.
  INSERT INTO public.tasks (
    title, description, target_url, brief,
    task_category, task_type,
    reward_amount,
    max_assignments, per_account_limit,
    challenge_level_id,
    status, created_by
  ) VALUES (
    p_title, p_description, p_target_url, p_brief,
    'reddit_challenge', 'comment',
    p_reward_amount,
    p_max_assignments, p_per_account_limit,
    p_level_id,
    'active', v_uid
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_challenge_task(uuid, text, text, text, int, int, int, text) TO authenticated;

-- ------------------------------------------------------------
-- 8. AFTER UPDATE trigger on task_assignments:
--    when a challenge assignment moves to 'approved', recompute level.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reddit_army_check_level_after_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_task_category text;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_user_id := COALESCE(NEW.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = NEW.reddit_account_id));
    IF v_user_id IS NULL THEN RETURN NEW; END IF;

    SELECT task_category INTO v_task_category FROM public.tasks WHERE id = NEW.task_id;
    IF v_task_category = 'reddit_challenge' THEN
      PERFORM public.check_challenge_level_complete(v_user_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reddit_army_check_level_after_approval ON public.task_assignments;
CREATE TRIGGER trg_reddit_army_check_level_after_approval
  AFTER UPDATE OF status ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_reddit_army_check_level_after_approval();

NOTIFY pgrst, 'reload schema';


============================================================
-- FILE: 20260730_reddit_army_rpc_phase2.sql
============================================================
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


============================================================
-- FILE: 20260730_reddit_army_extend_earnings.sql
============================================================
-- ============================================================
-- PeTa — Reddit Army: extend get_user_earnings() with retention
-- fields for display on the Earnings page.
--
-- Adds these new fields to the JSON response:
--   redditArmyRetentionHeld   — SUM bonus_holds WHERE status IN ('held','vesting')
--   redditArmyPendingCashable — pending daily bonus yet to be lump-summed
--   redditArmyPhase1Instant   — SUM user_credits source='phase1_completion'
--   redditArmyDailyCredited   — SUM user_credits source='daily_bonus_cashable'
--   redditArmyHoldReleased    — SUM user_credits source='hold_release'
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_earnings()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task_earnings int;
  v_manual_adj int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_bonus int;
  v_bonus_unlocked boolean;
  v_cashable int;
  v_total int;
  -- Reddit Army breakdown:
  v_ra_phase1 int;
  v_ra_daily_credited int;
  v_ra_hold_released int;
  v_ra_retention_held int;
  v_ra_pending_cashable int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Canonical task earnings: approved assignments (forum + reddit + challenge).
  SELECT COALESCE(SUM(t.reward_amount), 0)::int
  INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = v_uid
    AND ta.status = 'approved';

  -- Credits split (excluding task_reward which is a ledger mirror).
  -- Note: phase1_completion / daily_bonus_cashable / hold_release are now
  -- captured inside v_manual_adj (they're all cashable), AND broken out
  -- explicitly below for the UI to display.
  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'phase1_completion' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'daily_bonus_cashable' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'hold_release' THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_manual_adj,
       v_ra_phase1, v_ra_daily_credited, v_ra_hold_released
  FROM public.user_credits
  WHERE user_id = v_uid;

  -- Reddit Army retention: bonus_holds still locked.
  SELECT COALESCE(SUM(amount), 0)::int
  INTO v_ra_retention_held
  FROM public.bonus_holds
  WHERE user_id = v_uid AND status IN ('held','vesting');

  -- Reddit Army pending cashable: lump not yet released.
  SELECT COALESCE(SUM(credited_amount / 2), 0)::int
  INTO v_ra_pending_cashable
  FROM public.reddit_daily_activity
  WHERE user_id = v_uid
    AND credited_type = 'pending_split'
    AND bonus_credited = true
    AND lump_credited_at IS NULL;

  v_bonus := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= 100000;
  v_cashable := v_task_earnings + v_manual_adj + CASE WHEN v_bonus_unlocked THEN v_bonus ELSE 0 END;
  v_total := v_task_earnings + v_manual_adj + v_bonus;

  RETURN json_build_object(
    'tasks', v_task_earnings,
    'manualAdj', v_manual_adj,
    'signupBonus', v_signup_bonus,
    'referralBonus', v_referral_bonus,
    'bonus', v_bonus,
    'bonusUnlocked', v_bonus_unlocked,
    'cashable', v_cashable,
    'total', v_total,
    'earned', v_task_earnings + v_manual_adj,
    'referral', v_bonus,
    'fromWork', v_task_earnings,
    -- Reddit Army breakdown (new):
    'redditArmyPhase1Instant', v_ra_phase1,
    'redditArmyDailyCredited', v_ra_daily_credited,
    'redditArmyHoldReleased', v_ra_hold_released,
    'redditArmyRetentionHeld', v_ra_retention_held,
    'redditArmyPendingCashable', v_ra_pending_cashable
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_user_earnings() TO authenticated;

NOTIFY pgrst, 'reload schema';


============================================================
-- FILE: 20260730_reddit_army_sync_targets.sql
============================================================
-- ============================================================
-- PeTa — Reddit Army: helper RPC for the sync edge function.
--
-- list_reddit_army_sync_targets(p_user_ids) returns rows the edge
-- function needs: (user_id, username, reddit_account_id) for every
-- member whose program_status is phase2_active or resigning.
--
-- If p_user_ids is non-null, filter to those users (manual admin sync).
-- Otherwise return all eligible members.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_reddit_army_sync_targets(
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  username text,
  reddit_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rap.user_id,
    ra.username,
    rap.warmed_account_id AS reddit_account_id
  FROM public.reddit_army_profiles rap
  JOIN public.reddit_accounts ra ON ra.id = rap.warmed_account_id
  WHERE rap.program_status IN ('phase2_active','resigning')
    AND rap.warmed_account_id IS NOT NULL
    AND (p_user_ids IS NULL OR rap.user_id = ANY(p_user_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_reddit_army_sync_targets(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


============================================================
-- FILE: 20260730_reddit_army_cron_jobs.sql
============================================================
-- ============================================================
-- PeTa — Reddit Army pg_cron jobs.
--
-- Schedules:
--   1. release_phase1_completion_hold   every hour
--   2. release_biweekly_cashout         Saturday 02:00 UTC (= 09:00 WIB)
--   3. process_resignation_complete     daily 02:00 UTC (= 09:00 WIB)
--   4. flag_ghosting_for_review         weekly Sunday 17:00 UTC (= 00:00 WIB Mon)
--
-- Note: The "sync_reddit_daily_activity" job calls an edge function
-- via pg_net, scheduled separately. See Section 13 of the design spec.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Release phase1 completion holds older than 30 days (every hour).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-release-phase1-hold') THEN
    PERFORM cron.schedule(
      'ra-release-phase1-hold',
      '0 * * * *',
      'SELECT public.release_phase1_completion_hold();'
    );
  END IF;
END $$;

-- 2. Biweekly cashout lump sum (every Saturday 09:00 WIB).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-biweekly-cashout') THEN
    PERFORM cron.schedule(
      'ra-biweekly-cashout',
      '0 2 * * 6',   -- 02:00 UTC Saturday = 09:00 WIB Saturday
      'SELECT public.release_biweekly_cashout();'
    );
  END IF;
END $$;

-- 3. Process resignation complete (daily 09:00 WIB).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-resignation-process') THEN
    PERFORM cron.schedule(
      'ra-resignation-process',
      '0 2 * * *',   -- 02:00 UTC = 09:00 WIB
      'SELECT public.process_resignation_complete();'
    );
  END IF;
END $$;

-- 4. Flag ghosting for admin review (weekly).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-flag-ghosting') THEN
    PERFORM cron.schedule(
      'ra-flag-ghosting',
      '0 17 * * 0',  -- 17:00 UTC Sunday = 00:00 WIB Monday
      'SELECT public.flag_ghosting_for_review();'
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


COMMIT;

-- Done. Run these to verify (in a NEW SQL Editor tab):
--   SELECT * FROM reddit_challenge_levels ORDER BY level_number;
--   SELECT * FROM information_schema.tables WHERE table_name LIKE 'reddit_%' OR table_name = 'bonus_holds';
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ra-%';
