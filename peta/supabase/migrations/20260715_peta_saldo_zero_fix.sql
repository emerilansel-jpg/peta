-- =============================================================
-- PeTa QA Round 3 — Saldo 0 after approved forum_comment task
-- 2026-07-15
--
-- Root cause: legacy forum_comment rows in task_assignments can have
-- user_id = NULL (created before the 2026-07-14 claim_task_assignment fix
-- or via a backdoor path). When these rows are approved,
-- tg_on_assignment_approved sees COALESCE(ta.user_id, ra.user_id) = NULL,
-- raises a warning, and does NOT credit user_credits. The army member also
-- cannot read their own assignment through RLS, so getTotalEarnings() shows
-- Rp0 task earnings.
--
-- Fixes applied:
-- 1. Backfill user_id on forum_comment assignments from proof_image_url
--    storage path when possible.
-- 2. Backfill user_credits for approved assignments that were never
--    credited (idempotent via unique partial index on reference_id).
-- 3. Backfill balance_credited_at for rows that now have a credit.
-- 4. Add BEFORE INSERT/UPDATE trigger so task_assignments.user_id is
--    never NULL going forward.
-- 5. Add get_user_earnings() SECURITY DEFINER RPC so the frontend no
--    longer depends on RLS for its own earnings math.
-- 6. Add admin_repair_assignment_user_id() RPC for manual repair when
--    the automatic backfill cannot determine the owner.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Backfill user_id for forum_comment assignments where possible
-- -------------------------------------------------------------
-- Forum_comment assignments have reddit_account_id IS NULL. The only
-- place the real owner is recorded is the storage path of the uploaded
-- proof screenshot (if any): .../task-proofs/<uuid>/<taskId>-<ts>.ext
UPDATE public.task_assignments ta
SET user_id = (
  substring(
    ta.proof_image_url
    from 'task-proofs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'
  )::uuid
)
WHERE ta.user_id IS NULL
  AND ta.reddit_account_id IS NULL
  AND ta.proof_image_url IS NOT NULL
  AND ta.proof_image_url ~ 'task-proofs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (
      substring(
        ta.proof_image_url
        from 'task-proofs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'
      )::uuid
    )
  );

-- -------------------------------------------------------------
-- 2. Backfill missing user_credits for approved assignments
-- -------------------------------------------------------------
INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
SELECT
  COALESCE(ta.user_id, ra.user_id) AS uid,
  t.reward_amount,
  'task_reward',
  format('Reward task: %s', COALESCE(t.title, 'tugas')),
  ta.id
FROM public.task_assignments ta
LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
JOIN public.tasks t ON t.id = ta.task_id
WHERE ta.status = 'approved'
  AND COALESCE(ta.user_id, ra.user_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_credits uc
    WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'
  )
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------
-- 3. Mark balance_credited_at for rows that now have a credit
-- -------------------------------------------------------------
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

-- -------------------------------------------------------------
-- 4. Trigger: ensure task_assignments.user_id is never NULL
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_ensure_assignment_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    IF NEW.reddit_account_id IS NOT NULL THEN
      SELECT user_id INTO NEW.user_id
      FROM public.reddit_accounts
      WHERE id = NEW.reddit_account_id;
    ELSE
      NEW.user_id := auth.uid();
    END IF;
  END IF;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'task_assignments.user_id cannot be NULL. Set user_id explicitly or provide a valid reddit_account_id.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ensure_assignment_user_id ON public.task_assignments;
CREATE TRIGGER tg_ensure_assignment_user_id
  BEFORE INSERT OR UPDATE ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_ensure_assignment_user_id();

-- -------------------------------------------------------------
-- 5. get_user_earnings RPC — canonical earnings for the caller
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_earnings()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task_earnings int;
  v_manual_adj int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_bonus int;
  v_bonus_unlocked boolean;
  v_cashable int;
  v_total int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Canonical task earnings: approved assignments (forum + reddit).
  SELECT COALESCE(SUM(t.reward_amount), 0)::int
  INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = v_uid
    AND ta.status = 'approved';

  -- Credits split (excluding task_reward which is a ledger mirror).
  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward') THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_manual_adj
  FROM public.user_credits
  WHERE user_id = v_uid;

  v_bonus := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= 100000;
  v_cashable := v_task_earnings + v_manual_adj + CASE WHEN v_bonus_unlocked THEN v_bonus ELSE 0 END;
  v_total := v_task_earnings + v_manual_adj + v_bonus;

  RETURN json_build_object(
    'tasks', v_task_earnings,
    'manualAdj', v_manual_adj,
    'signupBonus', v_signup_bonus,
    'referralBonus', v_referral_bonus,
    'bonus', v_bonus,
    'bonusUnlocked', v_bonus_unlocked,
    'cashable', v_cashable,
    'total', v_total,
    'earned', v_task_earnings + v_manual_adj,
    'referral', v_bonus,
    'fromWork', v_task_earnings
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_user_earnings() TO authenticated;

-- -------------------------------------------------------------
-- 6. Admin repair RPC for assignments the backfill cannot fix
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_repair_assignment_user_id(
  p_assignment_id uuid,
  p_user_id uuid
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
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment ID wajib diisi';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID wajib diisi';
  END IF;

  UPDATE public.task_assignments
  SET user_id = p_user_id,
      updated_at = NOW()
  WHERE id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan';
  END IF;

  -- If the assignment is approved and missing its credit, backfill now.
  INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
  SELECT ta.user_id, t.reward_amount, 'task_reward',
         format('Reward task: %s', COALESCE(t.title, 'tugas')),
         ta.id
  FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.id = p_assignment_id
    AND ta.status = 'approved'
    AND ta.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_credits uc
      WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'
    );

  -- Sync the slot count in case the assignment was stuck.
  UPDATE public.task_assignments ta
  SET balance_credited_at = COALESCE(
    (SELECT MAX(uc.created_at) FROM public.user_credits uc
     WHERE uc.reference_id = ta.id AND uc.source = 'task_reward'),
    NOW()
  )
  WHERE ta.id = p_assignment_id
    AND ta.status = 'approved'
    AND ta.balance_credited_at IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_repair_assignment_user_id(uuid, uuid) TO authenticated;

-- Reload PostgREST schema cache so the new RPCs are immediately visible.
NOTIFY pgrst, 'reload schema';
