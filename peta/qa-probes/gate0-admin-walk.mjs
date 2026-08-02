// GATE 0 — Admin E2E walk on PROD. Logs in as admin, visits every admin
// + army route, captures console errors, failed requests, h1, screenshots.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const OUT = 'qa-probes/artifacts/admin';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  // PeTa army pages (admin sees member view too)
  '/tasks', '/task-history', '/reddit-army', '/account', '/earnings',
  // PeTa admin
  '/admin', '/admin/accounts', '/admin/tasks', '/admin/approval', '/admin/team',
  '/admin/payroll', '/admin/reddit-army', '/admin/broadcast', '/admin/inbox',
  '/admin/secrets', '/admin/wa-bot',
  // Reddit client area
  '/reddit/dashboard', '/reddit/new-order', '/reddit/orders', '/reddit/topup',
  '/reddit/reviews', '/reddit/feature-requests', '/reddit/ranking-forum', '/reddit/ai-visibility',
  // Reddit admin
  '/reddit/admin', '/reddit/admin/orders', '/reddit/admin/tickets', '/reddit/admin/clients',
  '/reddit/admin/reviews', '/reddit/admin/feature-requests', '/reddit/admin/finance',
  '/reddit/admin/settings', '/reddit/admin/waitlist',
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const results = [];

page.on('console', (m) => { if (m.type() === 'error') lastErrors.push(m.text().slice(0, 250)); });
page.on('pageerror', (e) => lastErrors.push('PAGEERROR: ' + e.message.slice(0, 250)));
page.on('response', (r) => { if (r.status() >= 400) lastFailed.push(`${r.status()} ${r.url().slice(0, 140)}`); });

let lastErrors = [], lastFailed = [];

// ---- LOGIN ----
await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
const emailInput = page.getByPlaceholder('kamu@email.com atau 0812xxxx');
await emailInput.fill(ADMIN_EMAIL);
await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);
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

writeFileSync('qa-probes/gate0-admin-walk.json', JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.errors?.length || r.failed?.length || r.error);
console.log('PAGES VISITED:', results.length - 1, 'BAD:', bad.length);
for (const b of bad) console.log(JSON.stringify(b));
await browser.close();
