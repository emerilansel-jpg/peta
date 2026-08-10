-- ============================================================
-- PeTa — Hero Army & Firecrawl Pipeline (Additive-Only)
--
-- SAFE: Only ADDS new columns, new role value, new trigger.
-- Does NOT modify existing tables, RPCs, RLS policies, or cron jobs.
--
-- Changes:
--   1. Add 'hero_army' to users.role CHECK constraint
--   2. Add Firecrawl tracking columns to task_assignments
--   3. Create trigger: auto-promote to hero_army on invitation activation
--   4. Add helper function: is_hero_army()
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Add 'hero_army' to users.role CHECK constraint
--    Current values: ('army', 'admin', 'client')
--    New values: ('army', 'admin', 'client', 'hero_army')
-- ------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('army', 'admin', 'client', 'hero_army'));

-- ------------------------------------------------------------
-- 2. Add Firecrawl tracking columns to task_assignments
--    These columns track whether a task was auto-verified by Firecrawl
--    or requires manual admin review (Incognito screenshot fallback).
-- ------------------------------------------------------------
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS is_verified_firecrawl boolean DEFAULT false;

ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS firecrawl_verified_at timestamptz;

-- Index for quick filtering of Firecrawl-verified tasks
CREATE INDEX IF NOT EXISTS idx_task_assignments_firecrawl_verified
  ON public.task_assignments (is_verified_firecrawl)
  WHERE is_verified_firecrawl = true;

-- ------------------------------------------------------------
-- 3. Helper function: is_hero_army()
--    Returns true if the current user has role = 'hero_army'.
--    Useful for RLS policies and frontend gating.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_hero_army()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'hero_army'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_hero_army() TO authenticated;

-- ------------------------------------------------------------
-- 4. Trigger: Auto-promote to hero_army when invitation activates
--    When reddit_army_profiles.program_status changes from
--    'not_started' to 'phase1_active', automatically update
--    the user's role from 'army' to 'hero_army'.
--
--    NOTE: This does NOT demote users back to 'army' if they
--    resign or get expelled. Admin must manually change role back.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_to_hero_army()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only promote when transitioning FROM not_started TO phase1_active
  IF OLD.program_status = 'not_started'
     AND NEW.program_status = 'phase1_active' THEN
    UPDATE public.users
       SET role = 'hero_army'
     WHERE id = NEW.user_id
       AND role = 'army';  -- Only promote if currently 'army' (not admin/client)
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_hero_army ON public.reddit_army_profiles;
CREATE TRIGGER trg_promote_hero_army
  AFTER UPDATE ON public.reddit_army_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_to_hero_army();

-- ------------------------------------------------------------
-- 5. Index on reddit_army_profiles for quick hero_army lookup
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reddit_army_profiles_user_status
  ON public.reddit_army_profiles (user_id, program_status);

COMMIT;

NOTIFY pgrst, 'reload schema';
