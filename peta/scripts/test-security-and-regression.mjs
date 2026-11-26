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
assert.ok(emailResetCode.includes('https://www.penghasilantambahan.com'), 'Email reset allowlist must include canonical www domain to prevent apex redirect drop');
assert.ok(!emailResetCode.includes('${base_url || '), 'Email reset must not inject raw base_url directly into URL');

assert.ok(waResetCode.includes('ALLOWED_ORIGINS'), 'WA reset must have ALLOWED_ORIGINS allowlist');
assert.ok(waResetCode.includes('https://www.penghasilantambahan.com'), 'WA reset allowlist must include canonical www domain to prevent apex redirect drop');
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

				// 13. Verify Forum Comment Credit Deduction via Credit Transactions
				console.log('13. Checking Forum Comment Credit Deduction & Invariants...');
				const forumCreditMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261012100000_fix_forum_comment_credit_transactions.sql');
				assert.ok(fs.existsSync(forumCreditMigrationPath), 'Migration 20261012100000 must exist');
				const forumCreditSql = fs.readFileSync(forumCreditMigrationPath, 'utf8');
				assert.ok(forumCreditSql.includes('INSERT INTO public.credit_transactions'), 'Must deduct credits via credit_transactions ledger');
				assert.ok(!forumCreditSql.includes('UPDATE public.users SET credit_balance'), 'Must never directly UPDATE users.credit_balance');
				console.log('  ✓ Forum comment credit deduction & invariants verified.');

				// 14. Verify Google Maps Review Service & Anti-Drop Contracts
				console.log('14. Checking Google Maps Review Service & Anti-Drop Contracts...');
				const gmapsMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261012110000_straight_google_maps_review_service.sql');
				assert.ok(fs.existsSync(gmapsMigrationPath), 'Migration 20261012110000 must exist');
				const gmapsSql = fs.readFileSync(gmapsMigrationPath, 'utf8');
				assert.ok(gmapsSql.includes("'google_maps_review'"), 'Must add google_maps_review to constraints');
				assert.ok(gmapsSql.includes("'google_maps_review_location'"), 'Must add google_maps_review_location to straight_pricing');
				assert.ok(gmapsSql.includes('fn_create_google_maps_review_order'), 'Must create fn_create_google_maps_review_order RPC');
				assert.ok(gmapsSql.includes('claim_task_assignment'), 'Must update claim_task_assignment');
				assert.ok(gmapsSql.includes('list_eligible_tasks_for_user'), 'Must update list_eligible_tasks_for_user');

				const redditApiPath = path.join(rootDir, 'src', 'modules', 'reddit', 'lib', 'api.ts');
				const redditApiCode = fs.readFileSync(redditApiPath, 'utf8');
				assert.ok(redditApiCode.includes('createGoogleMapsReviewOrder'), 'api.ts must export createGoogleMapsReviewOrder');

				const redditHooksPath = path.join(rootDir, 'src', 'modules', 'reddit', 'hooks', 'useRedditOrders.ts');
				const redditHooksCode = fs.readFileSync(redditHooksPath, 'utf8');
				assert.ok(redditHooksCode.includes('createGoogleMapsReviewOrder'), 'useRedditOrders must export createGoogleMapsReviewOrder');

					assert.ok(redditNewOrderCode.includes('GoogleMapsReviewOrderForm'), 'RedditNewOrder must contain GoogleMapsReviewOrderForm');
					console.log('  ✓ Google Maps Review service & Anti-Drop contracts verified.');

					// 15. Verify Quora Upvote Service Contracts ($0.20, Rp 1.000)
					console.log('15. Checking Quora Upvote Service Contracts ($0.20 / Rp 1.000)...');
					const quoraMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261012120000_straight_quora_upvote_service.sql');
					assert.ok(fs.existsSync(quoraMigrationPath), 'Migration 20261012120000 must exist');
					const quoraSql = fs.readFileSync(quoraMigrationPath, 'utf8');
					assert.ok(quoraSql.includes("'quora_upvote'"), 'Must add quora_upvote to constraints');
					assert.ok(quoraSql.includes("('quora_upvote', 'quora', 'upvote'"), 'Must seed quora_upvote in straight_pricing');
					assert.ok(quoraSql.includes('fn_create_quora_upvote_order'), 'Must create fn_create_quora_upvote_order RPC');
					assert.ok(quoraSql.includes('v_is_quora_upvote'), 'fn_ensure_order_task must handle quora_upvote');
					assert.ok(quoraSql.includes('1000'), 'Reward for quora upvote must be 1000');

						assert.ok(redditApiCode.includes('createQuoraUpvoteOrder'), 'api.ts must export createQuoraUpvoteOrder');
						assert.ok(redditHooksCode.includes('createQuoraUpvoteOrder'), 'useRedditOrders must export createQuoraUpvoteOrder');
						assert.ok(redditNewOrderCode.includes('QuoraUpvoteOrderForm'), 'RedditNewOrder must contain QuoraUpvoteOrderForm');
						console.log('  ✓ Quora Upvote service contracts verified.');

						// 16. Verify Yelp Review Service Contracts ($5.00, Rp 5.000)
						console.log('16. Checking Yelp Review Service Contracts ($5.00 / Rp 5.000)...');
						const yelpMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261026000000_straight_yelp_review_service.sql');
						assert.ok(fs.existsSync(yelpMigrationPath), 'Migration 20261026000000 must exist');
						const yelpSql = fs.readFileSync(yelpMigrationPath, 'utf8');
						assert.ok(yelpSql.includes("'yelp_review'"), 'Must add yelp_review to constraints');
						assert.ok(yelpSql.includes("'yelp_review', 'yelp', 'review'"), 'Must seed yelp_review in straight_pricing');
						assert.ok(yelpSql.includes('fn_create_yelp_review_order'), 'Must create fn_create_yelp_review_order RPC');
						assert.ok(yelpSql.includes('v_is_yelp'), 'fn_ensure_order_task must handle yelp_review');
						assert.ok(yelpSql.includes('v_is_yelp             THEN 5000'), 'Reward for yelp review must be 5000');

						const reloadedRedditApiCode = fs.readFileSync(redditApiPath, 'utf8');
						assert.ok(reloadedRedditApiCode.includes('createYelpReviewOrder'), 'api.ts must export createYelpReviewOrder');
						const reloadedRedditHooksCode = fs.readFileSync(redditHooksPath, 'utf8');
						assert.ok(reloadedRedditHooksCode.includes('createYelpReviewOrder'), 'useRedditOrders must export createYelpReviewOrder');
						const reloadedRedditNewOrderCode = fs.readFileSync(redditNewOrderPath, 'utf8');
							assert.ok(reloadedRedditNewOrderCode.includes('YelpReviewOrderForm'), 'RedditNewOrder must contain YelpReviewOrderForm');
							console.log('  ✓ Yelp Review service contracts verified.');

							// 17. Verify Clutch.co Review Service Contracts & Risk Disclaimer
							console.log('17. Checking Clutch Review Contracts & Risk Disclaimer ($5.00 / Rp 5.000)...');
							const clutchMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261027000000_straight_clutch_review_service.sql');
							assert.ok(fs.existsSync(clutchMigrationPath), 'Migration 20261027000000 must exist');
							const clutchSql = fs.readFileSync(clutchMigrationPath, 'utf8');
							assert.ok(clutchSql.includes("'clutch_review'"), 'Must add clutch_review to constraints');
							assert.ok(clutchSql.includes("'clutch_review', 'clutch', 'review'"), 'Must seed clutch_review in straight_pricing');
							assert.ok(clutchSql.includes('fn_create_clutch_review_order'), 'Must create fn_create_clutch_review_order RPC');
							assert.ok(clutchSql.includes('v_is_clutch'), 'fn_ensure_order_task must handle clutch_review');
							assert.ok(clutchSql.includes('v_is_clutch           THEN 5000'), 'Reward for clutch review must be 5000');

							assert.ok(reloadedRedditApiCode.includes('createClutchReviewOrder'), 'api.ts must export createClutchReviewOrder');
							assert.ok(reloadedRedditHooksCode.includes('createClutchReviewOrder'), 'useRedditOrders must export createClutchReviewOrder');
							assert.ok(reloadedRedditNewOrderCode.includes('ClutchReviewOrderForm'), 'RedditNewOrder must contain ClutchReviewOrderForm');
								assert.ok(reloadedRedditNewOrderCode.includes('PlatformRiskDisclaimer'), 'RedditNewOrder must contain PlatformRiskDisclaimer');
								console.log('  ✓ Clutch Review service contracts & Platform Risk Disclaimer verified.');

								// 18. Verify Drip Feed Delivery Architecture & Safeguards
								console.log('18. Checking Drip Feed Architecture & Automated Release Engine...');
								const dripMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261103010000_straight_peta_drip_feed_system.sql');
								assert.ok(fs.existsSync(dripMigrationPath), 'Migration 20261103010000 must exist');
								const dripSql = fs.readFileSync(dripMigrationPath, 'utf8');
								assert.ok(dripSql.includes('drip_interval_hours INT DEFAULT 0'), 'Must add drip_interval_hours column');
								assert.ok(dripSql.includes('drip_total_target INT DEFAULT 0'), 'Must add drip_total_target column');
								assert.ok(dripSql.includes('drip_next_release_at TIMESTAMPTZ'), 'Must add drip_next_release_at column');
								assert.ok(dripSql.includes('process_drip_feed_tasks'), 'Must create process_drip_feed_tasks function');
								assert.ok(dripSql.includes('v_approved >= v_target_total'), 'sync_task_slot_count must check drip_total_target before completing');
								assert.ok(dripSql.includes('v_initial_max := 1'), 'fn_ensure_order_task must start at 1 slot for drip orders');

								assert.ok(reloadedRedditApiCode.includes('dripIntervalHours?: number'), 'api.ts must define dripIntervalHours in review order inputs');
									assert.ok(reloadedRedditNewOrderCode.includes('function DripFeedSelector'), 'RedditNewOrder must contain DripFeedSelector');
									console.log('  ✓ Drip Feed architecture, SQL safeguards, and UI contracts verified.');

									// 19. Verify Order Pause & Resume System
									console.log('19. Checking Order Pause & Resume System...');
									const pauseMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261104000000_straight_order_pause_resume.sql');
									assert.ok(fs.existsSync(pauseMigrationPath), 'Migration 20261104000000 must exist');
									const pauseSql = fs.readFileSync(pauseMigrationPath, 'utf8');
									assert.ok(pauseSql.includes("'paused'"), 'Must allow paused status');
									assert.ok(pauseSql.includes('admin_pause_order'), 'Must create admin_pause_order RPC');
									assert.ok(pauseSql.includes('admin_resume_order'), 'Must create admin_resume_order RPC');
									assert.ok(pauseSql.includes('fn_client_pause_order'), 'Must create fn_client_pause_order RPC');
									assert.ok(pauseSql.includes('fn_client_resume_order'), 'Must create fn_client_resume_order RPC');

										const freshApi = fs.readFileSync(redditApiPath, 'utf8');
										assert.ok(freshApi.includes('adminPauseOrder'), 'api.ts must export adminPauseOrder');
										assert.ok(freshApi.includes('adminResumeOrder'), 'api.ts must export adminResumeOrder');
										assert.ok(freshApi.includes('clientPauseOrder'), 'api.ts must export clientPauseOrder');
										assert.ok(freshApi.includes('clientResumeOrder'), 'api.ts must export clientResumeOrder');
										console.log('  ✓ Order Pause & Resume architecture, RPCs, and UI methods verified.');

										// 20. Verify Dynamic Service Architecture, Live Proofs & B2B Invoicing
										console.log('20. Checking Dynamic Service Architecture, Live Proofs & B2B Invoicing...');
										const dynamicCatalogPath = path.join(rootDir, 'supabase', 'migrations', '20261105000000_straight_dynamic_service_catalog.sql');
										assert.ok(fs.existsSync(dynamicCatalogPath), 'Migration 20261105000000 must exist');
										const dynamicCatalogSql = fs.readFileSync(dynamicCatalogPath, 'utf8');
										assert.ok(dynamicCatalogSql.includes('straight_services'), 'Must create straight_services table');
										assert.ok(dynamicCatalogSql.includes('admin_upsert_straight_service'), 'Must create admin_upsert_straight_service');
										assert.ok(dynamicCatalogSql.includes('admin_toggle_straight_service'), 'Must create admin_toggle_straight_service');
										assert.ok(dynamicCatalogSql.includes('fn_create_generic_service_order'), 'Must create fn_create_generic_service_order');
										assert.ok(dynamicCatalogSql.includes('fn_get_order_delivery_proofs'), 'Must create fn_get_order_delivery_proofs');

										assert.ok(freshApi.includes('getStraightServices'), 'api.ts must export getStraightServices');
										assert.ok(freshApi.includes('getAdminAllStraightServices'), 'api.ts must export getAdminAllStraightServices');
										assert.ok(freshApi.includes('adminUpsertStraightService'), 'api.ts must export adminUpsertStraightService');
										assert.ok(freshApi.includes('createGenericServiceOrder'), 'api.ts must export createGenericServiceOrder');
										assert.ok(freshApi.includes('getOrderDeliveryProofs'), 'api.ts must export getOrderDeliveryProofs');

										const adminServicesPath = path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'admin', 'AdminServices.tsx');
										assert.ok(fs.existsSync(adminServicesPath), 'AdminServices.tsx must exist');

										const dynamicFormPath = path.join(rootDir, 'src', 'modules', 'reddit', 'components', 'DynamicServiceOrderForm.tsx');
										assert.ok(fs.existsSync(dynamicFormPath), 'DynamicServiceOrderForm.tsx must exist');

										const invoiceModalPath = path.join(rootDir, 'src', 'modules', 'reddit', 'components', 'InvoiceModal.tsx');
											assert.ok(fs.existsSync(invoiceModalPath), 'InvoiceModal.tsx must exist');
											console.log('  ✓ Dynamic Service Architecture, Live Proofs & B2B Invoicing verified.');

											// 21. Verify Ranking Forum SERP Redirect Resolution
											console.log('21. Checking Ranking Forum SERP Redirect Resolution...');
											const rankingFunctionPath = path.join(rootDir, 'supabase', 'functions', 'rank-forum-pages', 'index.ts');
											const rankingApiPath = path.join(rootDir, 'src', 'modules', 'reddit', 'lib', 'api.ts');
											const rankingPagePath = path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RankingForumPage.tsx');
											const rankingFunctionCode = fs.readFileSync(rankingFunctionPath, 'utf8');
											const rankingApiCode = fs.readFileSync(rankingApiPath, 'utf8');
											const rankingPageCode = fs.readFileSync(rankingPagePath, 'utf8');

											assert.ok((rankingFunctionCode.match(/resolve_goto_urls:\s*true/g) || []).length >= 2, 'All DataForSEO SERP calls must resolve Google redirect URLs');
													assert.ok(rankingFunctionCode.includes('GOOGLE_REDIRECT_URL_RE'), 'Ranking provider must identify Google redirect wrappers');
													assert.ok(rankingFunctionCode.includes('if (GOOGLE_REDIRECT_URL_RE.test(low)) return false;'), 'Google redirect wrappers must never be classified as forum targets');
													assert.ok(rankingFunctionCode.includes('return mapped.length ? mapped : null;'), 'Empty or wrapper-only DataForSEO rows must trigger provider fallback');
													assert.ok(rankingFunctionCode.includes('if (!url || GOOGLE_REDIRECT_URL_RE.test(url)) continue;'), 'Citation checks must not return Google redirect URLs');

													assert.ok(rankingApiCode.includes('google\\.[a-z.]+\\/goto'), 'Frontend must reject unresolved Google goto URLs');
assert.ok(rankingApiCode.includes('unresolvedRedirectCount'), 'Frontend must detect wrapper-only stale provider responses');
assert.ok(rankingApiCode.includes("'/api/resolve-serp-urls'"), 'Frontend must repair legacy Google redirect responses through the Pages resolver');
const serpResolverPath = path.join(rootDir, 'functions', 'api', 'resolve-serp-urls.ts');
const serpResolverCode = fs.readFileSync(serpResolverPath, 'utf8');
assert.ok(serpResolverCode.includes('redirect: \'manual\''), 'SERP resolver must inspect redirect headers without following arbitrary redirects');
assert.ok(serpResolverCode.includes('GOOGLE_REDIRECT_RE'), 'SERP resolver must only accept Google redirect wrappers');
assert.ok(serpResolverCode.includes('i += 6'), 'SERP resolver must resolve URLs in bounded concurrent batches');

											assert.ok(rankingPageCode.includes('!isInvalidOrSearchForumUrl(r.url)'), 'Ranking UI must retain a defense-in-depth URL filter');
assert.ok(rankingPageCode.includes('selectKeywordsToScan'), 'Ranking UI must prioritize forum-intent keywords');
assert.ok(rankingPageCode.includes('SERP_SCAN_CONCURRENCY'), 'Ranking UI must batch SERP requests');
assert.ok(rankingPageCode.includes('result.eligible'), 'Ranking UI must discard stale ineligible restored results');
assert.ok(rankingPageCode.includes('Rescan before ordering.'), 'Ranking UI must recheck eligibility before checkout');

													// 22. Verify Facebook/Avvo Dynamic Services and Yelp Pause Contract
													console.log('22. Checking Facebook/Avvo services and Yelp pause contract...');
													const newServicesMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261124000000_straight_facebook_avvo_services.sql');
													const claimSupportMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261124010000_straight_facebook_avvo_claim_support.sql');
													const newServicesSql = fs.readFileSync(newServicesMigrationPath, 'utf8');
													const claimSupportSql = fs.readFileSync(claimSupportMigrationPath, 'utf8');
													assert.ok(newServicesSql.includes("'facebook_group_comment'"), 'Catalog must seed Facebook Group Comment');
													assert.ok(newServicesSql.includes("'avvo_comment'"), 'Catalog must seed Avvo Comment');
													assert.ok(newServicesSql.includes("WHERE slug = 'yelp_review'"), 'Yelp catalog row must remain for historical orders');
													assert.ok(newServicesSql.includes("WHERE key = 'yelp_review'"), 'Yelp pricing row must be disabled');
													assert.ok(newServicesSql.includes('Yelp Reviews are paused right now.'), 'Legacy Yelp RPCs must reject new orders');
													assert.ok(newServicesSql.includes('CREATE TRIGGER trg_auto_import_reddit_order'), 'Migration must preserve one canonical order-task trigger');
													assert.ok(claimSupportSql.includes("'facebook_group_comment', 'avvo_comment', 'facebook_page_review'"), 'Claim draft/dedup allowlists must include new services');
													const tasksPageCode = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'Tasks.tsx'), 'utf8');
													const taskDetailPageCode = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'TaskDetail.tsx'), 'utf8');
													const ordersPageCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditOrders.tsx'), 'utf8');
													const orderDetailPageCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditOrderDetail.tsx'), 'utf8');
													assert.ok(tasksPageCode.includes("'facebook_group_comment'"), 'Worker task list must label Facebook Group tasks');
													assert.ok(tasksPageCode.includes("'avvo_comment'"), 'Worker task list must label Avvo tasks');
													assert.ok(tasksPageCode.includes("'facebook_page_review'"), 'Worker task list must label Facebook Page reviews');
													assert.ok(taskDetailPageCode.includes('isFacebookGroupComment') && taskDetailPageCode.includes('isAvvoComment'), 'Task detail must treat new services as comments');
													assert.ok(ordersPageCode.includes('Facebook Group Comments') && ordersPageCode.includes('Avvo Comments'), 'Client order list must label new services');
													assert.ok(orderDetailPageCode.includes('Facebook Group comments') && orderDetailPageCode.includes('Avvo comments'), 'Client order detail must label new services');
													const pageReviewMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261124020000_facebook_page_review_customer_feedback.sql');
													const pageReviewProofPath = path.join(rootDir, 'supabase', 'migrations', '20261124030000_facebook_page_review_proof_enforcement.sql');
													const pageReviewSql = fs.readFileSync(pageReviewMigrationPath, 'utf8');
													const pageReviewProofSql = fs.readFileSync(pageReviewProofPath, 'utf8');
													assert.ok(pageReviewSql.includes("'facebook_page_review'"), 'Catalog must define Facebook Page customer feedback');
													assert.ok(pageReviewSql.includes("'Star', 'blue', false"), 'Page review must remain disabled by default');
													assert.ok(pageReviewSql.includes('customer_attestation=true'), 'Server order RPC must require customer attestation');
													assert.ok(pageReviewSql.includes("'Star', 'blue', false"), 'Page review stays disabled until genuine-customer workflow is enabled');
													assert.ok(pageReviewProofSql.includes("COALESCE(v_task.task_category, '') = 'facebook_page_review'"), 'Server must special-case Page review proof');
													assert.ok(pageReviewProofSql.includes('[LIVE-OK]'), 'Page review proof must require live-public confirmation');
													assert.ok(taskDetailPageCode.includes('isFacebookPageReview'), 'Task detail must gate Page review tasks');
													const approvalQueueCode = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'admin', 'ApprovalQueue.tsx'), 'utf8');
													assert.ok(approvalQueueCode.includes("task_category === 'facebook_page_review'"), 'Approval queue must show Page review authenticity checklist');
													console.log('  ✓ Facebook/Avvo catalog, Yelp pause-only behavior, and claim wiring verified.');

													// 23. Verify global client order-progress notifications
													console.log('23. Checking global order-progress notifications...');
													const progressMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261126000000_straight_order_progress_notifications.sql');
													const progressSql = fs.readFileSync(progressMigrationPath, 'utf8');
													const dashboardCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditDashboard.tsx'), 'utf8');
													const orderDetailCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditOrderDetail.tsx'), 'utf8');
													const emailFnCode = fs.readFileSync(path.join(rootDir, 'supabase', 'functions', 'send-notification-email', 'index.ts'), 'utf8');
													assert.ok(progressSql.includes('order_progress_events'), 'Progress events must be persisted independent of notification preferences');
													assert.ok(progressSql.includes("'order_progress'"), 'Notification type constraint must allow order_progress');
													assert.ok(progressSql.includes('event_key text NOT NULL UNIQUE'), 'Progress events must be idempotent by event key');
													assert.ok(progressSql.includes('email_progress_notifications'), 'Email notification preference must exist');
													assert.ok(progressSql.includes('dashboard_progress_notifications'), 'Dashboard notification preference must exist');
													assert.ok(progressSql.includes('fn_notify_client_order_progress'), 'Reusable global progress notifier must exist');
													assert.ok(progressSql.includes("p_activity_type text DEFAULT 'assignment_approved'"), 'Progress notifier must be generic across activities');
													assert.ok(progressSql.includes('PERFORM public.fn_notify_client_order_progress'), 'Approval trigger must emit progress globally');
													assert.ok(dashboardCode.includes('Progress notifications'), 'Dashboard must expose notification preferences');
													assert.ok(dashboardCode.includes('Recent order activity'), 'Dashboard must show recent progress');
													assert.ok(orderDetailCode.includes('Recent activity'), 'Order detail must always show progress history');
													assert.ok(emailFnCode.includes("'order_progress'"), 'Email function must support order progress notifications');
													console.log('  ✓ Global progress notifications, preferences, dedup, and UI surfaces verified.');

													// 24. Verify Facebook Review + Avvo self-service ordering
													console.log('24. Checking Facebook Review + Avvo order flow...');
													const orderFlowMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261127000000_facebook_avvo_order_flow.sql');
													const orderFlowSql = fs.readFileSync(orderFlowMigrationPath, 'utf8');
													const newOrderCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditNewOrder.tsx'), 'utf8');
													const adminServicesCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'admin', 'AdminServices.tsx'), 'utf8');
													const orderDetailCode2 = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditOrderDetail.tsx'), 'utf8');
													const adminOrdersCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'admin', 'AdminOrders.tsx'), 'utf8');
													const workerTaskDetailCode = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'TaskDetail.tsx'), 'utf8');
													const formCode = fs.readFileSync(path.join(rootDir, 'src', 'modules', 'reddit', 'components', 'DynamicServiceOrderForm.tsx'), 'utf8');
													assert.ok(orderFlowSql.includes('requires_custom_drafts'), 'Server must require Facebook review text');
													assert.ok(orderFlowSql.includes('Each review text must be unique'), 'Review texts must be unique server-side');
													assert.ok(orderFlowSql.includes("'avvo_comment', 'facebook_group_comment'"), 'Eligibility dedupe must match claim behavior');
													assert.ok(newOrderCode.includes("dynamicSlug: 'facebook_page_review'"), 'Facebook Review must be a standard order card');
													assert.ok(newOrderCode.includes("dynamicSlug: 'avvo_comment'"), 'Avvo must be a standard order card');
													assert.ok(newOrderCode.includes("{ id: 'facebook', label: 'Facebook' }"), 'Service filter must include Facebook');
													assert.ok(newOrderCode.includes("{ id: 'avvo', label: 'Avvo' }"), 'Service filter must include Avvo');
													assert.ok(newOrderCode.includes("{ id: 'forum', label: 'Forums' }"), 'Service filter must include Forums');
													assert.ok(newOrderCode.includes("{ id: 'trustpilot', label: 'Trustpilot' }"), 'Service filter must include Trustpilot');
													assert.ok(newOrderCode.includes("{ id: 'quora', label: 'Quora' }"), 'Service filter must include Quora');
													assert.ok(newOrderCode.includes('avvo: \'avvo_comment\''), 'Avvo service alias must resolve to catalog slug');
													assert.ok(formCode.includes('requiresCustomText'), 'Order form must require review text before checkout');
													assert.ok(formCode.includes('must be unique'), 'Order form must reject duplicate review texts');
													assert.ok(formCode.includes('Each worker gets one unique text.'), 'Order form must show one review text box per ordered unit');
													assert.ok(adminServicesCode.includes('...(editingService?.form_config || {})'), 'Admin service save must preserve safety flags');
													assert.ok(orderDetailCode2.includes('Review / comment texts'), 'Client order detail must show review texts');
													assert.ok(adminOrdersCode.includes('Customer review texts'), 'Admin order detail must show review texts');
													assert.ok(workerTaskDetailCode.includes('Customer review text to publish'), 'Worker task must show assigned review text');
													console.log('  ✓ Facebook Review text, Avvo standard card, and draft visibility verified.');

													// 25. Verify Avvo VPN and Yelp business-name-first SOP
													console.log('25. Checking Avvo VPN + Yelp business-name flow...');
													const sopMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261128000000_avvo_vpn_yelp_business_name.sql');
													const sopSql = fs.readFileSync(sopMigrationPath, 'utf8');
													const taskDetailCode3 = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'TaskDetail.tsx'), 'utf8');
													const approvalCode2 = fs.readFileSync(path.join(rootDir, 'src', 'pages', 'admin', 'ApprovalQueue.tsx'), 'utf8');
													assert.ok(sopSql.includes('Nama Bisnis Yelp'), 'Yelp order field must use business name');
													assert.ok(sopSql.includes("v_url ~* '^https?://'"), 'Yelp direct URLs must be rejected on new orders');
													assert.ok(sopSql.includes('[VPN-WINDSCRIBE]'), 'Avvo must require Windscribe marker');
													assert.ok(sopSql.includes('[SEARCH-FIRST]'), 'Yelp must require search-first marker');
													assert.ok(sopSql.includes('tg_enforce_avvo_yelp_submission_sop'), 'SOP markers must be enforced server-side');
													assert.ok(taskDetailCode3.includes('avvoVpnConfirmed') && taskDetailCode3.includes('avvoEnglishNameConfirmed'), 'Worker must confirm Avvo VPN + English name');
													assert.ok(taskDetailCode3.includes('yelpSearchFirstConfirmed'), 'Worker must confirm Yelp search-first flow');
													assert.ok(approvalCode2.includes('Avvo Check'), 'Approval queue must show Avvo SOP checks');
													assert.ok(approvalCode2.includes('[SEARCH-FIRST]'), 'Approval queue must show Yelp search-first check');
													console.log('  ✓ Avvo VPN, Yelp business-name-first, and submission SOP verified.');

												console.log('  ✓ Ranking Forum now consumes resolved SERP URLs and rejects redirect wrappers.');


											console.log('===================================================');
										console.log('ALL SECURITY AND QA REGRESSION CHECKS PASSED (100%)');
										console.log('===================================================');
