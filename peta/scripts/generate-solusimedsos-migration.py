import os
from decimal import Decimal, ROUND_HALF_UP

RATE = Decimal('160') # 1 USD = 16,000 IDR -> 1 cent = 160 IDR

def round_cents(val):
    return int((Decimal(str(val)) / RATE).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

packages = [
    # 1. Likes / Shares
    ("SMS-LIKE-010", "1", "Like 100% Manusia - Retweet - Share", "https://solusimedsos.id/like", "sms_social_likes", "like_10", "10 Likes", 10, 25000, "active"),
    ("SMS-LIKE-050", "1", "Like 100% Manusia - Retweet - Share", "https://solusimedsos.id/like", "sms_social_likes", "like_50", "50 Likes", 50, 100000, "active"),
    ("SMS-LIKE-100", "1", "Like 100% Manusia - Retweet - Share", "https://solusimedsos.id/like", "sms_social_likes", "like_100", "100 Likes", 100, 190000, "active"),
    ("SMS-LIKE-200", "1", "Like 100% Manusia - Retweet - Share", "https://solusimedsos.id/like", "sms_social_likes", "like_200", "200 Likes", 200, 375000, "active"),
    ("SMS-LIKE-500", "1", "Like 100% Manusia - Retweet - Share", "https://solusimedsos.id/like", "sms_social_likes", "like_500", "500 Likes", 500, 900000, "active"),

    # 2. Comment Likes (Top Comment)
    ("SMS-COMLIKE-020", "2", "Like Comment (Top Comment Booster)", "https://solusimedsos.id/comment", "sms_comment_likes", "comlike_20", "20 Comment Likes", 20, 60000, "active"),
    ("SMS-COMLIKE-050", "2", "Like Comment (Top Comment Booster)", "https://solusimedsos.id/comment", "sms_comment_likes", "comlike_50", "50 Comment Likes", 50, 130000, "active"),
    ("SMS-COMLIKE-100", "2", "Like Comment (Top Comment Booster)", "https://solusimedsos.id/comment", "sms_comment_likes", "comlike_100", "100 Comment Likes", 100, 250000, "active"),
    ("SMS-COMLIKE-500", "2", "Like Comment (Top Comment Booster)", "https://solusimedsos.id/comment", "sms_comment_likes", "comlike_500", "500 Comment Likes", 500, 1200000, "active"),

    # 3. Real Followers
    ("SMS-FOLLOW-050", "3", "Follower Full Human", "https://solusimedsos.id/follower", "sms_real_followers", "follow_50", "50 Real Followers", 50, 100000, "active"),
    ("SMS-FOLLOW-100", "3", "Follower Full Human", "https://solusimedsos.id/follower", "sms_real_followers", "follow_100", "100 Real Followers", 100, 200000, "active"),
    ("SMS-FOLLOW-500", "3", "Follower Full Human", "https://solusimedsos.id/follower", "sms_real_followers", "follow_500", "500 Real Followers", 500, 950000, "active"),
    ("SMS-FOLLOW-1K",  "3", "Follower Full Human", "https://solusimedsos.id/follower", "sms_real_followers", "follow_1k", "1,000 Real Followers", 1000, 1850000, "active"),
    ("SMS-FOLLOW-2K",  "3", "Follower Full Human", "https://solusimedsos.id/follower", "sms_real_followers", "follow_2k", "2,000 Real Followers", 2000, 3600000, "active"),
    ("SMS-FOLLOW-5K",  "3", "Follower Full Human", "https://solusimedsos.id/follower", "sms_real_followers", "follow_5k", "5,000 Real Followers", 5000, 8000000, "active"),

    # 4. Giveaway Followers
    ("SMS-GIVEAWAY-2K",  "4", "Follower Indo Metode Giveaway", "https://solusimedsos.id/follower-giveaway", "sms_giveaway_followers", "giveaway_2k", "2,000 Giveaway Followers", 2000, 299000, "active"),
    ("SMS-GIVEAWAY-5K",  "4", "Follower Indo Metode Giveaway", "https://solusimedsos.id/follower-giveaway", "sms_giveaway_followers", "giveaway_5k", "5,000 Giveaway Followers", 5000, 499000, "active"),
    ("SMS-GIVEAWAY-10K", "4", "Follower Indo Metode Giveaway", "https://solusimedsos.id/follower-giveaway", "sms_giveaway_followers", "giveaway_10k", "10,000 Giveaway Followers", 10000, 899000, "active"),
    ("SMS-GIVEAWAY-20K", "4", "Follower Indo Metode Giveaway", "https://solusimedsos.id/follower-giveaway", "sms_giveaway_followers", "giveaway_20k", "20,000 Giveaway Followers", 20000, 1299000, "active"),

    # 5. Real Comments
    ("SMS-COMM-020", "5", "Real Custom Comments", "https://solusimedsos.id/comment", "sms_real_comments", "comm_20", "20 Real Comments", 20, 80000, "active"),
    ("SMS-COMM-050", "5", "Real Custom Comments", "https://solusimedsos.id/comment", "sms_real_comments", "comm_50", "50 Real Comments", 50, 200000, "active"),
    ("SMS-COMM-100", "5", "Real Custom Comments", "https://solusimedsos.id/comment", "sms_real_comments", "comm_100", "100 Real Comments", 100, 375000, "active"),
    ("SMS-COMM-500", "5", "Real Custom Comments", "https://solusimedsos.id/comment", "sms_real_comments", "comm_500", "500 Real Comments", 500, 1850000, "active"),
    ("SMS-COMM-1K",  "5", "Real Custom Comments", "https://solusimedsos.id/comment", "sms_real_comments", "comm_1k", "1,000 Real Comments", 1000, 3600000, "active"),

    # 6. Reply Comments
    ("SMS-REPLY-020", "6", "Thread Reply Comments", "https://solusimedsos.id/comment", "sms_reply_comments", "reply_20", "20 Thread Replies", 20, 90000, "active"),
    ("SMS-REPLY-050", "6", "Thread Reply Comments", "https://solusimedsos.id/comment", "sms_reply_comments", "reply_50", "50 Thread Replies", 50, 230000, "active"),
    ("SMS-REPLY-100", "6", "Thread Reply Comments", "https://solusimedsos.id/comment", "sms_reply_comments", "reply_100", "100 Thread Replies", 100, 450000, "active"),
    ("SMS-REPLY-500", "6", "Thread Reply Comments", "https://solusimedsos.id/comment", "sms_reply_comments", "reply_500", "500 Thread Replies", 500, 2250000, "active"),

    # 7. Combo Comment + Like
    ("SMS-COMBO-020", "8", "Engagement Combo: Comment + Like", "https://solusimedsos.id/comment", "sms_engagement_combo", "combo_20", "20 Comments + 20 Likes", 20, 100000, "active"),
    ("SMS-COMBO-050", "8", "Engagement Combo: Comment + Like", "https://solusimedsos.id/comment", "sms_engagement_combo", "combo_50", "50 Comments + 50 Likes", 50, 250000, "active"),
    ("SMS-COMBO-100", "8", "Engagement Combo: Comment + Like", "https://solusimedsos.id/comment", "sms_engagement_combo", "combo_100", "100 Comments + 100 Likes", 100, 500000, "active"),
    ("SMS-COMBO-500", "8", "Engagement Combo: Comment + Like", "https://solusimedsos.id/comment", "sms_engagement_combo", "combo_500", "500 Comments + 500 Likes", 500, 2500000, "active"),

    # 8. TikTok & Reels Views
    ("SMS-VIEW-1K",   "9", "Reel / TikTok Views", "https://solusimedsos.id/tiktok", "sms_video_views", "view_1k", "1,000 Video Views", 1000, 55000, "active"),
    ("SMS-VIEW-2K",   "9", "Reel / TikTok Views", "https://solusimedsos.id/tiktok", "sms_video_views", "view_2k", "2,000 Video Views", 2000, 75000, "active"),
    ("SMS-VIEW-5K",   "9", "Reel / TikTok Views", "https://solusimedsos.id/tiktok", "sms_video_views", "view_5k", "5,000 Video Views", 5000, 150000, "active"),
    ("SMS-VIEW-10K",  "9", "Reel / TikTok Views", "https://solusimedsos.id/tiktok", "sms_video_views", "view_10k", "10,000 Video Views", 10000, 200000, "active"),
    ("SMS-VIEW-50K",  "9", "Reel / TikTok Views", "https://solusimedsos.id/tiktok", "sms_video_views", "view_50k", "50,000 Video Views", 50000, 500000, "active"),
    ("SMS-VIEW-100K", "9", "Reel / TikTok Views", "https://solusimedsos.id/tiktok", "sms_video_views", "view_100k", "100,000 Video Views", 100000, 750000, "active"),

    # 9. Survey
    ("SMS-SURVEY-020", "10", "Jasa Isi Kuesioner (max 5 hal)", "https://solusimedsos.id/kuesioner", "sms_survey_respondents", "survey_20", "20 Survey Respondents", 20, 140000, "active"),
    ("SMS-SURVEY-050", "10", "Jasa Isi Kuesioner (max 5 hal)", "https://solusimedsos.id/kuesioner", "sms_survey_respondents", "survey_50", "50 Survey Respondents", 50, 340000, "active"),
    ("SMS-SURVEY-100", "10", "Jasa Isi Kuesioner (max 5 hal)", "https://solusimedsos.id/kuesioner", "sms_survey_respondents", "survey_100", "100 Survey Respondents", 100, 650000, "active"),
    ("SMS-SURVEY-500", "10", "Jasa Isi Kuesioner (max 5 hal)", "https://solusimedsos.id/kuesioner", "sms_survey_respondents", "survey_500", "500 Survey Respondents", 500, 3000000, "active"),

    # 10. Vote / Poll
    ("SMS-POLL-020", "11", "Vote / Poll Publik", "https://solusimedsos.id/vote", "sms_public_votes", "poll_20", "20 Poll Votes", 20, 100000, "active"),
    ("SMS-POLL-050", "11", "Vote / Poll Publik", "https://solusimedsos.id/vote", "sms_public_votes", "poll_50", "50 Poll Votes", 50, 200000, "active"),
    ("SMS-POLL-100", "11", "Vote / Poll Publik", "https://solusimedsos.id/vote", "sms_public_votes", "poll_100", "100 Poll Votes", 100, 400000, "active"),
    ("SMS-POLL-500", "11", "Vote / Poll Publik", "https://solusimedsos.id/vote", "sms_public_votes", "poll_500", "500 Poll Votes", 500, 2000000, "active"),
    ("SMS-POLL-1K",  "11", "Vote / Poll Publik", "https://solusimedsos.id/vote", "sms_public_votes", "poll_1k", "1,000 Poll Votes", 1000, 3800000, "active"),

    # 11. Campaign Posts
    ("SMS-POST-020", "12", "Campaign Post Amplification", "https://solusimedsos.id/ratecard", "sms_campaign_posts", "post_20", "20 Campaign Posts", 20, 200000, "active"),
    ("SMS-POST-050", "12", "Campaign Post Amplification", "https://solusimedsos.id/ratecard", "sms_campaign_posts", "post_50", "50 Campaign Posts", 50, 500000, "active"),
    ("SMS-POST-100", "12", "Campaign Post Amplification", "https://solusimedsos.id/ratecard", "sms_campaign_posts", "post_100", "100 Campaign Posts", 100, 1000000, "active"),

    # 12. Twitter Trending
    ("SMS-TREND-1H", "13", "Trending Topik Twitter", "https://solusimedsos.id/trending", "sms_twitter_trending", "trend_1h", "1 Hour Trending Topic", 1, 8000000, "active"),
    ("SMS-TREND-2H", "13", "Trending Topik Twitter", "https://solusimedsos.id/trending", "sms_twitter_trending", "trend_2h", "2 Hours Trending Topic", 2, 12500000, "active"),
    ("SMS-TREND-3H", "13", "Trending Topik Twitter", "https://solusimedsos.id/trending", "sms_twitter_trending", "trend_3h", "3 Hours Trending Topic", 3, 18000000, "active"),
    ("SMS-TREND-QUOTE", "13", "Trending Topik Twitter (4+ Hours / Prime Time)", "https://solusimedsos.id/trending", "sms_twitter_trending", "trend_quote", "Custom Duration / Prime Time", 1, 0, "quote_only"),

    # 13. YouTube Watch Hours (Paused)
    ("SMS-YTWATCH-1K", "14", "Jam Tayang Youtube (1000 Jam)", "https://solusimedsos.id/youtube", "sms_youtube_watch", "ytwatch_1k", "1,000 Watch Hours", 1000, 850000, "paused"),
    ("SMS-YTWATCH-2K", "14", "Jam Tayang Youtube (2000 Jam)", "https://solusimedsos.id/youtube", "sms_youtube_watch", "ytwatch_2k", "2,000 Watch Hours", 2000, 1700000, "paused"),
    ("SMS-YTWATCH-4K", "14", "Jam Tayang Youtube (4000 Jam)", "https://solusimedsos.id/youtube", "sms_youtube_watch", "ytwatch_4k", "4,000 Watch Hours", 4000, 3200000, "paused"),

    # 14. Clipper (Price on Request)
    ("SMS-CLIPPER-QUOTE", "15", "Jasa Clipper Video", "https://solusimedsos.id/clipper", "sms_video_clipper", "clipper_quote", "Content Clipping Campaign", 1, 0, "quote_only")
]

values_list = []
for code, sid, sname, surl, pub_key, pkg_key, pkg_lbl, qty, cost, status in packages:
    selling_idr = cost * 2
    selling_cents = round_cents(selling_idr)
    sname_esc = sname.replace("'", "''")
    pkg_lbl_esc = pkg_lbl.replace("'", "''")
    values_list.append(
        f"  ('{code}', 'SolusiMedsos', '{code}', '{sid}', '{sname_esc}', '{surl}', '6285123938143', "
        f"{cost}, '{pub_key}', '{pkg_key}', '{pkg_lbl_esc}', {qty}, {selling_idr}, {selling_cents}, '{status}')"
    )

print("Generated values:", len(values_list))

migration_sql = f"""-- Migration: 20261025000000_straight_solusimedsos_reseller_services.sql
-- Integrates SolusiMedsos Reseller Services with exact 2x markup and admin-only supplier tracking.
-- All supplier codes (SMS-xxx), supplier costs, and supplier identifiers are strictly confidential and restricted to admins.

BEGIN;

-- ------------------------------------------------------------
-- 1. Table: straight_supplier_packages (Admin-Only Sourcing Matrix)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.straight_supplier_packages (
  id TEXT PRIMARY KEY,                       -- Supplier code (e.g. SMS-LIKE-010)
  supplier TEXT NOT NULL DEFAULT 'SolusiMedsos',
  supplier_code TEXT NOT NULL,
  supplier_service_id TEXT NOT NULL,
  supplier_service_name TEXT NOT NULL,
  supplier_url TEXT NOT NULL,
  supplier_wa TEXT NOT NULL DEFAULT '6285123938143',
  supplier_cost_idr INT NOT NULL,            -- Cost in IDR
  public_service_key TEXT NOT NULL,          -- Public catalog service identifier (clean, customer-facing)
  public_package_key TEXT NOT NULL,          -- Public package key (e.g. like_10)
  package_label TEXT NOT NULL,               -- Customer-facing package label (e.g. 10 Likes)
  quantity INT NOT NULL,
  selling_price_idr INT NOT NULL,            -- 2x markup in IDR
  selling_price_cents INT NOT NULL,          -- 2x markup converted to USD cents (1 cent = 160 IDR)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'quote_only')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_straight_supplier_packages_lookup 
  ON public.straight_supplier_packages (public_service_key, public_package_key);

-- Enforce Strict Admin-Only Row-Level Security
ALTER TABLE public.straight_supplier_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS straight_supplier_packages_admin_only ON public.straight_supplier_packages;
CREATE POLICY straight_supplier_packages_admin_only
  ON public.straight_supplier_packages
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 2. Seed All 57 Packages (Cost, 2x Selling Price, SMS Code)
-- ------------------------------------------------------------
INSERT INTO public.straight_supplier_packages (
  id, supplier, supplier_code, supplier_service_id, supplier_service_name,
  supplier_url, supplier_wa, supplier_cost_idr, public_service_key,
  public_package_key, package_label, quantity, selling_price_idr,
  selling_price_cents, status
) VALUES
{",\n".join(values_list)}
ON CONFLICT (id) DO UPDATE SET
  supplier_cost_idr = EXCLUDED.supplier_cost_idr,
  selling_price_idr = EXCLUDED.selling_price_idr,
  selling_price_cents = EXCLUDED.selling_price_cents,
  status = EXCLUDED.status,
  updated_at = NOW();

-- ------------------------------------------------------------
-- 3. Table: straight_supplier_fulfillments (Admin-Only Order Tracking)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.straight_supplier_fulfillments (
  id BIGSERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES public.reddit_upvote_orders(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL DEFAULT 'SolusiMedsos',
  supplier_code TEXT NOT NULL,
  supplier_service_name TEXT NOT NULL,
  supplier_package TEXT NOT NULL,
  supplier_cost_idr INT NOT NULL,
  selling_price_idr INT NOT NULL,
  selling_price_cents INT NOT NULL,
  supplier_wa TEXT NOT NULL DEFAULT '6285123938143',
  supplier_url TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    fulfillment_status IN ('pending', 'awaiting_payment', 'submitted', 'processing', 'completed', 'failed', 'refunded')
  ),
  supplier_order_ref TEXT,
  supplier_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_straight_supplier_fulfillments_order 
  ON public.straight_supplier_fulfillments (order_id);

-- Enforce Strict Admin-Only Row-Level Security
ALTER TABLE public.straight_supplier_fulfillments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS straight_supplier_fulfillments_admin_only ON public.straight_supplier_fulfillments;
CREATE POLICY straight_supplier_fulfillments_admin_only
  ON public.straight_supplier_fulfillments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 4. Update reddit_upvote_orders Constraint for Reseller Services
-- ------------------------------------------------------------
ALTER TABLE public.reddit_upvote_orders DROP CONSTRAINT IF EXISTS reddit_upvote_orders_target_type_check;
ALTER TABLE public.reddit_upvote_orders ADD CONSTRAINT reddit_upvote_orders_target_type_check
  CHECK (target_type IN (
    'upvote', 'comment', 'thread', 'youtube_upload',
    'preferred_source', 'linkedin_like', 'linkedin_follow',
    'linkedin_comment', 'trustpilot_review', 'google_maps_review',
    'quora_upvote', 'reseller_order'
  ));

-- ------------------------------------------------------------
-- 5. Order Creation RPC: fn_create_reseller_order
-- Customer inputs clean keys; RPC resolves price & writes internal fulfillment record.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_reseller_order(
  p_service_key TEXT,
  p_package_key TEXT,
  p_target_url TEXT,
  p_platform TEXT DEFAULT 'Social',
  p_notes TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id UUID;
  v_user_balance INT;
  v_pkg public.straight_supplier_packages%ROWTYPE;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_existing_order_id INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Idempotency check via request_id
  IF p_request_id IS NOT NULL AND length(btrim(p_request_id)) > 0 THEN
    SELECT (ct.metadata->>'reddit_upvote_order_id')::int
    INTO v_existing_order_id
    FROM public.credit_transactions ct
    WHERE ct.user_id = v_user_id
      AND ct.metadata->>'request_id' = btrim(p_request_id)
      AND ct.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY ct.id DESC
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      SELECT * INTO v_order FROM public.reddit_upvote_orders WHERE id = v_existing_order_id;
      IF v_order.id IS NOT NULL THEN
        RETURN v_order;
      END IF;
    END IF;
  END IF;

  -- URL validation
  IF p_target_url IS NULL OR length(btrim(p_target_url)) < 5 THEN
    RAISE EXCEPTION 'Target URL is required' USING ERRCODE = 'P0001';
  END IF;

  -- Look up package in supplier catalog
  SELECT * INTO v_pkg
  FROM public.straight_supplier_packages
  WHERE public_service_key = btrim(p_service_key)
    AND public_package_key = btrim(p_package_key);

  IF v_pkg.id IS NULL THEN
    RAISE EXCEPTION 'Package not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_pkg.status <> 'active' THEN
    RAISE EXCEPTION 'This service is currently unavailable or requires a custom quote' USING ERRCODE = 'P0001';
  END IF;

  -- Balance check
  SELECT credit_balance INTO v_user_balance
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_user_balance IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_user_balance < v_pkg.selling_price_cents THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  -- Customer-facing notes (strictly sanitize: NO supplier name, NO SMS code, NO supplier cost)
  v_notes := jsonb_build_object(
    'service', v_pkg.public_service_key,
    'platform', COALESCE(p_platform, 'Social'),
    'package_name', v_pkg.package_label,
    'quantity', v_pkg.quantity,
    'target_url', btrim(p_target_url),
    'client_notes', NULLIF(btrim(COALESCE(p_notes, '')), '')
  );

  -- Insert order
  INSERT INTO public.reddit_upvote_orders (
    user_id,
    thread_url,
    subreddit,
    target_type,
    requested_upvotes,
    cost_credits,
    notes
  ) VALUES (
    v_user_id,
    btrim(p_target_url),
    COALESCE(p_platform, 'Social'),
    'reseller_order',
    v_pkg.quantity,
    v_pkg.selling_price_cents,
    v_notes::text
  )
  RETURNING * INTO v_order;

  -- Deduct credit
  INSERT INTO public.credit_transactions (
    user_id, type, amount, balance_after, metadata
  ) VALUES (
    v_user_id,
    'spend',
    -v_pkg.selling_price_cents,
    v_user_balance - v_pkg.selling_price_cents,
    jsonb_build_object(
      'reddit_upvote_order_id', v_order.id,
      'service', v_pkg.public_service_key,
      'package', v_pkg.package_label,
      'quantity', v_pkg.quantity,
      'request_id', p_request_id
    )
  );

  -- Create internal admin fulfillment record (Admin-Only table)
  INSERT INTO public.straight_supplier_fulfillments (
    order_id,
    supplier,
    supplier_code,
    supplier_service_name,
    supplier_package,
    supplier_cost_idr,
    selling_price_idr,
    selling_price_cents,
    supplier_wa,
    supplier_url,
    fulfillment_status
  ) VALUES (
    v_order.id,
    'SolusiMedsos',
    v_pkg.supplier_code,
    v_pkg.supplier_service_name,
    v_pkg.package_label,
    v_pkg.supplier_cost_idr,
    v_pkg.selling_price_idr,
    v_pkg.selling_price_cents,
    v_pkg.supplier_wa,
    v_pkg.supplier_url,
    'pending'
  );

  RETURN v_order;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_create_reseller_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_reseller_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 6. Public Safe Catalog Function: public_get_reseller_packages
-- Excludes supplier name, supplier code, and supplier cost.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_get_reseller_packages(
  p_service_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  public_service_key TEXT,
  public_package_key TEXT,
  package_label TEXT,
  quantity INT,
  selling_price_cents INT,
  status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 
    p.public_service_key,
    p.public_package_key,
    p.package_label,
    p.quantity,
    p.selling_price_cents,
    p.status
  FROM public.straight_supplier_packages p
  WHERE (p_service_key IS NULL OR p.public_service_key = p_service_key)
  ORDER BY p.public_service_key, p.quantity ASC;
$$;

GRANT EXECUTE ON FUNCTION public.public_get_reseller_packages(TEXT) TO PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7. Admin-Only RPC: admin_get_supplier_fulfillment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_supplier_fulfillment(
  p_order_id INT
)
RETURNS TABLE (
  id BIGINT,
  order_id INT,
  supplier TEXT,
  supplier_code TEXT,
  supplier_service_name TEXT,
  supplier_package TEXT,
  supplier_cost_idr INT,
  selling_price_idr INT,
  selling_price_cents INT,
  supplier_wa TEXT,
  supplier_url TEXT,
  fulfillment_status TEXT,
  supplier_order_ref TEXT,
  supplier_notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT f.id, f.order_id, f.supplier, f.supplier_code, f.supplier_service_name,
         f.supplier_package, f.supplier_cost_idr, f.selling_price_idr,
         f.selling_price_cents, f.supplier_wa, f.supplier_url,
         f.fulfillment_status, f.supplier_order_ref, f.supplier_notes,
         f.created_at, f.updated_at
  FROM public.straight_supplier_fulfillments f
  WHERE f.order_id = p_order_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_supplier_fulfillment(INT) TO authenticated;

-- ------------------------------------------------------------
-- 8. Admin-Only RPC: admin_update_supplier_fulfillment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_supplier_fulfillment(
  p_order_id INT,
  p_fulfillment_status TEXT,
  p_supplier_order_ref TEXT DEFAULT NULL,
  p_supplier_notes TEXT DEFAULT NULL
)
RETURNS public.straight_supplier_fulfillments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec public.straight_supplier_fulfillments%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.straight_supplier_fulfillments
  SET fulfillment_status = p_fulfillment_status,
      supplier_order_ref = COALESCE(p_supplier_order_ref, supplier_order_ref),
      supplier_notes = COALESCE(p_supplier_notes, supplier_notes),
      updated_at = NOW()
  WHERE order_id = p_order_id
  RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_supplier_fulfillment(INT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
"""

target_path = "G:/SF Project/peta-main/peta/supabase/migrations/20261025000000_straight_solusimedsos_reseller_services.sql"
with open(target_path, "w", encoding="utf-8") as f:
    f.write(migration_sql)

print("Migration written successfully:", target_path)
