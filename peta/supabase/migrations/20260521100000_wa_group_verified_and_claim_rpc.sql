-- =============================================================
-- WA-group verification system.
--
-- New flow: army member types "peta" in the official PeTa WhatsApp
-- group → Evolution API bot reads it → POSTs to N8N → N8N calls
-- this RPC → user gets Rp5K bonus (one-time, idempotent).
--
-- Architecture:
--   evolution-api (VPS)  webhook→  n8n  HTTP→  this RPC  → grants bonus
--
-- Security: RPC requires p_webhook_secret matching app_secrets
-- key 'WA_VERIFY_WEBHOOK_SECRET' (admin sets via /admin/secrets).
-- =============================================================

-- 1) Column to mark verified WA group joiners
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wa_group_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_group_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS users_wa_group_verified_idx
  ON public.users (wa_group_verified) WHERE wa_group_verified = false;

-- 2) Phone normalization helper.  Accepts +62812..., 0812..., 62812...
--    Strips non-digits, leading "0" → "62", returns normalized form.
CREATE OR REPLACE FUNCTION public.normalize_wa_phone(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  v := regexp_replace(p_raw, '[^0-9]', '', 'g');
  IF v LIKE '0%' THEN v := '62' || substring(v from 2); END IF;
  IF length(v) < 9 THEN RETURN NULL; END IF;
  RETURN v;
END $$;

-- 3) Main RPC — called by N8N webhook
CREATE OR REPLACE FUNCTION public.claim_wa_group_by_phone(
  p_phone text,
  p_webhook_secret text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expected_secret text;
  v_phone text;
  v_user_id uuid;
  v_already_verified boolean;
  v_bonus_amount CONSTANT int := 5000;
BEGIN
  -- Auth: webhook secret must match
  SELECT value INTO v_expected_secret
  FROM public.app_secrets WHERE key = 'WA_VERIFY_WEBHOOK_SECRET';
  IF v_expected_secret IS NULL OR v_expected_secret = '' THEN
    RAISE EXCEPTION 'WA_VERIFY_WEBHOOK_SECRET not configured';
  END IF;
  IF p_webhook_secret IS DISTINCT FROM v_expected_secret THEN
    RAISE EXCEPTION 'invalid webhook secret';
  END IF;

  v_phone := public.normalize_wa_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_phone', 'message', 'Format nomor tidak valid');
  END IF;

  -- Find user by normalized phone match.  We normalize both sides.
  SELECT u.id, u.wa_group_verified
  INTO v_user_id, v_already_verified
  FROM public.users u
  WHERE public.normalize_wa_phone(u.whatsapp) = v_phone
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'user_not_found', 'phone', v_phone,
      'message', 'Nomor belum terdaftar di PeTa. Daftar dulu di penghasilantambahan.com'
    );
  END IF;

  IF v_already_verified THEN
    RETURN json_build_object(
      'ok', false, 'reason', 'already_claimed', 'user_id', v_user_id,
      'message', 'Kamu udah dapat bonus group ini sebelumnya'
    );
  END IF;

  -- Grant bonus + mark verified
  UPDATE public.users
    SET wa_group_verified = true, wa_group_verified_at = NOW()
    WHERE id = v_user_id;

  INSERT INTO public.user_credits (user_id, amount, source, description)
  VALUES (v_user_id, v_bonus_amount, 'wa_group_verified', 'Bonus verifikasi join WA group (ketik peta)');

  RETURN json_build_object(
    'ok', true, 'user_id', v_user_id, 'phone', v_phone, 'bonus', v_bonus_amount,
    'message', '✅ Bonus Rp' || v_bonus_amount::text || ' udah masuk saldo PeTa kamu!'
  );
END $$;

-- Grant to anon — caller authenticates via webhook secret, not JWT.
-- (N8N may not have a Supabase user token; treating webhook secret as
-- the auth boundary is intentional and explicit.)
GRANT EXECUTE ON FUNCTION public.claim_wa_group_by_phone(text, text) TO anon, authenticated;

-- 4) Admin helper RPC — list users yang belum verified (untuk DM broadcast)
CREATE OR REPLACE FUNCTION public.admin_list_wa_unverified()
RETURNS TABLE (
  id uuid, full_name text, whatsapp text, normalized_phone text,
  email text, created_at timestamptz, has_signup_bonus boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT
    u.id, u.full_name::text, u.whatsapp::text,
    public.normalize_wa_phone(u.whatsapp) AS normalized_phone,
    au.email::text,
    u.created_at,
    EXISTS (
      SELECT 1 FROM public.user_credits c
      WHERE c.user_id = u.id AND c.source = 'signup_bonus'
    ) AS has_signup_bonus
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.role = 'army'
    AND u.wa_group_verified = false
    AND u.whatsapp IS NOT NULL AND u.whatsapp <> ''
  ORDER BY u.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_list_wa_unverified() TO authenticated;
