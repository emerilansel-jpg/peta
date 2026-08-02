// QA2 — GATE 0: Dead-link scan + form validation + reddit SaaS service status
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

// ===== 1. Dead-link scan on public pages =====
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pagesToScan = ['/', '/login', '/register', '/forgot-password', '/privacy', '/terms', '/help', '/reddit', '/reddit/signup', '/reddit/login', '/reddit/terms', '/reddit/privacy', '/reddit/refunds', '/reddit/contact'];
  const deadLinks = [];
  for (const p of pagesToScan) {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(600);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter(Boolean));
    const internal = [...new Set(links.filter((l) => l.startsWith('/') && !l.startsWith('//')))];
    for (const l of internal) {
      const url = BASE + l.split(/[?#]/)[0];
      try {
        const r = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (r.status >= 400) deadLinks.push({ from: p, link: l, status: r.status });
      } catch (e) { deadLinks.push({ from: p, link: l, error: e.message.slice(0, 80) }); }
    }
  }
  step('dead-links', { count: deadLinks.length, deadLinks: deadLinks.slice(0, 10) });
  await page.close();
}

// ===== 2. Form validation =====
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Register with invalid email + short password
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('Nama kamu').fill('Val Test');
  await page.getByPlaceholder('kamu@email.com').fill('not-an-email');
  await page.getByPlaceholder('08xxxxxxxxxx').fill('08123');
  await page.getByPlaceholder('Minimal 6 karakter').fill('123');
  await page.getByRole('button', { name: /daftar|register/i }).first().click();
  await page.waitForTimeout(1500);
  const registerErr = await page.evaluate(() => document.body.innerText.slice(0, 300));
  step('register-validation', { text: registerErr.slice(0, 200) });
  await page.screenshot({ path: 'qa-probes/artifacts/qa2-validation-register.png' });

  // Login with wrong creds
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill('nonexistent-qa2@example.com');
  await page.getByPlaceholder('••••••••').fill('wrongpass123');
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(2500);
  const loginErr = await page.evaluate(() => document.body.innerText.slice(0, 300));
  step('login-validation', { url: page.url().replace(BASE, ''), text: loginErr.slice(0, 150) });
  await page.close();
}

// ===== 3. Reddit SaaS: topup + new-order status =====
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.getByPlaceholder('••••••••').fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);

  // Topup page
  await page.goto(BASE + '/reddit/topup', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(2500);
  const topupText = await page.evaluate(() => document.body.innerText.slice(0, 800));
  step('topup-page', { text: topupText.slice(0, 300) });
  await page.screenshot({ path: 'qa-probes/artifacts/qa2-topup.png' });

  // New order page — check service status
  await page.goto(BASE + '/reddit/new-order', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(2500);
  const orderText = await page.evaluate(() => document.body.innerText.slice(0, 1000));
  step('new-order-page', { text: orderText.slice(0, 350) });
  await page.screenshot({ path: 'qa-probes/artifacts/qa2-new-order.png' });

  // Check services status via pricing RPC
  const services = await page.evaluate(async (token) => {
    const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/rpc/get_straight_pricing', { method: 'POST', headers: H, body: '{}' });
    const data = await resp.json();
    const enabled = {};
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row.key && typeof row.enabled !== 'undefined') enabled[row.key] = row.enabled;
      }
    }
    return { status: resp.status, enabled };
  }, await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    return JSON.parse(localStorage.getItem(k) || '{}')?.access_token || null;
  }));
  step('services-enabled', services);
  await page.close();
}

writeFileSync('qa-probes/qa2-gate0-misc.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Gate 0 misc tests complete');
