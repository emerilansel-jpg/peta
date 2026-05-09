-- =============================================================
-- Honor-system karma claim flow.
--
-- Reddit's anti-bot blocks data-center IPs on the public JSON
-- endpoints, so the auto-sync edge function falls back ~100% of
-- the time. To unblock users without a paid scraper or a
-- registered Reddit OAuth app, the user reads their own karma
-- number from their Reddit profile and submits it via
-- `submit_karma_claim`. The value lives on `reddit_accounts`
-- as `pending_karma` until an admin verifies the user's profile
-- on Reddit and approves via `admin_set_karma` (which now also
-- clears the pending fields).
-- =============================================================

ALTER TABLE public.reddit_accounts
  ADD COLUMN IF NOT EXISTS pending_karma int,
  ADD COLUMN IF NOT EXISTS pending_karma_submitted_at timestamptz;

CREATE OR REPLACE FUNCTION public.submit_karma_claim(
  p_account_id uuid,
  p_claimed_karma int
)
RETURNS public.reddit_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.reddit_accounts;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_claimed_karma < 0 OR p_claimed_karma > 10000000 THEN
    RAISE EXCEPTION 'claimed_karma out of range (0..10000000)';
  END IF;

  SELECT user_id INTO v_owner
  FROM public.reddit_accounts
  WHERE id = p_account_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'reddit_account not found';
  END IF;
  IF v_owner <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not your account';
  END IF;

  UPDATE public.reddit_accounts
  SET pending_karma = p_claimed_karma,
      pending_karma_submitted_at = NOW()
  WHERE id = p_account_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_karma_claim(uuid, int) TO authenticated;

-- admin_set_karma extended to clear pending fields when applying a value.
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
      account_age_days = COALESCE(p_account_age_days, account_age_days),
      pending_karma = NULL,
      pending_karma_submitted_at = NULL
  WHERE id = p_account_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'reddit_account not found: %', p_account_id;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_karma(uuid, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_karma_claim(p_account_id uuid)
RETURNS public.reddit_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.reddit_accounts;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  UPDATE public.reddit_accounts
  SET pending_karma = NULL,
      pending_karma_submitted_at = NULL
  WHERE id = p_account_id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reject_karma_claim(uuid) TO authenticated;
