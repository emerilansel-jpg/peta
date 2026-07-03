-- Task WA Blast System
-- Adds notification tracking + RPCs for auto-blasting WA group + DM members
-- when admin activates a task.
--
-- Requires: FONNTE_TOKEN secret in Supabase (already used by send-wa-password-reset)
-- Optional: app_secrets.key='WA_GROUP_JID' for auto group blast

-- 1. Track per-task notification sends
CREATE TABLE IF NOT EXISTS public.task_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  channel       text NOT NULL CHECK (channel IN ('whatsapp_group','whatsapp_dm')),
  phone         text,
  message       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error         text,
  fonnte_response jsonb,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_task ON public.task_notifications(task_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_status ON public.task_notifications(status) WHERE status = 'pending';

ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_notifications_admin_all ON public.task_notifications;
CREATE POLICY task_notifications_admin_all ON public.task_notifications
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- 2. RPC: get eligible army members for a task (matching karma + age gates)
CREATE OR REPLACE FUNCTION public.admin_get_task_eligible_members(p_task_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  whatsapp text,
  karma int,
  account_age_days int,
  level int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'task not found'; END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    u.whatsapp,
    ra.karma,
    ra.account_age_days,
    ra.level
  FROM users u
  JOIN reddit_accounts ra ON ra.user_id = u.id
  WHERE u.role = 'army'
    AND u.is_active = true
    AND u.whatsapp IS NOT NULL
    AND length(u.whatsapp) > 5
    AND COALESCE(ra.karma, 0) >= COALESCE(v_task.min_karma, 0)
    AND COALESCE(ra.account_age_days, 0) >= COALESCE(v_task.min_account_age_days, 0)
  ORDER BY u.full_name NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_task_eligible_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_task_eligible_members(uuid) TO authenticated;

-- 3. RPC: queue task notifications (group + individual DMs)
-- Returns array of notification IDs so edge function can iterate and send.
CREATE OR REPLACE FUNCTION public.admin_queue_task_notifications(
  p_task_id       uuid,
  p_test_mode     boolean DEFAULT false,
  p_test_whatsapp text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_task      tasks%ROWTYPE;
  v_group_jid text;
  v_message   text;
  v_notif_ids uuid[] := '{}'::uuid[];
  v_rec       record;
  v_id        uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RAISE EXCEPTION 'task not found'; END IF;

  -- Build message body
  v_message := format(
    '📢 *Task Baru Tersedia*%s%s%s%s%s%s',
    E'\n\n*' || COALESCE(v_task.title, 'Task') || '*',
    E'\n💰 Reward: Rp' || to_char(v_task.reward_amount, 'FM999,999,999'),
    E'\n👥 Slot: ' || COALESCE(v_task.current_assignments, 0) || '/' || COALESCE(v_task.max_assignments, 0) || ' terisi',
    CASE WHEN v_task.target_url IS NOT NULL THEN E'\n🔗 ' || v_task.target_url ELSE '' END,
    CASE WHEN v_task.min_karma > 0 THEN E'\n📊 Min karma: ' || v_task.min_karma ELSE '' END,
    E'\n\nBuka https://penghasilantambahan.com/tasks untuk ambil task.'
  );

  -- Test mode: queue only to admin's own number
  IF p_test_mode THEN
    INSERT INTO task_notifications (task_id, user_id, channel, phone, message, status)
    VALUES (p_task_id, v_uid, 'whatsapp_dm', COALESCE(p_test_whatsapp, (SELECT whatsapp FROM users WHERE id = v_uid)), v_message, 'pending')
    RETURNING id INTO v_id;
    v_notif_ids := array_append(v_notif_ids, v_id);

    RETURN jsonb_build_object(
      'test_mode', true,
      'notification_ids', v_notif_ids,
      'message', v_message,
      'total', 1
    );
  END IF;

  -- Production mode: group blast (if WA_GROUP_JID configured and task has wa_group_draft)
  SELECT value INTO v_group_jid FROM app_secrets WHERE key = 'WA_GROUP_JID';
  IF v_group_jid IS NOT NULL AND v_task.post_to_wa_group = true AND v_task.wa_group_draft IS NOT NULL THEN
    INSERT INTO task_notifications (task_id, channel, phone, message, status)
    VALUES (p_task_id, 'whatsapp_group', v_group_jid, v_task.wa_group_draft, 'pending')
    RETURNING id INTO v_id;
    v_notif_ids := array_append(v_notif_ids, v_id);
  END IF;

  -- Production mode: individual DMs to eligible members
  FOR v_rec IN
    SELECT * FROM admin_get_task_eligible_members(p_task_id)
  LOOP
    INSERT INTO task_notifications (task_id, user_id, channel, phone, message, status)
    VALUES (p_task_id, v_rec.user_id, 'whatsapp_dm', v_rec.whatsapp, v_message, 'pending')
    RETURNING id INTO v_id;
    v_notif_ids := array_append(v_notif_ids, v_id);
  END LOOP;

  RETURN jsonb_build_object(
    'test_mode', false,
    'notification_ids', v_notif_ids,
    'message', v_message,
    'total', array_length(v_notif_ids, 1)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_queue_task_notifications(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_queue_task_notifications(uuid, boolean, text) TO authenticated;

-- 4. RPC: mark a notification as sent/failed (called by edge function after Fonnte call)
CREATE OR REPLACE FUNCTION public.admin_mark_task_notification(
  p_notification_id uuid,
  p_status          text,
  p_error           text DEFAULT NULL,
  p_fonnte_response jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  UPDATE task_notifications
  SET status = p_status,
      error = p_error,
      fonnte_response = p_fonnte_response,
      sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
  WHERE id = p_notification_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_mark_task_notification(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_task_notification(uuid, text, text, jsonb) TO authenticated;

-- 5. RPC: list notification status for a task (admin UI progress tracking)
CREATE OR REPLACE FUNCTION public.admin_list_task_notifications(p_task_id uuid)
RETURNS TABLE (
  id uuid,
  channel text,
  phone text,
  status text,
  error text,
  sent_at timestamptz,
  created_at timestamptz,
  full_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
  SELECT tn.id, tn.channel, tn.phone, tn.status, tn.error, tn.sent_at, tn.created_at, u.full_name
  FROM task_notifications tn
  LEFT JOIN users u ON u.id = tn.user_id
  WHERE tn.task_id = p_task_id
  ORDER BY tn.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_task_notifications(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_task_notifications(uuid) TO authenticated;
