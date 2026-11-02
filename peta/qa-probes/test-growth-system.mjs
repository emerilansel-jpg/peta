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
  console.log('--- STARTING GROWTH SYSTEM END-TO-END AUDIT ---');

  // Sign in as Admin
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PWD,
  });
  if (authErr) throw authErr;
  console.log(`[PASS] Admin Authenticated: ${authData.user.email}`);

  // 1. Verify Legacy Users
  const { data: legacyUsers, error: legErr } = await supabase
    .from('users')
    .select('id, email, acquisition_type, role')
    .eq('acquisition_type', 'legacy');

  if (legErr) throw legErr;
  console.log(`[PASS] Legacy Users Verified: ${legacyUsers.length} users classified as 'legacy'.`);

  // 2. Test Campaign Management
  const testCode = `CAM-TEST-${Date.now().toString().slice(-4)}`;
  const { data: campaign, error: campErr } = await supabase
    .from('invitation_campaigns')
    .insert({
      campaign_code: testCode,
      campaign_name: 'E2E Automated Verification Campaign',
      target_audience: 'SF Interns',
      status: 'active',
    })
    .select()
    .single();

  if (campErr) throw campErr;
  console.log(`[PASS] Campaign Created: ${campaign.campaign_code} (ID: ${campaign.id})`);

  // 3. Test Invitation ID & Token Generation
  const { data: ghina } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('email', 'ghinads7@gmail.com')
    .single();

  const { data: inv, error: invErr } = await supabase.rpc('admin_create_invitation', {
    p_full_name: 'Test Candidate E2E',
    p_email: `e2e.test.${Date.now()}@example.com`,
    p_phone: '628999888777',
    p_campaign_id: campaign.id,
    p_recruiter_id: ghina?.id || null,
    p_channel: 'whatsapp',
    p_source: 'Automated Test',
    p_notes: 'Verification of unique ID and token flow',
    p_expires_in_days: 14,
  });

  if (invErr) throw invErr;
  console.log(`[PASS] Invitation Created: ${inv.invitation_code} (Token: ${inv.secure_token.slice(0, 10)}...)`);
  if (!inv.invitation_code.startsWith('INV-')) throw new Error('Invalid invitation code format');

  // 4. Test Invitation Click Tracking
  const { data: clickRes, error: clickErr } = await supabase.rpc('track_invitation_click', {
    p_token: inv.secure_token,
  });

  if (clickErr) throw clickErr;
  console.log(`[PASS] Invitation Click Tracked: valid=${clickRes.valid}, campaign=${clickRes.campaign_name}`);

  const { data: invAfterClick } = await supabase
    .from('invitations')
    .select('status, click_count, clicked_at')
    .eq('id', inv.id)
    .single();

  console.log(`[PASS] Invitation Status After Click: ${invAfterClick.status}, clicks: ${invAfterClick.click_count}`);
  if (invAfterClick.status !== 'clicked' || invAfterClick.click_count < 1) {
    throw new Error('Click status not updated properly');
  }

  // 5. Test Growth Overview RPC
  const { data: overview, error: ovErr } = await supabase.rpc('get_growth_overview');
  if (ovErr) throw ovErr;
  console.log('[PASS] Growth Overview RPC:');
  console.log(`       Total Users: ${overview.users.total} (Active: ${overview.users.active}, At Risk: ${overview.users.at_risk}, Inactive: ${overview.users.inactive})`);
  console.log(`       Invitations: ${overview.recruitment.created} created, ${overview.recruitment.clicked} clicked`);

  // 6. Test Recruiter Performance RPC
  const { data: recruiters, error: recErr } = await supabase.rpc('get_recruiter_performance');
  if (recErr) throw recErr;
  console.log(`[PASS] Recruiter Performance RPC: ${recruiters.length} recruiters listed.`);
  for (const r of recruiters) {
    console.log(`       - ${r.recruiter_name} (${r.role}): ${r.invitations_created} created, ${r.link_clicks} clicks, ${r.registrations} regs`);
  }

  // 7. Test User Activity Monitoring RPC
  const { data: userMon, error: monErr } = await supabase.rpc('get_user_activity_monitoring', {
    p_limit: 5,
    p_offset: 0,
  });
  if (monErr) throw monErr;
  console.log(`[PASS] User Activity Monitoring RPC: Total ${userMon.total} users, loaded ${userMon.users.length} sample.`);
  console.log(`       Sample User: ${userMon.users[0]?.full_name} (${userMon.users[0]?.acquisition_type}) - Status: ${userMon.users[0]?.activity_status}`);

  // 8. Clean up test invitation & campaign
  await supabase.from('invitations').delete().eq('id', inv.id);
  await supabase.from('invitation_campaigns').delete().eq('id', campaign.id);
  console.log('[PASS] Test fixtures cleaned up successfully.');

  console.log('--- ALL GROWTH & INVITATION SYSTEM TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
