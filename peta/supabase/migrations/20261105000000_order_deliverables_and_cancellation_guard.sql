-- ============================================================
-- Migration: 20261105000000_order_deliverables_and_cancellation_guard.sql
--
-- 1. Table order_deliverables: Relational storage for each delivered item
--    (No more overwriting screenshots when multiple reviews are ordered).
-- 2. Anti-fraud proof_image_hash on task_assignments: Prevents duplicate screenshots.
-- 3. Cancellation Lock Guard in fn_reddit_order_cancel_refund:
--    Protects army workers from having their in_progress/submitted work cancelled.
-- 4. RPCs: get_order_deliverables and get_order_cancellation_preview.
-- ============================================================

-- 1. TABLE: order_deliverables
CREATE TABLE IF NOT EXISTS public.order_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL REFERENCES public.reddit_upvote_orders(id) ON DELETE CASCADE,
  task_assignment_id uuid REFERENCES public.task_assignments(id) ON DELETE SET NULL,
  item_index int NOT NULL DEFAULT 1,
  reviewer_name text,
  proof_url text,
  screenshot_url text,
  status text NOT NULL DEFAULT 'delivered' CHECK (status IN ('delivered', 'disputed', 'replaced')),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_deliverables_order_id ON public.order_deliverables(order_id);
CREATE INDEX IF NOT EXISTS idx_order_deliverables_assignment_id ON public.order_deliverables(task_assignment_id);

ALTER TABLE public.order_deliverables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_deliverables_select_own" ON public.order_deliverables;
CREATE POLICY "order_deliverables_select_own" ON public.order_deliverables
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.reddit_upvote_orders o
    WHERE o.id = order_deliverables.order_id
      AND (o.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "order_deliverables_admin_all" ON public.order_deliverables;
CREATE POLICY "order_deliverables_admin_all" ON public.order_deliverables
FOR ALL USING (public.is_admin());

-- Backfill legacy deliverables from already completed / approved assignments
INSERT INTO public.order_deliverables (
  order_id,
  task_assignment_id,
  item_index,
  reviewer_name,
  proof_url,
  screenshot_url,
  delivered_at
)
SELECT
  t.source_order_id,
  ta.id,
  ROW_NUMBER() OVER (PARTITION BY t.source_order_id ORDER BY ta.updated_at ASC) AS item_index,
  COALESCE(NULLIF(trim(ta.submitted_username), ''), 'Member PeTa'),
  COALESCE(NULLIF(trim(ta.submitted_url), ''), ta.proof_url),
  ta.proof_image_url,
  COALESCE(ta.updated_at, NOW())
FROM public.task_assignments ta
JOIN public.tasks t ON t.id = ta.task_id
WHERE t.source_order_id IS NOT NULL
  AND ta.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_deliverables od
    WHERE od.task_assignment_id = ta.id
  )
ON CONFLICT DO NOTHING;

-- 2. ANTI-FRAUD: proof_image_hash ON task_assignments
ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS proof_image_hash text;
CREATE INDEX IF NOT EXISTS idx_task_assignments_proof_hash ON public.task_assignments(proof_image_hash) WHERE proof_image_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_enforce_unique_proof_image_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.proof_image_hash IS NOT NULL AND length(trim(NEW.proof_image_hash)) > 0 THEN
    IF NEW.status IN ('submitted', 'approved') THEN
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments
        WHERE proof_image_hash = NEW.proof_image_hash
          AND id <> NEW.id
          AND status IN ('submitted', 'approved')
      ) THEN
        RAISE EXCEPTION 'Screenshot ini sudah pernah digunakan untuk pengerjaan tugas lain. Harap upload screenshot asli pengerjaan kamu.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_unique_proof_image_hash ON public.task_assignments;
CREATE TRIGGER trg_enforce_unique_proof_image_hash
BEFORE INSERT OR UPDATE OF proof_image_hash, status ON public.task_assignments
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_unique_proof_image_hash();

-- Update submit_assignment_proof RPC to accept p_proof_image_hash
CREATE OR REPLACE FUNCTION public.submit_assignment_proof(
  p_assignment_id uuid,
  p_proof_url text DEFAULT NULL::text,
  p_submitted_url text DEFAULT NULL::text,
  p_submitted_username text DEFAULT NULL::text,
  p_draft_comment text DEFAULT NULL::text,
  p_proof_urls jsonb DEFAULT '[]'::jsonb,
  p_user_note text DEFAULT NULL::text,
  p_proof_image_url text DEFAULT NULL::text,
  p_proof_image_hash text DEFAULT NULL::text
)
RETURNS task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment public.task_assignments;
  v_task public.tasks;
  v_contributor boolean;
  v_first_submitted timestamptz;
  v_visibility_check timestamptz;
  v_proof_urls jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = true) THEN
    RAISE EXCEPTION 'Akun kamu sedang dinonaktifkan.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_assignment.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = v_assignment.reddit_account_id)) IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    v_assignment.status IN ('in_progress', 'submitted')
    OR (v_assignment.status = 'rejected' AND COALESCE(v_assignment.can_retry, false) = true)
  ) THEN
    RAISE EXCEPTION 'Assignment status tidak valid untuk submit bukti: %', v_assignment.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = v_assignment.task_id;

  v_proof_urls := COALESCE(p_proof_urls, '[]'::jsonb);
  IF jsonb_typeof(v_proof_urls) IS DISTINCT FROM 'array' THEN
    v_proof_urls := '[]'::jsonb;
  END IF;

  -- Validasi bukti minimal di server trust boundary
  IF COALESCE(v_task.task_category, '') IN ('preferred_source', 'linkedin_like', 'linkedin_follow') THEN
    IF NULLIF(trim(COALESCE(p_proof_image_url, v_assignment.proof_image_url, '')), '') IS NULL
       AND NULLIF(trim(COALESCE(p_proof_url, v_assignment.proof_url, '')), '') IS NULL
       AND jsonb_array_length(v_proof_urls) = 0 THEN
      RAISE EXCEPTION 'Screenshot bukti wajib disertakan.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF COALESCE(v_task.task_category, '') IN ('forum_comment', 'linkedin_comment') THEN
    IF NULLIF(trim(COALESCE(p_submitted_url, p_proof_url, v_assignment.submitted_url, v_assignment.proof_url, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Link posting / komentar wajib diisi.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NULLIF(trim(COALESCE(p_submitted_url, p_proof_url, v_assignment.submitted_url, v_assignment.proof_url, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Link video YouTube wajib diisi.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_first_submitted := v_assignment.first_proof_submitted_at;
  v_visibility_check := v_assignment.visibility_check_after;

  IF v_first_submitted IS NULL THEN
    v_first_submitted := NOW();
    v_visibility_check := v_first_submitted + INTERVAL '72 hours';
  END IF;

  v_contributor := COALESCE(v_assignment.contributor_workflow, false);

  UPDATE public.task_assignments
  SET status = 'submitted',
      proof_url = COALESCE(p_proof_url, proof_url),
      submitted_url = COALESCE(p_submitted_url, submitted_url),
      submitted_username = COALESCE(p_submitted_username, submitted_username),
      draft_comment = COALESCE(p_draft_comment, draft_comment),
      proof_urls = v_proof_urls,
      user_note = COALESCE(p_user_note, user_note),
      proof_image_url = COALESCE(p_proof_image_url, proof_image_url),
      proof_image_hash = COALESCE(p_proof_image_hash, proof_image_hash),
      first_proof_submitted_at = v_first_submitted,
      visibility_check_after = v_visibility_check,
      contributor_workflow = v_contributor,
      submitted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$function$;

-- 3. UPDATE tg_on_assignment_approved TO POPULATE order_deliverables
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

    -- If linked to a client order, verify order is not cancelled or refunded
    IF v_source_order_id IS NOT NULL THEN
      SELECT status INTO v_order_status
      FROM public.reddit_upvote_orders
      WHERE id = v_source_order_id;

      IF v_order_status IN ('cancelled', 'refunded') THEN
        RAISE EXCEPTION 'Tidak bisa approve tugas dari pesanan yang sudah dibatalkan atau direfund.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Credit cashable task reward ONLY for regular tasks (exclude reddit_challenge retention)
    IF v_task_category IS DISTINCT FROM 'reddit_challenge' THEN
      INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
      VALUES (
        v_user_id, v_reward, 'task_reward',
        format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
        NEW.id
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (
        v_user_id,
        'task_reward_credited',
        jsonb_build_object(
          'assignment_id', NEW.id,
          'task_id', NEW.task_id,
          'amount', v_reward,
          'source_order_id', v_source_order_id
        )
      );
    END IF;

    NEW.balance_credited_at := NOW();

    -- Straight order sync (B2B orders)
    IF v_source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET delivered_upvotes = COALESCE(delivered_upvotes, 0) + 1
      WHERE id = v_source_order_id;

      SELECT requested_upvotes, delivered_upvotes INTO v_requested, v_delivered
      FROM public.reddit_upvote_orders WHERE id = v_source_order_id;

      IF v_requested IS NOT NULL AND v_delivered >= v_requested THEN
        UPDATE public.reddit_upvote_orders
        SET status = 'completed', completed_at = NOW()
        WHERE id = v_source_order_id
          AND status IN ('pending', 'processing');
      END IF;

      -- 1. Insert into relational order_deliverables (No overwriting!)
      SELECT COALESCE(MAX(item_index), 0) + 1 INTO v_next_index
      FROM public.order_deliverables
      WHERE order_id = v_source_order_id;

      INSERT INTO public.order_deliverables (
        order_id,
        task_assignment_id,
        item_index,
        reviewer_name,
        proof_url,
        screenshot_url,
        delivered_at
      ) VALUES (
        v_source_order_id,
        NEW.id,
        v_next_index,
        COALESCE(NULLIF(trim(NEW.submitted_username), ''), 'Member PeTa'),
        COALESCE(NULLIF(trim(NEW.submitted_url), ''), NEW.proof_url),
        NEW.proof_image_url,
        NOW()
      )
      ON CONFLICT DO NOTHING;

      -- 2. Populate legacy delivery proof fields for backwards compatibility
      v_proof_text := COALESCE(NEW.submitted_url, NEW.proof_url, NEW.draft_comment);
      UPDATE public.reddit_upvote_orders
      SET delivery_proof_text = CASE
            WHEN delivery_proof_text IS NULL OR length(trim(delivery_proof_text)) = 0 THEN v_proof_text
            ELSE delivery_proof_text || E'\n\n---\n\n' || v_proof_text
          END,
          delivery_proof_url = COALESCE(NEW.proof_image_url, NEW.proof_url, delivery_proof_url)
      WHERE id = v_source_order_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. CANCELLATION LOCK GUARD in fn_reddit_order_cancel_refund
CREATE OR REPLACE FUNCTION public.fn_reddit_order_cancel_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_spend_count BIGINT;
  v_existing_refund BIGINT;
  v_cost INTEGER;
  v_requested INTEGER;
  v_delivered INTEGER;
  v_locked_active INTEGER := 0;
  v_total_committed INTEGER := 0;
  v_refundable_units INTEGER := 0;
  v_refund_amount INTEGER := 0;
  v_current_balance INTEGER;
BEGIN
  -- Only act on transition to 'cancelled'.
  IF NEW.status IS DISTINCT FROM 'cancelled' OR OLD.status IS NOT DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Defensive: only refund if there was a spend transaction for this order.
  SELECT COUNT(*) INTO v_spend_count
  FROM public.credit_transactions
  WHERE user_id = NEW.user_id
    AND type = 'spend'
    AND metadata ->> 'reddit_upvote_order_id' = NEW.id::TEXT;

  IF v_spend_count = 0 THEN
    RETURN NEW;
  END IF;

  -- Idempotency: bail if a refund already exists for this order.
  SELECT COUNT(*) INTO v_existing_refund
  FROM public.credit_transactions
  WHERE user_id = NEW.user_id
    AND type = 'refund'
    AND metadata ->> 'reddit_upvote_order_id' = NEW.id::TEXT;

  IF v_existing_refund > 0 THEN
    RETURN NEW;
  END IF;

  v_cost := COALESCE(NEW.cost_credits, 0);
  v_requested := COALESCE(NEW.requested_upvotes, 1);
  v_delivered := COALESCE(NEW.delivered_upvotes, 0);

  -- Count in_progress or submitted assignments currently locked by army
  SELECT
    COUNT(*)
  INTO v_locked_active
  FROM public.tasks t
  JOIN public.task_assignments ta ON ta.task_id = t.id
  WHERE t.source_order_id = NEW.id
    AND ta.status IN ('in_progress', 'submitted');

  v_total_committed := v_delivered + v_locked_active;

  -- GUARD: If all requested units are already completed or actively in progress, BLOCK CANCELLATION
  IF v_total_committed >= v_requested THEN
    RAISE EXCEPTION 'Semua slot pesanan sedang dikerjakan (% aktif) atau sudah selesai (% terkirim). Pesanan tidak dapat dibatalkan.',
      v_locked_active, v_delivered
      USING ERRCODE = 'P0001';
  END IF;

  -- Calculate refund strictly for uncommitted units
  v_refundable_units := GREATEST(v_requested - v_total_committed, 0);
  v_refund_amount := (v_refundable_units * v_cost) / v_requested;

  IF v_refund_amount > 0 THEN
    SELECT credit_balance INTO v_current_balance
    FROM public.users
    WHERE id = NEW.user_id
    FOR UPDATE;

    INSERT INTO public.credit_transactions (
      user_id, type, amount, balance_after, metadata
    ) VALUES (
      NEW.user_id,
      'refund',
      v_refund_amount,
      v_current_balance + v_refund_amount,
      jsonb_build_object(
        'reddit_upvote_order_id', NEW.id,
        'cancel_reason', NEW.cancel_reason,
        'requested_upvotes', v_requested,
        'delivered_upvotes', v_delivered,
        'locked_active_units', v_locked_active,
        'refundable_units', v_refundable_units
      )
    );

    -- Reduce max_assignments of associated tasks to freeze any further claims
    UPDATE public.tasks
    SET max_assignments = v_total_committed,
        status = CASE WHEN v_total_committed > 0 THEN 'active' ELSE 'paused' END,
        updated_at = NOW()
    WHERE source_order_id = NEW.id;

    -- Append note to cancel_reason
    NEW.cancel_reason := COALESCE(NEW.cancel_reason, '') ||
      format(' (Refund: %s dari %s unit. %s unit terkunci pengerjaan/terkirim)', v_refundable_units, v_requested, v_total_committed);
  END IF;

  -- Stamp the cancellation time (if not already set by caller).
  IF NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. RPCs FOR CLIENT PORTAL
CREATE OR REPLACE FUNCTION public.get_order_deliverables(p_order_id bigint)
RETURNS TABLE (
  id uuid,
  order_id bigint,
  item_index int,
  reviewer_name text,
  proof_url text,
  screenshot_url text,
  status text,
  delivered_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.reddit_upvote_orders o
    WHERE o.id = p_order_id
      AND (o.user_id = auth.uid() OR public.is_admin())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.order_id,
    d.item_index,
    d.reviewer_name,
    d.proof_url,
    d.screenshot_url,
    d.status,
    d.delivered_at
  FROM public.order_deliverables d
  WHERE d.order_id = p_order_id
  ORDER BY d.item_index ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_cancellation_preview(p_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_order public.reddit_upvote_orders;
  v_locked_active int := 0;
  v_total_committed int := 0;
  v_refundable_units int := 0;
  v_refund_amount int := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id
    AND (user_id = auth.uid() OR public.is_admin());

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Order not found');
  END IF;

  SELECT
    COUNT(*)
  INTO v_locked_active
  FROM public.tasks t
  JOIN public.task_assignments ta ON ta.task_id = t.id
  WHERE t.source_order_id = v_order.id
    AND ta.status IN ('in_progress', 'submitted');

  v_total_committed := COALESCE(v_order.delivered_upvotes, 0) + v_locked_active;
  v_refundable_units := GREATEST(COALESCE(v_order.requested_upvotes, 1) - v_total_committed, 0);
  v_refund_amount := (v_refundable_units * COALESCE(v_order.cost_credits, 0)) / COALESCE(v_order.requested_upvotes, 1);

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'requested_units', v_order.requested_upvotes,
    'delivered_units', v_order.delivered_upvotes,
    'locked_active_units', v_locked_active,
    'total_committed', v_total_committed,
    'refundable_units', v_refundable_units,
    'refund_amount', v_refund_amount,
    'can_cancel', (v_refundable_units > 0 AND v_order.status NOT IN ('cancelled', 'completed'))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_order_delivery_proofs(p_order_id bigint)
RETURNS TABLE (
  assignment_id uuid,
  status text,
  proof_url text,
  proof_image_url text,
  submitted_username text,
  submitted_at timestamptz,
  approved_at timestamptz,
  item_index int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.reddit_upvote_orders o
    WHERE o.id = p_order_id
      AND (o.user_id = auth.uid() OR public.is_admin())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    d.task_assignment_id AS assignment_id,
    d.status,
    d.proof_url,
    d.screenshot_url AS proof_image_url,
    d.reviewer_name AS submitted_username,
    d.created_at AS submitted_at,
    d.delivered_at AS approved_at,
    d.item_index
  FROM public.order_deliverables d
  WHERE d.order_id = p_order_id
  ORDER BY d.item_index ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_client_cancel_order(
  p_order_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_order public.reddit_upvote_orders;
  v_is_admin boolean;
  v_elapsed interval;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
  END IF;

  v_is_admin := public.is_admin();

  SELECT * INTO v_order
  FROM public.reddit_upvote_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_admin AND v_order.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Order sudah selesai atau sudah dibatalkan.' USING ERRCODE = 'P0001';
  END IF;

  -- 6 hour cancellation window check for non-admins
  IF NOT v_is_admin THEN
    v_elapsed := NOW() - v_order.created_at;
    IF v_elapsed > interval '6 hours' THEN
      RAISE EXCEPTION 'Batas waktu pembatalan otomatis (6 jam) telah berakhir. Hubungi support untuk bantuan.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Update order to cancelled (this invokes trg_reddit_order_cancel_refund which enforces lock guard!)
  UPDATE public.reddit_upvote_orders
  SET status = 'cancelled',
      cancel_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Client requested cancellation'),
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'status', 'cancelled'
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
