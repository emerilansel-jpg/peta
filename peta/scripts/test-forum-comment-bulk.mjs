// Smoke test for forum comment quantity + unique drafts.
// Reads Supabase credentials from env vars.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'https://yorlsgzsawchpeeazcvi.supabase.co';
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!anonKey || !serviceKey) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const adminEmail = 'info@jetdigitalpro.com';
const adminPassword = 'peta';
const admin = createClient(url, serviceKey);

async function signIn(email, password) {
  const c = createClient(url, anonKey);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } });
}

async function createConfirmedUser(email, password, metadata) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
  if (error) throw error;
  return data.user.id;
}

async function cleanup(prefix) {
  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users?.users || []) {
    if (u.email?.startsWith(prefix)) await admin.auth.admin.deleteUser(u.id);
  }
}

async function main() {
  const ts = Date.now();
  const prefix = `bulk-test-${ts}-`;
  try {
    // Create client
    const clientEmail = `${prefix}client@example.com`;
    const clientId = await createConfirmedUser(clientEmail, 'Test1234!', {
      full_name: 'Bulk Client', product: 'straight', role_title: 'QA', website: 'https://example.com',
    });

    // Credit client
    const adminClient = await signIn(adminEmail, adminPassword);
    await adminClient.rpc('fn_admin_adjust_credits', {
      p_user_id: clientId, p_amount_cents: 50000, p_reason: 'bulk test credit',
    });

    // Login client and create forum comment order quantity=3 with drafts
    const client = await signIn(clientEmail, 'Test1234!');
    const targetUrl = `https://www.quora.com/unanswered/e2e-test-${ts}`;
    const { data: order, error: orderErr } = await client.rpc('fn_create_forum_comment_order', {
      p_target_url: targetUrl,
      p_platform: 'quora',
      p_comment_text: 'This is the first draft for testing bulk forum comments.',
      p_use_suggested_comment: true,
      p_brand_name: 'Jetdigitalpro',
      p_brand_domain: 'jetdigitalpro.com',
      p_brand_mention_mode: 'plain',
      p_source_keyword: 'bulk test',
      p_notes: 'test notes',
      p_quantity: 3,
      p_comment_drafts: [
        { comment_text: 'Draft one: I used Jetdigitalpro and loved the SEO service.' },
        { comment_text: 'Draft two: Has anyone tried Jetdigitalpro for content marketing?' },
        { comment_text: 'Draft three: Jetdigitalpro helped us scale organic traffic quickly.' },
      ],
    });
    if (orderErr) throw new Error(`create order: ${orderErr.message}`);
    console.log('order id', order.id, 'qty', order.requested_upvotes, 'cost', order.cost_credits);
    if (order.requested_upvotes !== 3) throw new Error('quantity not saved');

    // Order is auto-imported for forum_comment; fetch the task.
    const { data: autoTask } = await admin.from('tasks').select('id').eq('source_order_id', order.id).maybeSingle();
    const taskId = autoTask?.id;
    console.log('auto task', taskId);
    if (!taskId) throw new Error('task not auto-imported');

    // Activate
    await adminClient.rpc('admin_update_task', { p_task_id: taskId, p_status: 'active' });

    // Verify task max_assignments
    const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).single();
    console.log('task max_assignments', task.max_assignments);
    if (task.max_assignments !== 3) throw new Error('max_assignments mismatch');

    // Create 3 army users and claim
    for (let i = 0; i < 3; i++) {
      const armyEmail = `${prefix}army${i}@example.com`;
      const armyId = await createConfirmedUser(armyEmail, 'Test1234!', {
        full_name: `Army ${i}`, whatsapp: `628${ts.toString().slice(-10)}${i}`,
      });
      const army = await signIn(armyEmail, 'Test1234!');
      const { data: assignment } = await army.rpc('claim_task_assignment', { p_task_id: taskId });
      console.log(`army${i} draft:`, assignment.draft_comment);
      if (!assignment.draft_comment) throw new Error(`army${i} got no draft`);

      // Submit
      await army.from('task_assignments').update({
        status: 'submitted',
        proof_url: 'https://quora.com/e2e-proof',
        submitted_url: targetUrl,
        submitted_username: `user${i}`,
      }).eq('id', assignment.id);

      // Approve as admin
      await adminClient.from('task_assignments').update({ status: 'approved' }).eq('id', assignment.id);
    }

    // Verify order completed
    const { data: finalOrder } = await admin.from('reddit_upvote_orders').select('*').eq('id', order.id).single();
    console.log('final order status', finalOrder.status, 'delivered', finalOrder.delivered_upvotes);
    if (finalOrder.status !== 'completed') throw new Error('order not completed');

    console.log('\n✅ Forum comment bulk test passed');
  } finally {
    await cleanup(prefix);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
