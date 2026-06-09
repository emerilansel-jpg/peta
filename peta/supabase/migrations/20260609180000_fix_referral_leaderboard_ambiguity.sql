-- =============================================================
-- Fix admin_get_referral_leaderboard — it errored on EVERY call.
--
-- The RETURNS TABLE OUT column `user_id` collided with `user_credits.user_id`
-- in the LATERAL subquery's `WHERE user_id = u.id`, raising 42702 (ambiguous
-- column reference / could refer to a PL/pgSQL variable or a table column).
-- Fix: alias the LATERAL subquery tables (rc/ru/uc) and qualify every column,
-- and ::text-cast the text return columns (varchar->text in RETURNS TABLE).
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_get_referral_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE(user_id uuid, email text, full_name text, ref_code text, total_clicks integer, unique_clicks integer, signups integer, total_earned integer, conversion_rate numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, u.full_name::text, u.referral_code::text,
    COALESCE(c.total_clicks, 0)::int, COALESCE(c.unique_clicks, 0)::int,
    COALESCE(s.signups, 0)::int, COALESCE(p.total_earned, 0)::int,
    CASE WHEN COALESCE(c.unique_clicks, 0) > 0 THEN round((COALESCE(s.signups, 0)::numeric / c.unique_clicks) * 100, 1) ELSE 0 END
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS total_clicks, COUNT(DISTINCT rc.visitor_session)::int AS unique_clicks
    FROM public.referral_clicks rc WHERE rc.referrer_user_id = u.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS signups FROM public.users ru WHERE ru.referred_by = u.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(uc.amount), 0)::int AS total_earned
    FROM public.user_credits uc WHERE uc.user_id = u.id AND uc.source = 'referral_bonus_referrer'
  ) p ON true
  WHERE u.role = 'army'
  ORDER BY COALESCE(s.signups, 0) DESC, COALESCE(c.unique_clicks, 0) DESC
  LIMIT p_limit;
END $$;
