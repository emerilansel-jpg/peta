-- Migration: 20261025000000_straight_solusimedsos_reseller_services.sql
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
  ('SMS-LIKE-010', 'SolusiMedsos', 'SMS-LIKE-010', '1', 'Like 100% Manusia - Retweet - Share', 'https://solusimedsos.id/like', '6285123938143', 25000, 'sms_social_likes', 'like_10', '10 Likes', 10, 50000, 313, 'active'),
  ('SMS-LIKE-050', 'SolusiMedsos', 'SMS-LIKE-050', '1', 'Like 100% Manusia - Retweet - Share', 'https://solusimedsos.id/like', '6285123938143', 100000, 'sms_social_likes', 'like_50', '50 Likes', 50, 200000, 1250, 'active'),
  ('SMS-LIKE-100', 'SolusiMedsos', 'SMS-LIKE-100', '1', 'Like 100% Manusia - Retweet - Share', 'https://solusimedsos.id/like', '6285123938143', 190000, 'sms_social_likes', 'like_100', '100 Likes', 100, 380000, 2375, 'active'),
  ('SMS-LIKE-200', 'SolusiMedsos', 'SMS-LIKE-200', '1', 'Like 100% Manusia - Retweet - Share', 'https://solusimedsos.id/like', '6285123938143', 375000, 'sms_social_likes', 'like_200', '200 Likes', 200, 750000, 4688, 'active'),
  ('SMS-LIKE-500', 'SolusiMedsos', 'SMS-LIKE-500', '1', 'Like 100% Manusia - Retweet - Share', 'https://solusimedsos.id/like', '6285123938143', 900000, 'sms_social_likes', 'like_500', '500 Likes', 500, 1800000, 11250, 'active'),
  ('SMS-COMLIKE-020', 'SolusiMedsos', 'SMS-COMLIKE-020', '2', 'Like Comment (Top Comment Booster)', 'https://solusimedsos.id/comment', '6285123938143', 60000, 'sms_comment_likes', 'comlike_20', '20 Comment Likes', 20, 120000, 750, 'active'),
  ('SMS-COMLIKE-050', 'SolusiMedsos', 'SMS-COMLIKE-050', '2', 'Like Comment (Top Comment Booster)', 'https://solusimedsos.id/comment', '6285123938143', 130000, 'sms_comment_likes', 'comlike_50', '50 Comment Likes', 50, 260000, 1625, 'active'),
  ('SMS-COMLIKE-100', 'SolusiMedsos', 'SMS-COMLIKE-100', '2', 'Like Comment (Top Comment Booster)', 'https://solusimedsos.id/comment', '6285123938143', 250000, 'sms_comment_likes', 'comlike_100', '100 Comment Likes', 100, 500000, 3125, 'active'),
  ('SMS-COMLIKE-500', 'SolusiMedsos', 'SMS-COMLIKE-500', '2', 'Like Comment (Top Comment Booster)', 'https://solusimedsos.id/comment', '6285123938143', 1200000, 'sms_comment_likes', 'comlike_500', '500 Comment Likes', 500, 2400000, 15000, 'active'),
  ('SMS-FOLLOW-050', 'SolusiMedsos', 'SMS-FOLLOW-050', '3', 'Follower Full Human', 'https://solusimedsos.id/follower', '6285123938143', 100000, 'sms_real_followers', 'follow_50', '50 Real Followers', 50, 200000, 1250, 'active'),
  ('SMS-FOLLOW-100', 'SolusiMedsos', 'SMS-FOLLOW-100', '3', 'Follower Full Human', 'https://solusimedsos.id/follower', '6285123938143', 200000, 'sms_real_followers', 'follow_100', '100 Real Followers', 100, 400000, 2500, 'active'),
  ('SMS-FOLLOW-500', 'SolusiMedsos', 'SMS-FOLLOW-500', '3', 'Follower Full Human', 'https://solusimedsos.id/follower', '6285123938143', 950000, 'sms_real_followers', 'follow_500', '500 Real Followers', 500, 1900000, 11875, 'active'),
  ('SMS-FOLLOW-1K', 'SolusiMedsos', 'SMS-FOLLOW-1K', '3', 'Follower Full Human', 'https://solusimedsos.id/follower', '6285123938143', 1850000, 'sms_real_followers', 'follow_1k', '1,000 Real Followers', 1000, 3700000, 23125, 'active'),
  ('SMS-FOLLOW-2K', 'SolusiMedsos', 'SMS-FOLLOW-2K', '3', 'Follower Full Human', 'https://solusimedsos.id/follower', '6285123938143', 3600000, 'sms_real_followers', 'follow_2k', '2,000 Real Followers', 2000, 7200000, 45000, 'active'),
  ('SMS-FOLLOW-5K', 'SolusiMedsos', 'SMS-FOLLOW-5K', '3', 'Follower Full Human', 'https://solusimedsos.id/follower', '6285123938143', 8000000, 'sms_real_followers', 'follow_5k', '5,000 Real Followers', 5000, 16000000, 100000, 'active'),
  ('SMS-GIVEAWAY-2K', 'SolusiMedsos', 'SMS-GIVEAWAY-2K', '4', 'Follower Indo Metode Giveaway', 'https://solusimedsos.id/follower-giveaway', '6285123938143', 299000, 'sms_giveaway_followers', 'giveaway_2k', '2,000 Giveaway Followers', 2000, 598000, 3738, 'active'),
  ('SMS-GIVEAWAY-5K', 'SolusiMedsos', 'SMS-GIVEAWAY-5K', '4', 'Follower Indo Metode Giveaway', 'https://solusimedsos.id/follower-giveaway', '6285123938143', 499000, 'sms_giveaway_followers', 'giveaway_5k', '5,000 Giveaway Followers', 5000, 998000, 6238, 'active'),
  ('SMS-GIVEAWAY-10K', 'SolusiMedsos', 'SMS-GIVEAWAY-10K', '4', 'Follower Indo Metode Giveaway', 'https://solusimedsos.id/follower-giveaway', '6285123938143', 899000, 'sms_giveaway_followers', 'giveaway_10k', '10,000 Giveaway Followers', 10000, 1798000, 11238, 'active'),
  ('SMS-GIVEAWAY-20K', 'SolusiMedsos', 'SMS-GIVEAWAY-20K', '4', 'Follower Indo Metode Giveaway', 'https://solusimedsos.id/follower-giveaway', '6285123938143', 1299000, 'sms_giveaway_followers', 'giveaway_20k', '20,000 Giveaway Followers', 20000, 2598000, 16238, 'active'),
  ('SMS-COMM-020', 'SolusiMedsos', 'SMS-COMM-020', '5', 'Real Custom Comments', 'https://solusimedsos.id/comment', '6285123938143', 80000, 'sms_real_comments', 'comm_20', '20 Real Comments', 20, 160000, 1000, 'active'),
  ('SMS-COMM-050', 'SolusiMedsos', 'SMS-COMM-050', '5', 'Real Custom Comments', 'https://solusimedsos.id/comment', '6285123938143', 200000, 'sms_real_comments', 'comm_50', '50 Real Comments', 50, 400000, 2500, 'active'),
  ('SMS-COMM-100', 'SolusiMedsos', 'SMS-COMM-100', '5', 'Real Custom Comments', 'https://solusimedsos.id/comment', '6285123938143', 375000, 'sms_real_comments', 'comm_100', '100 Real Comments', 100, 750000, 4688, 'active'),
  ('SMS-COMM-500', 'SolusiMedsos', 'SMS-COMM-500', '5', 'Real Custom Comments', 'https://solusimedsos.id/comment', '6285123938143', 1850000, 'sms_real_comments', 'comm_500', '500 Real Comments', 500, 3700000, 23125, 'active'),
  ('SMS-COMM-1K', 'SolusiMedsos', 'SMS-COMM-1K', '5', 'Real Custom Comments', 'https://solusimedsos.id/comment', '6285123938143', 3600000, 'sms_real_comments', 'comm_1k', '1,000 Real Comments', 1000, 7200000, 45000, 'active'),
  ('SMS-REPLY-020', 'SolusiMedsos', 'SMS-REPLY-020', '6', 'Thread Reply Comments', 'https://solusimedsos.id/comment', '6285123938143', 90000, 'sms_reply_comments', 'reply_20', '20 Thread Replies', 20, 180000, 1125, 'active'),
  ('SMS-REPLY-050', 'SolusiMedsos', 'SMS-REPLY-050', '6', 'Thread Reply Comments', 'https://solusimedsos.id/comment', '6285123938143', 230000, 'sms_reply_comments', 'reply_50', '50 Thread Replies', 50, 460000, 2875, 'active'),
  ('SMS-REPLY-100', 'SolusiMedsos', 'SMS-REPLY-100', '6', 'Thread Reply Comments', 'https://solusimedsos.id/comment', '6285123938143', 450000, 'sms_reply_comments', 'reply_100', '100 Thread Replies', 100, 900000, 5625, 'active'),
  ('SMS-REPLY-500', 'SolusiMedsos', 'SMS-REPLY-500', '6', 'Thread Reply Comments', 'https://solusimedsos.id/comment', '6285123938143', 2250000, 'sms_reply_comments', 'reply_500', '500 Thread Replies', 500, 4500000, 28125, 'active'),
  ('SMS-COMBO-020', 'SolusiMedsos', 'SMS-COMBO-020', '8', 'Engagement Combo: Comment + Like', 'https://solusimedsos.id/comment', '6285123938143', 100000, 'sms_engagement_combo', 'combo_20', '20 Comments + 20 Likes', 20, 200000, 1250, 'active'),
  ('SMS-COMBO-050', 'SolusiMedsos', 'SMS-COMBO-050', '8', 'Engagement Combo: Comment + Like', 'https://solusimedsos.id/comment', '6285123938143', 250000, 'sms_engagement_combo', 'combo_50', '50 Comments + 50 Likes', 50, 500000, 3125, 'active'),
  ('SMS-COMBO-100', 'SolusiMedsos', 'SMS-COMBO-100', '8', 'Engagement Combo: Comment + Like', 'https://solusimedsos.id/comment', '6285123938143', 500000, 'sms_engagement_combo', 'combo_100', '100 Comments + 100 Likes', 100, 1000000, 6250, 'active'),
  ('SMS-COMBO-500', 'SolusiMedsos', 'SMS-COMBO-500', '8', 'Engagement Combo: Comment + Like', 'https://solusimedsos.id/comment', '6285123938143', 2500000, 'sms_engagement_combo', 'combo_500', '500 Comments + 500 Likes', 500, 5000000, 31250, 'active'),
  ('SMS-VIEW-1K', 'SolusiMedsos', 'SMS-VIEW-1K', '9', 'Reel / TikTok Views', 'https://solusimedsos.id/tiktok', '6285123938143', 55000, 'sms_video_views', 'view_1k', '1,000 Video Views', 1000, 110000, 688, 'active'),
  ('SMS-VIEW-2K', 'SolusiMedsos', 'SMS-VIEW-2K', '9', 'Reel / TikTok Views', 'https://solusimedsos.id/tiktok', '6285123938143', 75000, 'sms_video_views', 'view_2k', '2,000 Video Views', 2000, 150000, 938, 'active'),
  ('SMS-VIEW-5K', 'SolusiMedsos', 'SMS-VIEW-5K', '9', 'Reel / TikTok Views', 'https://solusimedsos.id/tiktok', '6285123938143', 150000, 'sms_video_views', 'view_5k', '5,000 Video Views', 5000, 300000, 1875, 'active'),
  ('SMS-VIEW-10K', 'SolusiMedsos', 'SMS-VIEW-10K', '9', 'Reel / TikTok Views', 'https://solusimedsos.id/tiktok', '6285123938143', 200000, 'sms_video_views', 'view_10k', '10,000 Video Views', 10000, 400000, 2500, 'active'),
  ('SMS-VIEW-50K', 'SolusiMedsos', 'SMS-VIEW-50K', '9', 'Reel / TikTok Views', 'https://solusimedsos.id/tiktok', '6285123938143', 500000, 'sms_video_views', 'view_50k', '50,000 Video Views', 50000, 1000000, 6250, 'active'),
  ('SMS-VIEW-100K', 'SolusiMedsos', 'SMS-VIEW-100K', '9', 'Reel / TikTok Views', 'https://solusimedsos.id/tiktok', '6285123938143', 750000, 'sms_video_views', 'view_100k', '100,000 Video Views', 100000, 1500000, 9375, 'active'),
  ('SMS-SURVEY-020', 'SolusiMedsos', 'SMS-SURVEY-020', '10', 'Jasa Isi Kuesioner (max 5 hal)', 'https://solusimedsos.id/kuesioner', '6285123938143', 140000, 'sms_survey_respondents', 'survey_20', '20 Survey Respondents', 20, 280000, 1750, 'active'),
  ('SMS-SURVEY-050', 'SolusiMedsos', 'SMS-SURVEY-050', '10', 'Jasa Isi Kuesioner (max 5 hal)', 'https://solusimedsos.id/kuesioner', '6285123938143', 340000, 'sms_survey_respondents', 'survey_50', '50 Survey Respondents', 50, 680000, 4250, 'active'),
  ('SMS-SURVEY-100', 'SolusiMedsos', 'SMS-SURVEY-100', '10', 'Jasa Isi Kuesioner (max 5 hal)', 'https://solusimedsos.id/kuesioner', '6285123938143', 650000, 'sms_survey_respondents', 'survey_100', '100 Survey Respondents', 100, 1300000, 8125, 'active'),
  ('SMS-SURVEY-500', 'SolusiMedsos', 'SMS-SURVEY-500', '10', 'Jasa Isi Kuesioner (max 5 hal)', 'https://solusimedsos.id/kuesioner', '6285123938143', 3000000, 'sms_survey_respondents', 'survey_500', '500 Survey Respondents', 500, 6000000, 37500, 'active'),
  ('SMS-POLL-020', 'SolusiMedsos', 'SMS-POLL-020', '11', 'Vote / Poll Publik', 'https://solusimedsos.id/vote', '6285123938143', 100000, 'sms_public_votes', 'poll_20', '20 Poll Votes', 20, 200000, 1250, 'active'),
  ('SMS-POLL-050', 'SolusiMedsos', 'SMS-POLL-050', '11', 'Vote / Poll Publik', 'https://solusimedsos.id/vote', '6285123938143', 200000, 'sms_public_votes', 'poll_50', '50 Poll Votes', 50, 400000, 2500, 'active'),
  ('SMS-POLL-100', 'SolusiMedsos', 'SMS-POLL-100', '11', 'Vote / Poll Publik', 'https://solusimedsos.id/vote', '6285123938143', 400000, 'sms_public_votes', 'poll_100', '100 Poll Votes', 100, 800000, 5000, 'active'),
  ('SMS-POLL-500', 'SolusiMedsos', 'SMS-POLL-500', '11', 'Vote / Poll Publik', 'https://solusimedsos.id/vote', '6285123938143', 2000000, 'sms_public_votes', 'poll_500', '500 Poll Votes', 500, 4000000, 25000, 'active'),
  ('SMS-POLL-1K', 'SolusiMedsos', 'SMS-POLL-1K', '11', 'Vote / Poll Publik', 'https://solusimedsos.id/vote', '6285123938143', 3800000, 'sms_public_votes', 'poll_1k', '1,000 Poll Votes', 1000, 7600000, 47500, 'active'),
  ('SMS-POST-020', 'SolusiMedsos', 'SMS-POST-020', '12', 'Campaign Post Amplification', 'https://solusimedsos.id/ratecard', '6285123938143', 200000, 'sms_campaign_posts', 'post_20', '20 Campaign Posts', 20, 400000, 2500, 'active'),
  ('SMS-POST-050', 'SolusiMedsos', 'SMS-POST-050', '12', 'Campaign Post Amplification', 'https://solusimedsos.id/ratecard', '6285123938143', 500000, 'sms_campaign_posts', 'post_50', '50 Campaign Posts', 50, 1000000, 6250, 'active'),
  ('SMS-POST-100', 'SolusiMedsos', 'SMS-POST-100', '12', 'Campaign Post Amplification', 'https://solusimedsos.id/ratecard', '6285123938143', 1000000, 'sms_campaign_posts', 'post_100', '100 Campaign Posts', 100, 2000000, 12500, 'active'),
  ('SMS-TREND-1H', 'SolusiMedsos', 'SMS-TREND-1H', '13', 'Trending Topik Twitter', 'https://solusimedsos.id/trending', '6285123938143', 8000000, 'sms_twitter_trending', 'trend_1h', '1 Hour Trending Topic', 1, 16000000, 100000, 'active'),
  ('SMS-TREND-2H', 'SolusiMedsos', 'SMS-TREND-2H', '13', 'Trending Topik Twitter', 'https://solusimedsos.id/trending', '6285123938143', 12500000, 'sms_twitter_trending', 'trend_2h', '2 Hours Trending Topic', 2, 25000000, 156250, 'active'),
  ('SMS-TREND-3H', 'SolusiMedsos', 'SMS-TREND-3H', '13', 'Trending Topik Twitter', 'https://solusimedsos.id/trending', '6285123938143', 18000000, 'sms_twitter_trending', 'trend_3h', '3 Hours Trending Topic', 3, 36000000, 225000, 'active'),
  ('SMS-TREND-QUOTE', 'SolusiMedsos', 'SMS-TREND-QUOTE', '13', 'Trending Topik Twitter (4+ Hours / Prime Time)', 'https://solusimedsos.id/trending', '6285123938143', 0, 'sms_twitter_trending', 'trend_quote', 'Custom Duration / Prime Time', 1, 0, 0, 'quote_only'),
  ('SMS-YTWATCH-1K', 'SolusiMedsos', 'SMS-YTWATCH-1K', '14', 'Jam Tayang Youtube (1000 Jam)', 'https://solusimedsos.id/youtube', '6285123938143', 850000, 'sms_youtube_watch', 'ytwatch_1k', '1,000 Watch Hours', 1000, 1700000, 10625, 'paused'),
  ('SMS-YTWATCH-2K', 'SolusiMedsos', 'SMS-YTWATCH-2K', '14', 'Jam Tayang Youtube (2000 Jam)', 'https://solusimedsos.id/youtube', '6285123938143', 1700000, 'sms_youtube_watch', 'ytwatch_2k', '2,000 Watch Hours', 2000, 3400000, 21250, 'paused'),
  ('SMS-YTWATCH-4K', 'SolusiMedsos', 'SMS-YTWATCH-4K', '14', 'Jam Tayang Youtube (4000 Jam)', 'https://solusimedsos.id/youtube', '6285123938143', 3200000, 'sms_youtube_watch', 'ytwatch_4k', '4,000 Watch Hours', 4000, 6400000, 40000, 'paused'),
  ('SMS-CLIPPER-QUOTE', 'SolusiMedsos', 'SMS-CLIPPER-QUOTE', '15', 'Jasa Clipper Video', 'https://solusimedsos.id/clipper', '6285123938143', 0, 'sms_video_clipper', 'clipper_quote', 'Content Clipping Campaign', 1, 0, 0, 'quote_only')
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
