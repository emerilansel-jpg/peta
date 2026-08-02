// TAHAP 1 — RED TEAM: remaining abuse/attack/edge scenarios
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const browser = await chromium.launch();
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com'; // deleted — use for auth-fail tests only
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 300)); };

// ---------- (1) URL/ID manipulation ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cases = ['/task/not-a-uuid', '/task/00000000-0000-0000-0000-000000000000', '/task/', '/admin/nonexistent-page', '/reddit/admin/nonexistent'];
  const out = {};
  for (const c of cases) {
    try {
      await page.goto(BASE + c, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1200);
      out[c] = { url: page.url().replace(BASE, ''), len: await page.evaluate(() => document.body.innerText.length) };
    } catch (e) { out[c] = { error: e.message.slice(0, 100) }; }
  }
  step('url-manipulation', { out });
  await page.close();
}

// ---------- (2) back/forward navigation ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.goto(BASE + '/reddit', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.goBack();
  await page.waitForTimeout(1000);
  const back = await page.evaluate(() => location.pathname);
  await page.goBack();
  await page.waitForTimeout(1000);
  const back2 = await page.evaluate(() => location.pathname);
  await page.goForward();
  await page.waitForTimeout(1000);
  const fwd = await page.evaluate(() => location.pathname);
  step('back-forward', { back, back2, fwd });
  await page.close();
}

// ---------- (3) very long input ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const long = 'A'.repeat(10000);
  await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('Nama kamu').fill(long);
  const val = await page.getByPlaceholder('Nama kamu').inputValue();
  step('long-input', { entered: val.length, accepted: val.length === 10000 });
  await page.close();
}

// ---------- (4) rapid signup attempts (spam/abuse) ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const ts = Date.now().toString().slice(-6);
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.getByPlaceholder('Nama kamu').fill('Spam ' + i);
    await page.getByPlaceholder('kamu@email.com').fill(`spam-${ts}-${i}@example.com`);
    await page.getByPlaceholder('08xxxxxxxxxx').fill(`0812${ts}${i}0`);
    await page.locator('input[type="password"]').fill('SpamTest#2026');
    const r = await page.evaluate(async (email) => {
      const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi' },
        body: JSON.stringify({ email, password: 'SpamTest#2026' }),
      });
      return { status: resp.status, body: (await resp.text()).slice(0, 120) };
    }, `spam-${ts}-${i}@example.com`);
    statuses.push(r);
  }
  step('rapid-signup', { statuses });
  await page.close();
}

// ---------- (5) slow network — loading state ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script' || route.request().resourceType() === 'xhr' || route.request().resourceType() === 'fetch') {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(500);
  const during = await page.evaluate(() => document.body.innerText.slice(0, 200));
  step('slow-network-during', { text: during.slice(0, 120) });
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => document.body.innerText.slice(0, 200));
  step('slow-network-after', { text: after.slice(0, 120) });
  await page.close();
}

writeFileSync('qa-probes/redteam.json', JSON.stringify(log, null, 2));
await browser.close();
