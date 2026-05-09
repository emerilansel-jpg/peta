-- Per-user dismiss flag for the "Gabung WhatsApp" CTA on Tasks page.
-- Stored on users (not localStorage) so it persists across devices.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wa_group_dismissed boolean NOT NULL DEFAULT false;

-- User can dismiss the CTA for themselves. Admin override not needed.
CREATE OR REPLACE FUNCTION public.dismiss_wa_group()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.users SET wa_group_dismissed = true WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.dismiss_wa_group() TO authenticated;
