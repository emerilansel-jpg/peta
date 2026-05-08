-- =============================================================
-- Referral click tracking + analytics. Lets PeTa Army see
-- clicks / signups / conversion-rate on their referral link
-- and motivates them to keep sharing.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.referral_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code text NOT NULL,
  referrer_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  visitor_session text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referral_clicks_ref_idx
  ON public.referral_clicks (ref_code);
CREATE INDEX IF NOT EXISTS referral_clicks_owner_idx
  ON public.referral_clicks (referrer_user_id);
CREATE INDEX IF NOT EXISTS referral_clicks_session_idx
  ON public.referral_clicks (ref_code, visitor_session);

-- Anon-callable: log a click on a referral link. Dedup is enforced
-- per (ref_code, visitor_session) tuple so a user reloading their
-- own preview doesn't inflate the counter.
CREATE OR REPLACE FUNCTION public.track_referral_click(
  p_ref_code text,
  p_session text,
  p_user_agent text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_existing uuid;
  v_inserted public.referral_clicks;
BEGIN
  IF p_ref_code IS NULL OR length(p_ref_code) < 4 OR length(p_ref_code) > 32 THEN
    RAISE EXCEPTION 'invalid ref_code';
  END IF;

  SELECT id INTO v_owner FROM public.users WHERE referral_code = lower(p_ref_code) LIMIT 1;
  IF v_owner IS NULL THEN
    RETURN json_build_object('tracked', false, 'reason', 'unknown_code');
  END IF;

  IF p_session IS NOT NULL AND length(p_session) > 0 THEN
    SELECT id INTO v_existing FROM public.referral_clicks
    WHERE ref_code = lower(p_ref_code) AND visitor_session = p_session
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN json_build_object('tracked', false, 'reason', 'dup_session');
    END IF;
  END IF;

  INSERT INTO public.referral_clicks (ref_code, referrer_user_id, visitor_session, user_agent)
  VALUES (lower(p_ref_code), v_owner, NULLIF(p_session, ''), NULLIF(p_user_agent, ''))
  RETURNING * INTO v_inserted;

  RETURN json_build_object('tracked', true, 'click_id', v_inserted.id);
END $$;

GRANT EXECUTE ON FUNCTION public.track_referral_click(text, text, text) TO anon, authenticated;

-- User-callable analytics: clicks + signups + conversion rate
-- for the calling user's referral code (admin can query anyone).
CREATE OR REPLACE FUNCTION public.get_referral_analytics(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_clicks int;
  v_unique_clicks int;
  v_signups int;
  v_paid int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF auth.uid() <> p_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*)::int INTO v_total_clicks
  FROM public.referral_clicks WHERE referrer_user_id = p_user_id;

  SELECT COUNT(DISTINCT visitor_session)::int INTO v_unique_clicks
  FROM public.referral_clicks
  WHERE referrer_user_id = p_user_id AND visitor_session IS NOT NULL;

  SELECT COUNT(*)::int INTO v_signups
  FROM public.users WHERE referred_by = p_user_id;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_paid
  FROM public.user_credits
  WHERE user_id = p_user_id AND source = 'referral_bonus_referrer';

  RETURN json_build_object(
    'totalClicks', v_total_clicks,
    'uniqueClicks', v_unique_clicks,
    'signups', v_signups,
    'totalEarned', v_paid,
    'conversionRate', CASE
      WHEN v_unique_clicks > 0 THEN round((v_signups::numeric / v_unique_clicks) * 100, 1)
      ELSE 0
    END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_referral_analytics(uuid) TO authenticated;

-- Admin-only leaderboard: top N referrers by signups
CREATE OR REPLACE FUNCTION public.admin_get_referral_leaderboard(p_limit int DEFAULT 20)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  ref_code text,
  total_clicks int,
  unique_clicks int,
  signups int,
  total_earned int,
  conversion_rate numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.referral_code,
    COALESCE(c.total_clicks, 0)::int,
    COALESCE(c.unique_clicks, 0)::int,
    COALESCE(s.signups, 0)::int,
    COALESCE(p.total_earned, 0)::int,
    CASE
      WHEN COALESCE(c.unique_clicks, 0) > 0
      THEN round((COALESCE(s.signups, 0)::numeric / c.unique_clicks) * 100, 1)
      ELSE 0
    END
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS total_clicks,
           COUNT(DISTINCT visitor_session)::int AS unique_clicks
    FROM public.referral_clicks WHERE referrer_user_id = u.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS signups
    FROM public.users WHERE referred_by = u.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0)::int AS total_earned
    FROM public.user_credits
    WHERE user_id = u.id AND source = 'referral_bonus_referrer'
  ) p ON true
  WHERE u.role = 'army'
  ORDER BY COALESCE(s.signups, 0) DESC, COALESCE(c.unique_clicks, 0) DESC
  LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_referral_leaderboard(int) TO authenticated;
