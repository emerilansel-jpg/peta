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
assert.ok(onboardingTsx.includes('const ok = await safeClaim'), 'Onboarding must await safeClaim before completing step');
console.log('  ✓ B08 onboarding resume logic verified.');

// 7. Verify Migration 20260915000000 Security & Integrity Fixes
console.log('7. Checking Migration 20260915000000 Security & Data Integrity...');
const newMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20260915000000_security_and_data_integrity_fixes.sql');
assert.ok(fs.existsSync(newMigrationPath), 'Migration 20260915000000 must exist');
const newMigrationSql = fs.readFileSync(newMigrationPath, 'utf8');

assert.ok(newMigrationSql.includes('DROP POLICY IF EXISTS "activity_insert_any"'), 'Must drop open activity_logs policy');
assert.ok(newMigrationSql.includes('REVOKE INSERT ON public.activity_logs FROM anon'), 'Must revoke anon insert on activity_logs');
assert.ok(newMigrationSql.includes('Tidak bisa approve tugas dari pesanan yang sudah dibatalkan'), 'Must block approval on cancelled/refunded orders');
assert.ok(newMigrationSql.includes('get_public_community_feed'), 'Must define get_public_community_feed RPC');
console.log('  ✓ Migration 20260915000000 rules verified.');

// 8. Verify Edge Function Auth Hardening
console.log('8. Checking Edge Function Authentication...');
const dailySyncPath = path.join(rootDir, 'supabase', 'functions', 'sync-reddit-daily-activity', 'index.ts');
const rankForumPath = path.join(rootDir, 'supabase', 'functions', 'rank-forum-pages', 'index.ts');
const dailySyncCode = fs.readFileSync(dailySyncPath, 'utf8');
const rankForumCode = fs.readFileSync(rankForumPath, 'utf8');

assert.ok(dailySyncCode.includes("req.headers.get('Authorization')"), 'Daily sync must inspect Authorization header');
assert.ok(dailySyncCode.includes("SERVICE_ROLE"), 'Daily sync must verify service role or admin token');
assert.ok(rankForumCode.includes("req.headers.get('Authorization')"), 'Rank forum must inspect Authorization header');
console.log('  ✓ Edge function authentication guards verified.');

// 9. Verify Frontend Order Duplication Guard & Copy Fixes
console.log('9. Checking Frontend Duplicate Guard & Copy Fixes...');
const redditNewOrderPath = path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditNewOrder.tsx');
const landingPath = path.join(rootDir, 'src', 'pages', 'Landing.tsx');
const helpPath = path.join(rootDir, 'src', 'pages', 'Help.tsx');

const redditNewOrderCode = fs.readFileSync(redditNewOrderPath, 'utf8');
const landingCode = fs.readFileSync(landingPath, 'utf8');
const helpCode = fs.readFileSync(helpPath, 'utf8');

assert.ok(redditNewOrderCode.includes('!wantsSuggestion ? 1'), 'RedditNewOrder must clamp quantity to 1 for self-written comments');
	assert.ok(!landingCode.includes('Min cair Rp150K'), 'Landing must not claim min payout Rp150K');
	assert.ok(landingCode.includes('Tanpa min payout'), 'Landing must state Tanpa min payout');
	assert.ok(landingCode.includes('PenghasilanTambahan.com (PeTa)'), 'Landing footer must fix typo to PenghasilanTambahan.com');
	assert.ok(helpCode.includes('Tanpa minimum payout untuk saldo dari hasil task'), 'Help page must state no minimum payout');
	console.log('  ✓ Frontend duplicate comment prevention & copy fixes verified.');

	// 10. Verify Old Reddit Account Auto-Removal in Task Detail & Migration
	console.log('10. Checking Old Reddit Account Removal & Guards...');
	const taskDetailPath = path.join(rootDir, 'src', 'pages', 'TaskDetail.tsx');
	const taskDetailCode = fs.readFileSync(taskDetailPath, 'utf8');
	assert.ok(taskDetailCode.includes(".eq('is_active', true)"), 'TaskDetail must filter only active reddit accounts');

	const removeOldAccMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20260915020000_remove_old_reddit_accounts.sql');
	assert.ok(fs.existsSync(removeOldAccMigrationPath), 'Migration 20260915020000 must exist');
	const removeOldAccSql = fs.readFileSync(removeOldAccMigrationPath, 'utf8');
	assert.ok(removeOldAccSql.includes('COALESCE(is_active, true) = true'), 'claim_task_assignment must enforce active accounts');
	assert.ok(removeOldAccSql.includes('DELETE FROM public.reddit_accounts'), 'Must auto-delete unused old accounts');
	console.log('  ✓ Old Reddit account auto-removal & guards verified.');

	// 11. Verify Migration 20260926000000 Growth & Security Phase 0
	console.log('11. Checking Growth & Security Phase 0 Migration & Edge Functions...');
	const growthMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20260926000000_peta_growth_phase0_security_and_payout.sql');
	assert.ok(fs.existsSync(growthMigrationPath), 'Migration 20260926000000 must exist');
	const growthSql = fs.readFileSync(growthMigrationPath, 'utf8');

	assert.ok(growthSql.includes('onboarding_completed_at'), 'Must add onboarding_completed_at');
	assert.ok(growthSql.includes('reactivation_opt_in'), 'Must add reactivation_opt_in');
	assert.ok(growthSql.includes('Unknown or disabled onboarding step'), 'Must disable legacy onboarding steps');
	assert.ok(growthSql.includes('min_payout\', 0'), 'Payout eligibility must reflect no minimum payout');
	assert.ok(growthSql.includes('assignment_write_capabilities'), 'Must restore claim capability in claim_task_assignment');
	assert.ok(growthSql.includes('reddit_challenge'), 'Must exclude reddit_challenge from cashable earnings');
	assert.ok(growthSql.includes('admin_get_growth_dashboard'), 'Must create admin_get_growth_dashboard RPC');

	// Edge functions auth checks
	const sendPetaEmailPath = path.join(rootDir, 'supabase', 'functions', 'send-peta-email', 'index.ts');
	const sendBroadcastWaPath = path.join(rootDir, 'supabase', 'functions', 'send-broadcast-whatsapp', 'index.ts');
	const sendTaskBlastPath = path.join(rootDir, 'supabase', 'functions', 'send-task-blast', 'index.ts');

	const sendPetaEmailCode = fs.readFileSync(sendPetaEmailPath, 'utf8');
	const sendBroadcastWaCode = fs.readFileSync(sendBroadcastWaPath, 'utf8');
	const sendTaskBlastCode = fs.readFileSync(sendTaskBlastPath, 'utf8');

	assert.ok(sendPetaEmailCode.includes('unauthenticated'), 'send-peta-email must reject unauthenticated callers');
	assert.ok(sendPetaEmailCode.includes('forbidden_recipient'), 'send-peta-email must protect against open relay');
	assert.ok(sendBroadcastWaCode.includes('admin only'), 'send-broadcast-whatsapp must restrict to admin only');
		assert.ok(sendTaskBlastCode.includes('admin only'), 'send-task-blast must restrict to admin only');
		console.log('  ✓ Growth & Security Phase 0 rules and Edge Function protections verified.');

		// 12. Verify YouTube 3-Step Verification & Gating
		console.log('12. Checking YouTube 3-Step Verification & Gating...');
		const ytMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20260927000000_youtube_accounts_verification_gating.sql');
		assert.ok(fs.existsSync(ytMigrationPath), 'Migration 20260927000000 must exist');
		const ytSql = fs.readFileSync(ytMigrationPath, 'utf8');

		assert.ok(ytSql.includes('CREATE TABLE IF NOT EXISTS public.youtube_accounts'), 'Must create public.youtube_accounts table');
		assert.ok(ytSql.includes('youtube_account_id uuid REFERENCES public.youtube_accounts'), 'Must link youtube_account_id to task_assignments');
		assert.ok(ytSql.includes('Wajib verifikasi akun YouTube Step 3'), 'Must enforce YouTube verification in claim_task_assignment');
		assert.ok(ytSql.includes('COALESCE(t.task_category, \'\') <> \'youtube_upload\''), 'Must gate youtube_upload in list_eligible_tasks_for_user');
		assert.ok(ytSql.includes('admin_list_youtube_accounts'), 'Must provide admin_list_youtube_accounts RPC');
		assert.ok(ytSql.includes('admin_review_youtube_account'), 'Must provide admin_review_youtube_account RPC');

		const apiPath = path.join(rootDir, 'src', 'lib', 'api.ts');
		const apiCode = fs.readFileSync(apiPath, 'utf8');
		assert.ok(apiCode.includes('getMyYouTubeAccounts'), 'api.ts must export getMyYouTubeAccounts');
		assert.ok(apiCode.includes('registerYouTubeAccount'), 'api.ts must export registerYouTubeAccount');
		assert.ok(apiCode.includes('adminListYouTubeAccounts'), 'api.ts must export adminListYouTubeAccounts');
		assert.ok(apiCode.includes('adminReviewYouTubeAccount'), 'api.ts must export adminReviewYouTubeAccount');

		const taskDetailCodeLatest = fs.readFileSync(taskDetailPath, 'utf8');
		assert.ok(taskDetailCodeLatest.includes('Wajib Verifikasi YouTube Step 3'), 'TaskDetail must warn and block unverified YouTube claim');
		assert.ok(taskDetailCodeLatest.includes('approvedYtAccount'), 'TaskDetail must verify approved YouTube account');

		const ytAdminPagePath = path.join(rootDir, 'src', 'pages', 'admin', 'YouTubeAccounts.tsx');
		assert.ok(fs.existsSync(ytAdminPagePath), 'YouTubeAccounts.tsx admin page must exist');
		console.log('  ✓ YouTube 3-Step Verification & Gating verified.');

		console.log('===================================================');
		console.log('ALL SECURITY AND QA REGRESSION CHECKS PASSED (100%)');
		console.log('===================================================');
