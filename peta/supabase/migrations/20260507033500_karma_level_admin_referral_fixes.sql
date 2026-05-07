-- =============================================================
-- Karma / level / admin / referral fixes
--
-- Fixes three production bugs:
--   1. Reddit karma fetch was CORS-blocked from the browser. The
--      client now invokes a Supabase Edge Function (`sync-reddit-karma`)
--      which proxies the request server-side. Reddit also blocks
--      unauthenticated server requests since 2023, so admin manual
--      entry below is the canonical path.
--   2. Admin had no way to set karma manually. `admin_set_karma`
--      RPC + a BEFORE INSERT/UPDATE trigger on `reddit_accounts`
--      keep level in sync with karma + age automatically.
--   3. User `Diundang` count always showed 0 because RLS hides
--      other users' rows. `get_referral_count` is SECURITY DEFINER
--      and bypasses RLS for the caller's own count (admins can
--      see anyone's).
-- =============================================================

-- 1) compute_level(karma, age_days) — single source of truth.
--    Mirrored in src/lib/levels.ts (LEVELS array).
CREATE OR REPLACE FUNCTION public.compute_level(p_karma int, p_age_days int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_karma >= 10000 AND p_age_days >= 365 THEN RETURN 5;
  ELSIF p_karma >= 2000 AND p_age_days >= 180 THEN RETURN 4;
  ELSIF p_karma >= 500 AND p_age_days >= 90 THEN RETURN 3;
  ELSIF p_karma >= 100 AND p_age_days >= 30 THEN RETURN 2;
  ELSIF p_karma >= 5 AND p_age_days >= 3 THEN RETURN 1;
  ELSE RETURN 0;
  END IF;
END $$;

-- 2) BEFORE INSERT/UPDATE trigger so level cannot drift from karma + age.
CREATE OR REPLACE FUNCTION public.tg_set_reddit_level()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.level := public.compute_level(COALESCE(NEW.karma,0), COALESCE(NEW.account_age_days,0));
  NEW.last_sync := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reddit_accounts_set_level ON public.reddit_accounts;
CREATE TRIGGER reddit_accounts_set_level
  BEFORE INSERT OR UPDATE OF karma, account_age_days ON public.reddit_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_reddit_level();

-- 3) admin_set_karma — admin-only manual karma override. Level
--    auto-recomputes via the trigger above.
CREATE OR REPLACE FUNCTION public.admin_set_karma(
  p_account_id uuid,
  p_karma int,
  p_account_age_days int DEFAULT NULL
)
RETURNS public.reddit_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.reddit_accounts;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  IF p_karma < 0 THEN
    RAISE EXCEPTION 'karma must be >= 0';
  END IF;

  UPDATE public.reddit_accounts
  SET karma = p_karma,
      account_age_days = COALESCE(p_account_age_days, account_age_days)
  WHERE id = p_account_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'reddit_account not found: %', p_account_id;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_karma(uuid, int, int) TO authenticated;

-- 4) get_referral_count — bypasses RLS so a user can see how many
--    they've referred (RLS otherwise hides other users' rows).
CREATE OR REPLACE FUNCTION public.get_referral_count(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.uid() <> p_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*)::int INTO v_count
  FROM public.users
  WHERE referred_by = p_user_id;

  RETURN COALESCE(v_count, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.get_referral_count(uuid) TO authenticated;

-- 5) Backfill levels for existing accounts so trigger output is canonical.
UPDATE public.reddit_accounts SET karma = karma WHERE 1=1;
