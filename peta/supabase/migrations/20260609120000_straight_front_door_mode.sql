-- =============================================================
-- Straight Ltd — admin-controllable front door: open signup vs waitlist.
--
-- Lets the admin throttle incoming clients. When mode = 'waitlist', the public
-- landing routes its primary CTAs to /reddit/waitlist instead of /reddit/signup.
-- The mode is PUBLIC (the unauthenticated landing reads it), so anon SELECT is
-- allowed; only admins can change it (via RPC). Follows the straight_ai_settings
-- singleton pattern, but with an anon-readable policy like straight_pricing.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.straight_site_settings (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE,
  front_door_mode TEXT NOT NULL DEFAULT 'signup'
    CHECK (front_door_mode IN ('signup', 'waitlist')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id),
  CONSTRAINT straight_site_settings_singleton CHECK (id = TRUE)
);

INSERT INTO public.straight_site_settings (id, front_door_mode)
VALUES (TRUE, 'signup')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.straight_site_settings ENABLE ROW LEVEL SECURITY;

-- The front-door mode is not secret — the public landing reads it to pick its CTA.
DROP POLICY IF EXISTS straight_site_settings_read ON public.straight_site_settings;
CREATE POLICY straight_site_settings_read ON public.straight_site_settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- Writes only through the admin RPC below (no direct INSERT/UPDATE policy).

CREATE OR REPLACE FUNCTION public.admin_set_front_door_mode(p_mode TEXT)
RETURNS public.straight_site_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_row public.straight_site_settings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('signup', 'waitlist') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  UPDATE public.straight_site_settings
  SET front_door_mode = p_mode,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = TRUE
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    INSERT INTO public.straight_site_settings (id, front_door_mode, updated_by)
    VALUES (TRUE, p_mode, auth.uid())
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_front_door_mode(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_front_door_mode(TEXT) TO authenticated;
