-- 1. WhatsApp + referral columns on users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users (referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON public.users (referred_by);

-- 2. Backfill referral_code for existing users
UPDATE public.users
SET referral_code = LOWER(SUBSTRING(MD5(RANDOM()::text || id::text), 1, 8))
WHERE referral_code IS NULL;

-- 3. Auto-generate referral code on insert
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := LOWER(SUBSTRING(MD5(RANDOM()::text || NEW.id::text || clock_timestamp()::text), 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_referral_code ON public.users;
CREATE TRIGGER trg_users_referral_code
BEFORE INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();

-- 4. Task type: 'comment' or 'upvote'
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'comment'
  CHECK (task_type IN ('comment', 'upvote'));

-- 5. user_credits — generic credit ledger (referral bonus, signup bonus, etc.)
CREATE TABLE IF NOT EXISTS public.user_credits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('referral_bonus_referrer', 'referral_bonus_referee', 'signup_bonus', 'manual_adjustment')),
  description TEXT,
  reference_id UUID,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON public.user_credits (user_id);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own credits" ON public.user_credits;
CREATE POLICY "Users see own credits" ON public.user_credits
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Admins manage credits" ON public.user_credits;
CREATE POLICY "Admins manage credits" ON public.user_credits
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 6. Updated handle_new_user: capture whatsapp + referred_by + award referral bonus
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_code TEXT;
  v_referrer_id   UUID;
BEGIN
  v_referrer_code := NULLIF(LOWER(NEW.raw_user_meta_data->>'referral_code'), '');

  IF v_referrer_code IS NOT NULL THEN
    SELECT id INTO v_referrer_id FROM public.users WHERE referral_code = v_referrer_code LIMIT 1;
  END IF;

  INSERT INTO public.users (id, email, full_name, whatsapp, role, referred_by)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'whatsapp', ''),
    'army',
    v_referrer_id
  )
  ON CONFLICT (id) DO NOTHING;

  -- Award referral bonus to BOTH if a valid code was used
  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || NEW.email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Admin RPC: create a new member directly
CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_email TEXT,
  p_password TEXT,
  p_whatsapp TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can create members';
  END IF;

  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    p_email, crypt(p_password, gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'whatsapp', p_whatsapp),
    NOW(), NOW(),
    '', '', '', '', '', '', '', '',
    false, false
  );

  -- Trigger handle_new_user will create the public.users row.
  -- Update WhatsApp + full_name in case trigger missed them.
  UPDATE public.users
  SET whatsapp = COALESCE(p_whatsapp, whatsapp),
      full_name = COALESCE(p_full_name, full_name)
  WHERE id = v_user_id;

  RETURN v_user_id;
END;
$$;

-- 8. Admin RPC: update + soft-delete member
CREATE OR REPLACE FUNCTION public.admin_update_member(
  p_user_id UUID,
  p_full_name TEXT DEFAULT NULL,
  p_whatsapp TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can update members';
  END IF;

  UPDATE public.users SET
    full_name = COALESCE(p_full_name, full_name),
    whatsapp  = COALESCE(p_whatsapp,  whatsapp),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_member(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete members';
  END IF;

  -- Hard delete: removes auth.users; cascade clears public.users + reddit_accounts + payouts
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
