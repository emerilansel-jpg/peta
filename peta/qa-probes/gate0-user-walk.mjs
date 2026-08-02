// GATE 0 — User E2E walk on PROD with the provided member account.
// Captures console errors, failed requests, screenshots, and key UI state.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const USER_LOGIN = '0882001723410';
const USER_PASS = '@Lastalone99';
const OUT = 'qa-probes/artifacts/user';
mkdirSync(OUT, { recursive: true });

const ROUTES = ['/tasks', '/task-history', '/reddit-army', '/account', '/earnings',
  '/reddit/dashboard', '/reddit/orders', '/reddit/topup', '/reddit/new-order',
  '/reddit/reviews', '/reddit/feature-requests'];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const results = [];
let lastErrors = [], lastFailed = [];

page.on('console', (m) => { if (m.type() === 'error') lastErrors.push(m.text().slice(0, 250)); });
page.on('pageerror', (e) => lastErrors.push('PAGEERROR: ' + e.message.slice(0, 250)));
page.on('response', (r) => { if (r.status() >= 400) lastFailed.push(`${r.status()} ${r.url().slice(0, 140)}`); });

// ---- LOGIN ----
await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(USER_LOGIN);
await page.locator('input[type="password"]').first().fill(USER_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4500);
results.push({ step: 'LOGIN', finalUrl: page.url().replace(BASE, ''), errors: [...lastErrors] });

// ---- SWEEP ----
for (const route of ROUTES) {
  lastErrors = []; lastFailed = [];
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 80) || '',
      textLen: document.body.innerText.length,
      url: location.pathname,
    }));
    await page.screenshot({ path: `${OUT}/${route.replace(/\//g, '_')}.png` });
    results.push({ route, url: state.url, h1: state.h1, textLen: state.textLen, errors: [...new Set(lastErrors)].slice(0, 3), failed: [...new Set(lastFailed)].slice(0, 6) });
  } catch (e) {
    results.push({ route, error: e.message.slice(0, 200) });
  }
}

writeFileSync('qa-probes/gate0-user-walk.json', JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.errors?.length || r.failed?.length || r.error);
console.log('PAGES VISITED:', results.length - 1, 'BAD:', bad.length);
for (const b of bad) console.log(JSON.stringify(b));

// ---- Extra: capture topup page PayPal config (sandbox vs live) ----
const topup = results.find((r) => r.route === '/reddit/topup');
if (topup) {
  const paypalInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const scripts = [...document.querySelectorAll('script[src*="paypal"]')].map((s) => s.src.slice(0, 120));
    return { paypalScripts: scripts, topupText: text.slice(0, 400) };
  });
  console.log('PAYPAL:', JSON.stringify(paypalInfo, null, 2));
}
await browser.close();
