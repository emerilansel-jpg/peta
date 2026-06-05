-- =============================================================
-- Straight Ltd — admin-configurable pricing matrix.
-- 2 platforms (reddit, forum) x 5 services each:
--   upvote, comment plain, comment link, thread plain, thread link.
-- Each row has a price (cents) + an on/off toggle. Prices are public
-- (clients see them); only admins can change them (via RPC).
-- =============================================================

CREATE TABLE IF NOT EXISTS public.straight_pricing (
  key          text PRIMARY KEY,
  platform     text NOT NULL CHECK (platform IN ('reddit', 'forum')),
  service      text NOT NULL CHECK (service IN ('upvote', 'comment', 'thread')),
  mention_mode text NOT NULL DEFAULT 'none' CHECK (mention_mode IN ('none', 'plain', 'link')),
  label        text NOT NULL,
  price_cents  integer NOT NULL DEFAULT 500 CHECK (price_cents >= 0 AND price_cents <= 10000000),
  enabled      boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id)
);

-- Seed the 10-row matrix (idempotent — keeps existing prices on re-run).
INSERT INTO public.straight_pricing (key, platform, service, mention_mode, label, price_cents, enabled, sort_order) VALUES
  ('reddit_upvote',       'reddit', 'upvote',  'none',  'Reddit — Upvotes (per upvote)',       50,  true,  1),
  ('reddit_comment_plain','reddit', 'comment', 'plain', 'Reddit — Comment (plain text)',       500, true,  2),
  ('reddit_comment_link', 'reddit', 'comment', 'link',  'Reddit — Comment (with link)',        550, true,  3),
  ('reddit_thread_plain', 'reddit', 'thread',  'plain', 'Reddit — Thread (plain text)',        700, true,  4),
  ('reddit_thread_link',  'reddit', 'thread',  'link',  'Reddit — Thread (with link)',         750, true,  5),
  ('forum_upvote',        'forum',  'upvote',  'none',  'Other forum — Upvotes (per upvote)',  50,  false, 6),
  ('forum_comment_plain', 'forum',  'comment', 'plain', 'Other forum — Comment (plain text)',  500, true,  7),
  ('forum_comment_link',  'forum',  'comment', 'link',  'Other forum — Comment (with link)',   550, true,  8),
  ('forum_thread_plain',  'forum',  'thread',  'plain', 'Other forum — Thread (plain text)',   700, true,  9),
  ('forum_thread_link',   'forum',  'thread',  'link',  'Other forum — Thread (with link)',    750, true,  10)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.straight_pricing ENABLE ROW LEVEL SECURITY;

-- Prices are not secret — clients read them to render the order flow.
DROP POLICY IF EXISTS straight_pricing_read ON public.straight_pricing;
CREATE POLICY straight_pricing_read ON public.straight_pricing
  FOR SELECT TO anon, authenticated
  USING (true);

-- Writes only through the admin RPC below (no direct INSERT/UPDATE policy).

CREATE OR REPLACE FUNCTION public.admin_set_straight_pricing(
  p_key text,
  p_price_cents integer,
  p_enabled boolean
)
RETURNS public.straight_pricing
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_row public.straight_pricing;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_price_cents IS NULL OR p_price_cents < 0 OR p_price_cents > 10000000 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  UPDATE public.straight_pricing
  SET price_cents = p_price_cents,
      enabled = COALESCE(p_enabled, enabled),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE key = p_key
  RETURNING * INTO v_row;

  IF v_row.key IS NULL THEN RAISE EXCEPTION 'unknown_pricing_key'; END IF;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_straight_pricing(text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_straight_pricing(text, integer, boolean) TO authenticated;
