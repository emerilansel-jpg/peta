-- Test broadcast RPC: creates a 1-recipient broadcast targeting the admin
-- themselves (or overridden email/WA). Used by the "Test ke Saya Dulu" button.

CREATE OR REPLACE FUNCTION public.admin_send_test_broadcast(
  p_subject      text,
  p_body         text,
  p_channels     text[] DEFAULT ARRAY['email','whatsapp']::text[],
  p_test_email   text DEFAULT NULL,
  p_test_whatsapp text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_broadcast_id uuid;
  v_email text;
  v_whatsapp text;
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

  SELECT au.email, u.whatsapp INTO v_email, v_whatsapp
  FROM users u JOIN auth.users au ON au.id = u.id
  WHERE u.id = v_uid;

  v_email := COALESCE(NULLIF(trim(p_test_email), ''), v_email);
  v_whatsapp := COALESCE(NULLIF(trim(p_test_whatsapp), ''), v_whatsapp);

  INSERT INTO broadcasts (subject, body, channels, audience, created_by, total_targets)
  VALUES (trim(p_subject), trim(p_body), p_channels, 'test', v_uid, 1)
  RETURNING id INTO v_broadcast_id;

  IF 'email' = ANY(p_channels) AND v_email IS NOT NULL THEN
    INSERT INTO broadcast_recipients (broadcast_id, user_id, channel, email_snapshot, whatsapp_snapshot)
    VALUES (v_broadcast_id, v_uid, 'email', v_email, v_whatsapp);
  END IF;

  IF 'whatsapp' = ANY(p_channels) AND v_whatsapp IS NOT NULL THEN
    INSERT INTO broadcast_recipients (broadcast_id, user_id, channel, email_snapshot, whatsapp_snapshot)
    VALUES (v_broadcast_id, v_uid, 'whatsapp', v_email, v_whatsapp);
  END IF;

  RETURN v_broadcast_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_send_test_broadcast(text, text, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_test_broadcast(text, text, text[], text, text) TO authenticated;
