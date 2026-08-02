// GATE 0 — S4: form validation + dead-link scan + account page actions
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
const OUT = 'qa-probes/artifacts/s4';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 300)); };

// ---------- (1) REGISTER VALIDATION (anonymous) ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 140)));
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // case A: invalid email
  await page.getByPlaceholder('Nama kamu').fill('QA Val');
  await page.getByPlaceholder('kamu@email.com').fill('not-an-email');
  await page.getByPlaceholder('08xxxxxxxxxx').fill('08123456');
  await page.locator('input[type="password"]').fill('short');
  await page.getByRole('button', { name: /daftar|buat akun|join/i }).first().click();
  await page.waitForTimeout(1500);
  const errA = await page.evaluate(() => document.body.innerText.slice(0, 400));
  step('register-invalid', { text: errA.slice(0, 250) });
  await page.screenshot({ path: `${OUT}/1-register-invalid.png` });

  // case B: valid email, short password
  await page.getByPlaceholder('kamu@email.com').fill('valid@example.com');
  await page.getByPlaceholder('08xxxxxxxxxx').fill('081234567890');
  await page.locator('input[type="password"]').fill('123');
  await page.getByRole('button', { name: /daftar|buat akun|join/i }).first().click();
  await page.waitForTimeout(1500);
  const errB = await page.evaluate(() => document.body.innerText.slice(0, 400));
  step('register-short-pwd', { text: errB.slice(0, 250) });
  await page.close();
}

// ---------- (2) LOGIN VALIDATION ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill('nonexistent-user-xyz@example.com');
  await page.locator('input[type="password"]').first().fill('wrongpass123');
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(2500);
  const errLogin = await page.evaluate(() => document.body.innerText.slice(0, 500));
  step('login-wrong', { text: errLogin.slice(0, 250), url: page.url().replace(BASE, '') });
  await page.screenshot({ path: `${OUT}/2-login-wrong.png` });
  await page.close();
}

// ---------- (3) FORGOT PASSWORD ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/forgot-password', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const body0 = await page.evaluate(() => document.body.innerText.slice(0, 500));
  step('forgot-page', { text: body0.slice(0, 220) });
  const emailInput = page.locator('input[type="email"]').first();
  if (await emailInput.count() > 0) {
    await emailInput.fill('info@jetdigitalpro.com');
    await page.getByRole('button', { name: /kirim|reset|lanjut/i }).first().click();
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => document.body.innerText.slice(0, 500));
    step('forgot-submit', { text: after.slice(0, 250) });
    await page.screenshot({ path: `${OUT}/3-forgot-sent.png` });
  } else {
    step('forgot-no-input', {});
  }
  await page.close();
}

// ---------- (4) DEAD-LINK SCAN on key pages ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pagesToScan = ['/', '/login', '/register', '/reddit', '/reddit/signup', '/reddit/login', '/privacy', '/terms', '/help'];
  const deadLinks = [];
  for (const p of pagesToScan) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter(Boolean));
    const internal = [...new Set(links.filter((l) => l.startsWith('/') && !l.startsWith('//')))];
    for (const l of internal) {
      const url = BASE + l.split(/[?#]/)[0];
      const r = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (r.status >= 400) deadLinks.push({ from: p, link: l, status: r.status });
    }
  }
  step('dead-links', { deadLinks });
  await page.close();
}

// ---------- (5) ACCOUNT PAGE ACTIONS (member) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const acc = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  step('account-page', { text: acc.slice(0, 400) });
  const accBtns = await page.getByRole('button').allTextContents();
  step('account-buttons', { buttons: accBtns.slice(0, 10) });
  await page.screenshot({ path: `${OUT}/4-account.png` });
  await ctx.close();
}

// ---------- (6) REDDIT ARMY + TASK HISTORY (member) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 140)));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);
  await page.goto(BASE + '/reddit-army', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const army = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  step('reddit-army-page', { text: army.slice(0, 400) });
  await page.screenshot({ path: `${OUT}/5-reddit-army.png` });
  await page.goto(BASE + '/task-history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const hist = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  step('task-history', { text: hist.slice(0, 350) });
  await page.screenshot({ path: `${OUT}/6-task-history.png` });
  await ctx.close();
}

writeFileSync('qa-probes/gate0-s4.json', JSON.stringify(log, null, 2));
await browser.close();
