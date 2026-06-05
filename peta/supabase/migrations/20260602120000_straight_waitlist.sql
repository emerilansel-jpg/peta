-- =============================================================
-- Straight Ltd — Forum Mentions / GEO product waitlist.
-- Front-door interest capture for the new "get mentioned where
-- Google + AI look" offering. Public (anon) can join via a
-- SECURITY DEFINER RPC; only admins can read the list.
--
-- Privacy: this lives in the shared DB but is a Straight-side
-- feature. No PeTa army exposure. Writes go through the RPC only
-- (no direct INSERT policy), matching the track_referral_click /
-- onboarding-bonus security pattern.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.waitlist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  seed_keyword text,
  brand        text,
  website      text,
  notes        text,
  source       text NOT NULL DEFAULT 'straight_forum_mentions',
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'invited', 'converted', 'declined')),
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per email (case-insensitive). Lets the RPC dedup cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_uniq
  ON public.waitlist (lower(email));
CREATE INDEX IF NOT EXISTS waitlist_created_idx
  ON public.waitlist (created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Admins can read the list (for a future admin view). No INSERT/UPDATE
-- policy on purpose: all writes go through join_waitlist() (SECURITY
-- DEFINER) or service_role. is_admin() is SECURITY DEFINER so no recursion.
DROP POLICY IF EXISTS waitlist_admin_select ON public.waitlist;
CREATE POLICY waitlist_admin_select ON public.waitlist
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS waitlist_admin_update ON public.waitlist;
CREATE POLICY waitlist_admin_update ON public.waitlist
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Anon-callable: join the waitlist. Validates + normalizes email,
-- dedups per email, truncates free-text inputs to sane lengths.
CREATE OR REPLACE FUNCTION public.join_waitlist(
  p_email        text,
  p_seed_keyword text DEFAULT NULL,
  p_brand        text DEFAULT NULL,
  p_website      text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid;
BEGIN
  IF v_email = '' OR length(v_email) > 200
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  SELECT id INTO v_id FROM public.waitlist WHERE lower(email) = v_email LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN json_build_object('joined', false, 'reason', 'already_on_list');
  END IF;

  INSERT INTO public.waitlist (email, seed_keyword, brand, website, notes, user_agent)
  VALUES (
    v_email,
    NULLIF(left(trim(coalesce(p_seed_keyword, '')), 200), ''),
    NULLIF(left(trim(coalesce(p_brand, '')), 200), ''),
    NULLIF(left(trim(coalesce(p_website, '')), 300), ''),
    NULLIF(left(trim(coalesce(p_notes, '')), 2000), ''),
    NULLIF(left(coalesce(p_user_agent, ''), 500), '')
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('joined', true, 'id', v_id);
END $$;

GRANT EXECUTE ON FUNCTION public.join_waitlist(text, text, text, text, text, text)
  TO anon, authenticated;
