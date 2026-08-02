// GATE 0 — Phase A: admin creates a test member via Team UI.
// Phase B: new member logs in, walks member pages, captures console/errors.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const TS = Date.now().toString().slice(-8);
const MEMBER = {
  name: 'QA Test Member',
  email: `qa-test-${TS}@penghasilantambahan.com`,
  password: 'QaTest#2026!',
  whatsapp: `0812${TS}`,
};
const OUT = 'qa-probes/artifacts/member';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

// ============ PHASE A: ADMIN creates member ============
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);

  await page.goto(BASE + '/admin/team', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /tambah/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder('Nama lengkap').fill(MEMBER.name);
  await page.locator('input[type="email"]').fill(MEMBER.email);
  await page.getByPlaceholder('Kirim ke member nanti').fill(MEMBER.password);
  await page.getByPlaceholder('08xxxxxxxxxx').fill(MEMBER.whatsapp);
  await page.getByRole('button', { name: 'Buat Member' }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/phaseA-member-created.png` });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const memberVisible = bodyText.includes(MEMBER.email);
  results.push({ phase: 'A', step: 'create-member', memberVisible, errors: [...errs], toast: bodyText.slice(0, 300) });
  await ctx.close();
}

// ============ PHASE B: MEMBER walk ============
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let lastErrors = [], lastFailed = [];
  page.on('console', (m) => { if (m.type() === 'error') lastErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => lastErrors.push('PAGEERROR: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) lastFailed.push(`${r.status()} ${r.url().slice(0, 130)}`); });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
  await page.locator('input[type="password"]').first().fill(MEMBER.password);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
  results.push({ phase: 'B', step: 'login', finalUrl: page.url().replace(BASE, ''), errors: [...lastErrors], failed: [...new Set(lastFailed)].slice(0, 5) });

  // Onboarding check: where does a fresh member land?
  const landing = page.url().replace(BASE, '');
  await page.screenshot({ path: `${OUT}/phaseB-after-login${landing.replace(/\//g, '_')}.png` });

  const routes = ['/tasks', '/task-history', '/reddit-army', '/account', '/earnings',
    '/reddit/dashboard', '/reddit/orders', '/reddit/new-order', '/reddit/topup', '/reddit/reviews'];
  for (const route of routes) {
    lastErrors = []; lastFailed = [];
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 25000 });
      await page.waitForTimeout(1200);
      const st = await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent?.trim().slice(0, 70) || '',
        textLen: document.body.innerText.length,
        url: location.pathname,
      }));
      await page.screenshot({ path: `${OUT}/phaseB_${route.replace(/\//g, '_')}.png` });
      results.push({ phase: 'B', route, url: st.url, h1: st.h1, textLen: st.textLen, errors: [...new Set(lastErrors)].slice(0, 3), failed: [...new Set(lastFailed)].slice(0, 5) });
    } catch (e) {
      results.push({ phase: 'B', route, error: e.message.slice(0, 150) });
    }
  }
  await ctx.close();
}

writeFileSync('qa-probes/gate0-member-e2e.json', JSON.stringify({ member: MEMBER, results }, null, 2));
console.log('MEMBER:', MEMBER.email);
for (const r of results) {
  const flag = r.errors?.length || r.failed?.length || r.error || (r.memberVisible === false) ? '⚠️' : '✅';
  console.log(flag, JSON.stringify(r).slice(0, 300));
}
await browser.close();
