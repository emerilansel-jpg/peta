-- =============================================================
-- Reddit Upvotes Feature: USD credit-based system
-- Credits stored as cents (1 unit = 1 cent = $0.01)
-- =============================================================

-- Add credit_balance to users table (in cents)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.users.credit_balance IS 'Credit balance in cents (USD). 100 = $1.00';

-- Credit transactions ledger (amounts in cents)
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('topup', 'spend', 'adjust', 'refund')),
  amount INTEGER NOT NULL,         -- in cents
  balance_after INTEGER NOT NULL,  -- in cents
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.credit_transactions IS 'Ledger of credit changes. Amounts in cents.';

-- Reddit upvote orders
CREATE TABLE IF NOT EXISTS public.reddit_upvote_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  subreddit TEXT,
  thread_url TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'upvote' CHECK (target_type IN ('upvote', 'comment', 'thread')),
  requested_upvotes INTEGER NOT NULL DEFAULT 1,
  cost_credits INTEGER NOT NULL,   -- in cents
  delivered_upvotes INTEGER DEFAULT 0,
  notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Top-up requests (PayPal-based)
CREATE TABLE IF NOT EXISTS public.reddit_topup_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,            -- amount in cents
  credits_purchased INTEGER NOT NULL,       -- credits granted in cents
  payment_method TEXT NOT NULL DEFAULT 'paypal',
  paypal_order_id TEXT,                     -- PayPal's order ID
  paypal_capture_id TEXT,                   -- PayPal's capture ID
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reddit_upvote_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reddit_topup_requests ENABLE ROW LEVEL SECURITY;

-- RLS: credit_transactions
DROP POLICY IF EXISTS "users_select_own_credit_tx" ON public.credit_transactions;
CREATE POLICY "users_select_own_credit_tx" ON public.credit_transactions
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

-- RLS: reddit_upvote_orders
DROP POLICY IF EXISTS "users_select_own_reddit_orders" ON public.reddit_upvote_orders;
CREATE POLICY "users_select_own_reddit_orders" ON public.reddit_upvote_orders
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_insert_own_reddit_orders" ON public.reddit_upvote_orders;
CREATE POLICY "users_insert_own_reddit_orders" ON public.reddit_upvote_orders
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_update_reddit_orders" ON public.reddit_upvote_orders;
CREATE POLICY "admin_update_reddit_orders" ON public.reddit_upvote_orders
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- RLS: reddit_topup_requests
DROP POLICY IF EXISTS "users_select_own_topups" ON public.reddit_topup_requests;
CREATE POLICY "users_select_own_topups" ON public.reddit_topup_requests
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_insert_own_topups" ON public.reddit_topup_requests;
CREATE POLICY "users_insert_own_topups" ON public.reddit_topup_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_update_topups" ON public.reddit_topup_requests;
CREATE POLICY "admin_update_topups" ON public.reddit_topup_requests
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Trigger: update credit balance on transaction insert
CREATE OR REPLACE FUNCTION public.fn_update_credit_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.users
  SET credit_balance = NEW.balance_after
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_credit_balance ON public.credit_transactions;
CREATE TRIGGER trg_update_credit_balance AFTER INSERT ON public.credit_transactions
  FOR EACH ROW EXECUTE PROCEDURE public.fn_update_credit_balance();

-- RPC: Create Reddit upvote order (atomic with credit spend)
-- Price: 50 cents ($0.50) per upvote
CREATE OR REPLACE FUNCTION public.fn_create_reddit_upvote_order(
  p_thread_url TEXT,
  p_subreddit TEXT,
  p_requested_upvotes INTEGER,
  p_notes TEXT
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_cost INTEGER;
  v_user_balance INTEGER;
  v_price_per_upvote CONSTANT INTEGER := 50; -- 50 cents = $0.50
  v_order public.reddit_upvote_orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_requested_upvotes IS NULL OR p_requested_upvotes < 1 THEN RAISE EXCEPTION 'invalid upvote count'; END IF;
  IF p_requested_upvotes > 10000 THEN RAISE EXCEPTION 'max 10000 upvotes per order'; END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;

  v_cost := p_requested_upvotes * v_price_per_upvote;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  -- Create order
  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id, p_thread_url, p_subreddit, 'upvote',
    p_requested_upvotes, v_cost, p_notes
  )
  RETURNING * INTO v_order;

  -- Deduct credits
  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id, 'spend', -v_cost, v_user_balance - v_cost,
    jsonb_build_object('reddit_upvote_order_id', v_order.id)
  );

  RETURN v_order;
END;
$$;

-- RPC: Complete PayPal topup (credit user after successful capture)
-- Called by client after PayPal returns success
CREATE OR REPLACE FUNCTION public.fn_complete_paypal_topup(
  p_amount_cents INTEGER,
  p_paypal_order_id TEXT,
  p_paypal_capture_id TEXT
)
RETURNS public.reddit_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_user_balance INTEGER;
  v_topup public.reddit_topup_requests;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 THEN RAISE EXCEPTION 'minimum $1.00 topup'; END IF;
  IF p_paypal_order_id IS NULL THEN RAISE EXCEPTION 'paypal_order_id required'; END IF;

  -- Idempotency: check if this PayPal order was already processed
  IF EXISTS (SELECT 1 FROM public.reddit_topup_requests WHERE paypal_order_id = p_paypal_order_id) THEN
    SELECT * INTO v_topup FROM public.reddit_topup_requests WHERE paypal_order_id = p_paypal_order_id;
    RETURN v_topup;
  END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;

  -- Create topup record
  INSERT INTO public.reddit_topup_requests (
    user_id, amount_cents, credits_purchased,
    payment_method, paypal_order_id, paypal_capture_id,
    payment_status, completed_at
  ) VALUES (
    v_user_id, p_amount_cents, p_amount_cents,
    'paypal', p_paypal_order_id, p_paypal_capture_id,
    'completed', NOW()
  )
  RETURNING * INTO v_topup;

  -- Credit the user
  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id, 'topup', p_amount_cents, v_user_balance + p_amount_cents,
    jsonb_build_object('topup_request_id', v_topup.id, 'paypal_order_id', p_paypal_order_id)
  );

  RETURN v_topup;
END;
$$;

-- RPC: Admin manually add credits (for refunds, comps, etc.)
CREATE OR REPLACE FUNCTION public.fn_admin_adjust_credits(
  p_user_id UUID,
  p_amount_cents INTEGER,
  p_reason TEXT
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_balance INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount_cents = 0 THEN RAISE EXCEPTION 'amount must be non-zero'; END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  IF v_user_balance + p_amount_cents < 0 THEN RAISE EXCEPTION 'would result in negative balance'; END IF;

  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    p_user_id, 'adjust', p_amount_cents, v_user_balance + p_amount_cents,
    jsonb_build_object('reason', p_reason, 'admin_id', auth.uid())
  );

  RETURN json_build_object(
    'success', true,
    'new_balance', v_user_balance + p_amount_cents
  );
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_upvote_orders_user_id ON public.reddit_upvote_orders(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_upvote_orders_status ON public.reddit_upvote_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_topup_requests_user_id ON public.reddit_topup_requests(user_id, payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddit_topup_requests_paypal ON public.reddit_topup_requests(paypal_order_id);
