-- ============================================================
-- PeTa — Reddit Army: Schedule hourly sync edge function via pg_net.
--
-- Run this ONCE in Supabase Dashboard > SQL Editor after
-- REDDIT_ARMY_APPLY.sql has been applied.
--
-- INSTRUCTIONS:
--   Just run this whole script. No tokens to replace.
--
-- How it works:
--   - pg_net calls the edge function every hour (at minute 5).
--   - Auth header uses the project's ANON key — enough to invoke the
--     function (which is deployed with --no-verify-jwt anyway).
--   - The edge function itself has internal access to
--     SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase platform),
--     so it can call SECURITY DEFINER RPCs that bypass RLS.
--   - Body { "user_ids": null } tells the function to sync all
--     phase2_active + resigning members.
--
-- To verify after run:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ra-sync-daily-activity';
-- ============================================================

-- 1. Make sure pg_net is enabled.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Drop existing schedule if any (idempotent re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-sync-daily-activity') THEN
    PERFORM cron.unschedule('ra-sync-daily-activity');
  END IF;
END $$;

-- 3. Schedule hourly call.
SELECT cron.schedule(
  'ra-sync-daily-activity',
  '5 * * * *',  -- at minute 5 of every hour
  $$
    SELECT net.http_post(
      url := 'https://yorlsgzsawchpeeazcvi.supabase.co/functions/v1/sync-reddit-daily-activity',
      headers := jsonb_build_object(
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZmVyZW5jZSI6InlvcmxzZ3pzYXdjaHBlZWF6Y3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5ODU4NzQsImV4cCI6MjA5MzU2MTg3NH0.He3SQMbxTrsBmWmhZWa6P3C1TgFSBqMVjzjdnMhNjD8',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('user_ids', null)
    );
  $$
);

-- 4. Show what was scheduled.
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ra-%' ORDER BY jobname;
