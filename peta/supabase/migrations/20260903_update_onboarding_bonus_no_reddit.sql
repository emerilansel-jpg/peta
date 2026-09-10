-- ============================================================
-- PeTa — Update onboarding bonus amounts (no Reddit required).
--
-- Reddit account creation is no longer part of PeTa onboarding.
-- The Rp50.000 bonus is distributed across the 3 general onboarding steps:
--   - 'signup'   : Rp25.000
--   - 'wa_group' : Rp10.000 (was 5.000)
--   - 'warp'     : Rp15.000 (was 10.000)
-- Legacy steps ('reddit_account', 'reddit_url') are retained in the
-- CASE statement for backward compatibility with historical records.
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_onboarding_bonus(p_step text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHEN 'wa_group'       THEN v_amount := 10000; v_description := 'Bonus gabung grup WhatsApp';
    WHEN 'warp'           THEN v_amount := 15000; v_description := 'Bonus setup WARP';
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
$function$;

GRANT EXECUTE ON FUNCTION public.claim_onboarding_bonus(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
