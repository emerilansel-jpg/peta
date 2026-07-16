-- =============================================================
-- ROLLBACK: 20260602120000_straight_waitlist.sql
-- Run this ONLY if you need to fully remove the waitlist feature.
-- Safe to run even if the migration was never applied.
-- =============================================================

-- 1. Drop the RPC first (depends on the table)
DROP FUNCTION IF EXISTS public.join_waitlist(text, text, text, text, text, text);

-- 2. Drop policies
DROP POLICY IF EXISTS waitlist_admin_select ON public.waitlist;
DROP POLICY IF EXISTS waitlist_admin_update ON public.waitlist;

-- 3. Drop indexes
DROP INDEX IF EXISTS public.waitlist_email_uniq;
DROP INDEX IF EXISTS public.waitlist_created_idx;

-- 4. Drop the table (CASCADE drops any remaining policies/indexes)
DROP TABLE IF EXISTS public.waitlist CASCADE;
