-- ============================================================
-- Migration: 20261106000000_fix_monthly_guarantee_and_referral_separation.sql
--
-- 1. Fix handle_new_user: Disallow referral bonus for recruiter / campaign / invitation signups.
--    The Rp20.000 is a Monthly Guarantee (Jaminan Bulanan), not an instant signup referral bonus.
-- 2. Fix get_user_activity_monitoring: total_reward in activity table must strictly reflect task earnings (source = 'task_reward').
-- 3. Cleanup: Remove the accidental referral credits issued to November 2026 invitation signups and recruiter.
-- ============================================================

-- 1. Update handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
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

  -- Award referral bonus ONLY for genuine peer-to-peer member referrals.
  -- Exclude invitation/recruiter/campaign signups which are covered by Jaminan Bulanan (Rp20.000).
  IF v_referrer_id IS NOT NULL AND v_acq_type <> 'invitation' AND COALESCE(v_referrer_role, '') NOT IN ('recruiter', 'admin') THEN
    v_masked_email := LEFT(split_part(NEW.email, '@', 1), 3) || '***@' || split_part(NEW.email, '@', 2);
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || v_masked_email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Update get_user_activity_monitoring so total_reward only sums task_reward
CREATE OR REPLACE FUNCTION public.get_user_activity_monitoring(
  p_search text DEFAULT NULL::text,
  p_acquisition_type text DEFAULT NULL::text,
  p_activity_status text DEFAULT NULL::text,
  p_campaign_id uuid DEFAULT NULL::uuid,
  p_recruiter_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      user_id,
      COALESCE(sum(amount) FILTER (WHERE source = 'task_reward'), 0) AS total_reward
    FROM public.user_credits
    WHERE user_id IN (SELECT id FROM paginated)
    GROUP BY user_id
  ),
  user_rows AS (
    SELECT jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'whatsapp', p.whatsapp,
      'role', p.role,
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
$function$;

-- 3. Cleanup erroneous referral credits for November 2026 invitation/recruiter signups
DELETE FROM public.user_credits
WHERE source = 'referral_bonus_referee'
  AND created_at >= '2026-11-01'
  AND user_id IN (
      SELECT id FROM public.users WHERE acquisition_type = 'invitation' OR recruiter_id IS NOT NULL
  );

DELETE FROM public.user_credits
WHERE source = 'referral_bonus_referrer'
  AND created_at >= '2026-11-01'
  AND user_id = '6b06ff50-bc42-491b-8d9c-7fcbe58a2760';

NOTIFY pgrst, 'reload schema';
