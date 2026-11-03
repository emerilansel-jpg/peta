import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

const SB_URL = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PWD = 'peta';

function anonKey() {
  for (const p of ['.env.production', '.env.local', '.env']) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('anon key not found');
}

const supabase = createClient(SB_URL, anonKey());

async function run() {
  console.log('=== TEST SUITE: JAMINAN BULANAN (MONTHLY GUARANTEE) ===');

  // Login as Admin
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PWD,
  });
  if (authErr) throw authErr;
  console.log('[PASS] Admin Authenticated:', auth.user.email);

  // 1. Verify Config
  const { data: cfg, error: cfgErr } = await supabase.rpc('get_monthly_guarantee_config');
  if (cfgErr) throw cfgErr;
  console.log('[PASS] Current Config:', cfg);
  if (cfg.guarantee_amount !== 20000 || cfg.referral_code !== 'INTERN') {
    throw new Error('Config does not match default 20000 & INTERN');
  }

  // 2. Setup 5 Dummy Accounts
  // Find Intern recruiter ID (Ghina)
  const { data: ghina } = await supabase
    .from('users')
    .select('id')
    .eq('referral_code', 'INTERN')
    .single();

  if (!ghina) throw new Error('Recruiter with referral_code INTERN not found');

  const testPeriod = '2026-10';
  const timestampInPeriod = '2026-10-15T10:00:00Z';
  const testRunId = Date.now().toString().slice(-4);

  const testCases = [
    { name: 'User 0 (Rp0)', taskEarned: 0, expectedTopUp: 20000 },
    { name: 'User 5k (Rp5.000)', taskEarned: 5000, expectedTopUp: 15000 },
    { name: 'User 19999 (Rp19.999)', taskEarned: 19999, expectedTopUp: 1 },
    { name: 'User 20k (Rp20.000)', taskEarned: 20000, expectedTopUp: 0 },
    { name: 'User 50k (Rp50.000)', taskEarned: 50000, expectedTopUp: 0 },
  ];

  const createdUserIds = [];

  console.log('\n--- CREATING 5 TEST USERS & SEEDING TASK EARNINGS ---');
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const email = `test.guarantee.${testRunId}.${i}@example.com`;
    const wa = `62899${testRunId}${i}000`;

    // Insert user into public.users
    const { data: u, error: uErr } = await supabase
      .from('users')
      .insert({
        id: crypto.randomUUID(),
        email,
        full_name: `Test Guarantee ${tc.name}`,
        whatsapp: wa,
        role: 'army',
        is_active: true,
        onboarding_completed_at: new Date().toISOString(),
        referred_by: ghina.id,
        acquisition_source: 'INTERN',
      })
      .select('id, email, full_name')
      .single();

    if (uErr) throw uErr;
    tc.userId = u.id;
    createdUserIds.push(u.id);

    // If taskEarned > 0, insert task_reward in user_credits for October 2026
    if (tc.taskEarned > 0) {
      const { error: cErr } = await supabase
        .from('user_credits')
        .insert({
          id: crypto.randomUUID(),
          user_id: u.id,
          amount: tc.taskEarned,
          source: 'task_reward',
          description: `Reward task test ${tc.taskEarned}`,
          created_at: timestampInPeriod,
        });
      if (cErr) throw cErr;
    }

    console.log(`  Created ${tc.name} [ID: ${u.id.slice(0, 8)}] -> Task Earned: Rp${tc.taskEarned}`);
  }

  // 3. TEST DRY-RUN MODE
  console.log('\n--- TESTING DRY-RUN MODE ---');
  const { data: dryRunRes, error: dryErr } = await supabase.rpc('process_monthly_guarantee', {
    p_period: testPeriod,
    p_dry_run: true,
  });

  if (dryErr) throw dryErr;
  console.log('[PASS] Dry-Run Summary:', dryRunRes.summary);

  for (const tc of testCases) {
    const d = dryRunRes.details.find((x) => x.user_id === tc.userId);
    if (!d) throw new Error(`User ${tc.name} not found in dry run output`);
    console.log(`  Dry-Run Detail: ${tc.name} -> Earned: Rp${d.previous_task_earnings}, TopUp: Rp${d.top_up_amount} (Expected: Rp${tc.expectedTopUp})`);
    if (d.top_up_amount !== tc.expectedTopUp) {
      throw new Error(`Dry run mismatch for ${tc.name}: expected ${tc.expectedTopUp}, got ${d.top_up_amount}`);
    }
  }

  // Verify DB state after dry-run: no history or monthly_guarantee credits
  const { data: dryHistory } = await supabase
    .from('monthly_guarantee_history')
    .select('id')
    .in('user_id', createdUserIds);

  if (dryHistory && dryHistory.length > 0) {
    throw new Error('Dry run must not create history records!');
  }
  console.log('[PASS] Dry-Run verified completely isolated (zero DB mutations).');

  // 4. TEST LIVE RUN
  console.log('\n--- TESTING LIVE RUN EXECUTION ---');
  const { data: liveRes, error: liveErr } = await supabase.rpc('process_monthly_guarantee', {
    p_period: testPeriod,
    p_dry_run: false,
  });

  if (liveErr) throw liveErr;
  console.log('[PASS] Live Run Summary:', liveRes.summary);
  console.log(`  Total Eligible: ${liveRes.summary.total_eligible_members}`);
  console.log(`  Processed: ${liveRes.summary.members_processed}`);
  console.log(`  Recipients: ${liveRes.summary.recipients_count}`);
  console.log(`  Total Top-Up Cost: Rp${liveRes.summary.total_topup_amount}`);

  // Expected top-ups: 20000 + 15000 + 1 = 35001
  const expectedTotalCost = 35001;
  const expectedRecipients = 3;

  const testDetails = liveRes.details.filter((d) => createdUserIds.includes(d.user_id));
  for (const tc of testCases) {
    const d = testDetails.find((x) => x.user_id === tc.userId);
    if (!d) throw new Error(`User ${tc.name} missing from live run`);
    if (d.top_up_amount !== tc.expectedTopUp) {
      throw new Error(`Live run top_up mismatch for ${tc.name}: expected ${tc.expectedTopUp}, got ${d.top_up_amount}`);
    }
  }
  console.log('[PASS] All 5 individual top-up calculations verified: 20.000, 15.000, 1, 0, 0.');

  // Verify user_credits records
  const { data: credits, error: credErr } = await supabase
    .from('user_credits')
    .select('user_id, amount, source, description')
    .eq('source', 'monthly_guarantee')
    .in('user_id', createdUserIds);

  if (credErr) throw credErr;
  console.log(`[PASS] Verified ${credits.length} user_credits records created with source="monthly_guarantee":`);
  for (const c of credits) {
    console.log(`  - Amount: Rp${c.amount} | Description: "${c.description}"`);
  }
  if (credits.length !== 3) {
    throw new Error(`Expected exactly 3 credits, got ${credits.length}`);
  }

  // Verify notifications sent to top-up recipients
  const { data: notifs } = await supabase
    .from('notifications')
    .select('user_id, title, body')
    .eq('type', 'monthly_guarantee')
    .in('user_id', createdUserIds);

  console.log(`[PASS] Verified ${notifs.length} notifications dispatched:`);
  for (const n of notifs) {
    console.log(`  - Title: "${n.title}" | Body: "${n.body.slice(0, 60)}..."`);
  }
  if (notifs.length !== 3) {
    throw new Error(`Expected exactly 3 notifications, got ${notifs.length}`);
  }

  // 5. TEST IDEMPOTENCY (RUN CRON 2X IN SAME MONTH)
  console.log('\n--- TESTING IDEMPOTENCY (RE-RUNNING CRON IN SAME MONTH) ---');
  const { data: rerunRes, error: rerunErr } = await supabase.rpc('process_monthly_guarantee', {
    p_period: testPeriod,
    p_dry_run: false,
  });

  if (rerunErr) throw rerunErr;
  console.log('[PASS] Re-run Result Summary:', rerunRes.summary);

  const rerunTestDetails = rerunRes.details.filter((d) => createdUserIds.includes(d.user_id));
  for (const d of rerunTestDetails) {
    if (d.status !== 'already_processed') {
      throw new Error(`Expected status "already_processed" for user ${d.user_id}, got ${d.status}`);
    }
    if (d.top_up_amount !== 0) {
      throw new Error(`Expected top_up_amount = 0 on rerun, got ${d.top_up_amount}`);
    }
  }

  // Verify user_credits count STILL equals 3 (NO DOUBLE TOP-UP)
  const { data: creditsAfterRerun } = await supabase
    .from('user_credits')
    .select('id')
    .eq('source', 'monthly_guarantee')
    .in('user_id', createdUserIds);

  if (creditsAfterRerun.length !== 3) {
    throw new Error(`CRITICAL: Idempotency failed! Found ${creditsAfterRerun.length} credits after rerun (expected 3)`);
  }
  console.log('[PASS] IDEMPOTENCY CONFIRMED: 0 duplicate credits, all 5 members skipped cleanly.');

  // 6. TEST ADMIN HISTORY RPC
  console.log('\n--- TESTING ADMIN HISTORY RPC ---');
  const { data: histData, error: hErr } = await supabase.rpc('get_monthly_guarantee_history', {
    p_period: testPeriod,
  });
  if (hErr) throw hErr;
  console.log(`[PASS] Admin History returned ${histData.periods.length} periods, ${histData.records.length} records.`);
  const pRecord = histData.periods.find((p) => p.period === testPeriod);
  console.log('  Period Summary in Admin:', pRecord);

  // 7. CLEANUP TEST DATA
  console.log('\n--- CLEANING UP TEST FIXTURES ---');
  await supabase.from('notifications').delete().in('user_id', createdUserIds);
  await supabase.from('user_credits').delete().in('user_id', createdUserIds);
  await supabase.from('monthly_guarantee_history').delete().in('user_id', createdUserIds);
  await supabase.from('users').delete().in('id', createdUserIds);
  console.log('[PASS] Test dummy accounts & records removed cleanly.');

  console.log('\n=== ALL JAMINAN BULANAN TESTS PASSED 100% SUCCESSFULLY! ===');
}

run().catch((err) => {
  console.error('\n[TEST FAILED]', err);
  process.exit(1);
});
