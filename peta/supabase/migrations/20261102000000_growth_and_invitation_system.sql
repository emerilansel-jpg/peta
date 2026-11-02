-- ============================================================
-- Migration: 20261102000000_growth_and_invitation_system.sql
--
-- PeTa Growth & User Performance Management System:
--   1. User acquisition categorization (legacy, invitation, organic)
--   2. Safe backfill for all existing users as 'legacy'
--   3. Invitation campaigns & individual invitation tracking with unique IDs
--   4. Global user login logs & activity tracking
--   5. Real-time task activity triggers & status synchronization
--   6. Follow-up queue management for recruiters & admins
--   7. Analytical RPCs for overview, funnel, recruiter, and cohort retention
-- ============================================================

-- 1. Allow 'recruiter' in users role check constraint
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['army'::text, 'admin'::text, 'client'::text, 'hero_army'::text, 'recruiter'::text]));

-- Helper function: is_admin_or_recruiter
CREATE OR REPLACE FUNCTION public.is_admin_or_recruiter()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT current_user IN ('postgres', 'service_role', 'supabase_admin') OR EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin', 'recruiter')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_or_recruiter() TO authenticated;

-- 2. Create Campaign Management table
CREATE TABLE IF NOT EXISTS public.invitation_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_code text UNIQUE NOT NULL,
  campaign_name text NOT NULL,
  description text,
  target_audience text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_recruiter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.invitation_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_recruiter ON public.invitation_campaigns(assigned_recruiter_id);

-- Sequence for unique Invitation ID: INV-YYYY-XXXXXX
CREATE SEQUENCE IF NOT EXISTS public.invitation_code_seq START WITH 1;

-- 3. Create Invitations table
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_code text UNIQUE NOT NULL,
  campaign_id uuid REFERENCES public.invitation_campaigns(id) ON DELETE SET NULL,
  recruiter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  source text,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email', 'telegram', 'linkedin', 'direct', 'other')),
  secure_token text UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  sent_at timestamptz,
  clicked_at timestamptz,
  click_count integer NOT NULL DEFAULT 0,
  registered_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  registered_at timestamptz,
  first_login_at timestamptz,
  first_task_submitted_at timestamptz,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'sent', 'clicked', 'registered', 'first_login', 'first_task_submitted', 'active', 'inactive', 'declined', 'expired')),
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON public.invitations(invitation_code);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(secure_token);
CREATE INDEX IF NOT EXISTS idx_invitations_campaign ON public.invitations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_invitations_recruiter ON public.invitations(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_invitations_registered_user ON public.invitations(registered_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.invitations(status);

-- 4. Add Acquisition & Performance tracking fields to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS acquisition_type text NOT NULL DEFAULT 'organic' CHECK (acquisition_type IN ('legacy', 'invitation', 'organic')),
  ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES public.invitations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.invitation_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recruiter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_task_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_task_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_acquisition_type ON public.users(acquisition_type);
CREATE INDEX IF NOT EXISTS idx_users_invitation ON public.users(invitation_id);
CREATE INDEX IF NOT EXISTS idx_users_campaign ON public.users(campaign_id);
CREATE INDEX IF NOT EXISTS idx_users_recruiter ON public.users(recruiter_id);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON public.users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_last_task ON public.users(last_task_activity_at);

-- SAFE BACKFILL: Set all existing users to 'legacy'
UPDATE public.users
SET acquisition_type = 'legacy'
WHERE acquisition_type IS NULL OR acquisition_type = 'organic';

-- Backfill login timestamps from auth.users
UPDATE public.users u
SET first_login_at = au.created_at,
    last_login_at = COALESCE(au.last_sign_in_at, au.created_at)
FROM auth.users au
WHERE u.id = au.id
  AND u.last_login_at IS NULL;

-- Backfill task timestamps from public.task_assignments
WITH task_agg AS (
  SELECT
    user_id,
    min(created_at) AS first_task_at,
    max(COALESCE(submitted_at, updated_at)) AS last_task_at
  FROM public.task_assignments
  WHERE user_id IS NOT NULL
  GROUP BY user_id
)
UPDATE public.users u
SET first_task_submitted_at = COALESCE(u.first_task_submitted_at, t.first_task_at),
    last_task_activity_at = COALESCE(u.last_task_activity_at, t.last_task_at)
FROM task_agg t
WHERE u.id = t.user_id;

-- 5. User Login Logs table
CREATE TABLE IF NOT EXISTS public.user_login_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id text,
  login_method text NOT NULL DEFAULT 'password',
  device_type text,
  browser text,
  operating_system text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_date ON public.user_login_logs(user_id, created_at DESC);

-- 6. Task Activity Logs table
CREATE TABLE IF NOT EXISTS public.task_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES public.task_assignments(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('task_viewed', 'task_started', 'task_submitted', 'task_approved', 'task_rejected', 'task_expired', 'task_cancelled', 'reward_credited')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_act_user_date ON public.task_activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_act_event ON public.task_activity_logs(event_type);

-- 7. Follow-up Queue table
CREATE TABLE IF NOT EXISTS public.invitation_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES public.invitations(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('not_started', 'logged_in_no_task', 'at_risk', 'inactive', 'new_registration', 'custom')),
  followup_status text NOT NULL DEFAULT 'pending' CHECK (followup_status IN ('pending', 'contacted', 'resolved', 'ignored')),
  notes text,
  contacted_at timestamptz,
  next_followup_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_assigned ON public.invitation_followups(assigned_to, followup_status);
CREATE INDEX IF NOT EXISTS idx_followup_user ON public.invitation_followups(user_id);
CREATE INDEX IF NOT EXISTS idx_followup_status ON public.invitation_followups(followup_status);

-- 8. Trigger on Task Assignments for real-time user activity synchronization
CREATE OR REPLACE FUNCTION public.tg_record_task_activity_and_sync_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_event text;
BEGIN
  v_user_id := COALESCE(NEW.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = NEW.reddit_account_id));
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_event := 'task_started';
  ELSIF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    v_event := 'task_submitted';
  ELSIF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    v_event := 'task_approved';
  ELSIF NEW.status = 'rejected' AND (OLD.status IS DISTINCT FROM 'rejected') THEN
    IF NEW.admin_notes ILIKE 'Auto-cancelled:%' THEN
      v_event := 'task_expired';
    ELSE
      v_event := 'task_rejected';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Record event in task_activity_logs
  INSERT INTO public.task_activity_logs (user_id, task_id, assignment_id, event_type, metadata)
  VALUES (
    v_user_id,
    NEW.task_id,
    NEW.id,
    v_event,
    jsonb_build_object('status', NEW.status, 'notes', NEW.admin_notes)
  );

  -- Synchronize user timestamps
  UPDATE public.users
  SET last_task_activity_at = now(),
      first_task_submitted_at = CASE
        WHEN v_event = 'task_submitted' AND first_task_submitted_at IS NULL THEN now()
        ELSE first_task_submitted_at
      END
  WHERE id = v_user_id;

  -- Synchronize invitation record if user was invited
  UPDATE public.invitations
  SET first_task_submitted_at = COALESCE(first_task_submitted_at, CASE WHEN v_event = 'task_submitted' THEN now() ELSE NULL END),
      status = CASE
        WHEN v_event = 'task_submitted' AND status IN ('registered', 'first_login') THEN 'first_task_submitted'
        ELSE status
      END,
      updated_at = now()
  WHERE registered_user_id = v_user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_task_activity_and_sync_user ON public.task_assignments;
CREATE TRIGGER trg_record_task_activity_and_sync_user
AFTER INSERT OR UPDATE OF status ON public.task_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_record_task_activity_and_sync_user();

-- 9. Updated handle_new_user to handle invitation attribution
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product       TEXT;
  v_role          TEXT;
  v_full_name     TEXT;
  v_role_title    TEXT;
  v_website       TEXT;
  v_referrer_code TEXT;
  v_referrer_id   UUID;
  v_whatsapp      TEXT;
  v_existing_owner UUID;
  v_masked_email  TEXT;
  v_inv_token     TEXT;
  v_inv_record    public.invitations%ROWTYPE;
  v_acq_type      TEXT := 'organic';
  v_inv_id        UUID := NULL;
  v_camp_id       UUID := NULL;
  v_recruiter_id  UUID := NULL;
BEGIN
  -- Common metadata extraction
  v_product    := COALESCE(NULLIF(LOWER(NEW.raw_user_meta_data->>'product'), ''), 'peta');
  v_full_name  := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1));
  v_role_title := NULLIF(NEW.raw_user_meta_data->>'role_title', '');
  v_website    := NULLIF(NEW.raw_user_meta_data->>'website', '');
  v_referrer_code := NULLIF(LOWER(NEW.raw_user_meta_data->>'referral_code'), '');
  v_whatsapp   := NULLIF(NEW.raw_user_meta_data->>'whatsapp', '');
  v_inv_token  := NULLIF(trim(NEW.raw_user_meta_data->>'invitation_token'), '');

  -- Role: Straight clients get 'client', everyone else defaults to 'army'.
  IF v_product = 'straight' THEN
    v_role := 'client';
  ELSE
    v_role := 'army';
  END IF;

  -- Pre-check WhatsApp uniqueness
  IF v_whatsapp IS NOT NULL THEN
    SELECT id INTO v_existing_owner FROM public.users WHERE whatsapp = v_whatsapp LIMIT 1;
    IF v_existing_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Nomor WhatsApp ini sudah terdaftar di akun PeTa lain. Pakai nomor lain atau login dengan akun yang sudah ada.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Check Referral Code if provided
  IF v_referrer_code IS NOT NULL THEN
    SELECT id INTO v_referrer_id FROM public.users WHERE referral_code = v_referrer_code LIMIT 1;
  END IF;

  -- Validate Invitation Token
  IF v_inv_token IS NOT NULL THEN
    SELECT * INTO v_inv_record
    FROM public.invitations
    WHERE secure_token = v_inv_token
      AND status NOT IN ('declined', 'expired')
    LIMIT 1;

    IF v_inv_record.id IS NOT NULL THEN
      v_acq_type := 'invitation';
      v_inv_id := v_inv_record.id;
      v_camp_id := v_inv_record.campaign_id;
      v_recruiter_id := v_inv_record.recruiter_id;
    END IF;
  END IF;

  INSERT INTO public.users (
    id, email, full_name, whatsapp, role, referred_by,
    role_title, website,
    acquisition_source, acquisition_medium, acquisition_campaign,
    acquisition_content, acquisition_term, acquisition_landing_path,
    reactivation_opt_in,
    acquisition_type, invitation_id, campaign_id, recruiter_id,
    first_login_at, last_login_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_whatsapp,
    v_role,
    v_referrer_id,
    v_role_title,
    v_website,
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_source'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_medium'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_campaign'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_content'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_term'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_landing_path'), ''),
    COALESCE((NEW.raw_user_meta_data->>'reactivation_opt_in')::boolean, false),
    v_acq_type,
    v_inv_id,
    v_camp_id,
    v_recruiter_id,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    last_login_at = now();

  -- Update Invitation status if attributed
  IF v_inv_id IS NOT NULL THEN
    UPDATE public.invitations
    SET registered_user_id = NEW.id,
        registered_at = now(),
        first_login_at = now(),
        status = 'registered',
        updated_at = now()
    WHERE id = v_inv_id;
  END IF;

  -- Record initial login log
  INSERT INTO public.user_login_logs (user_id, login_method, device_type, user_agent)
  VALUES (
    NEW.id,
    'signup',
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'device_type', ''), 'unknown'),
    NULLIF(NEW.raw_user_meta_data->>'user_agent', '')
  );

  -- Award referral bonus if referral code was used
  IF v_referrer_id IS NOT NULL THEN
    v_masked_email := LEFT(split_part(NEW.email, '@', 1), 3) || '***@' || split_part(NEW.email, '@', 2);
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || v_masked_email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- 10. RPC: record_user_login (called upon successful client-side login)
CREATE OR REPLACE FUNCTION public.record_user_login(
  p_device_type text DEFAULT 'desktop',
  p_browser text DEFAULT NULL,
  p_os text DEFAULT NULL,
  p_method text DEFAULT 'password',
  p_ip text DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_login_logs (
    user_id, session_id, login_method, device_type, browser, operating_system, ip_address
  )
  VALUES (
    v_uid, p_session_id, p_method, p_device_type, p_browser, p_os, p_ip
  );

  UPDATE public.users
  SET last_login_at = now(),
      first_login_at = COALESCE(first_login_at, now())
  WHERE id = v_uid;

  UPDATE public.invitations
  SET first_login_at = COALESCE(first_login_at, now()),
      status = CASE
        WHEN status = 'registered' THEN 'first_login'
        ELSE status
      END,
      updated_at = now()
  WHERE registered_user_id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_login(text, text, text, text, text, text) TO authenticated;

-- 11. RPC: track_invitation_click (called when a guest visits /register?ref=TOKEN)
CREATE OR REPLACE FUNCTION public.track_invitation_click(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_campaign_name text;
  v_recruiter_name text;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token kosong');
  END IF;

  SELECT * INTO v_inv
  FROM public.invitations
  WHERE secure_token = trim(p_token);

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invitation tidak ditemukan');
  END IF;

  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    UPDATE public.invitations SET status = 'expired', updated_at = now() WHERE id = v_inv.id;
    RETURN jsonb_build_object('valid', false, 'error', 'Invitation sudah kedaluwarsa');
  END IF;

  IF v_inv.status = 'declined' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invitation sudah ditutup');
  END IF;

  -- Increment click count and track clicked_at
  UPDATE public.invitations
  SET click_count = click_count + 1,
      clicked_at = COALESCE(clicked_at, now()),
      status = CASE
        WHEN status IN ('created', 'sent') THEN 'clicked'
        ELSE status
      END,
      updated_at = now()
  WHERE id = v_inv.id;

  SELECT campaign_name INTO v_campaign_name
  FROM public.invitation_campaigns WHERE id = v_inv.campaign_id;

  SELECT full_name INTO v_recruiter_name
  FROM public.users WHERE id = v_inv.recruiter_id;

  RETURN jsonb_build_object(
    'valid', true,
    'invitation_id', v_inv.id,
    'invitation_code', v_inv.invitation_code,
    'full_name', v_inv.full_name,
    'email', v_inv.email,
    'phone', v_inv.phone,
    'campaign_name', v_campaign_name,
    'recruiter_name', v_recruiter_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_invitation_click(text) TO anon, authenticated;

-- 12. RPC: admin_create_invitation
CREATE OR REPLACE FUNCTION public.admin_create_invitation(
  p_full_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_recruiter_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'whatsapp',
  p_source text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_expires_in_days integer DEFAULT 30
)
RETURNS public.invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_token text;
  v_res public.invitations;
  v_seq_val bigint;
  v_recruiter_target uuid;
BEGIN
  IF NOT public.is_admin_or_recruiter() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Default recruiter to creator if not provided
  v_recruiter_target := COALESCE(p_recruiter_id, v_uid);

  -- Generate unique code: INV-2026-000001
  SELECT nextval('public.invitation_code_seq') INTO v_seq_val;
  v_code := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq_val::text, 6, '0');
  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.invitations (
    invitation_code, campaign_id, recruiter_id, created_by,
    full_name, email, phone, source, channel,
    secure_token, expires_at, internal_notes, status
  )
  VALUES (
    v_code, p_campaign_id, v_recruiter_target, v_uid,
    trim(p_full_name), NULLIF(trim(p_email), ''), NULLIF(trim(p_phone), ''),
    p_source, p_channel,
    v_token, (now() + (p_expires_in_days || ' days')::interval), p_notes, 'created'
  )
  RETURNING * INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_invitation(text, text, text, uuid, uuid, text, text, text, integer) TO authenticated;

-- 13. Analytical RPC: get_growth_overview
CREATE OR REPLACE FUNCTION public.get_growth_overview(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_recruiter_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_res jsonb;
  v_total_users int;
  v_legacy_users int;
  v_invitation_users int;
  v_organic_users int;
  v_active_users int;
  v_at_risk_users int;
  v_inactive_users int;
  v_never_logged_in int;
  v_never_submitted_task int;
  v_inv_created int;
  v_inv_sent int;
  v_inv_clicked int;
  v_inv_registered int;
  v_inv_first_task int;
  v_inv_active int;
  v_inv_inactive int;
BEGIN
  IF NOT public.is_admin_or_recruiter() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Global user stats
  SELECT
    count(*),
    count(*) FILTER (WHERE acquisition_type = 'legacy'),
    count(*) FILTER (WHERE acquisition_type = 'invitation'),
    count(*) FILTER (WHERE acquisition_type = 'organic'),
    count(*) FILTER (WHERE last_task_activity_at >= (v_now - interval '3 days')),
    count(*) FILTER (WHERE last_task_activity_at < (v_now - interval '3 days') AND last_task_activity_at >= (v_now - interval '7 days')),
    count(*) FILTER (WHERE last_task_activity_at < (v_now - interval '7 days') OR (last_task_activity_at IS NULL AND first_login_at IS NOT NULL)),
    count(*) FILTER (WHERE first_login_at IS NULL AND last_login_at IS NULL),
    count(*) FILTER (WHERE first_task_submitted_at IS NULL)
  INTO
    v_total_users,
    v_legacy_users,
    v_invitation_users,
    v_organic_users,
    v_active_users,
    v_at_risk_users,
    v_inactive_users,
    v_never_logged_in,
    v_never_submitted_task
  FROM public.users
  WHERE role IN ('army', 'hero_army')
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_recruiter_id IS NULL OR recruiter_id = p_recruiter_id)
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  -- Recruitment stats
  SELECT
    count(*),
    count(*) FILTER (WHERE status <> 'created'),
    count(*) FILTER (WHERE click_count > 0 OR status IN ('clicked', 'registered', 'first_login', 'first_task_submitted', 'active')),
    count(*) FILTER (WHERE registered_at IS NOT NULL OR status IN ('registered', 'first_login', 'first_task_submitted', 'active')),
    count(*) FILTER (WHERE first_task_submitted_at IS NOT NULL OR status = 'first_task_submitted'),
    count(*) FILTER (WHERE status = 'active'),
    count(*) FILTER (WHERE status = 'inactive')
  INTO
    v_inv_created,
    v_inv_sent,
    v_inv_clicked,
    v_inv_registered,
    v_inv_first_task,
    v_inv_active,
    v_inv_inactive
  FROM public.invitations
  WHERE (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_recruiter_id IS NULL OR recruiter_id = p_recruiter_id)
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  v_res := jsonb_build_object(
    'users', jsonb_build_object(
      'total', v_total_users,
      'legacy', v_legacy_users,
      'invitation', v_invitation_users,
      'organic', v_organic_users,
      'active', v_active_users,
      'at_risk', v_at_risk_users,
      'inactive', v_inactive_users,
      'never_logged_in', v_never_logged_in,
      'never_submitted_task', v_never_submitted_task
    ),
    'recruitment', jsonb_build_object(
      'created', v_inv_created,
      'sent', v_inv_sent,
      'clicked', v_inv_clicked,
      'registered', v_inv_registered,
      'first_task', v_inv_first_task,
      'active', v_inv_active,
      'inactive', v_inv_inactive
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'Invitation Created', 'count', v_inv_created),
      jsonb_build_object('step', 'Invitation Sent', 'count', v_inv_sent),
      jsonb_build_object('step', 'Link Clicked', 'count', v_inv_clicked),
      jsonb_build_object('step', 'Registered', 'count', v_inv_registered),
      jsonb_build_object('step', 'First Task Submitted', 'count', v_inv_first_task),
      jsonb_build_object('step', 'Active Member', 'count', v_inv_active)
    )
  );

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_growth_overview(timestamptz, timestamptz, uuid, uuid) TO authenticated;

-- 14. Analytical RPC: get_user_activity_monitoring
CREATE OR REPLACE FUNCTION public.get_user_activity_monitoring(
  p_search text DEFAULT NULL,
  p_acquisition_type text DEFAULT NULL,
  p_activity_status text DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_recruiter_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_res jsonb;
BEGIN
  IF NOT public.is_admin_or_recruiter() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  WITH user_base AS (
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.whatsapp,
      u.role,
      u.acquisition_type,
      u.created_at,
      u.first_login_at,
      u.last_login_at,
      u.first_task_submitted_at,
      u.last_task_activity_at,
      u.invitation_id,
      u.campaign_id,
      u.recruiter_id,
      c.campaign_name,
      rec.full_name AS recruiter_name,
      inv.invitation_code,
      CASE
        WHEN u.last_login_at IS NULL AND u.first_login_at IS NULL THEN 'not_started'
        WHEN u.first_task_submitted_at IS NULL THEN 'logged_in_no_task'
        WHEN u.last_task_activity_at >= (v_now - interval '3 days') THEN 'active'
        WHEN u.last_task_activity_at >= (v_now - interval '7 days') THEN 'at_risk'
        ELSE 'inactive'
      END AS computed_activity_status
    FROM public.users u
    LEFT JOIN public.invitation_campaigns c ON c.id = u.campaign_id
    LEFT JOIN public.users rec ON rec.id = u.recruiter_id
    LEFT JOIN public.invitations inv ON inv.id = u.invitation_id
    WHERE u.role IN ('army', 'hero_army')
      AND (p_acquisition_type IS NULL OR p_acquisition_type = 'all' OR u.acquisition_type = p_acquisition_type)
      AND (p_campaign_id IS NULL OR u.campaign_id = p_campaign_id)
      AND (p_recruiter_id IS NULL OR u.recruiter_id = p_recruiter_id)
      AND (
        p_search IS NULL OR trim(p_search) = '' OR
        u.full_name ILIKE '%' || trim(p_search) || '%' OR
        u.email ILIKE '%' || trim(p_search) || '%' OR
        u.whatsapp ILIKE '%' || trim(p_search) || '%' OR
        inv.invitation_code ILIKE '%' || trim(p_search) || '%'
      )
  ),
  filtered_base AS (
    SELECT *, count(*) OVER() as full_count
    FROM user_base
    WHERE (p_activity_status IS NULL OR p_activity_status = 'all' OR computed_activity_status = p_activity_status)
  ),
  paginated AS (
    SELECT *
    FROM filtered_base
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ),
  task_metrics AS (
    SELECT
      p.id AS user_id,
      count(ta.id) AS total_submitted,
      count(ta.id) FILTER (WHERE ta.created_at >= (v_now - interval '7 days')) AS tasks_7d,
      count(ta.id) FILTER (WHERE ta.status = 'approved') AS total_approved,
      count(ta.id) FILTER (WHERE ta.status = 'rejected') AS total_rejected
    FROM paginated p
    LEFT JOIN public.task_assignments ta ON ta.user_id = p.id
    GROUP BY p.id
  ),
  credit_metrics AS (
    SELECT
      p.id AS user_id,
      COALESCE(sum(uc.amount), 0) AS total_reward
    FROM paginated p
    LEFT JOIN public.user_credits uc ON uc.user_id = p.id AND uc.amount > 0
    GROUP BY p.id
  ),
  user_rows AS (
    SELECT jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'whatsapp', p.whatsapp,
      'acquisition_type', p.acquisition_type,
      'created_at', p.created_at,
      'last_login_at', p.last_login_at,
      'first_login_at', p.first_login_at,
      'last_task_activity_at', p.last_task_activity_at,
      'first_task_submitted_at', p.first_task_submitted_at,
      'invitation_code', p.invitation_code,
      'campaign_name', p.campaign_name,
      'recruiter_name', p.recruiter_name,
      'activity_status', p.computed_activity_status,
      'tasks_7d', COALESCE(tm.tasks_7d, 0),
      'total_tasks_submitted', COALESCE(tm.total_submitted, 0),
      'total_approved', COALESCE(tm.total_approved, 0),
      'total_rejected', COALESCE(tm.total_rejected, 0),
      'total_reward', COALESCE(cm.total_reward, 0)
    ) as row_data,
    p.full_count
    FROM paginated p
    LEFT JOIN task_metrics tm ON tm.user_id = p.id
    LEFT JOIN credit_metrics cm ON cm.user_id = p.id
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT full_count FROM user_rows LIMIT 1), 0),
    'users', COALESCE((SELECT jsonb_agg(row_data) FROM user_rows), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_activity_monitoring(text, text, text, uuid, uuid, integer, integer) TO authenticated;

-- 15. Analytical RPC: get_recruiter_performance
CREATE OR REPLACE FUNCTION public.get_recruiter_performance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin_or_recruiter() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  WITH recruiters AS (
    SELECT id, full_name, email, role
    FROM public.users
    WHERE role IN ('admin', 'recruiter')
       OR id IN (SELECT DISTINCT recruiter_id FROM public.invitations WHERE recruiter_id IS NOT NULL)
  ),
  inv_stats AS (
    SELECT
      recruiter_id,
      count(*) AS total_created,
      count(*) FILTER (WHERE status <> 'created') AS total_sent,
      count(*) FILTER (WHERE click_count > 0 OR status IN ('clicked', 'registered', 'first_login', 'first_task_submitted', 'active')) AS total_clicked,
      count(*) FILTER (WHERE registered_at IS NOT NULL) AS total_registered,
      count(*) FILTER (WHERE first_task_submitted_at IS NOT NULL) AS total_first_task
    FROM public.invitations
    GROUP BY recruiter_id
  ),
  user_stats AS (
    SELECT
      recruiter_id,
      count(*) FILTER (WHERE last_task_activity_at >= (v_now - interval '3 days')) AS active_users,
      count(*) FILTER (WHERE last_task_activity_at >= (v_now - interval '7 days') AND last_task_activity_at < (v_now - interval '3 days')) AS at_risk_users,
      count(*) FILTER (WHERE last_task_activity_at < (v_now - interval '7 days') OR (last_task_activity_at IS NULL AND first_login_at IS NOT NULL)) AS inactive_users
    FROM public.users
    WHERE recruiter_id IS NOT NULL
    GROUP BY recruiter_id
  ),
  combined AS (
    SELECT
      r.id AS recruiter_id,
      r.full_name AS recruiter_name,
      r.email,
      r.role,
      COALESCE(s.total_created, 0) AS invitations_created,
      COALESCE(s.total_sent, 0) AS invitations_sent,
      COALESCE(s.total_clicked, 0) AS link_clicks,
      COALESCE(s.total_registered, 0) AS registrations,
      COALESCE(s.total_first_task, 0) AS first_task_submissions,
      COALESCE(u.active_users, 0) AS active_users,
      COALESCE(u.at_risk_users, 0) AS at_risk_users,
      COALESCE(u.inactive_users, 0) AS inactive_users,
      CASE WHEN COALESCE(s.total_sent, 0) > 0 THEN round((s.total_registered::numeric / s.total_sent::numeric) * 100, 1) ELSE NULL END AS reg_conversion_rate,
      CASE WHEN COALESCE(s.total_registered, 0) > 0 THEN round((s.total_first_task::numeric / s.total_registered::numeric) * 100, 1) ELSE NULL END AS activation_rate,
      CASE WHEN COALESCE(s.total_registered, 0) > 0 THEN round((COALESCE(u.active_users, 0)::numeric / s.total_registered::numeric) * 100, 1) ELSE NULL END AS active_user_rate
    FROM recruiters r
    LEFT JOIN inv_stats s ON s.recruiter_id = r.id
    LEFT JOIN user_stats u ON u.recruiter_id = r.id
    ORDER BY COALESCE(s.total_registered, 0) DESC, r.full_name ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_res FROM combined c;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recruiter_performance() TO authenticated;

-- Enable RLS on new tables
ALTER TABLE public.invitation_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_login_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_followups ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins and recruiters can view campaigns"
  ON public.invitation_campaigns FOR SELECT
  USING (public.is_admin_or_recruiter());

CREATE POLICY "Admins and recruiters can manage campaigns"
  ON public.invitation_campaigns FOR ALL
  USING (public.is_admin_or_recruiter());

CREATE POLICY "Admins and recruiters can view invitations"
  ON public.invitations FOR SELECT
  USING (public.is_admin_or_recruiter());

CREATE POLICY "Admins and recruiters can manage invitations"
  ON public.invitations FOR ALL
  USING (public.is_admin_or_recruiter());

CREATE POLICY "Users can view own login logs"
  ON public.user_login_logs FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin_or_recruiter());

CREATE POLICY "Users can view own task activity logs"
  ON public.task_activity_logs FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin_or_recruiter());

CREATE POLICY "Admins and recruiters can manage followups"
  ON public.invitation_followups FOR ALL
  USING (public.is_admin_or_recruiter());

NOTIFY pgrst, 'reload schema';
