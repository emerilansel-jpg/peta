-- =============================================================
-- Fix request_payout PostgREST ambiguity
--
-- Production DB has an extra 6-parameter overload of request_payout
-- that was added outside of repo migrations. The frontend only passes
-- p_amount, so PostgREST cannot choose between the two candidate
-- functions and returns PGRST203.
-- Drop the unused overload so the 1-parameter version is unambiguous.
-- =============================================================

DROP FUNCTION IF EXISTS public.request_payout(
  p_amount int,
  p_payment_type text,
  p_provider text,
  p_account_number text,
  p_account_holder_name text,
  p_user_note text
);
