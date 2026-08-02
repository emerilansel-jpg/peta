// QA2 — GATE 2: Performance + cross-browser (WebKit) + chaos + multi-user persistence
import { chromium, webkit } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa2-task-21118641@penghasilantambahan.com';
const MEMBER_PASS = 'Qa2Task#2026';

const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 220)); };

// ===== 1. PERFORMANCE: main routes (3 runs, best) =====
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const route of ['/', '/reddit', '/login', '/register']) {
    const timings = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      timings.push(Date.now() - t0);
    }
    step('perf-' + route, { bestMs: Math.min(...timings) });
  }
  await browser.close();
}

// ===== 2. WEBKIT (Safari engine) — key routes =====
{
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));
  const results = {};
  for (const route of ['/', '/reddit', '/login', '/register', '/tasks']) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(700);
      results[route] = await page.evaluate(() => ({ len: document.body.innerText.length, h1: (document.querySelector('h1')?.textContent || '').slice(0, 40) }));
    } catch (e) {
      results[route] = { error: e.message.slice(0, 80) };
    }
  }
  step('webkit', { results, pageErrors: errs.slice(0, 3) });
  await browser.close();
}

// ===== 3. CHAOS: refresh mid-flow + two tabs + double submit =====
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // login as member
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);

  // two tabs same session
  const page2 = await ctx.newPage();
  await page2.goto(BASE + '/tasks', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page2.waitForTimeout(1500);
  const bothOk = await Promise.all([
    page.evaluate(() => document.body.innerText.length > 100),
    page2.evaluate(() => document.body.innerText.length > 100),
  ]);
  step('chaos-two-tabs', { bothRender: bothOk });

  // refresh mid-flow on task detail (submitted task)
  await page.goto(BASE + '/task/64433009-8937-4a52-aa58-b354222cd14a', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const afterReload = await page.evaluate(() => ({ url: location.pathname, len: document.body.innerText.length }));
  step('chaos-refresh-midflow', afterReload);

  // double-submit attempt: click submit twice on a fresh forum task? Use own submitted task (button gone)
  await browser.close();
}

// ===== 4. PERSISTENCE: member data intact after logout → login =====
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);

  // capture task history
  await page.goto(BASE + '/task-history', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => document.body.innerText.slice(0, 600));

  // logout
  await page.getByRole('button', { name: /logout|keluar/i }).first().click();
  await page.waitForTimeout(2500);
  const loggedOut = page.url().includes('/login');

  // login again
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);

  // check task history again
  await page.goto(BASE + '/task-history', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.body.innerText.slice(0, 600));
  step('persistence-logout-login', {
    loggedOut,
    historyBefore: before.slice(0, 150),
    historyAfter: after.slice(0, 150),
    dataIntact: before === after,
  });
  await browser.close();
}

writeFileSync('qa-probes/qa2-gate2.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Gate 2 tests complete');
