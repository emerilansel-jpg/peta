// GATE 0 — Phase C: register a fresh member via the PUBLIC /register flow,
// then login + walk member pages. Tests the primary onboarding path.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const TS = Date.now().toString().slice(-8);
const MEMBER = {
  name: 'QA Test Member',
  email: `qa-test-${TS}@penghasilantambahan.com`,
  password: 'QaTest#2026!',
  whatsapp: `0812${TS}000`,
};
const OUT = 'qa-probes/artifacts/member';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
let lastErrors = [], lastFailed = [];
page.on('console', (m) => { if (m.type() === 'error') lastErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => lastErrors.push('PAGEERROR: ' + e.message.slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400) lastFailed.push(`${r.status()} ${r.url().slice(0, 130)}`); });

// ---- REGISTER ----
await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByPlaceholder('Nama kamu').fill(MEMBER.name);
await page.getByPlaceholder('kamu@email.com').fill(MEMBER.email);
await page.getByPlaceholder('08xxxxxxxxxx').fill(MEMBER.whatsapp);
await page.locator('input[type="password"]').fill(MEMBER.password);
await page.getByRole('button', { name: /daftar|buat akun|join/i }).first().click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/phaseC-after-register.png` });
results.push({ phase: 'C', step: 'register', finalUrl: page.url().replace(BASE, ''), errors: [...new Set(lastErrors)].slice(0, 4), failed: [...new Set(lastFailed)].slice(0, 5) });
console.log('AFTER REGISTER:', page.url().replace(BASE, ''));

// ---- where did it land? onboarding? ----
if (page.url().includes('/onboarding')) {
  // Walk onboarding steps: click through each step CTA
  for (let i = 0; i < 6; i++) {
    lastErrors = [];
    const btns = await page.getByRole('button').allTextContents();
    const primary = btns.find((t) => /claim|lanjut|ambil|ya|buka|selesai|mulai|klaim/i.test(t));
    results.push({ phase: 'C', step: `onboarding-${i + 1}`, buttons: btns.slice(0, 6) });
    if (!primary) break;
    await page.getByRole('button', { name: new RegExp(primary.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: `${OUT}/phaseC-onboarding-end.png` });
  results.push({ phase: 'C', step: 'onboarding-end', finalUrl: page.url().replace(BASE, ''), errors: [...new Set(lastErrors)].slice(0, 4) });
}

// ---- MEMBER WALK ----
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
    await page.screenshot({ path: `${OUT}/phaseC_${route.replace(/\//g, '_')}.png` });
    results.push({ phase: 'C', route, url: st.url, h1: st.h1, textLen: st.textLen, errors: [...new Set(lastErrors)].slice(0, 3), failed: [...new Set(lastFailed)].slice(0, 5) });
  } catch (e) {
    results.push({ phase: 'C', route, error: e.message.slice(0, 150) });
  }
}

// ---- EARNINGS detail: saldo + payout UI ----
await page.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const earningsText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
results.push({ phase: 'C', step: 'earnings-text', text: earningsText });

writeFileSync('qa-probes/gate0-register-e2e.json', JSON.stringify({ member: MEMBER, results }, null, 2));
for (const r of results) {
  const flag = r.errors?.length || r.failed?.length || r.error ? '⚠️' : '✅';
  console.log(flag, JSON.stringify(r).slice(0, 280));
}
await browser.close();
