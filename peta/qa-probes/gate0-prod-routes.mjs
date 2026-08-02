// Probe PROD live site: route sweep at mobile+desktop, capture console errors,
// failed network requests, supabase URL, and page text.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
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
const supabaseUrls = new Set();

async function probe(route, viewport) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 250)); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message.slice(0, 250)));
  page.on('response', (r) => {
    const u = r.url();
    if (/supabase\.(co|in)/.test(u)) supabaseUrls.add(u.replace(/\/rest\/v1.*$/, '').replace(/\/auth\/v1.*$/, '').replace(/\/storage\/v1.*$/, ''));
    if (r.status() >= 400) failed.push(`${r.status()} ${u.slice(0, 140)}`);
  });
  const res = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => ({ ok: false, err: e.message }));
  await page.waitForTimeout(1200);
  let h1 = '', textLen = 0, url = '';
  try {
    h1 = (await page.evaluate(() => document.querySelector('h1')?.textContent || '')).trim();
    textLen = await page.evaluate(() => document.body.innerText.length);
    url = page.url();
  } catch {}
  results.push({
    route, viewport: viewport.width, httpOk: res?.ok() ?? false, finalUrl: url.replace(BASE, ''),
    h1: h1.slice(0, 60), textLen,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 4),
    failed: [...new Set(failed)].slice(0, 8),
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

writeFileSync('qa-probes/gate0-prod-routes.json', JSON.stringify(results, null, 2));
console.log('SUPABASE URLS:', [...supabaseUrls]);
const bad = results.filter((r) => !r.httpOk || r.consoleErrors.length || r.failed.length || r.textLen < 20);
console.log('PROBED', results.length, 'BAD:', bad.length);
for (const b of bad) console.log(JSON.stringify(b));
await browser.close();
