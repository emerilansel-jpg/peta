-- ============================================================
-- PeTa — QA test account cleanup (H7)
--
-- During the QA audit (2026-07-30), a test account was created in PROD via
-- the public signup endpoint to verify the email auto-confirm vulnerability
-- (C2) and money-mint RPC vectors live. The public.users row was already
-- self-deleted via RLS, but the auth.users row could not be removed without
-- the service_role. This migration removes that leftover row.
--
-- This is a one-off cleanup. Safe to run on staging (no-op if row absent)
-- and on prod (removes the single leftover test account).
--
-- After C2 (email verification now required), creating such test accounts
-- is no longer instant — but we still remove this one.
-- ============================================================

-- The QA probe account. Hard-deletes auth.users; FK cascade clears any
-- remaining public.* rows tied to it (public.users was already deleted).
DELETE FROM auth.users
WHERE id = '79e11b0c-dccd-4274-9425-1ad374a530c1'
   OR email = 'qa-probe-do-not-use@test.invalid';
