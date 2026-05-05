-- Server-side bonus claim: amounts/descriptions are fixed here,
-- can't be tampered with from the client. Idempotent via the
-- existing unique partial index on (user_id, description).
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
