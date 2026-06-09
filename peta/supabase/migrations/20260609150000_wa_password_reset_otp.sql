-- =============================================================
-- PeTa — WhatsApp OTP password reset (Fonnte-free-plan safe).
--
-- Fonnte's free plan rejects messages that contain URLs, so we send a 6-digit
-- code (plain text) instead of a reset link. The army member enters the code +
-- a new password on /reset-whatsapp, and an edge function verifies it and sets
-- the new password via the Supabase admin API.
--
-- This table is written/read ONLY by the service-role edge functions
-- (wa-reset-request / wa-reset-confirm). No RLS policies = no client access.
-- Codes are stored hashed (sha256), short-lived, single-use, attempt-capped.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.wa_password_reset (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_password_reset_user_idx
  ON public.wa_password_reset (user_id, created_at DESC);

ALTER TABLE public.wa_password_reset ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: only the service_role (edge functions) may touch it.

-- Resolve a WhatsApp number to a user id. SECURITY DEFINER so it can read
-- public.users; restricted to service_role so it can't be used by anon clients
-- for user enumeration. normalize_wa_phone() canonicalises 08.../+62.../62...
CREATE OR REPLACE FUNCTION public.get_user_id_by_whatsapp(p_whatsapp text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE p_whatsapp IS NOT NULL
    AND length(public.normalize_wa_phone(p_whatsapp)) >= 8
    AND public.normalize_wa_phone(u.whatsapp) = public.normalize_wa_phone(p_whatsapp)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_whatsapp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_whatsapp(text) TO service_role;
