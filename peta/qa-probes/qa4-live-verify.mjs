// QA4 LIVE VERIFICATION — post-deploy checks on prod.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const OUT = 'qa-probes/artifacts/qa4';
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
  console.log(`[${errors.length ? 'WARN' : ' OK '}] ${name}${errors.length ? '\n    → ' + errors.slice(0, 2).join('\n    → ') : ''}`);
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await step(page, '404-live', async () => {
  await page.goto(BASE + '/halaman-tidak-ada-xyz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText);
  results.notFound = body.includes('Halaman nggak ketemu') && body.includes('404');
  await page.screenshot({ path: `${OUT}/live-404.png` });
});

await step(page, 'landing-no-reddit-live', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText);
  results.landingReddit = /reddit/i.test(body);
  await page.screenshot({ path: `${OUT}/live-landing.png` });
});

await step(page, 'admin-login-redirect-live', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
  results.adminUrl = page.url().replace(BASE, '');
  await page.screenshot({ path: `${OUT}/live-admin-login.png` });
});

await step(page, 'admin-tasks-sheet-validation-live', async () => {
  await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /task baru/i }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /forum comment/i }).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Contoh/).first().fill('QA4 Live Block Check');
  const descTa = page.locator('textarea').first();
  await descTa.fill('');
  const briefTa = page.locator('textarea').nth(1);
  await briefTa.fill('');
  await page.getByRole('button', { name: /publish active/i }).first().click();
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.blockToastLive = /Komentar siap-posting/.test(body);
  await page.screenshot({ path: `${OUT}/live-block-toast.png` });
});

writeFileSync('qa-probes/qa4-live-verify.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa4-live-verify.json');
await browser.close();
