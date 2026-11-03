-- ============================================================
-- Migration: 20261103000000_monthly_guarantee_system.sql
--
-- Features:
-- 1. Update user_credits check constraint to include 'monthly_guarantee'
-- 2. Create monthly_guarantee_config table (dynamic threshold & ref code)
-- 3. Create monthly_guarantee_history table (idempotent tracking & audit)
-- 4. RPC process_monthly_guarantee (core engine with dry-run support)
-- 5. RPC cron_trigger_monthly_guarantee (automated 1st of month 00:05 WIB)
-- 6. RPCs for Admin inspection, reporting, and config management
-- 7. Register pg_cron schedule
-- ============================================================

-- 1. Update user_credits and notifications check constraints
ALTER TABLE public.user_credits
  DROP CONSTRAINT IF EXISTS user_credits_source_check;

ALTER TABLE public.user_credits
  ADD CONSTRAINT user_credits_source_check
  CHECK (source = ANY (ARRAY[
    'referral_bonus_referrer'::text,
    'referral_bonus_referee'::text,
    'signup_bonus'::text,
    'manual_adjustment'::text,
    'karma_milestone'::text,
    'task_reward'::text,
    'task_revert'::text,
    'wa_group_verified'::text,
    'phase1_completion'::text,
    'daily_bonus_cashable'::text,
    'hold_release'::text,
    'monthly_guarantee'::text
  ]));

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'message'::text,
    'order_status'::text,
    'review'::text,
    'credit'::text,
    'payment'::text,
    'general'::text,
    'first_order_nudge'::text,
    'reengagement'::text,
    'balance_reminder'::text,
    'monthly_guarantee'::text
  ]));

-- 2. Config Table (Dynamic, not hardcoded)
CREATE TABLE IF NOT EXISTS public.monthly_guarantee_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  guarantee_amount integer NOT NULL DEFAULT 20000 CHECK (guarantee_amount >= 0),
  referral_code text NOT NULL DEFAULT 'INTERN',
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

INSERT INTO public.monthly_guarantee_config (id, guarantee_amount, referral_code, is_active)
VALUES (1, 20000, 'INTERN', true)
ON CONFLICT (id) DO UPDATE SET
  updated_at = now();

-- 3. History & Audit Table (Guarantees Strict Idempotency: 1 user per period)
CREATE TABLE IF NOT EXISTS public.monthly_guarantee_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL, -- Format: YYYY-MM (e.g. '2026-10')
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  previous_task_earnings integer NOT NULL DEFAULT 0,
  top_up_amount integer NOT NULL DEFAULT 0,
  guarantee_target integer NOT NULL DEFAULT 20000,
  status text NOT NULL CHECK (status IN ('processed', 'skipped_target_met', 'dry_run')),
  credit_id uuid REFERENCES public.user_credits(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_monthly_guarantee_period_user UNIQUE (period, user_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_guarantee_period ON public.monthly_guarantee_history(period);
CREATE INDEX IF NOT EXISTS idx_monthly_guarantee_user ON public.monthly_guarantee_history(user_id);

-- Enable RLS
ALTER TABLE public.monthly_guarantee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_guarantee_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin view monthly_guarantee_config" ON public.monthly_guarantee_config;
CREATE POLICY "Admin view monthly_guarantee_config"
  ON public.monthly_guarantee_config FOR SELECT
  USING (public.is_admin() OR public.is_admin_or_recruiter());

DROP POLICY IF EXISTS "Admin modify monthly_guarantee_config" ON public.monthly_guarantee_config;
CREATE POLICY "Admin modify monthly_guarantee_config"
  ON public.monthly_guarantee_config FOR ALL
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin view monthly_guarantee_history" ON public.monthly_guarantee_history;
CREATE POLICY "Admin view monthly_guarantee_history"
  ON public.monthly_guarantee_history FOR SELECT
  USING (public.is_admin() OR public.is_admin_or_recruiter());

DROP POLICY IF EXISTS "Users view own monthly_guarantee_history" ON public.monthly_guarantee_history;
CREATE POLICY "Users view own monthly_guarantee_history"
  ON public.monthly_guarantee_history FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Core Engine RPC: process_monthly_guarantee
CREATE OR REPLACE FUNCTION public.process_monthly_guarantee(
  p_period text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_is_cron_or_system boolean;
  v_cfg public.monthly_guarantee_config%ROWTYPE;
  v_wib_now timestamptz;
  v_target_month timestamptz;
  v_period text;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_start_naive timestamp;
  v_end_naive timestamp;
  
  v_total_eligible integer := 0;
  v_processed integer := 0;
  v_skipped_already integer := 0;
  v_recipients integer := 0;
  v_total_topup integer := 0;
  
  v_user record;
  v_user_earnings integer;
  v_topup integer;
  v_hist_id uuid;
  v_credit_id uuid;
  v_desc text;
  v_details jsonb := '[]'::jsonb;
  v_existing_id uuid;
BEGIN
  -- Permission check: Allow if caller is admin or internal system (cron/superuser)
  v_is_cron_or_system := (auth.uid() IS NULL) OR current_user IN ('postgres', 'service_role', 'supabase_admin');
  IF NOT v_is_cron_or_system THEN
    SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF v_caller_role <> 'admin' THEN
      RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Load configuration
  SELECT * INTO v_cfg FROM public.monthly_guarantee_config WHERE id = 1;
  IF v_cfg.id IS NULL THEN
    v_cfg.guarantee_amount := 20000;
    v_cfg.referral_code := 'INTERN';
    v_cfg.is_active := true;
  END IF;

  IF NOT v_cfg.is_active AND NOT p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Program Jaminan Bulanan sedang dinonaktifkan dalam konfigurasi'
    );
  END IF;

  -- Determine target period and timestamps in WIB (UTC+7)
  v_wib_now := now() AT TIME ZONE 'Asia/Jakarta';
  
  IF p_period IS NOT NULL AND trim(p_period) <> '' THEN
    v_period := trim(p_period);
    -- Calculate start and end of requested period
    v_target_month := to_date(v_period || '-01', 'YYYY-MM-DD');
    v_start_ts := v_target_month AT TIME ZONE 'Asia/Jakarta';
    v_end_ts := (v_target_month + interval '1 month') AT TIME ZONE 'Asia/Jakarta';
  ELSE
    -- Default: Previous calendar month in WIB
    v_target_month := (date_trunc('month', v_wib_now) - interval '1 month');
    v_period := to_char(v_target_month, 'YYYY-MM');
    v_start_ts := v_target_month AT TIME ZONE 'Asia/Jakarta';
    v_end_ts := date_trunc('month', v_wib_now) AT TIME ZONE 'Asia/Jakarta';
  END IF;

  -- Convert to UTC naive timestamps for matching user_credits.created_at
  v_start_naive := (v_start_ts AT TIME ZONE 'UTC');
  v_end_naive := (v_end_ts AT TIME ZONE 'UTC');

  -- Query eligible members:
  -- 1. Registered with ref = config.referral_code
  -- 2. Onboarding complete (onboarding_completed_at IS NOT NULL)
  -- 3. Status active (is_active = true)
  FOR v_user IN
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.whatsapp,
      u.onboarding_completed_at,
      u.is_active
    FROM public.users u
    WHERE u.role = 'army'
      AND u.is_active = TRUE
      AND u.onboarding_completed_at IS NOT NULL
      AND (
        u.referred_by IN (SELECT id FROM public.users WHERE UPPER(referral_code) = UPPER(v_cfg.referral_code))
        OR UPPER(COALESCE(u.acquisition_source, '')) = UPPER(v_cfg.referral_code)
        OR UPPER(COALESCE(u.acquisition_campaign, '')) = UPPER(v_cfg.referral_code)
        OR u.invitation_id IN (
          SELECT inv.id FROM public.invitations inv
          WHERE UPPER(COALESCE(inv.invitation_code, '')) = UPPER(v_cfg.referral_code)
             OR inv.recruiter_id IN (SELECT id FROM public.users WHERE UPPER(referral_code) = UPPER(v_cfg.referral_code))
             OR inv.campaign_id IN (SELECT id FROM public.invitation_campaigns WHERE UPPER(campaign_code) = UPPER(v_cfg.referral_code))
        )
      )
    ORDER BY u.created_at ASC
  LOOP
    v_total_eligible := v_total_eligible + 1;

    -- Check idempotency: If user already has processed record for this period, SKIP
    SELECT id INTO v_existing_id
    FROM public.monthly_guarantee_history
    WHERE period = v_period AND user_id = v_user.id;

    IF v_existing_id IS NOT NULL THEN
      v_skipped_already := v_skipped_already + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_user.id,
        'full_name', v_user.full_name,
        'email', v_user.email,
        'status', 'already_processed',
        'top_up_amount', 0
      );
      CONTINUE;
    END IF;

    -- Calculate total task earnings in previous calendar month from user_credits
    -- (source IN ('task_reward', 'task_revert'))
    SELECT COALESCE(SUM(amount), 0)::integer
    INTO v_user_earnings
    FROM public.user_credits
    WHERE user_id = v_user.id
      AND source IN ('task_reward', 'task_revert')
      AND created_at >= v_start_naive
      AND created_at < v_end_naive;

    -- Guarantee Logic:
    -- If earnings < target, top_up = target - earnings
    -- If earnings >= target, top_up = 0
    IF v_user_earnings < v_cfg.guarantee_amount THEN
      v_topup := v_cfg.guarantee_amount - v_user_earnings;
    ELSE
      v_topup := 0;
    END IF;

    -- Execution (if not dry-run)
    IF NOT p_dry_run THEN
      IF v_topup > 0 THEN
        v_hist_id := gen_random_uuid();
        v_credit_id := gen_random_uuid();
        
        v_desc := format(
          'Jaminan bulanan periode %s (Penghasilan: Rp%s, Top-up: Rp%s)',
          v_period,
          to_char(v_user_earnings, 'FM999G999G999'),
          to_char(v_topup, 'FM999G999G999')
        );

        -- 1. Add top_up to member credits (cashable)
        INSERT INTO public.user_credits (
          id, user_id, amount, source, description, reference_id, created_at
        ) VALUES (
          v_credit_id, v_user.id, v_topup, 'monthly_guarantee', v_desc, v_hist_id, now()
        );

        -- 2. Insert history record referencing the credit
        INSERT INTO public.monthly_guarantee_history (
          id, period, user_id, previous_task_earnings, top_up_amount,
          guarantee_target, status, credit_id
        ) VALUES (
          v_hist_id, v_period, v_user.id, v_user_earnings, v_topup,
          v_cfg.guarantee_amount, 'processed', v_credit_id
        );

        -- 3. Send notification to member
        INSERT INTO public.notifications (
          user_id, type, title, body, is_read, metadata
        ) VALUES (
          v_user.id,
          'monthly_guarantee',
          'Jaminan Bulanan Masuk 💰',
          format(
            'Saldo kamu berhasil ditambah Rp%s dari program Jaminan Bulanan periode %s (Penghasilan task bulan lalu: Rp%s). Saldo langsung dapat ditarik.',
            to_char(v_topup, 'FM999G999G999'),
            v_period,
            to_char(v_user_earnings, 'FM999G999G999')
          ),
          false,
          jsonb_build_object(
            'period', v_period,
            'top_up_amount', v_topup,
            'previous_task_earnings', v_user_earnings,
            'history_id', v_hist_id
          )
        );

        v_recipients := v_recipients + 1;
        v_total_topup := v_total_topup + v_topup;
      ELSE
        -- Target already met, record as skipped_target_met for audit
        INSERT INTO public.monthly_guarantee_history (
          period, user_id, previous_task_earnings, top_up_amount,
          guarantee_target, status
        ) VALUES (
          v_period, v_user.id, v_user_earnings, 0,
          v_cfg.guarantee_amount, 'skipped_target_met'
        );
      END IF;
    END IF;

    v_processed := v_processed + 1;

    -- Append detail
    v_details := v_details || jsonb_build_object(
      'user_id', v_user.id,
      'full_name', v_user.full_name,
      'email', v_user.email,
      'previous_task_earnings', v_user_earnings,
      'top_up_amount', v_topup,
      'status', CASE WHEN v_topup > 0 THEN 'topped_up' ELSE 'target_met' END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'period', v_period,
    'dry_run', p_dry_run,
    'guarantee_amount', v_cfg.guarantee_amount,
    'referral_code', v_cfg.referral_code,
    'summary', jsonb_build_object(
      'total_eligible_members', v_total_eligible,
      'members_processed', v_processed,
      'members_already_processed_skipped', v_skipped_already,
      'recipients_count', CASE WHEN p_dry_run THEN (SELECT count(*)::int FROM jsonb_array_elements(v_details) e WHERE (e->>'top_up_amount')::int > 0) ELSE v_recipients END,
      'total_topup_amount', CASE WHEN p_dry_run THEN (SELECT COALESCE(SUM((e->>'top_up_amount')::int), 0)::int FROM jsonb_array_elements(v_details) e) ELSE v_total_topup END
    ),
    'details', v_details
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_monthly_guarantee(text, boolean) TO authenticated, service_role;

-- 5. Automated Cron Trigger Function (Checks 1st of month 00:05 WIB window)
CREATE OR REPLACE FUNCTION public.cron_trigger_monthly_guarantee()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_wib_now timestamptz := now() AT TIME ZONE 'Asia/Jakarta';
  v_res jsonb;
BEGIN
  -- Execute only if WIB current date is the 1st of the month, and hour is 00 (00:00 - 00:59 WIB)
  IF EXTRACT(DAY FROM v_wib_now) = 1 AND EXTRACT(HOUR FROM v_wib_now) = 0 THEN
    v_res := public.process_monthly_guarantee(p_dry_run := false);
    RETURN jsonb_build_object('executed', true, 'result', v_res);
  ELSE
    RETURN jsonb_build_object('executed', false, 'reason', 'Not in execution window (1st of month 00:05 WIB)');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cron_trigger_monthly_guarantee() TO authenticated, service_role;

-- 6. Helper RPCs for Admin UI
CREATE OR REPLACE FUNCTION public.get_monthly_guarantee_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg public.monthly_guarantee_config%ROWTYPE;
BEGIN
  IF NOT (public.is_admin() OR public.is_admin_or_recruiter()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cfg FROM public.monthly_guarantee_config WHERE id = 1;
  RETURN jsonb_build_object(
    'guarantee_amount', COALESCE(v_cfg.guarantee_amount, 20000),
    'referral_code', COALESCE(v_cfg.referral_code, 'INTERN'),
    'is_active', COALESCE(v_cfg.is_active, true),
    'updated_at', v_cfg.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_monthly_guarantee_config(
  p_guarantee_amount integer,
  p_referral_code text,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_code text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = 'P0001';
  END IF;

  v_clean_code := UPPER(regexp_replace(trim(COALESCE(p_referral_code, 'INTERN')), '[^A-Za-z0-9_-]', '', 'g'));
  IF length(v_clean_code) < 2 THEN
    RAISE EXCEPTION 'Kode referral minimal 2 karakter';
  END IF;

  UPDATE public.monthly_guarantee_config
  SET
    guarantee_amount = GREATEST(p_guarantee_amount, 0),
    referral_code = v_clean_code,
    is_active = p_is_active,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'ok', true,
    'guarantee_amount', p_guarantee_amount,
    'referral_code', v_clean_code,
    'is_active', p_is_active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_guarantee_history(
  p_period text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_periods jsonb;
  v_records jsonb;
  v_summary jsonb;
BEGIN
  IF NOT (public.is_admin() OR public.is_admin_or_recruiter()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Get available periods with summary
  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_periods
  FROM (
    SELECT
      period,
      count(*)::int AS total_members,
      count(*) FILTER (WHERE top_up_amount > 0)::int AS recipients_count,
      COALESCE(SUM(top_up_amount), 0)::int AS total_cost,
      max(created_at) AS last_run_at
    FROM public.monthly_guarantee_history
    GROUP BY period
    ORDER BY period DESC
  ) p;

  -- 2. Detail records for selected period
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_records
  FROM (
    SELECT
      h.id,
      h.period,
      h.user_id,
      u.full_name,
      u.email,
      u.whatsapp,
      h.previous_task_earnings,
      h.top_up_amount,
      h.guarantee_target,
      h.status,
      h.created_at
    FROM public.monthly_guarantee_history h
    JOIN public.users u ON u.id = h.user_id
    WHERE (p_period IS NULL OR h.period = p_period)
    ORDER BY h.created_at DESC, h.top_up_amount DESC
    LIMIT 200
  ) r;

  RETURN jsonb_build_object(
    'periods', v_periods,
    'records', v_records
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_guarantee_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_monthly_guarantee_config(integer, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_guarantee_history(text) TO authenticated;

-- 7. Register pg_cron Job
-- 00:05 WIB on the 1st of the month = 17:05 UTC on days 28-31
DO $$
BEGIN
  -- Unschedule existing job if any
  PERFORM cron.unschedule('peta-monthly-guarantee')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'peta-monthly-guarantee');

  -- Schedule cron job
  PERFORM cron.schedule(
    'peta-monthly-guarantee',
    '5 17 28-31 * *',
    'SELECT public.cron_trigger_monthly_guarantee();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron job schedule warning: %', SQLERRM;
END;
$$;

NOTIFY pgrst, 'reload schema';
