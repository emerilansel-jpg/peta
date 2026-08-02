// GATE 3 — cleanup all QA test data from PROD, then verify.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const PREFIXES = ['qa-obo-', 'qa-test-', 'xss-check-'];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);

const pre = {}; const result = await page.evaluate(async ({ SB, ANON, PREFIXES }) => {
  const H = { apikey: ANON, Authorization: 'Bearer ' + (JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token), 'Content-Type': 'application/json' };
  const j = async (url, opts = {}) => (await fetch(url, { headers: H, ...opts }));
  const out = { deleted: [], errors: [], leftoverUsers: [] };

  // 1. find test users (admin can read all)
  const users = await (await j(SB + '/rest/v1/users?select=id,email&limit=500')).json();
  const testUsers = (users || []).filter((u) => PREFIXES.some((p) => (u.email || '').startsWith(p)));
  out.foundUsers = testUsers;

  // 2. delete each via admin_delete_member RPC
  for (const u of testUsers) {
    const r = await j(SB + '/rest/v1/rpc/admin_delete_member', { method: 'POST', body: JSON.stringify({ p_user_id: u.id }) });
    out.deleted.push({ email: u.email, status: r.status, body: (await r.text()).slice(0, 100) });
  }

  // 3. verify leftovers
  const after = await (await j(SB + '/rest/v1/users?select=id,email&limit=500')).json();
  out.leftoverUsers = (after || []).filter((u) => PREFIXES.some((p) => (u.email || '').startsWith(p)));

  // 4. find QA tasks
  const tasks = await (await j(SB + '/rest/v1/tasks?select=id,title,status,is_hidden&limit=200')).json();
  out.qaTasks = (tasks || []).filter((t) => (t.title || '').includes('QA Test Task'));

  // 5. pause + hide QA tasks (no delete available in UI)
  for (const t of out.qaTasks) {
    await j(SB + '/rest/v1/tasks?id=eq.' + t.id, { method: 'PATCH', body: JSON.stringify({ status: 'paused', is_hidden: true }) });
  }
  const tasksAfter = await (await j(SB + '/rest/v1/tasks?select=id,title,status,is_hidden&limit=200')).json();
  out.qaTasksAfter = (tasksAfter || []).filter((t) => (t.title || '').includes('QA Test Task'));

  // 6. orphan check for deleted user ids
  const deadIds = (result0?.foundUsers || []).map((u) => u.id);
  out.orphanCheck = {};
  for (const table of ['user_credits', 'task_assignments', 'reddit_accounts', 'payouts']) {
    let total = 0;
    for (const id of deadIds) {
      const r = await j(SB + '/rest/v1/' + table + '?select=id&user_id=eq.' + id);
      const rows = await r.json();
      total += Array.isArray(rows) ? rows.length : 0;
    }
    out.orphanCheck[table] = total;
  }

  return out;
}, { SB, ANON, PREFIXES });

console.log(JSON.stringify(result, null, 2));
writeFileSync('qa-probes/gate3-cleanup.json', JSON.stringify(result, null, 2));
await browser.close();
