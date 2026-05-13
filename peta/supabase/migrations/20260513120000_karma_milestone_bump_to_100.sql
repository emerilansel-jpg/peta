-- Bump karma milestone threshold from 10 to 100.
-- Auto-sync on signup (via codetabs proxy) is reliable enough now that 10
-- was way too easy — most accounts already pass it on day 1. Bumping to
-- 100 makes the bonus meaningful and incentivizes real karma-building work.
--
-- Also widens the idempotency index to "one karma_milestone claim per user"
-- (was per user+description), so threshold bumps in the future don't allow
-- double-claims.

-- Drop the old per-description index; replace with a per-user index.
DROP INDEX IF EXISTS idx_user_credits_karma_milestone_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credits_karma_milestone_one_per_user
  ON user_credits (user_id)
  WHERE source = 'karma_milestone';

CREATE OR REPLACE FUNCTION public.claim_karma_milestone()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_max_karma int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT COALESCE(MAX(karma), 0) INTO v_max_karma
  FROM reddit_accounts WHERE user_id = v_uid;

  IF v_max_karma < 100 THEN
    RETURN jsonb_build_object('awarded', false, 'karma', v_max_karma, 'reason', 'karma_below_threshold');
  END IF;

  BEGIN
    INSERT INTO user_credits (user_id, amount, source, description)
    VALUES (v_uid, 5000, 'karma_milestone', 'karma_100');
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('awarded', false, 'karma', v_max_karma, 'reason', 'already_claimed');
  END;

  RETURN jsonb_build_object('awarded', true, 'karma', v_max_karma, 'amount', 5000);
END $$;

REVOKE ALL ON FUNCTION public.claim_karma_milestone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_karma_milestone() TO authenticated;
