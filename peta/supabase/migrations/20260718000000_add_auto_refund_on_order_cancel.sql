-- =============================================================
-- Auto-refund on order cancellation (option B: pro-rata, 6h client
-- window, admin override anytime). Adds cancel_reason + cancelled_at
-- to reddit_upvote_orders, and a BEFORE UPDATE trigger that inserts
-- a credit_transactions row of type 'refund' when status flips to
-- cancelled. Idempotent via a unique partial index on refund rows.
-- =============================================================

-- 1. Audit columns for cancellation.
ALTER TABLE public.reddit_upvote_orders
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.reddit_upvote_orders.cancel_reason IS 'Reason provided by client or admin when cancelling the order.';
COMMENT ON COLUMN public.reddit_upvote_orders.cancelled_at IS 'Timestamp when the order was cancelled. Set automatically by the trigger.';

-- 2. Guarantee at most one refund per order in the ledger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_one_refund_per_order
ON public.credit_transactions (user_id, (metadata ->> 'reddit_upvote_order_id'))
WHERE type = 'refund';

-- 3. Trigger function: create refund transaction on cancel transition.
CREATE OR REPLACE FUNCTION public.fn_reddit_order_cancel_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spend_count BIGINT;
  v_existing_refund BIGINT;
  v_cost INTEGER;
  v_requested INTEGER;
  v_delivered INTEGER;
  v_refund_amount INTEGER;
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

  IF v_delivered >= v_requested THEN
    v_refund_amount := 0;
  ELSE
    v_refund_amount := (v_requested - v_delivered) * v_cost / v_requested;
  END IF;

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
        'delivered_upvotes', v_delivered
      )
    );
  END IF;

  -- Stamp the cancellation time (if not already set by caller).
  IF NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Attach trigger.
DROP TRIGGER IF EXISTS trg_reddit_order_cancel_refund ON public.reddit_upvote_orders;
CREATE TRIGGER trg_reddit_order_cancel_refund
BEFORE UPDATE ON public.reddit_upvote_orders
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION public.fn_reddit_order_cancel_refund();
