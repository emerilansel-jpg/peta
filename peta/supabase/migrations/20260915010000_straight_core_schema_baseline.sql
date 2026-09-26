-- Migration: 20260915010000_straight_core_schema_baseline.sql
-- Establishes idempotent DDL, RLS policies, and RPCs for Straight Ltd core tables:
-- 1. app_secrets (credential store)
-- 2. order_tickets & ticket_messages (client support system)
-- 3. reviews (client review & testimonial system)
-- 4. feature_requests (client feature request & voting system)

BEGIN;

-- 1. app_secrets
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
-- No public policies: accessible exclusively by service_role and SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.admin_list_secrets()
RETURNS TABLE (
  key text,
  value_preview text,
  value_length int,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
  SELECT s.key,
         CASE WHEN length(s.value) > 8
              THEN left(s.value, 4) || '…' || right(s.value, 4)
              ELSE '•••' END AS value_preview,
         length(s.value)::int AS value_length,
         s.updated_at
  FROM public.app_secrets s
  ORDER BY s.key;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_secret(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  DELETE FROM public.app_secrets WHERE key = p_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_secrets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_secret(text) TO authenticated;


-- 2. order_tickets & ticket_messages
CREATE TABLE IF NOT EXISTS public.order_tickets (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject text,
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  unread_user int NOT NULL DEFAULT 0,
  unread_admin int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_tickets_user_id ON public.order_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_order_tickets_order_id ON public.order_tickets(order_id);
ALTER TABLE public.order_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_select_own" ON public.order_tickets;
CREATE POLICY "tickets_select_own" ON public.order_tickets
  FOR SELECT TO public
  USING ((user_id = auth.uid()) OR is_admin());

DROP POLICY IF EXISTS "tickets_update_admin" ON public.order_tickets;
CREATE POLICY "tickets_update_admin" ON public.order_tickets
  FOR UPDATE TO public
  USING ((user_id = auth.uid()) OR is_admin())
  WITH CHECK ((user_id = auth.uid()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id bigserial PRIMARY KEY,
  ticket_id bigint NOT NULL REFERENCES public.order_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_role text NOT NULL,
  body text NOT NULL,
  attachments jsonb,
  read_by_user boolean NOT NULL DEFAULT false,
  read_by_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON public.ticket_messages(ticket_id);
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_own_ticket" ON public.ticket_messages;
CREATE POLICY "messages_select_own_ticket" ON public.ticket_messages
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.order_tickets t
    WHERE t.id = ticket_messages.ticket_id AND ((t.user_id = auth.uid()) OR is_admin())
  ));

DROP POLICY IF EXISTS "messages_insert_own_ticket" ON public.ticket_messages;
CREATE POLICY "messages_insert_own_ticket" ON public.ticket_messages
  FOR INSERT TO public
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.order_tickets t
      WHERE t.id = ticket_messages.ticket_id AND ((t.user_id = auth.uid()) OR is_admin())
    )
  );

CREATE OR REPLACE FUNCTION public.fn_mark_ticket_read(
  p_ticket_id bigint,
  p_as_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_as_role = 'admin' AND NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_as_role = 'user' THEN
    UPDATE public.ticket_messages SET read_by_user = TRUE WHERE ticket_id = p_ticket_id AND read_by_user = FALSE;
    UPDATE public.order_tickets SET unread_user = 0 WHERE id = p_ticket_id AND user_id = auth.uid();
  ELSIF p_as_role = 'admin' THEN
    UPDATE public.ticket_messages SET read_by_admin = TRUE WHERE ticket_id = p_ticket_id AND read_by_admin = FALSE;
    UPDATE public.order_tickets SET unread_admin = 0 WHERE id = p_ticket_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mark_ticket_read(bigint, text) TO authenticated;


-- 3. reviews
CREATE TABLE IF NOT EXISTS public.reviews (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_id_public uuid,
  order_id bigint,
  type text NOT NULL,
  rating int,
  reviewer_name text,
  title text,
  body text,
  trustpilot_url text,
  trustpilot_screenshot_url text,
  status text NOT NULL DEFAULT 'pending',
  credit_awarded_cents int NOT NULL DEFAULT 0,
  admin_notes text,
  reviewer_role text,
  reviewer_website text,
  reviewer_profile_pic_url text,
  profile_pic_consent boolean NOT NULL DEFAULT false,
  dofollow_link_requested boolean NOT NULL DEFAULT false,
  dofollow_link_granted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select_own_or_admin" ON public.reviews;
CREATE POLICY "reviews_select_own_or_admin" ON public.reviews
  FOR SELECT TO public
  USING ((user_id = auth.uid()) OR is_admin());

DROP POLICY IF EXISTS "reviews_insert_own" ON public.reviews;
CREATE POLICY "reviews_insert_own" ON public.reviews
  FOR INSERT TO public
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_update_admin" ON public.reviews;
CREATE POLICY "reviews_update_admin" ON public.reviews
  FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());


-- 4. feature_requests
CREATE TABLE IF NOT EXISTS public.feature_requests (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  platform text,
  service_type text,
  description text NOT NULL,
  estimated_volume int,
  urgency text DEFAULT 'normal',
  contact_method text,
  status text NOT NULL DEFAULT 'open',
  admin_response text,
  votes int DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feature_requests_user_id ON public.feature_requests(user_id);
ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own_feature_requests" ON public.feature_requests;
CREATE POLICY "users_select_own_feature_requests" ON public.feature_requests
  FOR SELECT TO public
  USING ((user_id = auth.uid()) OR is_admin());

DROP POLICY IF EXISTS "users_insert_feature_requests" ON public.feature_requests;
CREATE POLICY "users_insert_feature_requests" ON public.feature_requests
  FOR INSERT TO public
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_update_feature_requests" ON public.feature_requests;
CREATE POLICY "admin_update_feature_requests" ON public.feature_requests
  FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());

COMMIT;

NOTIFY pgrst, 'reload schema';
