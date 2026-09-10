-- Migration: 20260910150000_atomic_password_reset_with_token.sql
-- Fixes password reset failure ("Unauthorized") by providing an atomic RPC
-- that verifies the reset token, updates auth.users password, and consumes the token
-- in a single SECURITY DEFINER transaction without requiring admin session.

BEGIN;

CREATE OR REPLACE FUNCTION public.reset_user_password_with_token(
  p_token UUID,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_token_record public.password_reset_tokens%ROWTYPE;
  v_user_id UUID;
BEGIN
  IF p_token IS NULL OR p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Password minimal 6 karakter');
  END IF;

  -- 1. Find and lock valid, unused token
  SELECT * INTO v_token_record
  FROM public.password_reset_tokens
  WHERE token = p_token
    AND used_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reset link is invalid or has expired');
  END IF;

  v_user_id := v_token_record.user_id;

  -- 2. Update password in auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = NOW()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;

  -- 3. Mark token as used
  UPDATE public.password_reset_tokens
  SET used_at = NOW()
  WHERE id = v_token_record.id;

  RETURN jsonb_build_object('ok', true, 'message', 'Password successfully updated');
END;
$$;

REVOKE ALL ON FUNCTION public.reset_user_password_with_token(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_user_password_with_token(UUID, TEXT) TO anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
