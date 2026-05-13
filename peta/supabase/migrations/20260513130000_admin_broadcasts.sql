-- Admin broadcast messages: send to ALL active army members across email +
-- WhatsApp channels. Stored centrally so admin can audit history + see
-- per-recipient delivery status.
--
-- Two tables:
--   broadcasts            — the message itself (subject + body + created_by)
--   broadcast_recipients  — per-user delivery row (one per channel per user)
--
-- Delivery is best-effort. The send-broadcast edge function tries email via
-- Resend (if RESEND_API_KEY secret is set) and leaves WhatsApp as a queue
-- of wa.me deeplinks for the admin to click through (no WA Business API
-- account assumed). Each row tracks its own status so we can retry.

CREATE TABLE IF NOT EXISTS public.broadcasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text NOT NULL,
  body          text NOT NULL,
  channels      text[] NOT NULL DEFAULT ARRAY['email','whatsapp']::text[],
  audience      text NOT NULL DEFAULT 'all_active', -- 'all_active' | 'admins_only' | future
  created_by    uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  total_targets int NOT NULL DEFAULT 0,
  email_sent    int NOT NULL DEFAULT 0,
  email_failed  int NOT NULL DEFAULT 0,
  wa_sent       int NOT NULL DEFAULT 0,
  wa_failed     int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id  uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email','whatsapp')),
  -- snapshot at send time so deletes/edits to users don't mess up audit
  email_snapshot text,
  whatsapp_snapshot text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped','manual_pending')),
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON public.broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON public.broadcast_recipients(status) WHERE status = 'pending';

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Admin-only read+write. Uses helper is_admin() to bypass RLS recursion.
DROP POLICY IF EXISTS broadcasts_admin_all ON public.broadcasts;
CREATE POLICY broadcasts_admin_all ON public.broadcasts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS broadcast_recipients_admin_all ON public.broadcast_recipients;
CREATE POLICY broadcast_recipients_admin_all ON public.broadcast_recipients
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- RPC: create a broadcast and queue all recipients in a single transaction.
-- Returns the broadcast id so the admin UI can immediately show progress.
CREATE OR REPLACE FUNCTION public.admin_create_broadcast(
  p_subject  text,
  p_body     text,
  p_channels text[] DEFAULT ARRAY['email','whatsapp']::text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_broadcast_id uuid;
  v_total int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'subject required';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'body required';
  END IF;

  INSERT INTO broadcasts (subject, body, channels, audience, created_by)
  VALUES (trim(p_subject), trim(p_body), p_channels, 'all_active', v_uid)
  RETURNING id INTO v_broadcast_id;

  -- Queue email recipients
  IF 'email' = ANY (p_channels) THEN
    INSERT INTO broadcast_recipients (broadcast_id, user_id, channel, email_snapshot, whatsapp_snapshot)
    SELECT v_broadcast_id, u.id, 'email', au.email, u.whatsapp
    FROM users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.is_active = true AND au.email IS NOT NULL;
  END IF;

  -- Queue WhatsApp recipients
  IF 'whatsapp' = ANY (p_channels) THEN
    INSERT INTO broadcast_recipients (broadcast_id, user_id, channel, email_snapshot, whatsapp_snapshot)
    SELECT v_broadcast_id, u.id, 'whatsapp', au.email, u.whatsapp
    FROM users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.is_active = true AND u.whatsapp IS NOT NULL AND length(u.whatsapp) > 5;
  END IF;

  SELECT COUNT(*) INTO v_total FROM broadcast_recipients WHERE broadcast_id = v_broadcast_id;
  UPDATE broadcasts SET total_targets = v_total WHERE id = v_broadcast_id;

  RETURN v_broadcast_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_create_broadcast(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_broadcast(text, text, text[]) TO authenticated;

-- RPC: list past broadcasts with delivery counts (admin only)
CREATE OR REPLACE FUNCTION public.admin_list_broadcasts(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  subject text,
  body text,
  channels text[],
  created_at timestamptz,
  total_targets int,
  email_sent int,
  email_failed int,
  wa_sent int,
  wa_failed int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT b.id, b.subject, b.body, b.channels, b.created_at,
         b.total_targets, b.email_sent, b.email_failed, b.wa_sent, b.wa_failed
  FROM broadcasts b
  ORDER BY b.created_at DESC
  LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_broadcasts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_broadcasts(int) TO authenticated;

-- RPC: fetch all recipients of a broadcast (admin only) — needed for the
-- "open WhatsApp link" admin UI which loops through pending wa recipients.
CREATE OR REPLACE FUNCTION public.admin_broadcast_recipients(p_broadcast_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  channel text,
  email_snapshot text,
  whatsapp_snapshot text,
  status text,
  error text,
  sent_at timestamptz,
  full_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT r.id, r.user_id, r.channel, r.email_snapshot, r.whatsapp_snapshot,
         r.status, r.error, r.sent_at, u.full_name
  FROM broadcast_recipients r
  JOIN users u ON u.id = r.user_id
  WHERE r.broadcast_id = p_broadcast_id
  ORDER BY r.channel, u.full_name NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.admin_broadcast_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_recipients(uuid) TO authenticated;

-- RPC: mark a single recipient's WA send as completed by admin (the admin
-- clicks the wa.me link and then comes back to mark "sent"). Bumps the
-- broadcast aggregate counter atomically.
CREATE OR REPLACE FUNCTION public.admin_mark_recipient_sent(p_recipient_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row broadcast_recipients%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE broadcast_recipients
  SET status = 'sent', sent_at = now(), error = NULL
  WHERE id = p_recipient_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RETURN; END IF;

  IF v_row.channel = 'whatsapp' THEN
    UPDATE broadcasts SET wa_sent = wa_sent + 1 WHERE id = v_row.broadcast_id;
  ELSIF v_row.channel = 'email' THEN
    UPDATE broadcasts SET email_sent = email_sent + 1 WHERE id = v_row.broadcast_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_mark_recipient_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_recipient_sent(uuid) TO authenticated;
