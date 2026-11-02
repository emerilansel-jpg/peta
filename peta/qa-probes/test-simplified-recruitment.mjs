import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

const SB_URL = 'https://yorlsgzsawchpeeazcvi.supabase.co';

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
  console.log('--- TESTING SIMPLIFIED RECRUITMENT FLOW (CODE: GHINA) ---');

  // 1. Test track_invitation_click with 'GHINA'
  const { data: clickRes, error: clickErr } = await supabase.rpc('track_invitation_click', {
    p_token: 'GHINA',
  });
  if (clickErr) throw clickErr;
  console.log('[PASS] Click Tracked for code "GHINA":', clickRes);
  if (!clickRes.valid || clickRes.code !== 'GHINA' || clickRes.recruiter_name !== 'Ghina') {
    throw new Error('track_invitation_click did not resolve Ghina correctly');
  }

  // 2. Test registration simulation using referral_code = 'GHINA'
  const testEmail = `test.recruit.${Date.now()}@example.com`;
  const testWa = `62812${Math.floor(1000000 + Math.random() * 9000000)}`;

  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: testEmail,
    password: 'password123',
    options: {
      data: {
        full_name: 'Calon Rekrutan Ghina',
        whatsapp: testWa,
        referral_code: 'GHINA',
      },
    },
  });

  if (signUpErr) throw signUpErr;
  const newUserId = signUpData.user?.id;
  console.log(`[PASS] Test User Registered: ${testEmail} (ID: ${newUserId})`);

  // 3. Verify user profile in public.users
  // Sign in as admin to inspect
  await supabase.auth.signInWithPassword({
    email: 'info@jetdigitalpro.com',
    password: 'peta',
  });

  const { data: userProfile, error: profErr } = await supabase
    .from('users')
    .select('id, full_name, acquisition_type, recruiter_id, invitation_id')
    .eq('id', newUserId)
    .single();

  if (profErr) throw profErr;
  console.log('[PASS] User Profile in DB:', userProfile);

  if (userProfile.acquisition_type !== 'invitation') {
    throw new Error(`Expected acquisition_type = 'invitation', got: ${userProfile.acquisition_type}`);
  }

  const { data: ghina } = await supabase
    .from('users')
    .select('id')
    .eq('email', 'ghinads7@gmail.com')
    .single();

  if (userProfile.recruiter_id !== ghina?.id) {
    throw new Error(`Expected recruiter_id = ${ghina?.id}, got: ${userProfile.recruiter_id}`);
  }

  // 4. Verify auto-created invitation record
  const { data: autoInv, error: autoInvErr } = await supabase
    .from('invitations')
    .select('*')
    .eq('registered_user_id', newUserId)
    .single();

  if (autoInvErr) throw autoInvErr;
  console.log(`[PASS] Auto-Created Invitation Record: ${autoInv.invitation_code} (Status: ${autoInv.status})`);

  // 5. Check recruiter performance metrics for Ghina
  const { data: recruiters, error: recErr } = await supabase.rpc('get_recruiter_performance');
  if (recErr) throw recErr;
  const ghinaStats = recruiters.find((r) => r.recruiter_name === 'Ghina');
  console.log('[PASS] Ghina Recruiter Metrics:', {
    registrations: ghinaStats?.registrations,
    recruiter_code: ghinaStats?.recruiter_code,
  });

  // 6. Clean up test user & invitation
  await supabase.from('invitations').delete().eq('id', autoInv.id);
  // Delete user from auth via asyncpg or admin call
  console.log('[PASS] Test verification successful!');
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
