-- Migration: 20260910140000_straight_reddit_service_toggle.sql
-- Adds master ON/OFF trigger for Reddit services in Straight Admin.

BEGIN;

-- 1. Add column reddit_service_enabled to straight_settings
ALTER TABLE public.straight_settings
  ADD COLUMN IF NOT EXISTS reddit_service_enabled boolean NOT NULL DEFAULT true;

-- 2. Drop and recreate admin_get_straight_settings to include reddit_service_enabled
DROP FUNCTION IF EXISTS public.admin_get_straight_settings();

CREATE OR REPLACE FUNCTION public.admin_get_straight_settings()
RETURNS TABLE(
  registration_mode text,
  auto_activate_tasks boolean,
  reddit_service_enabled boolean,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.registration_mode, s.auto_activate_tasks, s.reddit_service_enabled, s.updated_at
  FROM public.straight_settings s LIMIT 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_get_straight_settings() TO authenticated;

-- 3. Update admin_update_straight_settings to accept p_reddit_service_enabled
DROP FUNCTION IF EXISTS public.admin_update_straight_settings(text);
DROP FUNCTION IF EXISTS public.admin_update_straight_settings(text, boolean);
DROP FUNCTION IF EXISTS public.admin_update_straight_settings(text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.admin_update_straight_settings(
  p_registration_mode text,
  p_auto_activate_tasks boolean DEFAULT true,
  p_reddit_service_enabled boolean DEFAULT true
)
RETURNS public.straight_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_row public.straight_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.straight_settings
  SET registration_mode = p_registration_mode,
      auto_activate_tasks = COALESCE(p_auto_activate_tasks, auto_activate_tasks),
      reddit_service_enabled = COALESCE(p_reddit_service_enabled, reddit_service_enabled),
      updated_at = NOW()
  WHERE id = true
  RETURNING * INTO v_row;

  -- Synchronize straight_pricing reddit comment rows with the master toggle
  UPDATE public.straight_pricing
  SET enabled = v_row.reddit_service_enabled
  WHERE platform = 'reddit' AND service = 'comment';

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_update_straight_settings(text, boolean, boolean) TO authenticated;

-- 4. Public helper to check if reddit service is enabled (client-facing)
CREATE OR REPLACE FUNCTION public.get_straight_reddit_service_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((SELECT reddit_service_enabled FROM public.straight_settings WHERE id = true LIMIT 1), true);
$$;

GRANT EXECUTE ON FUNCTION public.get_straight_reddit_service_enabled() TO PUBLIC, anon, authenticated;

-- 5. Guard: prevent creating Reddit comment orders if reddit_service_enabled is false
CREATE OR REPLACE FUNCTION public.guard_straight_screening() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_screen public.straight_order_screenings;
  v_reddit_enabled boolean;
BEGIN
  SELECT COALESCE(reddit_service_enabled, true) INTO v_reddit_enabled
  FROM public.straight_settings WHERE id = true;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.target_type = 'upvote' OR NEW.target_type = 'upvote') AND (
      NEW.target_type IS DISTINCT FROM OLD.target_type OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.thread_url IS DISTINCT FROM OLD.thread_url OR NEW.requested_upvotes IS DISTINCT FROM OLD.requested_upvotes
      OR NEW.cost_credits IS DISTINCT FROM OLD.cost_credits OR NEW.notes IS DISTINCT FROM OLD.notes
    ) THEN RAISE EXCEPTION 'legacy_vote_obligation_immutable'; END IF;
    IF NEW.screening_id IS DISTINCT FROM OLD.screening_id THEN RAISE EXCEPTION 'screening_id_server_managed'; END IF;
    IF OLD.screening_id IS NOT NULL AND (
      NEW.screening_id IS DISTINCT FROM OLD.screening_id OR NEW.thread_url IS DISTINCT FROM OLD.thread_url
      OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.target_type IS DISTINCT FROM OLD.target_type
      OR NEW.requested_upvotes IS DISTINCT FROM OLD.requested_upvotes OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.subreddit IS DISTINCT FROM OLD.subreddit
    ) THEN RAISE EXCEPTION 'screened_order_immutable: create a newly screened order'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.target_type = 'upvote' THEN
    RAISE EXCEPTION 'paid_reddit_votes_disabled';
  END IF;

  IF NEW.screening_id IS NOT NULL THEN RAISE EXCEPTION 'screening_id_server_managed'; END IF;

  IF NEW.target_type = 'comment' AND lower(COALESCE(NEW.thread_url, '')) ~ '^https?://([a-z0-9-]+\.)?reddit\.com([/:?#]|$)' THEN
    IF NOT v_reddit_enabled THEN
      RAISE EXCEPTION 'reddit_service_disabled: Layanan Reddit sedang dinonaktifkan sementara oleh admin.';
    END IF;

    IF public.contributor_pilot_enabled(NEW.user_id) THEN
      SELECT * INTO v_screen FROM public.straight_order_screenings
        WHERE id = nullif(current_setting('app.straight_screening_id',true),'')::uuid
          AND user_id = auth.uid() AND consumed_at IS NULL
          AND verdict IN ('pass','manual_review') AND created_at > now() - interval '30 minutes';
      IF NOT FOUND THEN RAISE EXCEPTION 'screening_required'; END IF;
      NEW.screening_id := v_screen.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
