// QA2 — GATE 0: Route sweep on PROD (penghasilantambahan.com + straight.ltd)
// Capture console errors, failed resources, h1, text length, final URL.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE_PETA = 'https://www.penghasilantambahan.com';
const BASE_STRAIGHT = 'https://www.straight.ltd';

const PETA_PUBLIC = [
  '/', '/login', '/register', '/forgot-password', '/reset-password', '/update-password',
  '/reset-whatsapp', '/privacy', '/terms', '/help',
];
const PETA_GUARDED = [
  '/tasks', '/task-history', '/reddit-army', '/account', '/earnings',
  '/admin', '/admin/accounts', '/admin/tasks', '/admin/approval', '/admin/team',
  '/admin/payroll', '/admin/reddit-army', '/admin/broadcast', '/admin/inbox', '/admin/secrets', '/admin/wa-bot',
];
const STRAIGHT_PUBLIC = [
  '/reddit', '/reddit/waitlist', '/reddit/signup', '/reddit/login',
  '/reddit/terms', '/reddit/privacy', '/reddit/refunds', '/reddit/contact',
  '/reddit/forgot-password', '/reddit/reset-password',
];
const STRAIGHT_GUARDED = [
  '/reddit/dashboard', '/reddit/new-order', '/reddit/orders', '/reddit/topup',
  '/reddit/reviews', '/reddit/feature-requests', '/reddit/ranking-forum', '/reddit/ai-visibility',
  '/reddit/admin', '/reddit/admin/orders', '/reddit/admin/tickets', '/reddit/admin/clients',
  '/reddit/admin/reviews', '/reddit/admin/feature-requests', '/reddit/admin/finance',
  '/reddit/admin/settings', '/reddit/admin/waitlist',
];

const results = [];
const browser = await chromium.launch();

async function sweep(base, routes, viewport, label) {
  for (const route of routes) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const failed = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 180)); });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message.slice(0, 180)));
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
    try {
      const resp = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => ({
        h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 60),
        textLen: document.body.innerText.length,
        url: location.pathname + (location.search || ''),
      }));
      results.push({
        base: label, route, viewport: viewport.width,
        httpOk: resp?.ok() ?? false,
        finalUrl: state.url,
        h1: state.h1, textLen: state.textLen,
        consoleErrors: [...new Set(consoleErrors)].slice(0, 3),
        failed: [...new Set(failed)].slice(0, 6),
      });
    } catch (e) {
      results.push({ base: label, route, error: e.message.slice(0, 150) });
    }
    await page.close();
  }
}

// PeTa — mobile 390
await sweep(BASE_PETA, PETA_PUBLIC, { width: 390, height: 844 }, 'peta-m');
await sweep(BASE_PETA, PETA_GUARDED, { width: 390, height: 844 }, 'peta-m');
// PeTa — desktop 1440
await sweep(BASE_PETA, PETA_PUBLIC, { width: 1440, height: 900 }, 'peta-d');
// Straight — mobile 390
await sweep(BASE_STRAIGHT, STRAIGHT_PUBLIC, { width: 390, height: 844 }, 'str-m');
await sweep(BASE_STRAIGHT, STRAIGHT_GUARDED, { width: 390, height: 844 }, 'str-m');
// Straight — desktop 1440
await sweep(BASE_STRAIGHT, STRAIGHT_PUBLIC, { width: 1440, height: 900 }, 'str-d');

writeFileSync('qa-probes/qa2-gate0-routes.json', JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.error || !r.httpOk || r.consoleErrors?.length || r.failed?.length || (r.textLen || 0) < 20);
console.log('PROBED:', results.length, 'BAD:', bad.length);
for (const b of bad) console.log(JSON.stringify(b).slice(0, 260));
await browser.close();
