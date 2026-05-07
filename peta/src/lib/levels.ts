// Levels are based on a "performance" axis (karma + age).
// Rewards scale from Rp5.000 (newest) up to Rp20.000 (top tier) per comment.
// Upvote/like tasks are separate and pay Rp500 – Rp2.000 (see task_type='upvote').
// Thresholds are mirrored in DB function public.compute_level() — keep in sync.
export const LEVELS = [
  { level: 0, emoji: '🥚', name: 'Si Telur',         minKarma: 0,     minDays: 0,   maxKarma: 4,        maxDays: 2,        reward: 5000  },
  { level: 1, emoji: '🦴', name: 'Cave Baby',        minKarma: 5,     minDays: 3,   maxKarma: 99,       maxDays: 29,       reward: 8000  },
  { level: 2, emoji: '🔥', name: 'Cave Teen',        minKarma: 100,   minDays: 30,  maxKarma: 499,      maxDays: 89,       reward: 11000 },
  { level: 3, emoji: '⚔️', name: 'Village Warrior',  minKarma: 500,   minDays: 90,  maxKarma: 1999,     maxDays: 179,      reward: 14000 },
  { level: 4, emoji: '🏙️', name: 'City Slicker',    minKarma: 2000,  minDays: 180, maxKarma: 9999,     maxDays: 364,      reward: 17000 },
  { level: 5, emoji: '👑', name: 'Legend',           minKarma: 10000, minDays: 365, maxKarma: Infinity, maxDays: Infinity, reward: 20000 },
];

export function calculateLevel(karma: number, accountAgeDays: number): number {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const level = LEVELS[i];
    if (karma >= level.minKarma && accountAgeDays >= level.minDays) {
      return i;
    }
  }
  return 0;
}

export function getLevelInfo(level: number) {
  return LEVELS[level] || LEVELS[0];
}

export function getReward(level: number): number {
  return getLevelInfo(level).reward;
}
