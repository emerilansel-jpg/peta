-- ============================================================
-- Migration: 20261102020000_simplified_recruiter_and_campaign_codes.sql
--
-- Enable simple code-based recruitment:
--   1. Ghina & Admin can share short code (e.g. 'GHINA', 'PETA') or campaign codes (e.g. 'SF-INTERN')
--   2. track_invitation_click validates secure_tokens, recruiter referral codes, and campaign codes
--   3. handle_new_user automatically attributes users who register with recruiter/campaign codes
--      as acquisition_type = 'invitation' and auto-creates an invitation record.
-- ============================================================

-- Ensure Ghina and Admin have memorable referral codes
UPDATE public.users SET referral_code = 'GHINA' WHERE email = 'ghinads7@gmail.com';
UPDATE public.users SET referral_code = 'PETA' WHERE email = 'info@jetdigitalpro.com';

-- Update track_invitation_click to support Recruiter Codes & Campaign Codes
CREATE OR REPLACE FUNCTION public.track_invitation_click(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_cleaned text;
  v_inv public.invitations%ROWTYPE;
  v_campaign_name text;
  v_recruiter_name text;
  v_recruiter public.users%ROWTYPE;
  v_campaign public.invitation_campaigns%ROWTYPE;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token kosong');
  END IF;

  v_cleaned := trim(p_token);

  -- 1. Check if token matches individual invitation secure_token or invitation_code
  SELECT * INTO v_inv
  FROM public.invitations
  WHERE secure_token = v_cleaned OR UPPER(invitation_code) = UPPER(v_cleaned)
  LIMIT 1;

  IF v_inv.id IS NOT NULL THEN
    IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
      UPDATE public.invitations SET status = 'expired', updated_at = now() WHERE id = v_inv.id;
      RETURN jsonb_build_object('valid', false, 'error', 'Invitation sudah kedaluwarsa');
    END IF;

    IF v_inv.status = 'declined' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invitation sudah ditutup');
    END IF;

    -- Increment click count
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
      'type', 'individual',
      'invitation_id', v_inv.id,
      'invitation_code', v_inv.invitation_code,
      'full_name', v_inv.full_name,
      'email', v_inv.email,
      'phone', v_inv.phone,
      'campaign_name', v_campaign_name,
      'recruiter_name', v_recruiter_name
    );
  END IF;

  -- 2. Check if code matches a Recruiter or Admin (e.g. 'GHINA', 'PETA')
  SELECT * INTO v_recruiter
  FROM public.users
  WHERE UPPER(referral_code) = UPPER(v_cleaned)
    AND role IN ('recruiter', 'admin')
  LIMIT 1;

  IF v_recruiter.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'valid', true,
      'type', 'recruiter_code',
      'recruiter_id', v_recruiter.id,
      'recruiter_name', v_recruiter.full_name,
      'code', v_recruiter.referral_code
    );
  END IF;

  -- 3. Check if code matches an active Campaign code (e.g. 'CAM-2026-001', 'SF-INTERN')
  SELECT * INTO v_campaign
  FROM public.invitation_campaigns
  WHERE UPPER(campaign_code) = UPPER(v_cleaned)
    AND status = 'active'
  LIMIT 1;

  IF v_campaign.id IS NOT NULL THEN
    SELECT full_name INTO v_recruiter_name
    FROM public.users WHERE id = v_campaign.assigned_recruiter_id;

    RETURN jsonb_build_object(
      'valid', true,
      'type', 'campaign_code',
      'campaign_id', v_campaign.id,
      'campaign_name', v_campaign.campaign_name,
      'recruiter_id', v_campaign.assigned_recruiter_id,
      'recruiter_name', v_recruiter_name,
      'code', v_campaign.campaign_code
    );
  END IF;

  RETURN jsonb_build_object('valid', false, 'error', 'Bukan kode undangan');
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_invitation_click(text) TO anon, authenticated;

-- Upgrade handle_new_user to attribute via recruiter code / campaign code
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_product          TEXT;
  v_role             TEXT;
  v_full_name        TEXT;
  v_role_title       TEXT;
  v_website          TEXT;
  v_referrer_code    TEXT;
  v_referrer_id      UUID;
  v_referrer_role    TEXT;
  v_whatsapp         TEXT;
  v_existing_owner   UUID;
  v_masked_email     TEXT;
  v_inv_token        TEXT;
  v_inv_record       public.invitations%ROWTYPE;
  v_acq_type         TEXT := 'organic';
  v_inv_id           UUID := NULL;
  v_camp_id          UUID := NULL;
  v_recruiter_id     UUID := NULL;
  v_seq_val          BIGINT;
  v_auto_inv_code    TEXT;
BEGIN
  -- Common metadata extraction
  v_product       := COALESCE(NULLIF(LOWER(NEW.raw_user_meta_data->>'product'), ''), 'peta');
  v_full_name     := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1));
  v_role_title    := NULLIF(NEW.raw_user_meta_data->>'role_title', '');
  v_website       := NULLIF(NEW.raw_user_meta_data->>'website', '');
  v_referrer_code := NULLIF(UPPER(TRIM(NEW.raw_user_meta_data->>'referral_code')), '');
  v_whatsapp      := NULLIF(NEW.raw_user_meta_data->>'whatsapp', '');
  v_inv_token     := NULLIF(TRIM(NEW.raw_user_meta_data->>'invitation_token'), '');

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

  -- 1. Validate individual Invitation Token if present
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

  -- 2. Check if code matches a Campaign Code (e.g. 'CAM-2026-001', 'SF-INTERN')
  IF v_camp_id IS NULL AND v_referrer_code IS NOT NULL THEN
    SELECT id, assigned_recruiter_id INTO v_camp_id, v_recruiter_id
    FROM public.invitation_campaigns
    WHERE UPPER(campaign_code) = v_referrer_code
    LIMIT 1;

    IF v_camp_id IS NOT NULL THEN
      v_acq_type := 'invitation';
    END IF;
  END IF;

  -- 3. Check if code matches a User Referral Code (e.g. 'GHINA', 'PETA', or regular user)
  IF v_referrer_code IS NOT NULL THEN
    SELECT id, role INTO v_referrer_id, v_referrer_role
    FROM public.users
    WHERE UPPER(referral_code) = v_referrer_code
    LIMIT 1;

    -- If referrer is admin or recruiter, treat as recruitment invitation!
    IF v_referrer_id IS NOT NULL AND v_referrer_role IN ('recruiter', 'admin') THEN
      v_acq_type := 'invitation';
      v_recruiter_id := COALESCE(v_recruiter_id, v_referrer_id);
    END IF;
  END IF;

  -- Insert user FIRST so foreign keys referencing public.users(id) succeed!
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

  -- 4. Auto-generate invitation row for code-based signups (user now exists in public.users!)
  IF v_acq_type = 'invitation' AND v_inv_id IS NULL AND v_recruiter_id IS NOT NULL THEN
    SELECT nextval('public.invitation_code_seq') INTO v_seq_val;
    v_auto_inv_code := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq_val::text, 6, '0');

    INSERT INTO public.invitations (
      invitation_code, campaign_id, recruiter_id, created_by,
      full_name, email, phone, channel, status,
      registered_user_id, registered_at, first_login_at, click_count,
      internal_notes
    ) VALUES (
      v_auto_inv_code, v_camp_id, v_recruiter_id, v_recruiter_id,
      v_full_name, NEW.email, v_whatsapp, 'whatsapp', 'registered',
      NEW.id, now(), now(), 1,
      'Otomatis terdaftar via kode undangan: ' || COALESCE(v_referrer_code, 'link')
    )
    RETURNING id INTO v_inv_id;

    -- Update user with the new invitation_id
    UPDATE public.users SET invitation_id = v_inv_id WHERE id = NEW.id;
  END IF;

  -- Update Invitation status if pre-existing individual invitation
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

  -- Award referral bonus if valid referral code or recruiter code was used
  IF v_referrer_id IS NOT NULL THEN
    v_masked_email := LEFT(split_part(NEW.email, '@', 1), 3) || '***@' || split_part(NEW.email, '@', 2);
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || v_masked_email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Update get_recruiter_performance to include direct code registrations accurately
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
    SELECT id, full_name, email, role, referral_code
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
      count(*) AS total_recruited,
      count(*) FILTER (WHERE first_task_submitted_at IS NOT NULL) AS first_task_done,
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
      r.referral_code AS recruiter_code,
      COALESCE(s.total_created, 0) AS invitations_created,
      COALESCE(s.total_sent, 0) AS invitations_sent,
      COALESCE(s.total_clicked, 0) AS link_clicks,
      GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0)) AS registrations,
      GREATEST(COALESCE(s.total_first_task, 0), COALESCE(u.first_task_done, 0)) AS first_task_submissions,
      COALESCE(u.active_users, 0) AS active_users,
      COALESCE(u.at_risk_users, 0) AS at_risk_users,
      COALESCE(u.inactive_users, 0) AS inactive_users,
      CASE WHEN COALESCE(s.total_sent, 0) > 0 THEN round((GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0))::numeric / s.total_sent::numeric) * 100, 1) ELSE NULL END AS reg_conversion_rate,
      CASE WHEN GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0)) > 0 THEN round((GREATEST(COALESCE(s.total_first_task, 0), COALESCE(u.first_task_done, 0))::numeric / GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0))::numeric) * 100, 1) ELSE NULL END AS activation_rate,
      CASE WHEN GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0)) > 0 THEN round((COALESCE(u.active_users, 0)::numeric / GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0))::numeric) * 100, 1) ELSE NULL END AS active_user_rate
    FROM recruiters r
    LEFT JOIN inv_stats s ON s.recruiter_id = r.id
    LEFT JOIN user_stats u ON u.recruiter_id = r.id
    ORDER BY GREATEST(COALESCE(s.total_registered, 0), COALESCE(u.total_recruited, 0)) DESC, r.full_name ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_res FROM combined c;

  RETURN v_res;
END;
$$;

NOTIFY pgrst, 'reload schema';
