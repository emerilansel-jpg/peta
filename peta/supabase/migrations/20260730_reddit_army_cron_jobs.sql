-- ============================================================
-- PeTa — Reddit Army pg_cron jobs.
--
-- Schedules:
--   1. release_phase1_completion_hold   every hour
--   2. release_biweekly_cashout         Saturday 02:00 UTC (= 09:00 WIB)
--   3. process_resignation_complete     daily 02:00 UTC (= 09:00 WIB)
--   4. flag_ghosting_for_review         weekly Sunday 17:00 UTC (= 00:00 WIB Mon)
--
-- Note: The "sync_reddit_daily_activity" job calls an edge function
-- via pg_net, scheduled separately. See Section 13 of the design spec.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Release phase1 completion holds older than 30 days (every hour).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-release-phase1-hold') THEN
    PERFORM cron.schedule(
      'ra-release-phase1-hold',
      '0 * * * *',
      'SELECT public.release_phase1_completion_hold();'
    );
  END IF;
END $$;

-- 2. Biweekly cashout lump sum (every Saturday 09:00 WIB).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-biweekly-cashout') THEN
    PERFORM cron.schedule(
      'ra-biweekly-cashout',
      '0 2 * * 6',   -- 02:00 UTC Saturday = 09:00 WIB Saturday
      'SELECT public.release_biweekly_cashout();'
    );
  END IF;
END $$;

-- 3. Process resignation complete (daily 09:00 WIB).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-resignation-process') THEN
    PERFORM cron.schedule(
      'ra-resignation-process',
      '0 2 * * *',   -- 02:00 UTC = 09:00 WIB
      'SELECT public.process_resignation_complete();'
    );
  END IF;
END $$;

-- 4. Flag ghosting for admin review (weekly).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ra-flag-ghosting') THEN
    PERFORM cron.schedule(
      'ra-flag-ghosting',
      '0 17 * * 0',  -- 17:00 UTC Sunday = 00:00 WIB Monday
      'SELECT public.flag_ghosting_for_review();'
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
