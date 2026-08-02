// GATE 1 — Access control v2 (correct cross-user ids) + claim idempotency check
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
// real other users seen in admin ledger query
const OTHER_IDS = [
  '3c7b5940-5484-4d3d-a929-2f510faf6fca',
  'b62c1231-802b-4b32-9210-28eae1cc1812',
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);

const results = await page.evaluate(async ({ SB, ANON, OTHER_IDS, ME }) => {
  const tok = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token;
  const H = { apikey: ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const out = {};

  // my id via email filter
  const meR = await (await fetch(SB + '/rest/v1/users?select=id&email=eq.' + ME, { headers: H })).json();
  out.myId = meR?.[0]?.id || null;

  for (const otherId of OTHER_IDS) {
    const key = otherId.slice(0, 8);
    const r1 = await fetch(SB + '/rest/v1/user_credits?select=*&user_id=eq.' + otherId, { headers: H });
    out['credits_' + key] = { status: r1.status, body: (await r1.text()).slice(0, 150) };
    const r2 = await fetch(SB + '/rest/v1/reddit_upvote_orders?select=id,thread_url,status&user_id=eq.' + otherId, { headers: H });
    out['orders_' + key] = { status: r2.status, body: (await r2.text()).slice(0, 150) };
    const r3 = await fetch(SB + '/rest/v1/payouts?select=id,amount,status&user_id=eq.' + otherId, { headers: H });
    out['payouts_' + key] = { status: r3.status, body: (await r3.text()).slice(0, 150) };
    const r4 = await fetch(SB + '/rest/v1/task_assignments?select=id,status&user_id=eq.' + otherId, { headers: H });
    out['assignments_' + key] = { status: r4.status, body: (await r4.text()).slice(0, 150) };
    // UPDATE attempt
    const r5 = await fetch(SB + '/rest/v1/users?id=eq.' + otherId, { method: 'PATCH', headers: H, body: JSON.stringify({ full_name: 'HACKED-BYZCODE' }) });
    out['update_' + key] = { status: r5.status, body: (await r5.text()).slice(0, 150) };
    // DELETE attempt
    const r6 = await fetch(SB + '/rest/v1/reddit_upvote_orders?user_id=eq.' + otherId, { method: 'DELETE', headers: H });
    out['deleteOrder_' + key] = { status: r6.status, body: (await r6.text()).slice(0, 150) };
  }

  // claim idempotency: count signup_bonus rows for ME
  const rows = await (await fetch(SB + '/rest/v1/user_credits?select=id,source&source=eq.signup_bonus', { headers: H })).json();
  out.mySignupBonusRows = rows;

  // admin RPC with proper params
  const r = await fetch(SB + '/rest/v1/rpc/admin_create_member', { method: 'POST', headers: H, body: JSON.stringify({ p_email: 'x@x.com', p_password: '123456', p_full_name: 'x' }) });
  out.adminCreateMemberAsMember = { status: r.status, body: (await r.text()).slice(0, 200) };

  return out;
}, { SB, ANON, OTHER_IDS, ME: MEMBER_EMAIL });

console.log(JSON.stringify(results, null, 2));
writeFileSync('qa-probes/gate1-access-control-v2.json', JSON.stringify(results, null, 2));
await browser.close();
