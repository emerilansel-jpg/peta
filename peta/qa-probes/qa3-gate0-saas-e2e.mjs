// QA3 GATE 0 — SaaS E2E: signup client → login → dashboard → topup (PayPal mode) → new-order (services) → ticket.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const STRAIGHT = 'https://www.straight.ltd';
const TS = Date.now().toString().slice(-8);
const SAAS = {
  name: 'QA3 SaaS Client',
  email: `qa3-${TS}-saas@penghasilantambahan.com`,
  password: 'Qa3SaaSTest#2026!',
  role: 'QA3 tester',
};
const OUT = 'qa-probes/artifacts/qa3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = { ts: TS, saas: SAAS, steps: [] };
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

// 1. Signup
await step(page, 'saas-signup', async () => {
  await page.goto(STRAIGHT + '/reddit/signup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const body0 = await page.evaluate(() => document.body.innerText);
  results.signupPageSample = body0.slice(0, 300);
  // fill: name, email, password, role
  const inputs = page.locator('input');
  const n = await inputs.count();
  // try heuristics: first text input = name, second = email, password input = password
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[placeholder*="@"]').first();
  const nameInput = page.locator('input[type="text"]').first();
  await nameInput.fill(SAAS.name);
  await emailInput.fill(SAAS.email);
  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(SAAS.password);
  const roleInput = page.locator('input[type="text"]').nth(1);
  if (await roleInput.isVisible().catch(() => false)) await roleInput.fill(SAAS.role);
  // accept terms checkbox if any
  const terms = page.locator('input[type="checkbox"]').first();
  if (await terms.isVisible().catch(() => false)) { await terms.check().catch(() => {}); }
  const submit = page.getByRole('button', { name: /sign up|create|daftar|buat akun/i }).first();
  await submit.click();
  await page.waitForTimeout(5000);
  results.signupResultUrl = page.url().replace(STRAIGHT, '');
  const after = await page.evaluate(() => document.body.innerText);
  results.signupResultSample = after.slice(0, 350);
  await page.screenshot({ path: `${OUT}/saas-signup-result.png` });
});

// 2. Login as the new SaaS client
await step(page, 'saas-login', async () => {
  await page.goto(STRAIGHT + '/reddit/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  await emailInput.fill(SAAS.email);
  await page.locator('input[type="password"]').first().fill(SAAS.password);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForTimeout(5000);
  results.afterLoginUrl = page.url().replace(STRAIGHT, '');
  const body = await page.evaluate(() => document.body.innerText);
  results.loginError = body.match(/(error[^\n]*|invalid[^\n]*|wrong[^\n]*)/i)?.[0] || null;
  await page.screenshot({ path: `${OUT}/saas-login-result.png` });
});

// 3. Dashboard
await step(page, 'saas-dashboard', async () => {
  await page.goto(STRAIGHT + '/reddit/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.body.innerText);
  results.dashboardSample = body.slice(0, 700);
  await page.screenshot({ path: `${OUT}/saas-dashboard2.png` });
});

// 4. Topup — PayPal mode
await step(page, 'saas-topup', async () => {
  await page.goto(STRAIGHT + '/reddit/topup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const scripts = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map(s => s.src));
  const paypal = scripts.filter(s => s.includes('paypal'));
  results.paypalScripts = paypal;
  results.paypalMode = paypal.some(s => s.includes('sandbox'))
    ? 'SANDBOX'
    : paypal.some(s => s.includes('www.paypal.com') || s.includes('api-m.paypal.com'))
      ? 'LIVE'
      : 'none-loaded';
  const body = await page.evaluate(() => document.body.innerText);
  results.topupSample = body.slice(0, 700);
  await page.screenshot({ path: `${OUT}/saas-topup2.png` });
});

// 5. New order — service matrix
await step(page, 'saas-new-order', async () => {
  await page.goto(STRAIGHT + '/reddit/new-order', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.body.innerText);
  results.orderSample = body.slice(0, 1000);
  await page.screenshot({ path: `${OUT}/saas-new-order2.png` });
});

// 6. Tickets
await step(page, 'saas-tickets', async () => {
  await page.goto(STRAIGHT + '/reddit/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.body.innerText);
  results.ordersSample = body.slice(0, 400);
  await page.screenshot({ path: `${OUT}/saas-orders.png` });
});

writeFileSync('qa-probes/qa3-gate0-saas-e2e.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-saas-e2e.json');
await browser.close();
