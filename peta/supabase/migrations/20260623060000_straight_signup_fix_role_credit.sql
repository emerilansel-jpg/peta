-- =============================================================
-- Straight Ltd — fix email signup: correct role, save profile
-- fields, and award the promised $5 signup credit.
--
-- Production already has role='client' rows and role_title/website
-- columns, but the repo migrations did not. This migration makes the
-- repo match production AND fixes the missing signup-credit bug.
-- =============================================================

-- 1) Allow 'client' role (used by Straight Ltd users).
--    Drop and recreate the CHECK constraint idempotently.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('army', 'admin', 'client'));

-- 2) Add Straight profile fields if they don't exist yet.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role_title TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;

-- 3) Recreate handle_new_user so Straight signups get:
--    - role = 'client'
--    - full_name, role_title, website copied from metadata
--    - $5 (500 cents) signup credit via credit_transactions
--    while PeTa signups keep the existing army role / WhatsApp /
--    referral-bonus behaviour.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_product       TEXT;
  v_role          TEXT;
  v_full_name     TEXT;
  v_role_title    TEXT;
  v_website       TEXT;
  v_referrer_code TEXT;
  v_referrer_id   UUID;
  v_whatsapp      TEXT;
  v_existing_owner UUID;
BEGIN
  -- Common metadata extraction
  v_product    := COALESCE(NULLIF(LOWER(NEW.raw_user_meta_data->>'product'), ''), 'peta');
  v_full_name  := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1));
  v_role_title := NULLIF(NEW.raw_user_meta_data->>'role_title', '');
  v_website    := NULLIF(NEW.raw_user_meta_data->>'website', '');
  v_referrer_code := NULLIF(LOWER(NEW.raw_user_meta_data->>'referral_code'), '');
  v_whatsapp   := NULLIF(NEW.raw_user_meta_data->>'whatsapp', '');

  -- Role: Straight clients get 'client', everyone else defaults to 'army'.
  IF v_product = 'straight' THEN
    v_role := 'client';
  ELSE
    v_role := 'army';
  END IF;

  -- Pre-check WhatsApp uniqueness so we can raise a friendly message.
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

  INSERT INTO public.users (
    id, email, full_name, whatsapp, role, referred_by,
    role_title, website
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_whatsapp,
    v_role,
    v_referrer_id,
    v_role_title,
    v_website
  )
  ON CONFLICT (id) DO NOTHING;

  -- Award referral bonus to BOTH sides if a valid PeTa referral code was used.
  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || NEW.email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  -- Straight signup bonus: $5 free credit as advertised on the landing page.
  IF v_product = 'straight' THEN
    INSERT INTO public.credit_transactions (
      user_id, type, amount, balance_after, metadata
    )
    SELECT
      NEW.id,
      'adjust',
      500,
      COALESCE(u.credit_balance, 0) + 500,
      jsonb_build_object('reason', 'straight_signup_bonus', 'description', '$5 free credit on signup')
    FROM public.users u
    WHERE u.id = NEW.id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Idempotency guard: a user can only receive the Straight signup bonus once.
--    This also makes any future backfill safe.
DROP INDEX IF EXISTS idx_credit_transactions_straight_signup_bonus;
CREATE UNIQUE INDEX idx_credit_transactions_straight_signup_bonus
  ON public.credit_transactions (user_id)
  WHERE metadata->>'reason' = 'straight_signup_bonus';

-- Ensure the trigger is attached (idempotent).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
