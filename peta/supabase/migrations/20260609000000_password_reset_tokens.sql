-- Password reset tokens for WhatsApp-based forgot password
-- Stores tokens generated when user requests reset via WA number

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL CHECK (method IN ('email', 'whatsapp')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON public.password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON public.password_reset_tokens(expires_at) WHERE used_at IS NULL;

-- RLS: only service_role can read tokens (users verify via edge function)
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON public.password_reset_tokens;
CREATE POLICY "Service role only" ON public.password_reset_tokens
  FOR ALL USING (false) WITH CHECK (false);

-- RPC: verify token and return user_id if valid
CREATE OR REPLACE FUNCTION public.verify_password_reset_token(p_token TEXT)
RETURNS TABLE (
  user_id UUID,
  valid BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.password_reset_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_record
  FROM public.password_reset_tokens
  WHERE token = p_token AND used_at IS NULL AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Token tidak valid atau sudah expired'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_record.user_id, true, 'Token valid'::TEXT;
END;
$$;

-- RPC: mark token as used
CREATE OR REPLACE FUNCTION public.consume_password_reset_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.password_reset_tokens
  SET used_at = NOW()
  WHERE token = p_token AND used_at IS NULL AND expires_at > NOW();

  RETURN FOUND;
END;
$$;

-- Cleanup old expired tokens (run via pg_cron or manual)
CREATE OR REPLACE FUNCTION public.cleanup_expired_password_reset_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.password_reset_tokens
  WHERE expires_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- RPC: admin update user password (for WA password reset)
CREATE OR REPLACE FUNCTION public.admin_update_user_password(
  p_user_id UUID,
  p_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO anon;
