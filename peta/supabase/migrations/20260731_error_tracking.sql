-- ============================================================
-- PeTa — Client-side error tracking
--
-- Simple error logging: React app catches errors & sends them
-- here. Admin can review in a basic view.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  error_type text,
  error_message text,
  error_stack text,
  url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs (created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "error_logs_insert_authenticated" ON public.error_logs;
CREATE POLICY "error_logs_insert_authenticated" ON public.error_logs
  FOR INSERT WITH CHECK (true);  -- allow any authenticated user to insert

DROP POLICY IF EXISTS "error_logs_admin_select" ON public.error_logs;
CREATE POLICY "error_logs_admin_select" ON public.error_logs
  FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.log_client_error(
  p_error_type text,
  p_error_message text,
  p_error_stack text DEFAULT NULL,
  p_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ua text;
BEGIN
  v_ua := current_setting('request.headers', true)::json ->> 'user-agent';
  INSERT INTO public.error_logs (user_id, error_type, error_message, error_stack, url, user_agent)
  VALUES (v_uid, p_error_type, p_error_message, p_error_stack, p_url, v_ua);
EXCEPTION WHEN OTHERS THEN
  -- Silently fail — logging should never break the app
  NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
