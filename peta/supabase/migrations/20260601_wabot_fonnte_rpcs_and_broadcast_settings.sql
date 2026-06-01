-- WaBot Fonnte webhook RPCs + broadcast_settings singleton table

INSERT INTO app_secrets (key, value)
SELECT 'FONNTE_WEBHOOK_SECRET', encode(gen_random_bytes(16), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM app_secrets WHERE key = 'FONNTE_WEBHOOK_SECRET');

CREATE OR REPLACE FUNCTION public.admin_get_fonnte_webhook_secret()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN (SELECT value FROM app_secrets WHERE key = 'FONNTE_WEBHOOK_SECRET');
END;
$$;

DROP FUNCTION IF EXISTS public.admin_rotate_fonnte_webhook_secret();

CREATE OR REPLACE FUNCTION public.admin_rotate_fonnte_webhook_secret()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_new text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  v_new := encode(gen_random_bytes(16), 'hex');
  INSERT INTO app_secrets (key, value) VALUES ('FONNTE_WEBHOOK_SECRET', v_new)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  RETURN v_new;
END;
$$;

CREATE TABLE IF NOT EXISTS public.broadcast_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  daily_limit int NOT NULL DEFAULT 200,
  speed_per_minute int NOT NULL DEFAULT 5,
  delay_min_seconds int NOT NULL DEFAULT 3,
  delay_max_seconds int NOT NULL DEFAULT 10,
  send_hours_start int NOT NULL DEFAULT 8,
  send_hours_end int NOT NULL DEFAULT 20,
  skip_friday bool NOT NULL DEFAULT false,
  batch_size int NOT NULL DEFAULT 50,
  batch_pause_minutes int NOT NULL DEFAULT 30,
  max_recipients_per_blast int NOT NULL DEFAULT 200,
  require_opt_out_text bool NOT NULL DEFAULT false,
  opt_out_keyword text NOT NULL DEFAULT 'STOP',
  max_links_per_message int NOT NULL DEFAULT 3,
  use_spintax bool NOT NULL DEFAULT false,
  dedup_window_days int NOT NULL DEFAULT 0,
  is_paused bool NOT NULL DEFAULT false,
  pause_reason text,
  paused_until timestamptz,
  daily_counter_date date NOT NULL DEFAULT CURRENT_DATE,
  total_sent_today int NOT NULL DEFAULT 0,
  total_sent_lifetime int NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.broadcast_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "admin_only" ON public.broadcast_settings FOR ALL
    USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.broadcast_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_get_broadcast_settings()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN (SELECT row_to_json(bs) FROM broadcast_settings bs WHERE id = 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_broadcast_settings(
  p_daily_limit int DEFAULT NULL,
  p_speed_per_minute int DEFAULT NULL,
  p_delay_min_seconds int DEFAULT NULL,
  p_delay_max_seconds int DEFAULT NULL,
  p_send_hours_start int DEFAULT NULL,
  p_send_hours_end int DEFAULT NULL,
  p_skip_friday bool DEFAULT NULL,
  p_batch_size int DEFAULT NULL,
  p_batch_pause_minutes int DEFAULT NULL,
  p_max_recipients_per_blast int DEFAULT NULL,
  p_require_opt_out_text bool DEFAULT NULL,
  p_opt_out_keyword text DEFAULT NULL,
  p_max_links_per_message int DEFAULT NULL,
  p_use_spintax bool DEFAULT NULL,
  p_dedup_window_days int DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE broadcast_settings SET
    daily_limit              = COALESCE(p_daily_limit, daily_limit),
    speed_per_minute         = COALESCE(p_speed_per_minute, speed_per_minute),
    delay_min_seconds        = COALESCE(p_delay_min_seconds, delay_min_seconds),
    delay_max_seconds        = COALESCE(p_delay_max_seconds, delay_max_seconds),
    send_hours_start         = COALESCE(p_send_hours_start, send_hours_start),
    send_hours_end           = COALESCE(p_send_hours_end, send_hours_end),
    skip_friday              = COALESCE(p_skip_friday, skip_friday),
    batch_size               = COALESCE(p_batch_size, batch_size),
    batch_pause_minutes      = COALESCE(p_batch_pause_minutes, batch_pause_minutes),
    max_recipients_per_blast = COALESCE(p_max_recipients_per_blast, max_recipients_per_blast),
    require_opt_out_text     = COALESCE(p_require_opt_out_text, require_opt_out_text),
    opt_out_keyword          = COALESCE(p_opt_out_keyword, opt_out_keyword),
    max_links_per_message    = COALESCE(p_max_links_per_message, max_links_per_message),
    use_spintax              = COALESCE(p_use_spintax, use_spintax),
    dedup_window_days        = COALESCE(p_dedup_window_days, dedup_window_days),
    updated_at               = now()
  WHERE id = 1;
  RETURN (SELECT row_to_json(bs) FROM broadcast_settings bs WHERE id = 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_pause_blast(
  p_pause bool,
  p_reason text DEFAULT NULL,
  p_until text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE broadcast_settings SET
    is_paused    = p_pause,
    pause_reason = CASE WHEN p_pause THEN COALESCE(p_reason, 'Manual pause by admin') ELSE NULL END,
    paused_until = CASE WHEN p_pause AND p_until IS NOT NULL AND trim(p_until) != ''
                        THEN trim(p_until)::timestamptz ELSE NULL END,
    updated_at   = now()
  WHERE id = 1;
  RETURN (SELECT row_to_json(bs) FROM broadcast_settings bs WHERE id = 1);
END;
$$;
