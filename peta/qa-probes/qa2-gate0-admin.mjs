// QA2 — GATE 0: Admin E2E flows
// 1. Admin create member (verify pgcrypto fix)
// 2. Admin task lifecycle
// 3. Admin payroll cancel
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

// Login as admin
await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
await page.getByPlaceholder('••••••••').fill(ADMIN_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(3000);

const token = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
  const session = JSON.parse(localStorage.getItem(k) || '{}');
  return session?.access_token || null;
});

if (!token) {
  step('login-failed', { error: 'No token after login' });
  await browser.close();
  process.exit(1);
}

step('admin-login', { success: true });

// 1. Create member via admin RPC
const ts = Date.now().toString().slice(-8);
const memberEmail = `qa2-member-${ts}@penghasilantambahan.com`;

const createResult = await page.evaluate(async ({ email, token }) => {
  const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/rpc/admin_create_member', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      p_email: email,
      p_password: 'Qa2Member#2026',
      p_full_name: 'QA2 Member Test',
      p_whatsapp: `08123456${Date.now().toString().slice(-8)}`,
    }),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}, { email: memberEmail, token });

step('admin-create-member', createResult);

// 2. Verify member was created
const memberCheck = await page.evaluate(async ({ email, token }) => {
  const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const resp = await fetch(`https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/users?email=eq.${email}&select=id,email,full_name,role`, { headers: H });
  return resp.json();
}, { email: memberEmail, token });

step('member-check', memberCheck);

// 3. Delete member (cleanup)
if (memberCheck.length > 0) {
  const deleteResult = await page.evaluate(async ({ userId, token }) => {
    const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/rpc/admin_delete_member', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ p_user_id: userId }),
    });
    return { status: resp.status };
  }, { userId: memberCheck[0].id, token });
  step('admin-delete-member', deleteResult);
}

// 4. Test admin_cancel_payout RPC exists
const cancelTest = await page.evaluate(async ({ token }) => {
  const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/rpc/admin_cancel_payout', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ p_payout_id: '00000000-0000-0000-0000-000000000000' }),
  });
  return { status: resp.status, body: await resp.text().then(t => t.slice(0, 200)) };
}, { token });

step('admin-cancel-payout-rpc', cancelTest);

writeFileSync('qa-probes/qa2-gate0-admin.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Admin E2E flows complete');
