// End-to-end smoke test: Straight client creates an upvote order,
// PeTa admin imports it as a task, an army member claims/submits,
// admin approves, and the source order is auto-completed.
//
// Runs against PRODUCTION Supabase by default. Pass --cleanup-only to remove
// previously created test rows (matches email prefix `e2e-test-`).

import { createClient } from '@supabase/supabase-js';

// Credentials via env (never commit real keys). For local QA fetch them from
// Supabase dashboard / Vercel env, or temporarily export them inline.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!ANON_KEY || !SERVICE_KEY) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASSWORD = 'peta';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } });
}

async function createConfirmedUser({ email, password, metadata }) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function cleanup(emailPrefix) {
  console.log('\n--- cleanup ---');
  const { data: users } = await admin.auth.admin.listUsers();
  const testUsers = (users?.users || []).filter((u) => u.email?.startsWith(emailPrefix));
  for (const u of testUsers) {
    console.log('delete user', u.email);
    await admin.auth.admin.deleteUser(u.id);
  }
  // Orphan rows that might have survived auth deletion (defensive)
  await admin.from('reddit_upvote_orders').delete().like('thread_url', '%e2e-test%').select();
  await admin.from('tasks').delete().like('target_url', '%e2e-test%').select();
  console.log('cleanup done, deleted users:', testUsers.length);
}

async function main() {
  const cleanupOnly = process.argv.includes('--cleanup-only');
  const noCleanup = process.argv.includes('--no-cleanup');
  const ts = Date.now();
  const prefix = `e2e-test-${ts}-`;
  const clientEmail = `${prefix}client@example.com`;
  const armyEmail = `${prefix}army@example.com`;
  const password = 'Test1234!';

  if (cleanupOnly) {
    await cleanup('e2e-test-');
    return;
  }

  console.log('=== E2E flow test ===');
  console.log('client:', clientEmail);
  console.log('army:', armyEmail);

  try {
    // 1) Admin session
    const adminClient = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('admin signed in');

    // 2) Create Straight client
    const clientId = await createConfirmedUser({
      email: clientEmail,
      password,
      metadata: {
        full_name: 'E2E Client',
        product: 'straight',
        role_title: 'QA Engineer',
        website: 'https://e2e-test-straight.example.com',
      },
    });
    console.log('client user created', clientId);

    // Verify role = client
    const { data: clientProfile } = await admin.from('users').select('role,role_title,website').eq('id', clientId).single();
    console.log('client profile:', clientProfile);
    if (clientProfile.role !== 'client') throw new Error('client role mismatch');

    // 3) Credit client ($100 = 10000 cents)
    const { data: creditRes, error: creditErr } = await adminClient.rpc('fn_admin_adjust_credits', {
      p_user_id: clientId,
      p_amount_cents: 10000,
      p_reason: 'E2E test credit',
    });
    if (creditErr) throw new Error(`adjust credits: ${creditErr.message}`);
    console.log('credits adjusted', creditRes);

    const { data: balance } = await admin.from('users').select('credit_balance').eq('id', clientId).single();
    console.log('client balance cents:', balance.credit_balance);
    if (balance.credit_balance < 100) throw new Error('credit not applied');

    // 4) Client creates order
    const clientClient = await signIn(clientEmail, password);
    const threadUrl = `https://www.reddit.com/r/e2e-test/comments/${ts}/post/`;
    const { data: order, error: orderErr } = await clientClient.rpc('fn_create_reddit_upvote_order', {
      p_thread_url: threadUrl,
      p_subreddit: 'e2e-test',
      p_requested_upvotes: 1,
      p_notes: JSON.stringify({ source: 'e2e-test' }),
    });
    if (orderErr) throw new Error(`create order: ${orderErr.message}`);
    console.log('order created', order.id, 'cost_cents', order.cost_credits);

    // 5) (Optional) Admin list pending orders — may be empty if auto-import trigger runs.
    const { data: pending, error: pendingErr } = await adminClient.rpc('admin_list_pending_reddit_orders');
    if (pendingErr) console.log('list pending error (non-fatal):', pendingErr.message);
    else console.log('pending count:', pending?.length);

    // 6) Locate the task. Production has an auto-import trigger; if absent, fall back to manual import.
    let taskId;
    const { data: autoTask } = await admin.from('tasks').select('id,status').eq('source_order_id', order.id).maybeSingle();
    if (autoTask) {
      console.log('auto-imported task found', autoTask.id, autoTask.status);
      taskId = autoTask.id;
    } else {
      const { data: importRes, error: importErr } = await adminClient.rpc('admin_import_reddit_order', {
        p_order_id: order.id,
        p_reward_amount: 500,
        p_min_level: 0,
        p_title_override: `E2E upvote task ${ts}`,
      });
      if (importErr) throw new Error(`import order: ${importErr.message}`);
      taskId = importRes.task_id;
      console.log('manually imported task', taskId, importRes);
    }

    // 7) Activate task
    const { data: upd, error: updErr } = await adminClient.rpc('admin_update_task', {
      p_task_id: taskId,
      p_status: 'active',
    });
    if (updErr) throw new Error(`activate task: ${updErr.message}`);
    console.log('task activated', upd);

    // 8) Create army user with WhatsApp and Reddit account
    const armyId = await createConfirmedUser({
      email: armyEmail,
      password,
      metadata: {
        full_name: 'E2E Army',
        whatsapp: `628${ts.toString().slice(-10)}`,
      },
    });
    console.log('army user created', armyId);

    const redditUsername = `E2EArmy${ts % 100000}`;
    const { data: redditAccount, error: redditErr } = await admin.from('reddit_accounts').insert({
      user_id: armyId,
      username: redditUsername,
      karma: 1000,
      account_age_days: 365,
      level: 2,
      status_flag: 'ok',
    }).select().single();
    if (redditErr) throw new Error(`insert reddit account: ${redditErr.message}`);
    console.log('reddit account created', redditAccount.id);

    // 9) Army claims task
    const armyClient = await signIn(armyEmail, password);
    const { data: assignment, error: claimErr } = await armyClient.rpc('claim_task_assignment', {
      p_task_id: taskId,
      p_reddit_account_id: redditAccount.id,
    });
    if (claimErr) throw new Error(`claim task: ${claimErr.message}`);
    console.log('task claimed', assignment.id);

    // 10) Army submits proof
    const { error: submitErr } = await armyClient.from('task_assignments').update({
      status: 'submitted',
      proof_url: 'https://example.com/e2e-proof.png',
      submitted_url: threadUrl,
      submitted_username: redditUsername,
    }).eq('id', assignment.id);
    if (submitErr) throw new Error(`submit: ${submitErr.message}`);
    console.log('assignment submitted');

    // 11) Admin approves
    const { error: approveErr } = await adminClient.from('task_assignments').update({ status: 'approved' }).eq('id', assignment.id);
    if (approveErr) throw new Error(`approve: ${approveErr.message}`);
    console.log('assignment approved');

    // 12) Verify order completion
    await sleep(500);
    const { data: finalOrder } = await admin.from('reddit_upvote_orders').select('*').eq('id', order.id).single();
    console.log('final order:', {
      status: finalOrder.status,
      requested_upvotes: finalOrder.requested_upvotes,
      delivered_upvotes: finalOrder.delivered_upvotes,
    });
    if (finalOrder.status !== 'completed') throw new Error(`order not completed: ${finalOrder.status}`);
    if (finalOrder.delivered_upvotes < finalOrder.requested_upvotes) throw new Error('delivered_upvotes not incremented');

    // 13) Verify army earned reward
    const { data: armyCredits } = await admin.from('user_credits').select('amount,source').eq('user_id', armyId);
    const reward = armyCredits.find((c) => c.source === 'task_reward');
    console.log('army task_reward:', reward);
    if (!reward) throw new Error('army did not receive task_reward credit');

    console.log('\n✅ E2E flow passed');
  } finally {
    if (!noCleanup) await cleanup('e2e-test-');
  }
}

main().catch((err) => {
  console.error('\n❌ E2E flow failed:', err.message);
  process.exit(1);
});
