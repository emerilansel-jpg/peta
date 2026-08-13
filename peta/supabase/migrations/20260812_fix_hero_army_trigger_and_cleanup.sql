-- ============================================================
-- PeTa — Fix promote_to_hero_army trigger + drop dead Firecrawl RPCs.
--
-- Problem 1: trg_promote_hero_army only fired AFTER UPDATE. Users joining
--   via the INSERT path (activate_reddit_army_invitation / join_reddit_army_program
--   create the profile row directly with status='phase1_active') were never
--   promoted to the 'hero_army' role. Fix: fire on INSERT OR UPDATE and handle
--   the INSERT case (NEW.program_status = 'phase1_active') separately.
--
-- Problem 2: get_pending_firecrawl_assignments() + mark_task_firecrawl_verified()
--   were dead code — the edge function does inline SQL instead of calling them.
--   Drop to avoid maintenance confusion.
--
-- ADDITIVE: no data changes.
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Rewrite the trigger function to handle INSERT + UPDATE.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_to_hero_army()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Promote army -> hero_army when:
  --   (a) a profile row is INSERTed directly into phase1_active (join RPC path), OR
  --   (b) a profile row transitions not_started -> phase1_active (activation path).
  -- Never demotes (admin must manually revert role on resign/expel).
  IF (TG_OP = 'INSERT' AND NEW.program_status = 'phase1_active')
     OR (TG_OP = 'UPDATE' AND OLD.program_status = 'not_started' AND NEW.program_status = 'phase1_active')
  THEN
    UPDATE public.users
       SET role = 'hero_army'
     WHERE id = NEW.user_id
       AND role = 'army';  -- only promote regular army, never touch admin/client
  END IF;
  RETURN NEW;
END;
$$;

-- Re-bind the trigger to fire on INSERT OR UPDATE (was UPDATE only).
DROP TRIGGER IF EXISTS trg_promote_hero_army ON public.reddit_army_profiles;
CREATE TRIGGER trg_promote_hero_army
  AFTER INSERT OR UPDATE ON public.reddit_army_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_to_hero_army();

-- ------------------------------------------------------------
-- 2) Drop the two dead Firecrawl helper RPCs.
--    The deployed edge function sync-reddit-army-firecrawl uses inline SQL
--    (reads submitted assignments, writes is_verified_firecrawl directly),
--    so these were never called. Dropping removes confusion for future readers.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_pending_firecrawl_assignments();
DROP FUNCTION IF EXISTS public.mark_task_firecrawl_verified(uuid);

NOTIFY pgrst, 'reload schema';
