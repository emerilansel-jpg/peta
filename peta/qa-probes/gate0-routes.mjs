// GATE 0 probe: load every route at mobile + desktop, capture console errors,
// failed resources, h1, and visible text length. Report dead routes.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:5173';
const PUBLIC_ROUTES = [
  '/', '/login', '/register', '/forgot-password', '/reset-password', '/update-password',
  '/reset-whatsapp', '/privacy', '/terms', '/help',
  '/reddit', '/reddit/waitlist', '/reddit/signup', '/reddit/login',
  '/reddit/terms', '/reddit/privacy', '/reddit/refunds', '/reddit/contact',
  '/reddit/forgot-password', '/reddit/reset-password',
];
const GUARDED_ROUTES = [
  '/tasks', '/task-history', '/reddit-army', '/account', '/earnings',
  '/reddit/dashboard', '/reddit/new-order', '/reddit/orders', '/reddit/topup',
  '/reddit/reviews', '/reddit/feature-requests', '/reddit/ranking-forum', '/reddit/ai-visibility',
  '/admin', '/admin/accounts', '/admin/tasks', '/admin/approval', '/admin/team',
  '/admin/payroll', '/admin/reddit-army', '/admin/broadcast', '/admin/inbox', '/admin/secrets', '/admin/wa-bot',
  '/reddit/admin', '/reddit/admin/orders', '/reddit/admin/tickets', '/reddit/admin/clients',
  '/reddit/admin/reviews', '/reddit/admin/feature-requests', '/reddit/admin/finance',
  '/reddit/admin/settings', '/reddit/admin/waitlist',
];

const browser = await chromium.launch();
const results = [];

async function probe(route, viewport) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  const res = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 15000 })
    .catch((e) => ({ ok: false, err: e.message }));
  await page.waitForTimeout(800);
  let h1 = '', textLen = 0;
  try {
    h1 = (await page.evaluate(() => document.querySelector('h1')?.textContent || '')).trim();
    textLen = await page.evaluate(() => document.body.innerText.length);
  } catch {}
  results.push({
    route, viewport: viewport.width, httpOk: res?.ok() ?? false,
    h1: h1.slice(0, 60), textLen, consoleErrors: [...new Set(consoleErrors)].slice(0, 4), failed: [...new Set(failed)].slice(0, 6),
  });
  await page.close();
}

for (const r of PUBLIC_ROUTES) {
  await probe(r, { width: 390, height: 844 });
  await probe(r, { width: 1440, height: 900 });
}
for (const r of GUARDED_ROUTES) {
  await probe(r, { width: 390, height: 844 });
}

writeFileSync('qa-probes/gate0-routes.json', JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.httpOk || r.consoleErrors.length || r.failed.length || r.textLen < 20);
console.log('PROBED', results.length, 'BAD:', bad.length);
for (const b of bad) console.log(JSON.stringify(b));
await browser.close();
