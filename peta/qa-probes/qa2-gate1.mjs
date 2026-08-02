// QA2 — GATE 1: Access control matrix (2 accounts) + XSS + injection + session
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';

// Account A = qa2 task member (has data: task assignment submitted)
const USER_A = { email: 'qa2-task-21118641@penghasilantambahan.com', password: 'Qa2Task#2026' };
// Account B = admin (different user)
const USER_B = { email: 'info@jetdigitalpro.com', password: 'peta' };

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 250)); };

async function loginToken(page, email, pass) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(email);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    return JSON.parse(localStorage.getItem(k) || '{}')?.access_token || null;
  });
}

// ===== 1. ACCESS CONTROL: User A vs User B =====
{
  const page = await browser.newPage();
  const tokenA = await loginToken(page, USER_A.email, USER_A.password);
  const tokenB = await loginToken(page, USER_B.email, USER_B.password);

  const results = await page.evaluate(async ({ SB, ANON, tokenA, tokenB }) => {
    const HA = { apikey: ANON, Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };
    const HB = { apikey: ANON, Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' };
    const out = {};

    // A's own id
    const meA = await (await fetch(SB + '/rest/v1/auth/me', { headers: HA })).json();
    out.userAId = meA?.id || null;

    // B's id (admin can see all)
    const usersB = await (await fetch(SB + '/rest/v1/users?select=id,email&limit=5', { headers: HB })).json();
    out.adminSeesUsers = Array.isArray(usersB) ? usersB.length : usersB;
    const userBId = Array.isArray(usersB) && usersB.length > 0 ? usersB[0].id : null;

    // A tries to read B's data
    if (userBId) {
      const r1 = await fetch(SB + `/rest/v1/user_credits?select=*&user_id=eq.${userBId}`, { headers: HA });
      out.aReadsB_credits = { status: r1.status, body: (await r1.text()).slice(0, 120) };

      const r2 = await fetch(SB + `/rest/v1/payouts?select=*&user_id=eq.${userBId}`, { headers: HA });
      out.aReadsB_payouts = { status: r2.status, body: (await r2.text()).slice(0, 120) };

      const r3 = await fetch(SB + `/rest/v1/task_assignments?select=*&user_id=eq.${userBId}`, { headers: HA });
      out.aReadsB_assignments = { status: r3.status, body: (await r3.text()).slice(0, 120) };

      // A tries to UPDATE B's profile
      const r4 = await fetch(SB + `/rest/v1/users?id=eq.${userBId}`, { method: 'PATCH', headers: HA, body: JSON.stringify({ full_name: 'HACKED-QA2' }) });
      out.aUpdatesB = { status: r4.status, body: (await r4.text()).slice(0, 120) };

      // A tries to DELETE B's payouts
      const r5 = await fetch(SB + `/rest/v1/payouts?user_id=eq.${userBId}`, { method: 'DELETE', headers: HA });
      out.aDeletesB_payouts = { status: r5.status, body: (await r5.text()).slice(0, 120) };
    }

    // A tries admin RPCs
    const r6 = await fetch(SB + '/rest/v1/rpc/admin_pending_approvals', { method: 'POST', headers: HA, body: '{}' });
    out.aCallsAdminRPC = { status: r6.status, body: (await r6.text()).slice(0, 120) };

    // A can read own data
    const r7resp = await fetch(SB + '/rest/v1/task_assignments?select=id,status,created_at', { headers: HA });
    const r7 = await r7resp.json();
    out.aReadsOwn = { status: r7resp.status, rows: Array.isArray(r7) ? r7.length : r7 };

    return out;
  }, { SB, ANON, tokenA, tokenB });

  step('access-control', results);
  await page.close();
}

// ===== 2. XSS: register name with script =====
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const dialogs = [];
  page.on('dialog', async (dlg) => { dialogs.push(dlg.message()); await dlg.dismiss(); });
  const ts = Date.now().toString().slice(-6);
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  const xss = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  await page.getByPlaceholder('Nama kamu').fill(xss);
  await page.getByPlaceholder('kamu@email.com').fill(`qa2-xss-${ts}@example.com`);
  await page.getByPlaceholder('08xxxxxxxxxx').fill(`0812345${ts}`);
  await page.getByPlaceholder('Minimal 6 karakter').fill('XssTest#2026');
  await page.getByRole('button', { name: /daftar|register/i }).first().click();
  await page.waitForTimeout(4000);
  const url = page.url().replace(BASE, '');
  const html = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
  step('xss-register', {
    finalUrl: url,
    dialogsFired: dialogs.length,
    rawScriptInDom: html.includes('<script>alert(1)'),
    escaped: html.includes('&lt;script&gt;'),
  });
  await page.close();
}

// ===== 3. Injection: login with SQL payload =====
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill("admin' OR '1'='1'--");
  await page.getByPlaceholder('••••••••').fill("' OR 1=1 --");
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => ({ url: location.pathname, text: document.body.innerText.slice(0, 150) }));
  step('injection-login', { url: out.url, notLoggedIn: out.url !== '/tasks', text: out.text.slice(0, 100) });
  await page.close();
}

// ===== 4. Session: JWT expiry + logout =====
{
  const page = await browser.newPage();
  await loginToken(page, USER_A.email, USER_A.password);

  const jwt = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    const v = JSON.parse(localStorage.getItem(k) || '{}');
    const payload = JSON.parse(atob(v.access_token.split('.')[1]));
    return { expInSec: payload.exp - Math.floor(Date.now() / 1000), role: payload.role, aud: payload.aud };
  });
  step('jwt-info', jwt);

  // logout
  const logoutBtn = page.getByRole('button', { name: /logout|keluar/i }).first();
  const found = await logoutBtn.count();
  step('logout-btn', { found });
  if (found > 0) {
    await logoutBtn.click();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      url: location.pathname,
      tokenKeys: Object.keys(localStorage).filter((x) => x.includes('auth-token')).length,
    }));
    step('after-logout', after);
  }
  await page.close();
}

writeFileSync('qa-probes/qa2-gate1.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Gate 1 security tests complete');
