ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

UPDATE public.task_assignments ta
SET user_id = ra.user_id
FROM public.reddit_accounts ra
WHERE ta.reddit_account_id = ra.id
  AND ta.user_id IS NULL;

ALTER TABLE public.task_assignments
  ALTER COLUMN user_id SET DEFAULT auth.uid(),
  ALTER COLUMN reddit_account_id DROP NOT NULL;

DROP POLICY IF EXISTS "assignments_select_own" ON public.task_assignments;
DROP POLICY IF EXISTS "assignments_insert_own" ON public.task_assignments;
DROP POLICY IF EXISTS "assignments_update_own" ON public.task_assignments;

CREATE POLICY "assignments_select_own" ON public.task_assignments
  FOR SELECT USING (
    user_id = auth.uid()
    OR reddit_account_id IN (SELECT id FROM public.reddit_accounts WHERE user_id = auth.uid())
    OR public.is_admin()
  );

CREATE POLICY "assignments_insert_own" ON public.task_assignments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      reddit_account_id IS NULL
      OR reddit_account_id IN (SELECT id FROM public.reddit_accounts WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "assignments_update_own" ON public.task_assignments
  FOR UPDATE USING (
    user_id = auth.uid()
    OR reddit_account_id IN (SELECT id FROM public.reddit_accounts WHERE user_id = auth.uid())
    OR public.is_admin()
  );

CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  brief text,
  target_url text,
  task_type text,
  task_category text,
  reward_amount integer,
  max_assignments integer,
  current_assignments integer,
  min_karma integer,
  min_account_age_days integer,
  per_account_limit integer,
  status text,
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz,
  can_do_with_account_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_has_reddit boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  v_is_admin := public.is_admin();
  v_has_reddit := EXISTS (SELECT 1 FROM public.reddit_accounts WHERE user_id = v_user);

  IF v_is_admin AND NOT v_has_reddit THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, NULL::uuid AS can_do_with_account_id
    FROM public.tasks t
    WHERE t.status = 'active'
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
    ORDER BY t.id, t.created_at DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.task_category = 'forum_comment'
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND ta.status IN ('in_progress','submitted','approved')
    ) < COALESCE(t.per_account_limit, 1)
  ORDER BY t.id, t.created_at DESC;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, ra.id AS can_do_with_account_id
  FROM public.tasks t
  JOIN public.reddit_accounts ra ON ra.user_id = v_user
  WHERE t.status = 'active'
    AND COALESCE(t.task_category, '') <> 'forum_comment'
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (v_is_admin OR ra.karma >= COALESCE(t.min_karma, 0))
    AND (v_is_admin OR ra.account_age_days >= COALESCE(t.min_account_age_days, 0))
    AND (v_is_admin OR ra.status_flag NOT IN ('suspended','not_found'))
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.reddit_account_id = ra.id
        AND ta.status IN ('in_progress','submitted','approved')
    ) < COALESCE(t.per_account_limit, 1)
  ORDER BY t.id, t.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.list_eligible_tasks_for_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_pending_assignments()
RETURNS TABLE(
  id uuid,
  task_id uuid,
  status text,
  admin_notes text,
  can_retry boolean,
  proof_url text,
  draft_comment text,
  created_at timestamptz,
  updated_at timestamptz,
  task_title text,
  task_category text,
  task_reward integer,
  task_target_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  RETURN QUERY
  SELECT ta.id, ta.task_id, ta.status, ta.admin_notes, ta.can_retry,
         ta.proof_url, ta.draft_comment,
         ta.created_at, ta.updated_at,
         t.title, t.task_category, t.reward_amount, t.target_url
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE (
      ta.user_id = v_uid
      OR ta.reddit_account_id IN (SELECT ra.id FROM public.reddit_accounts ra WHERE ra.user_id = v_uid)
    )
    AND ta.status IN ('in_progress','submitted','rejected')
  ORDER BY ta.created_at DESC
  LIMIT 50;
END $$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_assignments() TO authenticated;

CREATE OR REPLACE FUNCTION public.retry_rejected_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_can_retry boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT COALESCE(ta.user_id, ra.user_id), ta.can_retry
  INTO v_owner, v_can_retry
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  WHERE ta.id = p_assignment_id;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'not your assignment'; END IF;
  IF NOT v_can_retry THEN RAISE EXCEPTION 'rejection is final - no retry allowed'; END IF;

  UPDATE public.task_assignments
  SET status = 'in_progress',
      proof_url = NULL,
      draft_comment = NULL,
      admin_notes = NULL,
      updated_at = now()
  WHERE id = p_assignment_id AND status = 'rejected' AND can_retry = true;
END $$;

GRANT EXECUTE ON FUNCTION public.retry_rejected_assignment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_enforce_per_account_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit int;
  v_existing int;
  v_category text;
BEGIN
  SELECT COALESCE(per_account_limit, 1), task_category
  INTO v_limit, v_category
  FROM public.tasks
  WHERE id = NEW.task_id;

  IF v_category = 'forum_comment' THEN
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND user_id = NEW.user_id
      AND status IN ('in_progress','submitted','approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini (max % per member). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.reddit_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_existing
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND reddit_account_id = NEW.reddit_account_id
      AND status IN ('in_progress','submitted','approved');
    IF v_existing >= v_limit THEN
      RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini (max % per akun). Coba task lain.', v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_reward int;
  v_task_title text;
  v_source_order_id int;
  v_requested int;
  v_delivered int;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT COALESCE(ta.user_id, ra.user_id), t.reward_amount, t.title, t.source_order_id
      INTO v_user_id, v_reward, v_task_title, v_source_order_id
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.id = NEW.id;

    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (
      v_user_id, v_reward, 'task_reward',
      format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
      NEW.id
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.tasks SET current_assignments = current_assignments + 1 WHERE id = NEW.task_id;

    IF v_source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET delivered_upvotes = COALESCE(delivered_upvotes, 0) + 1
      WHERE id = v_source_order_id;

      SELECT requested_upvotes, delivered_upvotes INTO v_requested, v_delivered
      FROM public.reddit_upvote_orders WHERE id = v_source_order_id;

      IF v_delivered >= v_requested THEN
        UPDATE public.reddit_upvote_orders
        SET status = 'completed', completed_at = NOW()
        WHERE id = v_source_order_id AND status NOT IN ('completed','refunded');
        UPDATE public.tasks SET status = 'completed'
        WHERE id = NEW.task_id AND status = 'active';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION IF EXISTS public.admin_pending_approvals();

CREATE OR REPLACE FUNCTION public.admin_pending_approvals()
RETURNS TABLE(
  assignment_id   uuid,
  status          text,
  proof_url       text,
  draft_comment   text,
  admin_notes     text,
  created_at      timestamptz,
  updated_at      timestamptz,
  submitted_at    timestamptz,
  task_id         uuid,
  task_title      text,
  task_target_url text,
  task_category   text,
  task_type       text,
  task_reward     int,
  submitted_url   text,
  submitted_username text,
  proof_image_url text,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    ta.draft_comment::text,
    ta.admin_notes::text,
    ta.created_at,
    ta.updated_at,
    COALESCE(ta.updated_at, ta.created_at) AS submitted_at,
    t.id AS task_id,
    t.title::text AS task_title,
    t.target_url::text AS task_target_url,
    t.task_category::text,
    t.task_type::text,
    t.reward_amount AS task_reward,
    ta.submitted_url::text,
    ta.submitted_username::text,
    ta.proof_image_url::text,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = COALESCE(ta.user_id, ra.user_id)
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;
