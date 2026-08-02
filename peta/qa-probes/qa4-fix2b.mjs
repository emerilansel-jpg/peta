// QA4 FIX 2b — admin publish forum task with EMPTY brief + EMPTY description → must be blocked.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'http://localhost:4173';
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
  console.log(`[${errors.length ? 'WARN' : ' OK '}] ${name}${errors.length ? '\n    → ' + errors.slice(0, 3).join('\n    → ') : ''}`);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await step(page, 'admin-login', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
});

await step(page, 'publish-forum-empty-everything', async () => {
  await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /task baru/i }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /forum comment/i }).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Contoh/).first().fill('QA4 Forum Blocked Test');
  // CLEAR auto-filled description (forum category auto-fills a standard brief)
  const descTa = page.locator('textarea').first();
  await descTa.fill('');
  // brief textarea also empty
  const briefTa = page.locator('textarea').nth(1);
  await briefTa.fill('');
  // watch for toast
  let toastSeen = '';
  page.on('console', (m) => { if (m.text().includes('Komentar')) toastSeen = m.text().slice(0, 120); });
  await page.getByRole('button', { name: /publish active/i }).first().click();
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.blockToastSeen = /butuh 'Komentar siap-posting'/.test(body) || /Komentar siap-posting/.test(body);
  results.sheetStillOpen = body.includes('Buat Task Baru');
  await page.screenshot({ path: `${OUT}/fix2b-blocked.png` });
});

// Positive control: publish with brief filled → succeeds
await step(page, 'publish-forum-with-brief', async () => {
  // close sheet if open
  if (await page.getByRole('button', { name: /task baru/i }).first().isVisible().catch(() => false)) {
    await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
  }
  await page.getByRole('button', { name: /task baru/i }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /forum comment/i }).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Contoh/).first().fill('QA4 Forum WithBrief 2b');
  const descTa = page.locator('textarea').first();
  await descTa.fill('brief test');
  const briefTa = page.locator('textarea').nth(1);
  await briefTa.fill('QA4 komentar final untuk test 2b');
  await page.getByRole('button', { name: /publish active/i }).first().click();
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.body.innerText);
  results.positivePublished = body.includes('QA4 Forum WithBrief 2b');
  await page.screenshot({ path: `${OUT}/fix2b-positive.png` });
});

writeFileSync('qa-probes/qa4-fix2b.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa4-fix2b.json');
await browser.close();
