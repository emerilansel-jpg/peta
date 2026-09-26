-- Migration: 20260915000000_security_and_data_integrity_fixes.sql
-- Fixes:
-- 1. Lock down activity_logs RLS insert policy (prevent spoofed/open logs from anon)
-- 2. Prevent claiming tasks when member/account has permanent rejection (can_retry = false)
-- 3. Block assignment approval when linked Straight source order is cancelled or refunded
-- 4. Provide secure public community feed RPC (no PII leak, works under strict table RLS)

BEGIN;

-- 1. Activity Logs RLS Hardening
DROP POLICY IF EXISTS "activity_insert_any" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_insert_own" ON public.activity_logs;
CREATE POLICY "activity_insert_own" ON public.activity_logs
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
    OR auth.role() = 'service_role'
  );
REVOKE INSERT ON public.activity_logs FROM anon;
GRANT INSERT ON public.activity_logs TO authenticated, service_role;

-- 2. Non-Challenge Tasks: Enforce Permanent Rejection (can_retry = false)
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

    IF COALESCE(v_task.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment'
    ) THEN
      NEW.reddit_account_id := NULL;
      NEW.user_id := COALESCE(NEW.user_id, auth.uid());
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
      END IF;

      SELECT COUNT(*) INTO v_existing
      FROM public.task_assignments
      WHERE task_id = NEW.task_id
        AND user_id = NEW.user_id
        AND (
          status IN ('in_progress','submitted','approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Kamu sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per member). Coba task lain.', v_limit
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
        AND (
          status IN ('in_progress','submitted','approved')
          OR (status = 'rejected' AND COALESCE(can_retry, false) = false)
        );

      IF v_existing >= v_limit THEN
        RAISE EXCEPTION 'Akun Reddit ini sudah pernah kerjain task ini atau tugas tidak dapat diulang (max % per akun). Coba task lain.', v_limit
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

-- 3. Order Cancellation Guard on Assignment Approval
CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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

    -- Credit cashable task reward ONLY for regular tasks.
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

      -- Populate delivery proof fields for client
      IF v_task_category = 'forum_comment' THEN
        v_proof_text := COALESCE(NEW.submitted_url, NEW.proof_url, NEW.draft_comment);
        UPDATE public.reddit_upvote_orders
        SET delivery_proof_text = COALESCE(v_proof_text, delivery_proof_text),
            delivery_proof_url  = COALESCE(NEW.proof_image_url, NEW.proof_url, delivery_proof_url)
        WHERE id = v_source_order_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Public Community Feed RPC (Masked names, safe for anon & army under strict RLS)
CREATE OR REPLACE FUNCTION public.get_public_community_feed(p_limit int DEFAULT 12)
RETURNS TABLE (
  kind text,
  who text,
  amount int,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT kind, who, amount, created_at FROM (
    -- Signups
    SELECT
      'signup'::text AS kind,
      CASE
        WHEN length(coalesce(full_name, split_part(email, '@', 1))) <= 3 THEN '***'
        ELSE substring(coalesce(full_name, split_part(email, '@', 1)), 1, 3) || '***'
      END AS who,
      0::int AS amount,
      created_at
    FROM public.users
    WHERE role IN ('army', 'hero_army') AND is_active = true
    ORDER BY created_at DESC
    LIMIT p_limit
  ) s
  UNION ALL
  SELECT kind, who, amount, created_at FROM (
    -- Paid payouts
    SELECT
      'payout'::text AS kind,
      CASE
        WHEN length(coalesce(u.full_name, split_part(u.email, '@', 1))) <= 3 THEN '***'
        ELSE substring(coalesce(u.full_name, split_part(u.email, '@', 1)), 1, 3) || '***'
      END AS who,
      p.amount,
      coalesce(p.paid_at, p.created_at) AS created_at
    FROM public.payouts p
    JOIN public.users u ON u.id = p.user_id
    WHERE p.status = 'paid'
    ORDER BY coalesce(p.paid_at, p.created_at) DESC
    LIMIT p_limit
  ) p
  UNION ALL
  SELECT kind, who, amount, created_at FROM (
    -- Referral bonuses
    SELECT
      'referral'::text AS kind,
      CASE
        WHEN length(coalesce(u.full_name, split_part(u.email, '@', 1))) <= 3 THEN '***'
        ELSE substring(coalesce(u.full_name, split_part(u.email, '@', 1)), 1, 3) || '***'
      END AS who,
      c.amount,
      c.created_at
    FROM public.user_credits c
    JOIN public.users u ON u.id = c.user_id
    WHERE c.source = 'referral_bonus_referrer'
    ORDER BY c.created_at DESC
    LIMIT p_limit
  ) r
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_community_feed(int) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
