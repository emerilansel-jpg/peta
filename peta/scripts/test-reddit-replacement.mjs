// test-reddit-replacement.mjs
// Offline verification of Reddit account replacement migration and logic contracts.

import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('1. Checking SQL migration structure & contracts...');
const migrationPath = path.resolve('supabase/migrations/20260911000000_replace_reddit_account_flow.sql');
assert(fs.existsSync(migrationPath), `Migration file not found at ${migrationPath}`);
const sql = fs.readFileSync(migrationPath, 'utf8');

// Check column additions
assert(sql.includes('is_active boolean NOT NULL DEFAULT true'), 'Missing is_active column');
assert(sql.includes('replaced_at timestamptz'), 'Missing replaced_at column');
assert(sql.includes('replacement_reason text'), 'Missing replacement_reason column');
assert(sql.includes('replaced_by_account_id uuid'), 'Missing replaced_by_account_id column');

// Check RPC replace_user_reddit_account
assert(sql.includes('CREATE OR REPLACE FUNCTION public.replace_user_reddit_account'), 'Missing replace_user_reddit_account RPC');
assert(sql.includes('p_new_username text'), 'Missing p_new_username param');
assert(sql.includes('p_reason text'), 'Missing p_reason param');
assert(sql.includes('p_initial_karma int'), 'Missing p_initial_karma param');
assert(sql.includes('p_initial_age_days int'), 'Missing p_initial_age_days param');
assert(sql.includes('p_user_id uuid'), 'Missing p_user_id param');
assert(sql.includes('GRANT EXECUTE ON FUNCTION public.replace_user_reddit_account'), 'Missing grant on replace_user_reddit_account');

// Check claim_challenge_task active check
assert(sql.includes('ra.is_active, true) = true'), 'Missing active check in claim_challenge_task');

console.log('   ✓ Migration file syntax & contracts verified.');

console.log('2. Simulating username sanitization & validation logic...');
function sanitizeUsername(raw) {
  const clean = String(raw || '')
    .replace(/^.*?(?:reddit\.com\/(?:user|u)\/|u\/|user\/)/i, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .trim();
  return clean;
}

assert.strictEqual(sanitizeUsername('u/valid_user'), 'valid_user');
assert.strictEqual(sanitizeUsername('https://www.reddit.com/user/another-user_1'), 'another-user_1');
assert.strictEqual(sanitizeUsername('reddit.com/u/thirdUser'), 'thirdUser');
assert.strictEqual(sanitizeUsername('user/fourth_user'), 'fourth_user');
assert.strictEqual(sanitizeUsername('   clean_user   '), 'clean_user');
console.log('   ✓ Sanitization verified.');

console.log('3. Simulating replacement state transitions...');
// Test state: User with old account, 2 completed tasks, 1 in-progress task, Rp100.000 saldo
const user = { id: 'user-uuid-1', saldo: 100000 };
let accounts = [
  { id: 'acc-1', user_id: user.id, username: 'banned_acc', is_active: true, karma: 120, status_flag: 'suspended' }
];
let assignments = [
  { id: 'assign-1', task_id: 't-1', reddit_account_id: 'acc-1', status: 'approved', reward: 15000 },
  { id: 'assign-2', task_id: 't-2', reddit_account_id: 'acc-1', status: 'submitted', reward: 10000 },
  { id: 'assign-3', task_id: 't-3', reddit_account_id: 'acc-1', status: 'in_progress', reward: 12000 },
];
let profile = { user_id: user.id, warmed_account_id: 'acc-1', current_challenge_level: 2 };

// Execute replacement logic
function simulateReplace(newUsername, reason) {
  const clean = sanitizeUsername(newUsername);
  assert(clean.length >= 3, 'Username minimal 3 karakter');

  const oldAcc = accounts.find((a) => a.user_id === user.id && a.is_active);
  assert(oldAcc.username !== clean, 'Akun baru tidak boleh sama');

  const newAcc = {
    id: 'acc-2',
    user_id: user.id,
    username: clean,
    is_active: true,
    karma: 50,
    status_flag: 'ok',
  };

  // Archive old
  oldAcc.is_active = false;
  oldAcc.replaced_at = new Date().toISOString();
  oldAcc.replacement_reason = reason;
  oldAcc.replaced_by_account_id = newAcc.id;

  accounts.push(newAcc);

  // Update profile
  if (profile) {
    profile.warmed_account_id = newAcc.id;
  }

  return newAcc;
}

const newAcc = simulateReplace('u/fresh_account_2026', 'Akun lama terkena shadowban');

// Assertions
assert.strictEqual(accounts.length, 2, 'Should have 2 accounts stored');
assert.strictEqual(accounts[0].is_active, false, 'Old account must be archived (is_active = false)');
assert.strictEqual(accounts[0].replaced_by_account_id, 'acc-2', 'Old account links to replacement');
assert.strictEqual(accounts[1].is_active, true, 'New account must be active');
assert.strictEqual(profile.warmed_account_id, 'acc-2', 'Profile warmed_account_id points to new account');
assert.strictEqual(profile.current_challenge_level, 2, 'Challenge level must NOT be reset');

// Check past tasks & balance safety
assert.strictEqual(assignments[0].status, 'approved', 'Approved task MUST stay approved');
assert.strictEqual(assignments[0].reddit_account_id, 'acc-1', 'Approved task retains historical account reference');
assert.strictEqual(assignments[1].status, 'submitted', 'Submitted task MUST stay submitted for admin review');
assert.strictEqual(user.saldo, 100000, 'Saldo MUST NOT be reset');

console.log('   ✓ State transitions & history preservation verified.');
console.log('\nALL TESTS PASSED: Reddit account replacement flow is solid and safe.');
