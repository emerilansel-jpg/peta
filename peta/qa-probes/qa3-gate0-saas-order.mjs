// QA3 GATE 0 — SaaS new-order flow: try creating an Upvotes order (no balance) and see handling.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

const STRAIGHT = 'https://www.straight.ltd';
const saasState = JSON.parse(readFileSync('qa-probes/qa3-gate0-saas-e2e.json', 'utf8'));
const SAAS = saasState.saas;
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

await step(page, 'login', async () => {
  await page.goto(STRAIGHT + '/reddit/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('input[type="email"], input[placeholder*="email" i]').first().fill(SAAS.email);
  await page.locator('input[type="password"]').first().fill(SAAS.password);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForTimeout(4000);
});

await step(page, 'new-order-upvotes', async () => {
  await page.goto(STRAIGHT + '/reddit/new-order', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // click "Order now" — first one is Upvotes
  const orderNow = page.getByRole('button', { name: /order now/i }).first();
  await orderNow.click();
  await page.waitForTimeout(3000);
  const url = page.url();
  results.orderFormUrl = url.replace(STRAIGHT, '');
  const body = await page.evaluate(() => document.body.innerText);
  results.orderFormSample = body.slice(0, 700);
  await page.screenshot({ path: `${OUT}/saas-order-form.png` });
});

await step(page, 'fill-order-and-submit', async () => {
  // try to fill the form minimally: url + quantity
  const inputs = page.locator('input');
  const n = await inputs.count();
  results.formInputs = n;
  const urlInput = page.locator('input[type="url"], input[placeholder*="url" i], input[placeholder*="reddit" i]').first();
  if (await urlInput.isVisible().catch(() => false)) {
    await urlInput.fill('https://www.reddit.com/r/indonesia/comments/qa3test');
  }
  const qtyInput = page.locator('input[type="number"], input[placeholder*="qty" i], input[placeholder*="jumlah" i]').first();
  if (await qtyInput.isVisible().catch(() => false)) {
    await qtyInput.fill('5');
  }
  const submit = page.getByRole('button', { name: /place order|submit|buat order|pay|checkout/i }).first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    await page.waitForTimeout(4000);
  }
  const after = await page.evaluate(() => document.body.innerText);
  results.afterOrderSubmit = after.slice(0, 500);
  results.orderSubmitUrl = page.url().replace(STRAIGHT, '');
  await page.screenshot({ path: `${OUT}/saas-order-result.png` });
});

writeFileSync('qa-probes/qa3-gate0-saas-order.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-saas-order.json');
await browser.close();
