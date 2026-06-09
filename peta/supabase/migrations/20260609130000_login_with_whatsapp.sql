-- =============================================================
-- PeTa — allow army members to log in with their WhatsApp number.
--
-- Supabase Auth is email+password. Phone-OTP needs a paid SMS provider, so
-- instead we resolve the WhatsApp number to the account's email server-side,
-- then the client signs in with the normal email+password path (no SMS cost).
--
-- users.whatsapp is UNIQUE; normalize_wa_phone() (added 2026-05-21) canonicalises
-- 08.../+62.../62... so "0812..." and "62812..." match the same account.
--
-- SECURITY NOTE (accepted tradeoff): this returns an account email for a given
-- phone, so a phone number can be used to probe whether it's registered (email
-- enumeration). The password is still required — it does not bypass auth, it only
-- maps the identifier. If stricter privacy is needed later, move resolution into
-- an edge function that performs the sign-in server-side so the email never
-- reaches the client.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_email_by_whatsapp(p_whatsapp text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT au.email::text
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE p_whatsapp IS NOT NULL
    AND length(public.normalize_wa_phone(p_whatsapp)) >= 8
    AND public.normalize_wa_phone(u.whatsapp) = public.normalize_wa_phone(p_whatsapp)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_email_by_whatsapp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_whatsapp(text) TO anon, authenticated;
