-- ============================================================
-- QA FIX (2026-07-31) — admin_create_member / password-reset broken in prod
--
-- Symptom: "function gen_salt(unknown) does not exist" when admin creates
-- a member via Team UI, and the same failure path in password-reset RPCs.
-- Root cause: those SECURITY DEFINER functions set `search_path = public, auth`
-- but Supabase installs the pgcrypto extension in the `extensions` schema,
-- so crypt()/gen_salt() are invisible to them.
--
-- Fix: 1) make sure pgcrypto exists in public (harmless if already present),
--      2) add `extensions` to the search_path of both affected functions.
--      3) same guard for any other function using crypt()/gen_salt().
-- ============================================================

BEGIN;

-- 1. Ensure pgcrypto is available somewhere in the search path.
--    If Supabase already installed it in `extensions`, this is a no-op.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Re-create admin_create_member with extensions in search_path
CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_email TEXT,
  p_password TEXT,
  p_whatsapp TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
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

-- 3. Re-create admin_update_user_password with extensions in search_path
CREATE OR REPLACE FUNCTION public.admin_update_user_password(
  p_user_id UUID,
  p_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  -- Allow anonymous callers with valid token (edge function uses service_role)
  -- or authenticated users updating their own password
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    -- Only service_role or admin can update other users
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_member(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO anon;

COMMIT;
