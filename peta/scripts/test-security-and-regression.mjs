// test-security-and-regression.mjs
// Automated regression test suite to ensure all QA security and bug fixes
// remain permanently enforced across codebase and migrations.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== RUNNING SECURITY & REGRESSION VERIFICATION SUITE ===');

// 1. Verify B02 & B03 & B06 & B07 & B09 in migrations
console.log('1. Checking Database Security & Logic Migrations...');
const migrationPath = path.join(rootDir, 'supabase', 'migrations', '20260914110000_fix_security_and_qa_regressions.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration 20260914110000 must exist');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

// B02: Direct insert prevention
assert.ok(migrationSql.includes('DROP POLICY IF EXISTS payouts_insert_own'), 'Must drop payouts_insert_own policy');
assert.ok(migrationSql.includes('REVOKE INSERT ON public.payouts FROM authenticated'), 'Must revoke INSERT on payouts from authenticated');
assert.ok(migrationSql.includes('is_admin()'), 'Must restrict payouts insert to admin only');

// B03: Payout serialization lock
assert.ok(migrationSql.includes('pg_advisory_xact_lock(hashtext(v_uid::text))'), 'Must enforce advisory lock per user in request_payout');

// B06: Permanent rejection check
assert.ok(
  migrationSql.includes("OR (status = 'rejected' AND COALESCE(can_retry, false) = false)"),
  'Must prevent re-claiming tasks with final rejection'
);

// B07: Server timestamp enforcement
assert.ok(
  migrationSql.includes('NEW.submitted_at := now()'),
  'Must unconditionally set submitted_at to server now()'
);

// B09: Founding bonus registration order
assert.ok(
  migrationSql.includes("ORDER BY created_at ASC LIMIT 100"),
  'Must check registration order for first 100 members'
);
console.log('  ✓ B02, B03, B06, B07, B09 database rules verified.');

// 2. Verify B10: Password reset link origin validation
console.log('2. Checking Password Reset Host Poisoning Protections...');
const emailResetPath = path.join(rootDir, 'supabase', 'functions', 'send-password-reset-email', 'index.ts');
const waResetPath = path.join(rootDir, 'supabase', 'functions', 'send-wa-password-reset', 'index.ts');

assert.ok(fs.existsSync(emailResetPath), 'send-password-reset-email must exist');
assert.ok(fs.existsSync(waResetPath), 'send-wa-password-reset must exist');

const emailResetCode = fs.readFileSync(emailResetPath, 'utf8');
const waResetCode = fs.readFileSync(waResetPath, 'utf8');

assert.ok(emailResetCode.includes('ALLOWED_ORIGINS'), 'Email reset must have ALLOWED_ORIGINS allowlist');
assert.ok(emailResetCode.includes('penghasilantambahan.com'), 'Email reset allowlist must include official domain');
assert.ok(!emailResetCode.includes('${base_url || '), 'Email reset must not inject raw base_url directly into URL');

assert.ok(waResetCode.includes('ALLOWED_ORIGINS'), 'WA reset must have ALLOWED_ORIGINS allowlist');
assert.ok(waResetCode.includes('penghasilantambahan.com'), 'WA reset allowlist must include official domain');
assert.ok(!waResetCode.includes('${base_url || '), 'WA reset must not inject raw base_url directly into URL');
console.log('  ✓ B10 password reset origin allowlists verified.');

// 3. Verify B11: Missing Edge Functions Presence
console.log('3. Checking Required Edge Functions Presence...');
const requiredFunctions = [
  'send-broadcast-emails',
  'send-broadcast-whatsapp',
  'retry-pending-whatsapp',
  'inbox-send-reply',
];

for (const fnName of requiredFunctions) {
  const fnPath = path.join(rootDir, 'supabase', 'functions', fnName, 'index.ts');
  assert.ok(fs.existsSync(fnPath), `Edge function ${fnName}/index.ts must exist in repo`);
  const fnContent = fs.readFileSync(fnPath, 'utf8');
  assert.ok(fnContent.length > 100, `Edge function ${fnName} must not be empty`);
}
console.log('  ✓ B11 all required edge functions present in repo.');

// 4. Verify B04: submitChallengeAssignmentProof non-zero row check
console.log('4. Checking Frontend Proof Submission Verification...');
const apiTsPath = path.join(rootDir, 'src', 'lib', 'api.ts');
const apiTs = fs.readFileSync(apiTsPath, 'utf8');

assert.ok(apiTs.includes('.select(\'id\')'), 'submitChallengeAssignmentProof must select id to verify row update');
assert.ok(apiTs.includes('.maybeSingle()'), 'submitChallengeAssignmentProof must check single returned row');
assert.ok(apiTs.includes('if (!data) throw new Error'), 'submitChallengeAssignmentProof must throw if zero rows updated');
console.log('  ✓ B04 zero-row proof update protection verified.');

// 5. Verify B05: claimChallengeTask Error Handling in UI
console.log('5. Checking Reddit Army Claim Error Handling in UI...');
const redditArmyTsxPath = path.join(rootDir, 'src', 'pages', 'RedditArmy.tsx');
const redditArmyTsx = fs.readFileSync(redditArmyTsxPath, 'utf8');

assert.ok(
  redditArmyTsx.includes('if (!res.ok) throw new Error(res.error'),
  'claimMut must throw error when claimChallengeTask returns ok: false'
);
console.log('  ✓ B05 claim error propagation verified.');

// 6. Verify B08: Onboarding Resume Logic
console.log('6. Checking Onboarding Step Completion Verification...');
const onboardingTsxPath = path.join(rootDir, 'src', 'pages', 'Onboarding.tsx');
const onboardingTsx = fs.readFileSync(onboardingTsxPath, 'utf8');

assert.ok(!onboardingTsx.includes('existingCredits.length > 0) {\n        navigate(\'/tasks\''), 'Onboarding must not redirect on single signup credit');
assert.ok(onboardingTsx.includes('hasStep1 && hasStep2 && hasStep3'), 'Onboarding must check that all primary steps are claimed before redirecting');
console.log('  ✓ B08 onboarding resume logic verified.');

console.log('===================================================');
console.log('ALL SECURITY AND QA REGRESSION CHECKS PASSED (100%)');
console.log('===================================================');
