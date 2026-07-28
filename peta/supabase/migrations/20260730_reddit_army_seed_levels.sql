-- ============================================================
-- PeTa — Reddit Army: Seed initial 5 challenge levels.
--
-- Draft values, editable via Admin UI (RedditArmy > Challenges tab).
-- Completing level 5 (Veteran) triggers phase1 completion (Rp100K).
-- ============================================================

INSERT INTO public.reddit_challenge_levels
  (level_number, level_name, title, description, target_type, target_count, target_subreddits, reward_amount, display_order, is_active)
VALUES
  (
    1,
    'Tunas',
    'Comment 3x di r/indonesia',
    'Komen 3 kali di subreddit r/indonesia biar akun keliatan hidup.',
    'comment_count',
    3,
    ARRAY['indonesia'],
    5000,
    1,
    true
  ),
  (
    2,
    'Pemuda',
    'Comment 5x + 1 post',
    'Komen 5 kali di subreddit apa aja + bikin 1 post pendek.',
    'combined',
    5,
    NULL,
    10000,
    2,
    true
  ),
  (
    3,
    'Penggiat',
    'Karma ≥ 20',
    'Akun kamu harus dapet minimal 20 karma (post + comment karma total).',
    'karma_threshold',
    20,
    NULL,
    15000,
    3,
    true
  ),
  (
    4,
    'Pejuang',
    'Karma ≥ 50 + 3 posts',
    'Naikin karma ke 50 + bikin 3 post di subreddit yang relevan.',
    'combined',
    50,
    NULL,
    20000,
    4,
    true
  ),
  (
    5,
    'Veteran',
    'Karma ≥ 100 + 5 posts',
    'Level terakhir: karma 100 + 5 posts. Selesaiin ini = dapet Rp100K lump & masuk Fase 2.',
    'combined',
    100,
    NULL,
    0,  -- level 5 reward is the Rp100K phase1_completion, not a level reward
    5,
    true
  )
ON CONFLICT (level_number) DO UPDATE SET
  level_name = EXCLUDED.level_name,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  target_type = EXCLUDED.target_type,
  target_count = EXCLUDED.target_count,
  target_subreddits = EXCLUDED.target_subreddits,
  reward_amount = EXCLUDED.reward_amount,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';
