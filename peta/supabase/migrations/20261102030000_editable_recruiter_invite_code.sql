-- ============================================================
-- Migration: 20261102030000_editable_recruiter_invite_code.sql
--
-- RPC to allow recruiters & admins to customize/change their invite codes:
--   - Validates uniqueness across users.referral_code & campaigns.campaign_code
--   - Uppercased, 3-24 characters, alphanumeric + dash/underscore
--   - Admin can edit any recruiter code; recruiter can edit their own code
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_recruiter_invite_code(
  p_recruiter_id uuid,
  p_new_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller_role text;
  v_clean text;
  v_exists_user uuid;
  v_exists_campaign uuid;
  v_is_superuser boolean;
BEGIN
  v_is_superuser := current_user IN ('postgres', 'service_role', 'supabase_admin');

  IF NOT v_is_superuser THEN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Sesi login tidak valid');
    END IF;

    SELECT role INTO v_caller_role FROM public.users WHERE id = v_uid;
    IF v_caller_role NOT IN ('admin', 'recruiter') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Hanya admin atau recruiter yang dapat mengubah kode');
    END IF;

    -- Only admin can edit another person's code
    IF v_caller_role <> 'admin' AND v_uid <> p_recruiter_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Kamu hanya dapat mengubah kode undangan milik sendiri');
    END IF;
  END IF;

  -- Clean and sanitize
  v_clean := UPPER(regexp_replace(trim(COALESCE(p_new_code, '')), '[^A-Za-z0-9_-]', '', 'g'));

  IF length(v_clean) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kode minimal 3 karakter');
  END IF;

  IF length(v_clean) > 24 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kode maksimal 24 karakter');
  END IF;

  -- Check uniqueness in public.users
  SELECT id INTO v_exists_user
  FROM public.users
  WHERE UPPER(referral_code) = v_clean
    AND id <> p_recruiter_id
  LIMIT 1;

  IF v_exists_user IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kode "' || v_clean || '" sudah dipakai oleh pengguna lain');
  END IF;

  -- Check uniqueness against campaigns
  SELECT id INTO v_exists_campaign
  FROM public.invitation_campaigns
  WHERE UPPER(campaign_code) = v_clean
  LIMIT 1;

  IF v_exists_campaign IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kode "' || v_clean || '" sudah dipakai sebagai kode campaign');
  END IF;

  -- Update user referral_code
  UPDATE public.users
  SET referral_code = v_clean
  WHERE id = p_recruiter_id;

  RETURN jsonb_build_object(
    'ok', true,
    'new_code', v_clean,
    'message', 'Kode undangan berhasil diubah menjadi: ' || v_clean
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_recruiter_invite_code(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
