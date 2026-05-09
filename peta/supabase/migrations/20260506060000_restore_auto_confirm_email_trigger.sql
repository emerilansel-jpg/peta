-- Re-add the BEFORE INSERT trigger that auto-confirms new users at the DB level.
--
-- A previous migration removed this trigger on the assumption that the
-- project-level "Confirm email" toggle was OFF on every environment. That
-- assumption broke on the prod project, where new signups were being held in
-- unconfirmed state and never got an active session — so the post-signup
-- redirect to /onboarding bounced back to /login with "Email not confirmed".
--
-- The trigger sits at the DB level so it works regardless of dashboard
-- settings, and it's idempotent (only sets email_confirmed_at if NULL).

CREATE OR REPLACE FUNCTION auto_confirm_user()
RETURNS TRIGGER AS $$
BEGIN
  -- confirmed_at is a generated column in recent Supabase auth schema
  -- versions and cannot be set directly — only touch email_confirmed_at.
  NEW.email_confirmed_at = COALESCE(NEW.email_confirmed_at, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_confirm_users_trigger ON auth.users;

CREATE TRIGGER auto_confirm_users_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_confirm_user();

-- Backfill: confirm any existing unconfirmed users so they can finally log in.
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;
