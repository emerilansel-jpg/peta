-- =============================================================
-- Reddit Upvotes Feature: Credit-based system
-- =============================================================

-- Add credit_balance to users table if not exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0;

-- Credit transactions ledger
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('topup', 'spend', 'adjust', 'refund')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reddit upvote orders
CREATE TABLE IF NOT EXISTS public.reddit_upvote_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  subreddit TEXT,
  thread_url TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'upvote' CHECK (target_type IN ('upvote', 'comment', 'thread')),
  requested_upvotes INTEGER NOT NULL DEFAULT 1,
  cost_credits INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Top-up requests (manual admin approval)
CREATE TABLE IF NOT EXISTS public.reddit_topup_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_requested INTEGER NOT NULL,
  payment_method TEXT,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reddit_upvote_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reddit_topup_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies: credit_transactions (read-only for user's own)
DROP POLICY IF EXISTS "users_select_own_credit_tx" ON public.credit_transactions;
CREATE POLICY "users_select_own_credit_tx" ON public.credit_transactions
  FOR SELECT USING (user_id = auth.uid());

-- RLS Policies: reddit_upvote_orders
DROP POLICY IF EXISTS "users_select_own_reddit_orders" ON public.reddit_upvote_orders;
CREATE POLICY "users_select_own_reddit_orders" ON public.reddit_upvote_orders
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_insert_own_reddit_orders" ON public.reddit_upvote_orders;
CREATE POLICY "users_insert_own_reddit_orders" ON public.reddit_upvote_orders
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_update_reddit_orders" ON public.reddit_upvote_orders;
CREATE POLICY "admin_update_reddit_orders" ON public.reddit_upvote_orders
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- RLS Policies: reddit_topup_requests
DROP POLICY IF EXISTS "users_select_own_topups" ON public.reddit_topup_requests;
CREATE POLICY "users_select_own_topups" ON public.reddit_topup_requests
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_insert_own_topups" ON public.reddit_topup_requests;
CREATE POLICY "users_insert_own_topups" ON public.reddit_topup_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_select_all_topups" ON public.reddit_topup_requests;
CREATE POLICY "admin_select_all_topups" ON public.reddit_topup_requests
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_topups" ON public.reddit_topup_requests;
CREATE POLICY "admin_update_topups" ON public.reddit_topup_requests
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Trigger: update user credit balance on transaction insert
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
  v_price_per_upvote CONSTANT INTEGER := 10;
  v_order public.reddit_upvote_orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_requested_upvotes IS NULL OR p_requested_upvotes < 1 THEN RAISE EXCEPTION 'invalid upvote count'; END IF;

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

-- RPC: Approve top-up (admin only)
CREATE OR REPLACE FUNCTION public.fn_admin_approve_topup(
  p_topup_id BIGINT,
  p_admin_id UUID
)
RETURNS public.reddit_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_topup public.reddit_topup_requests;
  v_user_balance INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_topup FROM public.reddit_topup_requests WHERE id = p_topup_id FOR UPDATE;
  IF v_topup IS NULL THEN RAISE EXCEPTION 'topup not found'; END IF;
  IF v_topup.status <> 'pending' THEN RAISE EXCEPTION 'topup already processed'; END IF;

  -- Add credits
  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) SELECT
    v_topup.user_id, 'topup', v_topup.amount_requested,
    credit_balance + v_topup.amount_requested,
    jsonb_build_object('topup_request_id', v_topup.id)
  FROM public.users WHERE id = v_topup.user_id;

  -- Mark topup as approved
  UPDATE public.reddit_topup_requests
  SET status = 'approved', updated_at = NOW()
  WHERE id = p_topup_id
  RETURNING * INTO v_topup;

  RETURN v_topup;
END;
$$;

-- RPC: Reject top-up (admin only)
CREATE OR REPLACE FUNCTION public.fn_admin_reject_topup(
  p_topup_id BIGINT,
  p_admin_note TEXT
)
RETURNS public.reddit_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_topup public.reddit_topup_requests;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.reddit_topup_requests
  SET status = 'rejected', admin_note = p_admin_note, updated_at = NOW()
  WHERE id = p_topup_id
  RETURNING * INTO v_topup;

  RETURN v_topup;
END;
$$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reddit_upvote_orders_user_id ON public.reddit_upvote_orders(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_reddit_topup_requests_user_id ON public.reddit_topup_requests(user_id, status, created_at);
