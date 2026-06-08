-- =============================================================
-- Straight Ltd — Registration mode toggle.
-- Admin can switch between "signup" (open registration) and
-- "waitlist" (capture interest only). Controls front-door behavior
-- for RedditLanding, RedditSignup, and WaitlistPage.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.straight_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  registration_mode TEXT NOT NULL DEFAULT 'signup'
    CHECK (registration_mode IN ('signup', 'waitlist')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  CONSTRAINT straight_settings_singleton CHECK (id = TRUE)
);

INSERT INTO public.straight_settings (id, registration_mode)
VALUES (TRUE, 'signup')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.straight_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS straight_settings_read_authenticated ON public.straight_settings;
CREATE POLICY straight_settings_read_authenticated
  ON public.straight_settings
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS straight_settings_admin_update ON public.straight_settings;
CREATE POLICY straight_settings_admin_update
  ON public.straight_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Public read: anyone can check the current mode (used by landing page)
DROP POLICY IF EXISTS straight_settings_public_read ON public.straight_settings;
CREATE POLICY straight_settings_public_read
  ON public.straight_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Admin-only: get current settings
CREATE OR REPLACE FUNCTION public.admin_get_straight_settings()
RETURNS TABLE (
  registration_mode TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT s.registration_mode, s.updated_at
  FROM public.straight_settings s
  WHERE s.id = TRUE;
END;
$$;

-- Admin-only: update registration mode
CREATE OR REPLACE FUNCTION public.admin_update_straight_settings(
  p_registration_mode TEXT
)
RETURNS public.straight_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.straight_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_registration_mode NOT IN ('signup', 'waitlist') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  UPDATE public.straight_settings
  SET
    registration_mode = p_registration_mode,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = TRUE
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    INSERT INTO public.straight_settings (
      id,
      registration_mode,
      updated_by
    )
    VALUES (
      TRUE,
      p_registration_mode,
      auth.uid()
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

-- Public read: get current registration mode (no auth required)
CREATE OR REPLACE FUNCTION public.get_straight_registration_mode()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT registration_mode INTO v_mode
  FROM public.straight_settings
  WHERE id = TRUE;

  RETURN COALESCE(v_mode, 'signup');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_straight_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_straight_settings(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_straight_registration_mode() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_straight_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_straight_settings(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_straight_registration_mode() TO anon, authenticated;
