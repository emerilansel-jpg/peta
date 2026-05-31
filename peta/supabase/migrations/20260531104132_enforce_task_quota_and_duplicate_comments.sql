-- Enforce task quota at claim time, not approval time.
-- This prevents multiple army members from taking a 1-slot forum task while
-- the first member is still in_progress/submitted.

CREATE OR REPLACE FUNCTION public.normalize_forum_comment(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(trim(coalesce(p_text, ''))), '\s+', ' ', 'g')
$$;

CREATE OR REPLACE FUNCTION public.task_live_assignment_count(p_task_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::integer
  FROM public.task_assignments
  WHERE task_id = p_task_id
    AND status IN ('in_progress','submitted','approved')
$$;

CREATE OR REPLACE FUNCTION public.sync_task_slot_count(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live int;
BEGIN
  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;

  UPDATE public.tasks
  SET current_assignments = LEAST(COALESCE(max_assignments, 0), v_live),
      status = CASE
        WHEN status = 'active' AND v_live >= COALESCE(max_assignments, 0) THEN 'completed'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_task_id;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_unique_forum_comment(
  p_assignment_id uuid,
  p_task_id uuid,
  p_comment text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_comment text := public.normalize_forum_comment(p_comment);
  v_duplicate_id uuid;
BEGIN
  IF v_comment IS NULL OR length(v_comment) < 20 THEN
    RETURN;
  END IF;

  SELECT id, task_category, target_url
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id;

  IF COALESCE(v_task.task_category, '') <> 'forum_comment' THEN
    RETURN;
  END IF;

  SELECT ta.id
  INTO v_duplicate_id
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.id IS DISTINCT FROM p_assignment_id
    AND t.task_category = 'forum_comment'
    AND ta.status IN ('in_progress','submitted','approved')
    AND public.normalize_forum_comment(ta.draft_comment) = v_comment
    AND COALESCE(NULLIF(trim(t.target_url), ''), t.id::text)
        = COALESCE(NULLIF(trim(v_task.target_url), ''), v_task.id::text)
  LIMIT 1;

  IF v_duplicate_id IS NOT NULL THEN
    RAISE EXCEPTION 'Komentar ini sudah pernah dipakai untuk target forum yang sama. Ubah komentarnya supaya aman dan tidak terlihat spam.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tg_enforce_assignment_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_limit int;
  v_existing int;
  v_live int;
BEGIN
  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  v_limit := COALESCE(v_task.per_account_limit, 1);

  IF TG_OP = 'INSERT' THEN
    IF v_task.status <> 'active'
      OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
      OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
      RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    SELECT public.task_live_assignment_count(NEW.task_id) INTO v_live;
    IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
      PERFORM public.sync_task_slot_count(NEW.task_id);
      RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(v_task.task_category, '') = 'forum_comment' THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

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
        RAISE EXCEPTION 'Akun Reddit wajib untuk task ini.' USING ERRCODE = 'P0001';
      END IF;

      SELECT user_id INTO NEW.user_id
      FROM public.reddit_accounts
      WHERE id = NEW.reddit_account_id;

      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Akun tidak valid.' USING ERRCODE = 'P0001';
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
  END IF;

  IF NEW.draft_comment IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.draft_comment IS DISTINCT FROM OLD.draft_comment OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.enforce_unique_forum_comment(NEW.id, NEW.task_id, NEW.draft_comment);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_enforce_per_account_limit_before_insert ON public.task_assignments;
DROP TRIGGER IF EXISTS tg_enforce_assignment_rules_before_write ON public.task_assignments;

CREATE TRIGGER tg_enforce_assignment_rules_before_write
BEFORE INSERT OR UPDATE OF draft_comment, status ON public.task_assignments
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_assignment_rules();

DROP POLICY IF EXISTS "assignments_insert_own" ON public.task_assignments;
CREATE POLICY "assignments_insert_own" ON public.task_assignments
  FOR INSERT WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task record;
  v_account record;
  v_assignment public.task_assignments;
  v_live int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.status <> 'active'
    OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
    OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at) THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_task.task_category, '') = 'forum_comment' THEN
    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
    VALUES (p_task_id, v_uid, NULL, 'in_progress')
    RETURNING * INTO v_assignment;
  ELSE
    SELECT *
    INTO v_account
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id
      AND user_id = v_uid;

    IF v_account.id IS NULL THEN
      RAISE EXCEPTION 'Pilih akun Reddit yang valid.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.is_admin() THEN
      IF v_account.karma < COALESCE(v_task.min_karma, 0)
        OR v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0)
        OR v_account.status_flag IN ('suspended','not_found') THEN
        RAISE EXCEPTION 'Akun ini belum eligible untuk task ini.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status)
    VALUES (p_task_id, v_uid, p_reddit_account_id, 'in_progress')
    RETURNING * INTO v_assignment;
  END IF;

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_task_assignment(uuid, uuid) TO authenticated;

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      GREATEST(COALESCE(t.current_assignments, 0), slot.live_assignments)::integer,
      t.min_karma, t.min_account_age_days, t.per_account_limit,
      t.status, t.start_at, t.end_at, t.created_at, NULL::uuid
    FROM public.tasks t
    CROSS JOIN LATERAL (SELECT public.task_live_assignment_count(t.id) AS live_assignments) slot
    WHERE t.status = 'active'
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND slot.live_assignments < COALESCE(t.max_assignments, 0)
    ORDER BY t.id, t.created_at DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    GREATEST(COALESCE(t.current_assignments, 0), slot.live_assignments)::integer,
    t.min_karma, t.min_account_age_days, t.per_account_limit,
    t.status, t.start_at, t.end_at, t.created_at, NULL::uuid
  FROM public.tasks t
  CROSS JOIN LATERAL (SELECT public.task_live_assignment_count(t.id) AS live_assignments) slot
  WHERE t.status = 'active'
    AND t.task_category = 'forum_comment'
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND slot.live_assignments < COALESCE(t.max_assignments, 0)
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
    GREATEST(COALESCE(t.current_assignments, 0), slot.live_assignments)::integer,
    t.min_karma, t.min_account_age_days, t.per_account_limit,
    t.status, t.start_at, t.end_at, t.created_at, ra.id
  FROM public.tasks t
  CROSS JOIN LATERAL (SELECT public.task_live_assignment_count(t.id) AS live_assignments) slot
  JOIN public.reddit_accounts ra ON ra.user_id = v_user
  WHERE t.status = 'active'
    AND COALESCE(t.task_category, '') <> 'forum_comment'
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND slot.live_assignments < COALESCE(t.max_assignments, 0)
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

CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    PERFORM public.sync_task_slot_count(NEW.task_id);

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

UPDATE public.tasks t
SET current_assignments = LEAST(COALESCE(t.max_assignments, 0), slot.live_assignments),
    status = CASE
      WHEN t.status = 'active' AND slot.live_assignments >= COALESCE(t.max_assignments, 0) THEN 'completed'
      ELSE t.status
    END,
    updated_at = now()
FROM (
  SELECT task_id, count(*)::integer AS live_assignments
  FROM public.task_assignments
  WHERE status IN ('in_progress','submitted','approved')
  GROUP BY task_id
) slot
WHERE t.id = slot.task_id;
