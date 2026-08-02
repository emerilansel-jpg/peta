// QA3 GATE 0 — Register form validation, 404 route, empty-state honesty checks.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const OUT = 'qa-probes/artifacts/qa3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = { steps: [] };
async function step(page, name, fn) {
  const errors = [];
  const onErr = (m) => errors.push(m.text().slice(0, 160));
  const onPageErr = (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160));
  page.on('console', onErr); page.on('pageerror', onPageErr);
  try { await fn(); } catch (e) { errors.push('EXC: ' + e.message.slice(0, 220)); }
  page.removeListener('console', onErr); page.removeListener('pageerror', onPageErr);
  results.steps.push({ name, errors: errors.slice(0, 6) });
  console.log(`[${errors.length ? 'WARN' : ' OK '}] ${name}${errors.length ? '\n    → ' + errors.slice(0, 3).join('\n    → ') : ''}`);
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// 1. Register validation — submit empty form
await step(page, 'register-empty-submit', async () => {
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /daftar|register/i }).first().click();
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.validationMessages = body.match(/(wajib|harus|invalid|minimal|tidak valid)[^\n]{0,60}/gi)?.slice(0, 6) || [];
  await page.screenshot({ path: `${OUT}/register-validation.png` });
});

// 2. Invalid email + weak password
await step(page, 'register-invalid-email', async () => {
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const inputs = page.locator('input');
  const n = await inputs.count();
  results.registerInputCount = n;
  const emailInput = page.locator('input[type="email"], input[placeholder*="@"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill('bukan-email');
  }
  const passInput = page.locator('input[type="password"]').first();
  if (await passInput.isVisible().catch(() => false)) {
    await passInput.fill('123');
  }
  const nameInput = page.locator('input[type="text"]').first();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill('QA3 Test');
  }
  await page.getByRole('button', { name: /daftar|register/i }).first().click();
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText);
  results.invalidEmailMsgs = body.match(/(wajib|harus|invalid|minimal|tidak valid|email)[^\n]{0,70}/gi)?.slice(0, 8) || [];
  await page.screenshot({ path: `${OUT}/register-invalid.png` });
});

// 3. 404 / unknown route behavior
await step(page, 'unknown-route', async () => {
  await page.goto(BASE + '/halaman-tidak-ada-xyz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  results.unknownRouteUrl = page.url().replace(BASE, '');
  results.unknownRouteTitle = await page.title();
  await page.screenshot({ path: `${OUT}/unknown-route.png` });
});

// 4. Empty-state honesty: task history with zero entries on a fresh member? (member has 1) — check payout page instead
await step(page, 'payout-empty-state', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // not logged in — just check login page error for wrong creds
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill('wrong@wrong.com');
  await page.locator('input[type="password"]').first().fill('wrongpass123');
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.wrongLoginMsg = body.match(/(invalid|salah|gagal|tidak ditemukan|error)[^\n]{0,80}/gi)?.slice(0, 4) || [];
  await page.screenshot({ path: `${OUT}/login-wrong.png` });
});

writeFileSync('qa-probes/qa3-gate0-forms.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-forms.json');
await browser.close();
