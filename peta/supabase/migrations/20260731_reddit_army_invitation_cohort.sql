-- ============================================================
-- PeTa — Reddit Army v2: Invitation + Cohort + Min Days + Drop Karma
--
-- Implements Pak Nell feedback (29 Jul 2026):
--   1. Invitation-only — army cannot self-enroll, admin must invite
--   2. Min days per level — challenge cannot complete too fast (warmup)
--   3. Cohort — split test 30% new account / 70% warmed purchased
--   4. Drop Karma Mission — remove feature
--
-- Changes:
--   reddit_army_profiles: add cohort, invited_by, invited_at,
--                         warmed_account_provided_at, current_level_started_at
--   reddit_challenge_levels: add min_days_at_level (3/7/14/21/30 default)
--   Drop RPC: claim_karma_milestone, has_claimed_karma_milestone
--   Drop column: user_credits source 'karma_milestone' (kept for history)
--
-- Idempotent + safe to re-run.
-- ============================================================

BEGIN;

-- --------------------------------------------------------
-- 1. reddit_army_profiles: add cohort + invitation fields
-- --------------------------------------------------------
ALTER TABLE public.reddit_army_profiles
  ADD COLUMN IF NOT EXISTS cohort text
    CHECK (cohort IS NULL OR cohort IN ('new_self_register','warmed_purchased')),
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmed_account_provided_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_level_started_at timestamptz;

-- Backfill: existing profiles get default cohort (so they still work).
UPDATE public.reddit_army_profiles
   SET cohort = COALESCE(cohort, 'new_self_register')
 WHERE cohort IS NULL;

-- existing profiles that already started get current_level_started_at = phase1_started_at
UPDATE public.reddit_army_profiles
   SET current_level_started_at = phase1_started_at
 WHERE current_level_started_at IS NULL
   AND phase1_started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reddit_army_profiles_cohort
  ON public.reddit_army_profiles (cohort);
CREATE INDEX IF NOT EXISTS idx_reddit_army_profiles_invited_by
  ON public.reddit_army_profiles (invited_by);

-- --------------------------------------------------------
-- 2. reddit_challenge_levels: add min_days_at_level
-- --------------------------------------------------------
ALTER TABLE public.reddit_challenge_levels
  ADD COLUMN IF NOT EXISTS min_days_at_level int NOT NULL DEFAULT 0
    CHECK (min_days_at_level >= 0);

-- Seed default min days for existing 5 levels.
UPDATE public.reddit_challenge_levels SET min_days_at_level = 3  WHERE level_number = 1 AND min_days_at_level = 0;
UPDATE public.reddit_challenge_levels SET min_days_at_level = 7  WHERE level_number = 2 AND min_days_at_level = 0;
UPDATE public.reddit_challenge_levels SET min_days_at_level = 14 WHERE level_number = 3 AND min_days_at_level = 0;
UPDATE public.reddit_challenge_levels SET min_days_at_level = 21 WHERE level_number = 4 AND min_days_at_level = 0;
UPDATE public.reddit_challenge_levels SET min_days_at_level = 30 WHERE level_number = 5 AND min_days_at_level = 0;

-- --------------------------------------------------------
-- 3. Drop Karma Mission RPCs
--    (Keep the user_credits history with source='karma_milestone'
--     so past rewards are not lost. Only drop the RPCs.)
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_karma_milestone();
DROP FUNCTION IF EXISTS public.has_claimed_karma_milestone(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
