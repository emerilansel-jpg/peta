// GATE 1 — Access control matrix: member token tries to read/write other users' data
// and call admin RPCs. Each attempt must be DENIED (403/404/error).
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);

const results = await page.evaluate(async ({ SB, ANON }) => {
  const tok = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token;
  const H = { apikey: ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const out = {};

  // 1. who am I
  const me = await (await fetch(SB + '/rest/v1/auth/me', { headers: H })).json();
  out.myId = me.id || null;

  // 2. read ALL users (should be denied for army)
  const r2 = await fetch(SB + '/rest/v1/users?select=id,email&limit=5', { headers: H });
  out.listAllUsers = { status: r2.status, body: (await r2.text()).slice(0, 200) };

  // 3. read another user's credits — target: a random other id (use myId+1 semantics: query all then pick someone else)
  const users = await (await fetch(SB + '/rest/v1/users?select=id&limit=100', { headers: H })).json();
  const other = (users || []).find((u) => u.id !== out.myId);
  out.otherUserId = other?.id || null;
  if (other) {
    const r3 = await fetch(SB + '/rest/v1/user_credits?select=*&user_id=eq.' + other.id, { headers: H });
    out.readOtherCredits = { status: r3.status, body: (await r3.text()).slice(0, 200) };
    const r3b = await fetch(SB + '/rest/v1/reddit_upvote_orders?select=*&user_id=eq.' + other.id, { headers: H });
    out.readOtherOrders = { status: r3b.status, body: (await r3b.text()).slice(0, 200) };
    const r3c = await fetch(SB + '/rest/v1/payouts?select=*&user_id=eq.' + other.id, { headers: H });
    out.readOtherPayouts = { status: r3c.status, body: (await r3c.text()).slice(0, 200) };
  }

  // 4. try to UPDATE another user's profile
  if (other) {
    const r4 = await fetch(SB + '/rest/v1/users?id=eq.' + other.id, { method: 'PATCH', headers: H, body: JSON.stringify({ full_name: 'HACKED' }) });
    out.updateOtherUser = { status: r4.status, body: (await r4.text()).slice(0, 200) };
  }

  // 5. admin RPCs with member token
  for (const rpc of ['admin_pending_approvals', 'admin_create_member', 'get_reddit_army_stats_for_admin', 'admin_mark_payout_paid', 'admin_task_queue_stats']) {
    const r = await fetch(SB + '/rest/v1/rpc/' + rpc, { method: 'POST', headers: H, body: '{}' });
    out['rpc:' + rpc] = { status: r.status, body: (await r.text()).slice(0, 150) };
  }

  // 6. claim onboarding bonus repeatedly (idempotency check)
  const c1 = await fetch(SB + '/rest/v1/rpc/claim_onboarding_bonus', { method: 'POST', headers: H, body: JSON.stringify({ p_step: 'signup' }) });
  const c1b = await c1.text();
  const c2 = await fetch(SB + '/rest/v1/rpc/claim_onboarding_bonus', { method: 'POST', headers: H, body: JSON.stringify({ p_step: 'signup' }) });
  out.claimTwice = { first: { status: c1.status, body: c1b.slice(0, 120) }, second: { status: c2.status, body: (await c2.text()).slice(0, 120) } };

  return out;
}, { SB, ANON });

console.log(JSON.stringify(results, null, 2));
writeFileSync('qa-probes/gate1-access-control.json', JSON.stringify(results, null, 2));
await browser.close();
