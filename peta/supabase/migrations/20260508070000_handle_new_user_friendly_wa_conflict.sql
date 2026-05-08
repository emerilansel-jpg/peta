-- handle_new_user must catch the new whatsapp UNIQUE violation and surface
-- a friendly Indonesian message instead of bubbling up the raw Postgres
-- "duplicate key" error to the registration form. Without this guard,
-- the auth.users INSERT also rolls back and the user just sees a generic
-- "Database error saving new user".
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_referrer_code TEXT;
  v_referrer_id   UUID;
  v_whatsapp      TEXT;
  v_existing_owner UUID;
BEGIN
  v_referrer_code := NULLIF(LOWER(NEW.raw_user_meta_data->>'referral_code'), '');
  v_whatsapp := NULLIF(NEW.raw_user_meta_data->>'whatsapp', '');

  -- Pre-check WhatsApp uniqueness so we can raise a friendly message.
  -- A bare UNIQUE violation in the trigger would roll back the whole
  -- auth.users insert and surface as "Database error saving new user".
  IF v_whatsapp IS NOT NULL THEN
    SELECT id INTO v_existing_owner FROM public.users WHERE whatsapp = v_whatsapp LIMIT 1;
    IF v_existing_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Nomor WhatsApp ini sudah terdaftar di akun PeTa lain. Pakai nomor lain atau login dengan akun yang sudah ada.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_referrer_code IS NOT NULL THEN
    SELECT id INTO v_referrer_id FROM public.users WHERE referral_code = v_referrer_code LIMIT 1;
  END IF;

  INSERT INTO public.users (id, email, full_name, whatsapp, role, referred_by)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    v_whatsapp,
    'army',
    v_referrer_id
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || NEW.email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  RETURN NEW;
END;
$$;

-- Anon-callable phone-availability check. RLS blocks anon SELECT on users,
-- so this returns just a boolean — no PII leak. Used by the registration
-- form to show a friendly Indonesian error before attempting auth.signUp,
-- which wraps the trigger error as "Database error saving new user".
CREATE OR REPLACE FUNCTION public.is_whatsapp_taken(p_whatsapp text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE whatsapp = p_whatsapp
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_whatsapp_taken(text) TO anon, authenticated;
