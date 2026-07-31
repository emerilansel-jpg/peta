-- ============================================================
-- QA FIX (2026-07-31) — founding cap enforcement + payout cancel
--
-- 1) claim_onboarding_bonus: deny all onboarding-bonus claims once the
--    founding slots (100 army members) are full — matches the published
--    promise "Slot ke-101 dst tidak dapat bonus founding" and removes the
--    economic incentive for signup spam (Rp25K+ per account).
-- 2) admin_cancel_payout: lets an admin cancel a pending payout so a wrong
--    account number can be fixed; funds free up automatically in the UI
--    (available = cashable − pending payouts).
-- ============================================================

-- 1. Founding cap enforcement
CREATE OR REPLACE FUNCTION public.claim_onboarding_bonus(p_step text)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID;
  v_amount INTEGER;
  v_description TEXT;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Founding cap: slot ke-101+ tidak mendapat bonus founding.
  IF (SELECT COUNT(*) FROM public.users WHERE role = 'army') >= 100 THEN
    RAISE EXCEPTION 'Founding bonus sudah penuh (slot ke-101+ tidak dapat bonus founding)';
  END IF;

  CASE p_step
    WHEN 'signup'         THEN v_amount := 25000; v_description := 'Bonus pendaftaran';
    WHEN 'wa_group'       THEN v_amount :=  5000; v_description := 'Bonus gabung grup WhatsApp';
    WHEN 'warp'           THEN v_amount := 10000; v_description := 'Bonus setup WARP';
    WHEN 'reddit_account' THEN v_amount :=  5000; v_description := 'Bonus buat akun Reddit';
    WHEN 'reddit_url'     THEN v_amount :=  5000; v_description := 'Bonus verifikasi profil Reddit';
    ELSE RAISE EXCEPTION 'Unknown onboarding step: %', p_step;
  END CASE;

  INSERT INTO public.user_credits (user_id, amount, source, description)
  VALUES (v_user, v_amount, 'signup_bonus', v_description)
  ON CONFLICT (user_id, description) WHERE source = 'signup_bonus'
  DO NOTHING;

  RETURN v_amount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_onboarding_bonus(text) TO authenticated;

-- 2. Admin cancel payout (frees committed funds for the member)
CREATE OR REPLACE FUNCTION public.admin_cancel_payout(p_payout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can cancel payouts';
  END IF;

  UPDATE public.payouts
  SET status = 'cancelled',
      notes = COALESCE(notes, '') || E'\n[Cancelled by admin ' || now() || ']'
  WHERE id = p_payout_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found or not pending';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_payout(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
