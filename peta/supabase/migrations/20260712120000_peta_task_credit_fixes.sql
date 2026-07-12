-- =============================================================
-- PeTa task credit fixes
--
-- Root causes addressed:
-- 1. tg_on_assignment_approved function existed but was never attached
--    to task_assignments, so approved tasks never credited user_credits.
-- 2. user_credits_source_check rejected source='task_reward'.
-- 3. validate_payout_eligibility JOINed reddit_accounts, excluding forum
--    tasks (reddit_account_id IS NULL) from earnings count.
-- 4. admin_reject_assignment RPC was used by the frontend but did not
--    exist in the database.
-- 5. No idempotency guard prevented duplicate credits on re-approval.
-- 6. No balance_credited_at tracking made recovery/audit hard.
--
-- Also provides a recovery RPC for historical approved-but-not-credited rows.
-- =============================================================

-- 1) Allow task_reward source so the approval trigger can insert credits.
ALTER TABLE public.user_credits
  DROP CONSTRAINT IF EXISTS user_credits_source_check;

ALTER TABLE public.user_credits
  ADD CONSTRAINT user_credits_source_check
  CHECK (source = ANY (ARRAY[
    'referral_bonus_referrer'::text,
    'referral_bonus_referee'::text,
    'signup_bonus'::text,
    'manual_adjustment'::text,
    'karma_milestone'::text,
    'task_reward'::text
  ]));

-- 2) Track when a credit was actually processed for an assignment.
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS balance_credited_at TIMESTAMPTZ NULL;

-- 3) Idempotency guard: one task_reward credit per assignment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credits_task_reward_reference_id
  ON public.user_credits (reference_id)
  WHERE source = 'task_reward';

-- 4) Recreate the approval trigger function with:
--    - credit insert into user_credits
--    - balance_credited_at timestamp set on the assignment
--    - activity log entry for audit
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

    -- Credit the army member. Unique partial index on (reference_id) for
    -- task_reward makes this idempotent across re-approvals.
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (
      v_user_id, v_reward, 'task_reward',
      format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
      NEW.id
    )
    ON CONFLICT DO NOTHING;

    -- Mark the assignment as credited so admins can audit retroactively.
    NEW.balance_credited_at := NOW();

    -- Audit trail for support/debugging.
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

    PERFORM public.sync_task_slot_count(NEW.task_id);

    -- Straight order sync: count delivered upvotes/comments and complete order if needed.
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

-- Attach the trigger. Use BEFORE so we can set balance_credited_at on NEW.
DROP TRIGGER IF EXISTS tg_on_assignment_approved ON public.task_assignments;
CREATE TRIGGER tg_on_assignment_approved
  BEFORE UPDATE OF status ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_on_assignment_approved();

-- 5) Fix payout eligibility: count forum tasks where reddit_account_id IS NULL
--    by using the assignment's own user_id (or falling back to the account owner).
CREATE OR REPLACE FUNCTION public.validate_payout_eligibility(
  p_user_id uuid,
  p_amount int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_created_at timestamptz;
  v_days_old int;
  v_approved_tasks int;
  v_weekly_total int;
  v_task_earnings int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_other_credits int;
  v_bonus_total int;
  v_committed int;
  v_bonus_unlocked boolean;
  v_cashable_pool int;
  v_available_unlocked int;
  v_weekly_cap CONSTANT int := 500000;
  v_min_account_age CONSTANT int := 7;
  v_min_approved_tasks CONSTANT int := 5;
  v_bonus_unlock_floor CONSTANT int := 100000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF auth.uid() <> p_user_id AND NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT created_at INTO v_created_at FROM public.users WHERE id = p_user_id;
  IF v_created_at IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  v_days_old := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_created_at)) / 86400)::int;

  -- Count approved tasks for the user, including forum tasks (reddit_account_id IS NULL).
  SELECT COUNT(*)::int INTO v_approved_tasks
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  WHERE COALESCE(ta.user_id, ra.user_id) = p_user_id AND ta.status = 'approved';

  SELECT COALESCE(SUM(amount), 0)::int INTO v_weekly_total
  FROM public.payouts
  WHERE user_id = p_user_id
    AND created_at > NOW() - INTERVAL '7 days'
    AND status IN ('pending', 'paid');

  -- Task earnings — canonical source: approved assignments * reward.
  -- LEFT JOIN on reddit_accounts so forum_comment tasks are included.
  SELECT COALESCE(SUM(t.reward_amount), 0)::int INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = p_user_id AND ta.status = 'approved';

  -- Credits split. task_reward is the ledger mirror of an approved assignment
  -- — excluded here to avoid double counting.
  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward') THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_other_credits
  FROM public.user_credits
  WHERE user_id = p_user_id;

  v_bonus_total := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= v_bonus_unlock_floor;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_committed
  FROM public.payouts
  WHERE user_id = p_user_id AND status IN ('pending', 'paid');

  v_cashable_pool := v_task_earnings + v_other_credits
                   + CASE WHEN v_bonus_unlocked THEN v_bonus_total ELSE 0 END;
  v_available_unlocked := v_cashable_pool - v_committed;

  IF v_days_old < v_min_account_age AND v_approved_tasks < v_min_approved_tasks THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'holding_period',
      'message', format(
        'Payout pertama buka setelah %s hari ATAU %s task approved. Akun kamu %s hari, task approved: %s.',
        v_min_account_age, v_min_approved_tasks, v_days_old, v_approved_tasks
      ),
      'days_old', v_days_old,
      'approved_tasks', v_approved_tasks,
      'task_earnings', v_task_earnings,
      'bonus_total', v_bonus_total,
      'bonus_unlocked', v_bonus_unlocked,
      'bonus_unlock_floor', v_bonus_unlock_floor,
      'available_unlocked', v_available_unlocked
    );
  END IF;

  IF p_amount > v_available_unlocked THEN
    IF NOT v_bonus_unlocked AND v_bonus_total > 0 THEN
      RETURN json_build_object(
        'eligible', false,
        'reason', 'earnings_floor',
        'message', format(
          'Saldo bonus (signup + referral) kebuka setelah kumpulin Rp%s dari TASK approved. Sekarang baru Rp%s dari task — kurang Rp%s lagi. Saldo dari task bisa langsung cair.',
          to_char(v_bonus_unlock_floor, 'FM999G999G999'),
          to_char(v_task_earnings, 'FM999G999G999'),
          to_char(v_bonus_unlock_floor - v_task_earnings, 'FM999G999G999')
        ),
        'task_earnings', v_task_earnings,
        'bonus_total', v_bonus_total,
        'bonus_unlocked', false,
        'bonus_unlock_floor', v_bonus_unlock_floor,
        'available_unlocked', v_available_unlocked
      );
    ELSE
      RETURN json_build_object(
        'eligible', false,
        'reason', 'insufficient_balance',
        'message', format(
          'Saldo tidak cukup. Tersedia Rp%s.',
          to_char(GREATEST(v_available_unlocked, 0), 'FM999G999G999')
        ),
        'task_earnings', v_task_earnings,
        'bonus_total', v_bonus_total,
        'bonus_unlocked', v_bonus_unlocked,
        'bonus_unlock_floor', v_bonus_unlock_floor,
        'available_unlocked', v_available_unlocked
      );
    END IF;
  END IF;

  IF (v_weekly_total + p_amount) > v_weekly_cap THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'weekly_cap',
      'message', format(
        'Limit payout mingguan Rp%s. Sudah pakai Rp%s minggu ini, sisa Rp%s. Hubungi admin untuk override.',
        to_char(v_weekly_cap, 'FM999G999G999'),
        to_char(v_weekly_total, 'FM999G999G999'),
        to_char(v_weekly_cap - v_weekly_total, 'FM999G999G999')
      ),
      'weekly_total', v_weekly_total,
      'weekly_cap', v_weekly_cap,
      'task_earnings', v_task_earnings,
      'bonus_total', v_bonus_total,
      'bonus_unlocked', v_bonus_unlocked,
      'bonus_unlock_floor', v_bonus_unlock_floor,
      'available_unlocked', v_available_unlocked
    );
  END IF;

  RETURN json_build_object(
    'eligible', true,
    'days_old', v_days_old,
    'approved_tasks', v_approved_tasks,
    'weekly_total', v_weekly_total,
    'weekly_cap', v_weekly_cap,
    'task_earnings', v_task_earnings,
    'bonus_total', v_bonus_total,
    'bonus_unlocked', v_bonus_unlocked,
    'bonus_unlock_floor', v_bonus_unlock_floor,
    'available_unlocked', v_available_unlocked
  );
END $$;

GRANT EXECUTE ON FUNCTION public.validate_payout_eligibility(uuid, int) TO authenticated;

-- 6) Admin reject RPC used by ApprovalQueue.tsx. No credit reversal here because
--    reject is normally applied to submitted (not yet credited) rows.
CREATE OR REPLACE FUNCTION public.admin_reject_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_can_retry boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = p_reason,
      can_retry = p_can_retry,
      updated_at = NOW()
  WHERE id = p_assignment_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reject_assignment(uuid, text, boolean) TO authenticated;

-- 7) Recovery RPC: backfill user_credits for approved assignments that were
--    never credited (e.g. because the trigger was not attached historically).
--    Run this once from the Supabase SQL Editor after deploying the migration.
CREATE OR REPLACE FUNCTION public.admin_recover_missing_task_rewards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
  v_updated int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH missing AS (
    SELECT
      COALESCE(ta.user_id, ra.user_id) AS reward_user_id,
      t.reward_amount,
      format('Reward task: %s', COALESCE(t.title, 'tugas')) AS description,
      ta.id AS reference_id
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_credits uc
        WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'
      )
  )
  INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
  SELECT reward_user_id, reward_amount, 'task_reward', description, reference_id
  FROM missing
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.task_assignments ta
  SET balance_credited_at = NOW()
  WHERE ta.status = 'approved'
    AND ta.balance_credited_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.user_credits uc
      WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'inserted_rows', v_inserted,
    'updated_assignments', v_updated,
    'note', 'Historical approved tasks without task_reward credits have been backfilled.'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_recover_missing_task_rewards() TO authenticated;

-- 8) Backfill balance_credited_at for already-credited approved assignments
--    so the audit column is complete from day one.
UPDATE public.task_assignments ta
SET balance_credited_at = COALESCE(
  (SELECT MAX(uc.created_at) FROM public.user_credits uc
   WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'),
  NOW()
)
WHERE ta.status = 'approved'
  AND ta.balance_credited_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.user_credits uc
    WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'
  );
