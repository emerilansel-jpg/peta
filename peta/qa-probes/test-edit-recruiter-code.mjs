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
  console.log('--- TESTING EDITABLE RECRUITER INVITE CODE ---');

  // Sign in as Admin
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'info@jetdigitalpro.com',
    password: 'peta',
  });
  if (authErr) throw authErr;
  console.log('[PASS] Logged in as Admin:', authData.user.email);

  // 1. Get Ghina's ID
  const { data: ghina, error: gErr } = await supabase
    .from('users')
    .select('id, full_name, referral_code')
    .eq('email', 'ghinads7@gmail.com')
    .single();
  if (gErr) throw gErr;
  console.log(`[PASS] Found Ghina: id=${ghina.id}, current_code=${ghina.referral_code}`);

  // 2. Change Ghina code to GHINA-TEST
  const testCode = `GHINA-TEST-${Date.now().toString().slice(-4)}`;
  const { data: updateRes, error: uErr } = await supabase.rpc('update_recruiter_invite_code', {
    p_recruiter_id: ghina.id,
    p_new_code: testCode,
  });
  if (uErr) throw uErr;
  console.log('[PASS] Updated code result:', updateRes);
  if (!updateRes.ok || updateRes.new_code !== testCode) {
    throw new Error('Code update failed');
  }

  // 3. Verify track_invitation_click with new code
  const { data: clickRes, error: cErr } = await supabase.rpc('track_invitation_click', {
    p_token: testCode,
  });
  if (cErr) throw cErr;
  console.log('[PASS] track_invitation_click for new code:', clickRes);
  if (!clickRes.valid || clickRes.code !== testCode || clickRes.recruiter_name !== 'Ghina') {
    throw new Error('New code was not recognized by track_invitation_click');
  }

  // 4. Test duplicate prevention
  const { data: dupRes } = await supabase.rpc('update_recruiter_invite_code', {
    p_recruiter_id: ghina.id,
    p_new_code: 'PETA', // already taken by Admin
  });
  console.log('[PASS] Duplicate check result (should fail gracefully):', dupRes);
  if (dupRes.ok) {
    throw new Error('Duplicate code should have been rejected');
  }

  // 5. Revert back to 'GHINA'
  const { data: revertRes, error: rErr } = await supabase.rpc('update_recruiter_invite_code', {
    p_recruiter_id: ghina.id,
    p_new_code: 'GHINA',
  });
  if (rErr) throw rErr;
  console.log('[PASS] Reverted code back to "GHINA":', revertRes);
  if (!revertRes.ok || revertRes.new_code !== 'GHINA') {
    throw new Error('Revert to GHINA failed');
  }

  console.log('--- ALL EDITABLE INVITE CODE TESTS PASSED SUCCESSFULLY! ---');
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
