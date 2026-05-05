-- Idempotency for signup bonuses: same user + same description = same credit
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credits_signup_dedup
  ON public.user_credits (user_id, description)
  WHERE source = 'signup_bonus';

-- Backfill: grant Rp50K to every existing army member who completed Reddit setup
-- but never received a signup bonus (existing users from before the bonus logic existed)
INSERT INTO public.user_credits (user_id, amount, source, description)
SELECT u.id, 50000, 'signup_bonus', 'Bonus onboarding (lengkap)'
FROM public.users u
JOIN public.reddit_accounts ra ON ra.user_id = u.id
WHERE u.role = 'army'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_credits c
    WHERE c.user_id = u.id AND c.source = 'signup_bonus'
  )
ON CONFLICT DO NOTHING;
