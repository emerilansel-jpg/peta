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

const sb = createClient(SB_URL, anonKey());
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PWD });
if (authErr) {
  console.error('FAIL: Admin login failed', authErr);
  process.exit(1);
}

const { data: tasks, error: rpcErr } = await sb.rpc('list_eligible_tasks_for_user');
if (rpcErr) {
  console.error('FAIL: list_eligible_tasks_for_user threw error:', rpcErr);
  process.exit(1);
}

console.log(`PASS: list_eligible_tasks_for_user returned ${tasks?.length || 0} tasks cleanly.`);
if (!tasks || tasks.length === 0) {
  console.error('WARN: 0 tasks returned, verify active task seeds.');
} else {
  console.log('Sample task returned:', tasks[0]?.title);
}

process.exit(0);
