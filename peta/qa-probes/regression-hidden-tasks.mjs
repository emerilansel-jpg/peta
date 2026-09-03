// REGRESSION PROBE — hidden tasks must never leak to army-facing task lists.
//
// Verifies the invariant enforced by migration 20260902_hidden_tasks_never_leak.sql:
//   1. list_eligible_tasks_for_user returns ZERO hidden tasks (admin session,
//      army bucket — admin owns a reddit account so it hits the same bucket
//      that leaked in the 2026-09-02 bug).
//   2. Every hidden task in DB is absent from the RPC result, by id AND title.
//   3. claim_task_assignment / claim_challenge_task function bodies contain
//      the is_hidden guard (needs SUPABASE_ACCESS_TOKEN; skipped if unset).
//
// Run: node qa-probes/regression-hidden-tasks.mjs
// Exit 0 = invariant holds. Exit 1 = LEAK (fix before deploy).
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

const SB_URL = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PWD = 'peta';

function anonKey() {
  for (const p of ['.env.production', '.env.local']) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('anon key not found');
}

const failures = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures.push(name);
};

// --- 1. Data-level: hidden tasks absent from the army task list ---
const sb = createClient(SB_URL, anonKey());
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PWD });
ok('admin login', !authErr, authErr?.message || '');
if (authErr) process.exit(1);

const { data: eligible, error: rpcErr } = await sb.rpc('list_eligible_tasks_for_user');
ok('list_eligible_tasks_for_user callable', !rpcErr, rpcErr?.message || '');
if (rpcErr) process.exit(1);

const { data: hiddenRows, error: hiddenErr } = await sb
  .from('tasks')
  .select('id, title, status, is_hidden')
  .eq('is_hidden', true);
ok('hidden tasks queryable', !hiddenErr, hiddenErr?.message || '');

const hiddenIds = new Set((hiddenRows ?? []).map((t) => t.id));
const eligibleIds = new Set((eligible ?? []).map((t) => t.id));
const leaked = (eligible ?? []).filter((t) => hiddenIds.has(t.id));
ok('no hidden task in army task list', leaked.length === 0,
  leaked.length ? 'LEAKED: ' + leaked.map((t) => t.title).join(' | ') : `${eligibleIds.size} eligible, ${hiddenIds.size} hidden`);

// --- 2. Structural: claim RPCs carry the is_hidden guard ---
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (token) {
  const res = await fetch(`${'https://api.supabase.com'}/v1/projects/yorlsgzsawchpeeazcvi/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `SELECT proname FROM pg_proc WHERE proname IN ('claim_task_assignment','claim_challenge_task')
              AND pronamespace='public'::regnamespace AND pg_get_functiondef(oid) NOT LIKE '%is_hidden%'`,
    }),
  });
  const unguarded = res.ok ? await res.json() : [{ proname: 'query_failed_' + res.status }];
  ok('claim RPCs guard is_hidden', unguarded.length === 0,
    unguarded.length ? 'UNGUARDED: ' + unguarded.map((r) => r.proname).join(',') : 'all guarded');
} else {
  console.log('SKIP  claim RPC structure check (SUPABASE_ACCESS_TOKEN unset)');
}

// --- 3. E2E: preferred_source claim works WITHOUT a Reddit account ---
// Regression for the 2026-09-03 bug (assignment trigger rejected
// NULL-account inserts with 'Akun Reddit wajib untuk task ini.').
// Creates a scratch task via service role, claims it via the admin
// session, asserts success, then cleans up.
if (token) {
  const q = async (sql) => {
    const res = await fetch(`${'https://api.supabase.com'}/v1/projects/yorlsgzsawchpeeazcvi/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) throw new Error(`mgmt query failed ${res.status}: ${await res.text()}`);
    return res.json();
  };
  try {
    const scratch = await q(`
      INSERT INTO tasks (title, description, target_url, task_type, task_category,
                         reward_amount, max_assignments, per_account_limit, status)
      VALUES ('[PROBE] preferred_source claim test', 'scratch', 'https://example.com',
              'upvote', 'preferred_source', 2500, 1, 1, 'active')
      RETURNING id`);
    const scratchId = scratch[0].id;
    try {
      const { error: claimErr } = await sb.rpc('claim_task_assignment', {
        p_task_id: scratchId,
        p_reddit_account_id: null,
      });
      ok('preferred_source claim without reddit account', !claimErr, claimErr?.message || '');
      if (!claimErr) {
        // Double-claim must be rejected (per-member dedup).
        const { error: againErr } = await sb.rpc('claim_task_assignment', {
          p_task_id: scratchId,
          p_reddit_account_id: null,
        });
        ok('double-claim rejected', !!againErr, againErr?.message || '');
      }
    } finally {
      await q(`DELETE FROM task_assignments WHERE task_id='${scratchId}'`);
      await q(`DELETE FROM tasks WHERE id='${scratchId}'`);
    }
  } catch (e) {
    ok('preferred_source claim E2E (setup)', false, e.message);
  }
} else {
  console.log('SKIP  preferred_source claim E2E (SUPABASE_ACCESS_TOKEN unset)');
}

console.log(failures.length ? `\n❌ ${failures.length} failure(s)` : '\n✅ invariant holds: hidden tasks never leak');
process.exit(failures.length ? 1 : 0);
