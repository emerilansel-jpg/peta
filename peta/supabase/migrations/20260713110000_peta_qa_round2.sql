-- =============================================================
-- PeTa QA Round 2 — 2026-07-13
--
-- Root causes fixed:
--
-- Bug #1: Auto-approve — NOT a system bug. Caused by admin running a
--         wildcard UPDATE workaround in SQL Editor. No code fix needed.
--         Going forward the admin_approve_assignment RPC is the only path.
--
-- Bug #2: Saldo 0 after approve forum_comment task.
--         Root cause: tg_on_assignment_approved might not be attached in
--         prod, OR user_id is NULL on the assignment. The recovery RPC
--         existed but we also need: (a) force-attach the trigger,
--         (b) backfill any approved-but-uncertified rows, (c) ensure
--         task_assignments.user_id is always populated for forum_comment.
--
-- Bug #3: Founding 0/100 on landing page for anon visitors.
--         Root cause: RLS on public.users only allows self/admin reads.
--         Anon visitors have no auth.uid() so getFoundingMembers() sees 0.
--         Fix: add an anon-readable SECURITY DEFINER RPC + add a select
--         policy that lets anon read only the aggregate count is NOT
--         possible via RLS (RLS can't expose COUNT without rows).
--         Cleanest fix: an RPC that returns the count.
-- =============================================================

-- -------------------------------------------------------------
-- FIX BUG #2 — ensure trigger is attached + backfill credits
-- -------------------------------------------------------------

-- 2.1) Recreate the trigger function (idempotent) so it credits
--      user_credits on approve. Uses COALESCE on ta.user_id first
--      (forum_comment) then reddit_accounts.user_id (reddit tasks).
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

    IF v_user_id IS NULL THEN
      -- Defensive: should never happen, but prevents silent trigger failure.
      RAISE WARNING 'approve trigger: no user for assignment %', NEW.id;
      RETURN NEW;
    END IF;

    -- Credit the army member. Unique partial index makes this idempotent.
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (
      v_user_id, v_reward, 'task_reward',
      format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
      NEW.id
    )
    ON CONFLICT DO NOTHING;

    NEW.balance_credited_at := NOW();

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

-- 2.2) Force-attach trigger. This was the original 2026-07-12 fix —
--      re-run here in case it didn't make it to prod.
DROP TRIGGER IF EXISTS tg_on_assignment_approved ON public.task_assignments;
CREATE TRIGGER tg_on_assignment_approved
  BEFORE UPDATE OF status ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_on_assignment_approved();

-- 2.3) Backfill user_id on forum_comment assignments where it's NULL.
--      claim_task_assignment sets it, but legacy rows may lack it.
UPDATE public.task_assignments ta
SET user_id = ra.user_id
FROM public.reddit_accounts ra
WHERE ta.user_id IS NULL
  AND ta.reddit_account_id = ra.id;

-- 2.4) Backfill missing credits for any approved assignment.
--      Idempotent via the unique partial index on user_credits.reference_id.
INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
SELECT
  COALESCE(ta.user_id, ra.user_id) AS uid,
  t.reward_amount,
  'task_reward',
  format('Reward task: %s', COALESCE(t.title, 'tugas')) AS description,
  ta.id AS reference_id
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

-- 2.5) Mark balance_credited_at for any approved + credited assignment
--      that somehow still has NULL balance_credited_at.
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
-- FIX BUG #3 — anon-readable founding member count via RPC
-- -------------------------------------------------------------

-- 3.1) SECURITY DEFINER RPC that returns the army count + slots info.
--      SECURITY DEFINER bypasses RLS so anon users can read the aggregate.
CREATE OR REPLACE FUNCTION public.get_founding_members_count()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'count',   COALESCE((SELECT COUNT(*) FROM public.users WHERE role = 'army'), 0),
    'max',     100,
    'slotsLeft', GREATEST(100 - COALESCE((SELECT COUNT(*) FROM public.users WHERE role = 'army'), 0), 0),
    'isFull',  COALESCE((SELECT COUNT(*) FROM public.users WHERE role = 'army'), 0) >= 100,
    'percent', LEAST((COALESCE((SELECT COUNT(*) FROM public.users WHERE role = 'army'), 0)::float / 100 * 100), 100)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_founding_members_count() TO anon;
GRANT EXECUTE ON FUNCTION public.get_founding_members_count() TO authenticated;

-- -------------------------------------------------------------
-- POST-FIX: reload PostgREST schema cache
-- -------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
