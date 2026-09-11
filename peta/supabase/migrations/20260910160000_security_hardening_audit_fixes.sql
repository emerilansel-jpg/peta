-- Migration: 20260910160000_security_hardening_audit_fixes.sql
-- Security hardening fixes:
-- 1. Guard public.users column protection (prevent non-admin self-elevation to admin or balance inflation)
-- 2. Fix reset_user_password_with_token parameter type from UUID to TEXT
-- 3. Restrict admin_get_client_health to is_admin()
-- 4. Restrict list_reddit_army_sync_targets to is_admin() or service_role
-- 5. Enable RLS and restrict access on referral_clicks

BEGIN;

-- ------------------------------------------------------------
-- 1. Guard public.users column protection
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_users_column_protection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Admin or internal service_role can perform any update (including manual admin credit adjustments)
  IF public.is_admin() OR auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Non-admin users cannot change their role
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'unauthorized: role cannot be modified directly' USING ERRCODE = '42501';
  END IF;

  -- Non-admin users cannot change their active status
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'unauthorized: is_active cannot be modified directly' USING ERRCODE = '42501';
  END IF;

  -- Non-admin users cannot directly alter their credit_balance
  -- (Balance updates must occur via transactions/triggers or admin adjustments)
  IF NEW.credit_balance IS DISTINCT FROM OLD.credit_balance THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions ct
      WHERE ct.user_id = NEW.id AND ct.balance_after = NEW.credit_balance
        AND ct.created_at >= NOW() - INTERVAL '1 minute'
    ) THEN
      RAISE EXCEPTION 'unauthorized: credit_balance cannot be modified directly' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_users_column_protection ON public.users;
CREATE TRIGGER trg_guard_users_column_protection
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_column_protection();

-- ------------------------------------------------------------
-- 2. Fix reset_user_password_with_token: parameter type TEXT
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reset_user_password_with_token(UUID, TEXT);
DROP FUNCTION IF EXISTS public.reset_user_password_with_token(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.reset_user_password_with_token(
  p_token TEXT,
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
  IF p_token IS NULL OR length(trim(p_token)) = 0 OR p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Password minimal 6 karakter');
  END IF;

  -- Find and lock valid, unused token matching string token from email/WhatsApp
  SELECT * INTO v_token_record
  FROM public.password_reset_tokens
  WHERE token = trim(p_token)
    AND used_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reset link is invalid or has expired');
  END IF;

  v_user_id := v_token_record.user_id;

  -- Update password in auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = NOW()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;

  -- Mark token as used
  UPDATE public.password_reset_tokens
  SET used_at = NOW()
  WHERE id = v_token_record.id;

  RETURN jsonb_build_object('ok', true, 'message', 'Password successfully updated');
END;
$$;

REVOKE ALL ON FUNCTION public.reset_user_password_with_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_user_password_with_token(TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Restrict admin_get_client_health to is_admin()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_client_health()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  credit_balance int,
  total_orders int,
  completed_orders int,
  lifetime_spent_cents bigint,
  last_order_at timestamptz,
  days_since_last_order int,
  last_sign_in_at timestamptz,
  segment text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH per_user AS (
    SELECT
      u.id,
      u.email,
      u.full_name,
      COALESCE(u.credit_balance, 0) AS credit_balance,
      u.created_at,
      au.last_sign_in_at,
      COALESCE(st.total_orders, 0) AS total_orders,
      COALESCE(st.completed_orders, 0) AS completed_orders,
      st.last_order_at,
      COALESCE(sp.spent, 0) AS lifetime_spent_cents
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total_orders,
             count(*) FILTER (WHERE o.status = 'completed')::int AS completed_orders,
             max(o.created_at) AS last_order_at
      FROM public.reddit_upvote_orders o WHERE o.user_id = u.id
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(-sum(ct.amount), 0)::bigint AS spent
      FROM public.credit_transactions ct
      WHERE ct.user_id = u.id AND ct.type = 'spend'
    ) sp ON true
    WHERE u.role = 'client'
  )
  SELECT
    pu.id,
    pu.email,
    pu.full_name,
    pu.credit_balance,
    pu.total_orders,
    pu.completed_orders,
    pu.lifetime_spent_cents,
    pu.last_order_at,
    CASE WHEN pu.last_order_at IS NOT NULL
      THEN EXTRACT(DAY FROM NOW() - pu.last_order_at)::int
      ELSE NULL END,
    pu.last_sign_in_at,
    CASE
      WHEN pu.total_orders = 0 AND pu.created_at >= NOW() - INTERVAL '14 days' THEN 'new'
      WHEN pu.total_orders = 0 THEN 'never_activated'
      WHEN pu.last_order_at >= NOW() - INTERVAL '14 days' THEN 'active'
      WHEN pu.last_order_at >= NOW() - INTERVAL '30 days' THEN 'cooling'
      WHEN pu.last_order_at >= NOW() - INTERVAL '60 days' THEN 'at_risk'
      ELSE 'dormant'
    END
  FROM per_user pu;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_client_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_client_health() TO authenticated;

-- ------------------------------------------------------------
-- 4. Restrict list_reddit_army_sync_targets to is_admin() or service_role
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_reddit_army_sync_targets(
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  username text,
  reddit_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    rap.user_id,
    ra.username,
    rap.warmed_account_id AS reddit_account_id
  FROM public.reddit_army_profiles rap
  JOIN public.reddit_accounts ra ON ra.id = rap.warmed_account_id
  WHERE rap.program_status IN ('phase2_active','resigning')
    AND rap.warmed_account_id IS NOT NULL
    AND (p_user_ids IS NULL OR rap.user_id = ANY(p_user_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.list_reddit_army_sync_targets(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_reddit_army_sync_targets(uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Enable RLS and restrict access on referral_clicks
-- ------------------------------------------------------------
ALTER TABLE public.referral_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_clicks_admin_all" ON public.referral_clicks;
CREATE POLICY "referral_clicks_admin_all" ON public.referral_clicks
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "referral_clicks_owner_select" ON public.referral_clicks;
CREATE POLICY "referral_clicks_owner_select" ON public.referral_clicks
  FOR SELECT TO authenticated
  USING (referrer_user_id = auth.uid());

COMMIT;
NOTIFY pgrst, 'reload schema';
