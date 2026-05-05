-- ====================================================================
-- One-time prod admin seed.
-- Run this ONCE in Supabase SQL editor AFTER `supabase db push` to prod.
-- Then change the password from the app UI on first login.
-- ====================================================================

DO $$
DECLARE
  admin_id UUID := gen_random_uuid();
  admin_email TEXT := 'info@jetdigitalpro.com';      -- ← change if you want
  admin_password TEXT := 'PetaProd2026!';            -- ← CHANGE THIS, min 6 chars
  admin_name TEXT := 'Admin PeTa';
BEGIN
  -- Bail out if already seeded
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = admin_email) THEN
    RAISE NOTICE 'Admin already exists for %, skipping.', admin_email;
    RETURN;
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated',
    admin_email, crypt(admin_password, gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', admin_name),
    NOW(), NOW(),
    '', '', '', '', '', '', '', '',
    false, false
  );

  -- handle_new_user trigger creates the public.users row with role=army.
  -- Promote to admin.
  UPDATE public.users
  SET role = 'admin', full_name = admin_name
  WHERE id = admin_id;

  RAISE NOTICE 'Admin seeded: % (id=%)', admin_email, admin_id;
END $$;

-- Verify
SELECT u.id, u.email, p.role, p.full_name
FROM auth.users u
JOIN public.users p ON p.id = u.id
WHERE p.role = 'admin';
