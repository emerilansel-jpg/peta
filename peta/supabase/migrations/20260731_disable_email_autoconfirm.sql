-- ============================================================
-- PeTa — Disable email auto-confirm (security fix C2)
--
-- Problem: the DB-level BEFORE INSERT trigger on auth.users
-- (auto_confirm_users_trigger, added by 20260506060000) sets
-- email_confirmed_at = NOW() on every signup, bypassing Supabase
-- Auth email verification entirely. This let anyone create a
-- verified account with a throwaway / fake email instantly —
-- opening the door to referral-bonus farming (Rp20K referrer +
-- Rp20K referee per fake signup), spam, and payout abuse.
--
-- Fix: drop the trigger so signups go through the normal Supabase
-- Auth flow. New users receive a verification email and must click
-- the link before email_confirmed_at is set and a live session is
-- granted. Combined with the Register.tsx UI changes, this restores
-- genuine email ownership verification.
--
-- NOTE: existing confirmed users are left untouched (no backfill
-- in either direction). Only NEW signups are affected.
--
-- Dashboard requirement: ensure the project-level "Confirm email"
-- setting is ENABLED in Auth > Providers > Email on both staging
-- and prod. This migration removes the DB-level bypass; the
-- project setting must be ON for Supabase to actually send the
-- verification email and gate the session.
-- ============================================================

DROP TRIGGER IF EXISTS auto_confirm_users_trigger ON auth.users;
DROP FUNCTION IF EXISTS public.auto_confirm_user();
