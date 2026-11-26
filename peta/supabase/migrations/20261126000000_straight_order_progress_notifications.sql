-- Straight Ltd: global client order-progress notifications.
-- Progress events are stored once per order activity and remain available on the
-- order page. Email uses the existing notifications -> email trigger via a hidden
-- notification row, so dashboard/email preferences stay independent.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_progress_notifications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dashboard_progress_notifications boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'message', 'order_status', 'order_progress', 'review', 'credit', 'payment', 'general',
    'first_order_nudge', 'reengagement', 'balance_reminder', 'monthly_guarantee'
  ]::text[]));

CREATE TABLE IF NOT EXISTS public.order_progress_events (
  id bigserial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES public.reddit_upvote_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  progress_units integer NOT NULL DEFAULT 1,
  requested_units integer,
  delivered_units integer,
  event_key text NOT NULL UNIQUE,
  email_queued boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_progress_events_order ON public.order_progress_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_progress_events_user ON public.order_progress_events(user_id, created_at DESC);

ALTER TABLE public.order_progress_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_progress_events_owner_read ON public.order_progress_events;
CREATE POLICY order_progress_events_owner_read ON public.order_progress_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
RETURNS TABLE(email_progress_notifications boolean, dashboard_progress_notifications boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.email_progress_notifications, u.dashboard_progress_notifications
  FROM public.users u
  WHERE u.id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_notification_preferences(
  p_email_progress_notifications boolean,
  p_dashboard_progress_notifications boolean
)
RETURNS TABLE(email_progress_notifications boolean, dashboard_progress_notifications boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  UPDATE public.users u
  SET email_progress_notifications = COALESCE(p_email_progress_notifications, true),
      dashboard_progress_notifications = COALESCE(p_dashboard_progress_notifications, true)
  WHERE u.id = auth.uid();
  RETURN QUERY
  SELECT u.email_progress_notifications, u.dashboard_progress_notifications
  FROM public.users u WHERE u.id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_progress(p_order_id integer DEFAULT NULL)
RETURNS TABLE(
  id bigint,
  order_id integer,
  activity_type text,
  title text,
  body text,
  progress_units integer,
  requested_units integer,
  delivered_units integer,
  email_queued boolean,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT e.id, e.order_id, e.activity_type, e.title, e.body,
         e.progress_units, e.requested_units, e.delivered_units, e.email_queued, e.created_at
  FROM public.order_progress_events e
  WHERE e.user_id = auth.uid()
    AND (p_order_id IS NULL OR e.order_id = p_order_id)
  ORDER BY e.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_client_order_progress(
  p_order_id integer,
  p_assignment_id uuid,
  p_activity_type text DEFAULT 'assignment_approved'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.reddit_upvote_orders;
  v_pref_email boolean := true;
  v_pref_dashboard boolean := true;
  v_service text;
  v_key text;
  v_event_id bigint;
  v_title text;
  v_body text;
  v_progress int := 1;
BEGIN
  SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN; END IF;

  SELECT email_progress_notifications, dashboard_progress_notifications
  INTO v_pref_email, v_pref_dashboard
  FROM public.users WHERE id = v_order.user_id;

  v_service := COALESCE(NULLIF(btrim(v_order.subreddit), ''), NULLIF(v_order.target_type, ''), 'Order');
  v_progress := 1;
  v_key := format('%s:%s', p_activity_type, COALESCE(p_assignment_id::text, p_order_id::text));
  v_title := format('Progress on %s', v_service);
  v_body := format(
    'A new %s was recorded for order #%s. Current progress: %s/%s. Time: %s.',
    replace(p_activity_type, '_', ' '),
    p_order_id,
    COALESCE(v_order.delivered_upvotes, 0),
    COALESCE(v_order.requested_upvotes, 0),
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
  );

  -- Record progress regardless of notification preferences; order detail is source of truth.
  BEGIN
    INSERT INTO public.order_progress_events (
      order_id, user_id, activity_type, title, body,
      progress_units, requested_units, delivered_units, event_key, email_queued
    ) VALUES (
      v_order.id, v_order.user_id, p_activity_type, v_title, v_body,
      v_progress, v_order.requested_upvotes, v_order.delivered_upvotes, v_key, COALESCE(v_pref_email, true)
    )
    ON CONFLICT (event_key) DO UPDATE SET
      requested_units = EXCLUDED.requested_units,
      delivered_units = EXCLUDED.delivered_units,
      email_queued = public.order_progress_events.email_queued OR EXCLUDED.email_queued
    RETURNING id INTO v_event_id;
  EXCEPTION WHEN others THEN NULL; END;

  -- Dashboard notifications are optional; progress events above still exist.
  IF COALESCE(v_pref_dashboard, true) THEN
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, body, link, target_role, is_read, metadata)
      VALUES (v_order.user_id, 'order_status', v_title, v_body,
              format('/orders/%s', v_order.id), 'user', false,
              jsonb_build_object('order_id', v_order.id, 'activity_type', p_activity_type,
                                 'event_key', v_key, 'source', 'order_progress'))
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;

  -- Email queue row is intentionally hidden from the dashboard (is_read=true).
  -- The DB trigger on public.notifications fires the existing email function.
  IF COALESCE(v_pref_email, true) THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.metadata->>'event_key' = v_key || ':email'
      ) THEN
        INSERT INTO public.notifications (user_id, type, title, body, link, target_role, is_read, metadata)
        VALUES (v_order.user_id, 'order_progress', v_title, v_body,
                format('/orders/%s', v_order.id), 'user', true,
                jsonb_build_object('order_id', v_order.id, 'activity_type', p_activity_type,
                                   'event_key', v_key || ':email', 'source', 'order_progress',
                                   'email_only', true));
      END IF;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END;
$$;

-- Preserve the category-agnostic approval sync and add one global progress event.
CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_reward int;
  v_task_title text;
  v_source_order_id int;
  v_requested int;
  v_delivered int;
  v_proof_text text;
  v_task_category text;
  v_order_status text;
  v_next_index int;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT COALESCE(ta.user_id, ra.user_id), t.reward_amount, t.title, t.source_order_id, t.task_category
      INTO v_user_id, v_reward, v_task_title, v_source_order_id, v_task_category
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.id = NEW.id;

    IF v_source_order_id IS NOT NULL THEN
      SELECT status INTO v_order_status FROM public.reddit_upvote_orders WHERE id = v_source_order_id;
      IF v_order_status IN ('cancelled', 'refunded') THEN
        RAISE EXCEPTION 'Tidak bisa approve tugas dari pesanan yang sudah dibatalkan atau direfund.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF v_task_category IS DISTINCT FROM 'reddit_challenge' THEN
      INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
      VALUES (v_user_id, v_reward, 'task_reward',
              format('Reward task: %s', COALESCE(v_task_title, 'tugas')), NEW.id)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (v_user_id, 'task_reward_credited',
              jsonb_build_object('assignment_id', NEW.id, 'task_id', NEW.task_id,
                                 'amount', v_reward, 'source_order_id', v_source_order_id));
    END IF;

    NEW.balance_credited_at := NOW();

    IF v_source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET delivered_upvotes = COALESCE(delivered_upvotes, 0) + 1
      WHERE id = v_source_order_id;

      SELECT requested_upvotes, delivered_upvotes INTO v_requested, v_delivered
      FROM public.reddit_upvote_orders WHERE id = v_source_order_id;

      IF v_requested IS NOT NULL AND v_delivered >= v_requested THEN
        UPDATE public.reddit_upvote_orders
        SET status = 'completed', completed_at = NOW()
        WHERE id = v_source_order_id AND status IN ('pending', 'processing');
      END IF;

      SELECT COALESCE(MAX(item_index), 0) + 1 INTO v_next_index
      FROM public.order_deliverables WHERE order_id = v_source_order_id;

      INSERT INTO public.order_deliverables (
        order_id, task_assignment_id, item_index, reviewer_name, proof_url, screenshot_url, delivered_at
      ) VALUES (
        v_source_order_id, NEW.id, v_next_index,
        COALESCE(NULLIF(trim(NEW.submitted_username), ''), 'Member PeTa'),
        COALESCE(NULLIF(trim(NEW.submitted_url), ''), NEW.proof_url),
        NEW.proof_image_url, NOW()
      ) ON CONFLICT DO NOTHING;

      v_proof_text := COALESCE(NEW.submitted_url, NEW.proof_url, NEW.draft_comment);
      UPDATE public.reddit_upvote_orders
      SET delivery_proof_text = CASE
            WHEN delivery_proof_text IS NULL OR length(trim(delivery_proof_text)) = 0 THEN v_proof_text
            ELSE delivery_proof_text || E'\n\n---\n\n' || v_proof_text END,
          delivery_proof_url = COALESCE(NEW.proof_image_url, NEW.proof_url, delivery_proof_url)
      WHERE id = v_source_order_id;

      PERFORM public.fn_notify_client_order_progress(v_source_order_id, NEW.id, 'assignment_approved');
      IF v_delivered >= v_requested THEN
        PERFORM public.fn_notify_client_order_progress(v_source_order_id, NEW.id, 'order_completed');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_notification_preferences() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_notification_preferences(boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_progress(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_notify_client_order_progress(integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify_client_order_progress(integer, uuid, text) TO authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
