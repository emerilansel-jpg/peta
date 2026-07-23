-- ============================================================
-- PeTa — assignment history and rejected-task visibility.
-- Keeps rejection/completion history even after a retry mutates the
-- live assignment back to in_progress.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.task_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.task_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('approved', 'rejected')),
  admin_notes text,
  can_retry boolean NOT NULL DEFAULT false,
  proof_url text,
  draft_comment text,
  event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_history_user_event
  ON public.task_assignment_history(user_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_assignment_history_assignment_event
  ON public.task_assignment_history(assignment_id, event_at DESC);

ALTER TABLE public.task_assignment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_assignment_history_select_own" ON public.task_assignment_history;
CREATE POLICY "task_assignment_history_select_own" ON public.task_assignment_history
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "task_assignment_history_admin_all" ON public.task_assignment_history;
CREATE POLICY "task_assignment_history_admin_all" ON public.task_assignment_history
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.record_task_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.status IN ('approved', 'rejected')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT COALESCE(NEW.user_id, ra.user_id)
      INTO v_user_id
    FROM public.reddit_accounts ra
    WHERE ra.id = NEW.reddit_account_id;

    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.task_assignment_history (
        assignment_id, user_id, task_id, status, admin_notes,
        can_retry, proof_url, draft_comment, event_at
      ) VALUES (
        NEW.id, v_user_id, NEW.task_id, NEW.status, NEW.admin_notes,
        COALESCE(NEW.can_retry, false), NEW.proof_url, NEW.draft_comment, now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_task_assignment_history ON public.task_assignments;
CREATE TRIGGER trg_record_task_assignment_history
  AFTER INSERT OR UPDATE OF status ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.record_task_assignment_history();

-- Backfill the current terminal state of existing assignments. The trigger
-- handles future transitions and repeated reject -> retry -> reject events.
INSERT INTO public.task_assignment_history (
  assignment_id, user_id, task_id, status, admin_notes,
  can_retry, proof_url, draft_comment, event_at
)
SELECT
  ta.id,
  COALESCE(ta.user_id, ra.user_id),
  ta.task_id,
  ta.status,
  ta.admin_notes,
  COALESCE(ta.can_retry, false),
  ta.proof_url,
  ta.draft_comment,
  ta.updated_at
FROM public.task_assignments ta
LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
WHERE ta.status IN ('approved', 'rejected')
  AND COALESCE(ta.user_id, ra.user_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.task_assignment_history h
    WHERE h.assignment_id = ta.id
      AND h.status = ta.status
  );

CREATE OR REPLACE FUNCTION public.get_my_task_history()
RETURNS TABLE(
  id uuid,
  assignment_id uuid,
  task_id uuid,
  status text,
  admin_notes text,
  can_retry boolean,
  proof_url text,
  draft_comment text,
  event_at timestamptz,
  task_title text,
  task_category text,
  task_reward integer,
  task_target_url text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  RETURN QUERY
  SELECT h.id, h.assignment_id, h.task_id, h.status, h.admin_notes,
         h.can_retry, h.proof_url, h.draft_comment, h.event_at,
         t.title, t.task_category, t.reward_amount, t.target_url
  FROM public.task_assignment_history h
  JOIN public.tasks t ON t.id = h.task_id
  WHERE h.user_id = v_uid
  ORDER BY h.event_at DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_task_history() TO authenticated;

-- Recreate the current eligible-task RPC with a server-side rejected-task
-- exclusion. Hidden-task and display-order behavior comes from the previous
-- task-order migration and is retained here.
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(
  id uuid, title text, description text, brief text, target_url text,
  task_type text, task_category text, reward_amount integer,
  max_assignments integer, current_assignments integer, min_karma integer,
  min_account_age_days integer, per_account_limit integer, status text,
  start_at timestamptz, end_at timestamptz, created_at timestamptz,
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
    SELECT DISTINCT ON (t.display_order, t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments, t.current_assignments,
      t.min_karma, t.min_account_age_days, t.per_account_limit, t.status,
      t.start_at, t.end_at, t.created_at, NULL::uuid
    FROM public.tasks t
    WHERE t.status = 'active'
      AND NOT COALESCE(t.is_hidden, false)
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
      AND NOT EXISTS (
        SELECT 1 FROM public.task_assignments ta
        LEFT JOIN public.reddit_accounts rejected_ra ON rejected_ra.id = ta.reddit_account_id
        WHERE ta.task_id = t.id
          AND COALESCE(ta.user_id, rejected_ra.user_id) = v_user
          AND ta.status = 'rejected'
      )
    ORDER BY t.display_order ASC, t.id ASC, t.created_at DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (t.display_order, t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments, t.current_assignments,
    t.min_karma, t.min_account_age_days, t.per_account_limit, t.status,
    t.start_at, t.end_at, t.created_at, NULL::uuid
  FROM public.tasks t
  WHERE t.status = 'active'
    AND NOT COALESCE(t.is_hidden, false)
    AND t.task_category IN ('forum_comment', 'youtube_upload')
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND NOT EXISTS (
      SELECT 1 FROM public.task_assignments ta
      LEFT JOIN public.reddit_accounts rejected_ra ON rejected_ra.id = ta.reddit_account_id
      WHERE ta.task_id = t.id
        AND COALESCE(ta.user_id, rejected_ra.user_id) = v_user
        AND ta.status = 'rejected'
    )
    AND (SELECT count(*) FROM public.task_assignments ta
         WHERE ta.task_id = t.id AND ta.user_id = v_user
           AND ta.status IN ('in_progress','submitted','approved')) < COALESCE(t.per_account_limit, 1)
  ORDER BY t.display_order ASC, t.id ASC, t.created_at DESC;

  RETURN QUERY
  SELECT DISTINCT ON (t.display_order, t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments, t.current_assignments,
    t.min_karma, t.min_account_age_days, t.per_account_limit, t.status,
    t.start_at, t.end_at, t.created_at, ra.id
  FROM public.tasks t
  JOIN public.reddit_accounts ra ON ra.user_id = v_user
  WHERE t.status = 'active'
    AND NOT COALESCE(t.is_hidden, false)
    AND COALESCE(t.task_category, '') NOT IN ('forum_comment', 'youtube_upload')
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (v_is_admin OR ra.karma >= COALESCE(t.min_karma, 0))
    AND (v_is_admin OR ra.account_age_days >= COALESCE(t.min_account_age_days, 0))
    AND (v_is_admin OR ra.status_flag NOT IN ('suspended','not_found'))
    AND NOT EXISTS (
      SELECT 1 FROM public.task_assignments ta
      LEFT JOIN public.reddit_accounts rejected_ra ON rejected_ra.id = ta.reddit_account_id
      WHERE ta.task_id = t.id
        AND COALESCE(ta.user_id, rejected_ra.user_id) = v_user
        AND ta.status = 'rejected'
    )
    AND (SELECT count(*) FROM public.task_assignments ta
         WHERE ta.task_id = t.id AND ta.reddit_account_id = ra.id
           AND ta.status IN ('in_progress','submitted','approved')) < COALESCE(t.per_account_limit, 1)
  ORDER BY t.display_order ASC, t.id ASC, t.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_eligible_tasks_for_user() TO authenticated;
NOTIFY pgrst, 'reload schema';
