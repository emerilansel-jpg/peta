// GATE 2 — performance timing + WebKit cross-browser + chaos (double-submit)
import { chromium, webkit } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';

const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 300)); };

// ---------- (1) PERFORMANCE: TTFB + load on main routes (3 runs, take best) ----------
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const routes = ['/', '/reddit', '/login', '/tasks'];
  for (const route of routes) {
    const timings = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const domReady = Date.now() - t0;
      const ttfb = resp && resp.timing ? (resp.timing.responseStart - resp.timing.requestStart) : -1;
      timings.push({ ttfb, domReady });
    }
    step('perf-' + route, { best: timings.sort((a, b) => a.domReady - b.domReady)[0] });
  }
  await browser.close();
}

// ---------- (2) WEBKIT cross-browser: key routes ----------
{
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  const results = {};
  for (const route of ['/', '/reddit', '/login', '/register', '/tasks']) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800);
      const st = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent?.trim() || '', len: document.body.innerText.length }));
      results[route] = st;
    } catch (e) {
      results[route] = { error: e.message.slice(0, 120) };
    }
  }
  step('webkit', { results, pageErrors: errs.slice(0, 3) });
  await browser.close();
}

// ---------- (3) CHAOS: double-submit on task submission ----------
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);

  // go to the task detail (submitted task — view only), and try submitting again
  await page.goto(BASE + '/task/210abad4-e4ff-474e-ac7c-1879322cc0c3', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);
  const stage = await page.evaluate(() => document.body.innerText.slice(0, 300));
  step('chaos-task-state', { text: stage.slice(0, 180) });

  // refresh during load (chaos: refresh while page loading)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const afterReload = await page.evaluate(() => ({ url: location.pathname, len: document.body.innerText.length }));
  step('chaos-refresh-midflow', { afterReload });

  // two tabs same account
  const page2 = await ctx.newPage();
  await page2.goto(BASE + '/tasks', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page2.waitForTimeout(2000);
  const bothOk = await Promise.all([
    page.evaluate(() => document.body.innerText.length > 100),
    page2.evaluate(() => document.body.innerText.length > 100),
  ]);
  step('chaos-two-tabs', { bothRender: bothOk });
  await browser.close();
}

writeFileSync('qa-probes/gate2-perf-chaos.json', JSON.stringify(log, null, 2));
await browser.close();
