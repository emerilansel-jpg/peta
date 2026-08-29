-- ============================================================
-- Straight Ltd — churn prevention system (2026-08-29)
--
-- Prepaid-credits B2B platform: churn = clients who stop
-- ordering / topping up (no subscription to cancel). This
-- migration adds a daily sweep that detects at-risk clients and
-- inserts notifications (target_role='user') — the existing
-- trg_send_email_on_notification pipeline emails them.
--
-- Segments (one email per client per sweep, priority top-down):
--   W  first_order_nudge  — signed up 2–10 days ago, 0 orders
--   R  reengagement       — had orders, none in 14–60 days
--   B  balance_reminder   — idle balance ≥ $10, no orders in 30d
--
-- Dedup: same notification type not re-sent within its window
-- (W 14d / max 2 ever, R+B 30d).
--
-- Also: admin_get_client_health() for the admin Retention page.
--
-- Idempotent: safe to re-run.
-- Apply via: supabase db query --linked --file <this file>
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_straight_churn_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  r record;
  v_sent_w int := 0;
  v_sent_r int := 0;
  v_sent_b int := 0;
  v_type text;
  v_title text;
  v_body text;
  v_link text;
  v_first_name text;
BEGIN
  FOR r IN
    SELECT
      u.id,
      u.full_name,
      u.credit_balance,
      u.created_at,
      au.last_sign_in_at,
      COALESCE(st.total_orders, 0) AS total_orders,
      st.last_order_at
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total_orders, max(o.created_at) AS last_order_at
      FROM public.reddit_upvote_orders o WHERE o.user_id = u.id
    ) st ON true
    WHERE u.role = 'client'
      AND u.is_active
      AND u.email IS NOT NULL
  LOOP
    v_type := NULL;
    v_title := NULL;
    v_body := NULL;
    v_link := '/reddit/new-order';
    v_first_name := COALESCE(NULLIF(trim(split_part(COALESCE(r.full_name, ''), ' ', 1)), ''), 'there');

    IF r.total_orders = 0
       AND r.created_at >= NOW() - INTERVAL '10 days'
       AND r.created_at <= NOW() - INTERVAL '2 days' THEN
      -- W: activation nudge
      IF (SELECT count(*) FROM public.notifications
          WHERE user_id = r.id AND type = 'first_order_nudge') < 2
         AND NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_id = r.id AND type = 'first_order_nudge'
            AND created_at > NOW() - INTERVAL '14 days') THEN
        v_type := 'first_order_nudge';
        v_title := 'Ready to grow? Create your first order';
        v_body := 'Hi ' || v_first_name || ', your Straight Ltd account is set up and waiting. ' ||
                  'Top up with PayPal, paste your link, and delivery usually starts within hours. ' ||
                  'Need a hand? Just reply to this email — a real person reads it.';
      END IF;
    ELSIF r.total_orders > 0
       AND r.last_order_at < NOW() - INTERVAL '14 days'
       AND r.last_order_at > NOW() - INTERVAL '60 days' THEN
      -- R: re-engagement
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = r.id AND type = 'reengagement'
          AND created_at > NOW() - INTERVAL '30 days') THEN
        v_type := 'reengagement';
        v_title := 'It''s been a while — your dashboard is ready';
        v_body := 'Hi ' || v_first_name || ', no orders from you in a few weeks. ' ||
                  'You can now order Reddit upvotes, forum comments, and YouTube video uploads ' ||
                  'from one dashboard. Anything you want to rank or get seen? It takes about 2 minutes to order.';
        v_link := '/reddit/new-order';
      END IF;
    ELSIF COALESCE(r.credit_balance, 0) >= 1000
       AND (r.total_orders = 0 OR r.last_order_at < NOW() - INTERVAL '30 days') THEN
      -- B: idle balance reminder
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = r.id AND type = 'balance_reminder'
          AND created_at > NOW() - INTERVAL '30 days') THEN
        v_type := 'balance_reminder';
        v_title := 'You have $' || to_char(round(COALESCE(r.credit_balance, 0) / 100.0, 2), 'FM999999990.00') || ' in credits waiting';
        v_body := 'Hi ' || v_first_name || ', your Straight Ltd balance is ready to use — credits never expire. ' ||
                  'Create an order any time and we start delivering right away.';
        v_link := '/reddit/new-order';
      END IF;
    END IF;

    IF v_type IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, target_role, is_read)
      VALUES (r.id, v_type, v_title, v_body, v_link, 'user', false);
      IF v_type = 'first_order_nudge' THEN v_sent_w := v_sent_w + 1;
      ELSIF v_type = 'reengagement' THEN v_sent_r := v_sent_r + 1;
      ELSE v_sent_b := v_sent_b + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'first_order_nudges', v_sent_w,
    'reengagements', v_sent_r,
    'balance_reminders', v_sent_b,
    'ran_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_straight_churn_sweep() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Allow the new churn notification types (prod has a CHECK constraint).
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'message', 'order_status', 'review', 'credit', 'payment', 'general',
    'first_order_nudge', 'reengagement', 'balance_reminder'
  ]::text[]));

-- Admin wrapper for manual runs (cron calls the function directly as owner).
CREATE OR REPLACE FUNCTION public.admin_run_churn_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.fn_straight_churn_sweep();
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_run_churn_sweep() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_run_churn_sweep() FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- Daily cron at 02:23 UTC (09:23 WIB)
-- ------------------------------------------------------------
DO $churn$
BEGIN
  BEGIN
    PERFORM cron.unschedule('straight-churn-sweep');
  EXCEPTION WHEN others THEN NULL;
  END;
  PERFORM cron.schedule(
    'straight-churn-sweep',
    '23 2 * * *',
    $$SELECT public.fn_straight_churn_sweep()$$
  );
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'pg_cron not available — schedule the sweep manually';
END $churn$;

-- ------------------------------------------------------------
-- Admin: client health overview (Retention page)
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
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
  FROM per_user pu
$$;

REVOKE ALL ON FUNCTION public.admin_get_client_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_client_health() TO authenticated;

NOTIFY pgrst, 'reload schema';
