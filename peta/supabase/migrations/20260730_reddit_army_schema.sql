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
