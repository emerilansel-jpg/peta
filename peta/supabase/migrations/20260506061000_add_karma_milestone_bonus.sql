-- Karma milestone bonus: Rp5K when user's max reddit_account karma >= 10.
-- Used as the post-onboarding "Misi Wajib #1" reward to keep army engaged
-- while real cuan tasks are still ramping.

ALTER TABLE user_credits DROP CONSTRAINT IF EXISTS user_credits_source_check;
ALTER TABLE user_credits ADD CONSTRAINT user_credits_source_check
  CHECK (source = ANY (ARRAY[
    'referral_bonus_referrer'::text,
    'referral_bonus_referee'::text,
    'signup_bonus'::text,
    'manual_adjustment'::text,
    'karma_milestone'::text
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credits_karma_milestone_unique
  ON user_credits (user_id, description)
  WHERE source = 'karma_milestone';

-- Server-side claim. Trusts only the DB-stored karma (synced from Reddit on
-- demand by the client). Idempotent via the partial unique index above.
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

  IF v_max_karma < 10 THEN
    RETURN jsonb_build_object('awarded', false, 'karma', v_max_karma, 'reason', 'karma_below_threshold');
  END IF;

  BEGIN
    INSERT INTO user_credits (user_id, amount, source, description)
    VALUES (v_uid, 5000, 'karma_milestone', 'karma_10');
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('awarded', false, 'karma', v_max_karma, 'reason', 'already_claimed');
  END;

  RETURN jsonb_build_object('awarded', true, 'karma', v_max_karma, 'amount', 5000);
END $$;

REVOKE ALL ON FUNCTION public.claim_karma_milestone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_karma_milestone() TO authenticated;
