// QA3 GATE 0 — Admin approve (exact button) + verify assignment status + saldo.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const adminState = JSON.parse(readFileSync('qa-probes/qa3-gate0-admin.json', 'utf8'));
const MEMBER = adminState.member;
const TS = adminState.ts;
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

// ---------- ADMIN: approve ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await step(page, 'admin-login', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4000);
  });
  await step(page, 'approve-exact', async () => {
    await page.goto(BASE + '/admin/approval', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const body0 = await page.evaluate(() => document.body.innerText);
    results.queueHasTask = body0.includes(`QA3 Forum WithBrief ${TS}`);
    // exact-name button "Approve" (mobile card)
    const approveBtn = page.getByRole('button', { name: 'Approve', exact: true }).first();
    const n = await approveBtn.count().catch(() => 0);
    results.approveButtons = n;
    if (n === 0) throw new Error('no Approve button found');
    await approveBtn.click();
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => document.body.innerText);
    results.toast = (after.match(/(Approved|Gagal[^\n]*)/i) || [''])[0];
    await page.screenshot({ path: `${OUT}/e2e-approve2.png` });
  });
  await ctx.close();
}

// ---------- MEMBER: check saldo ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await step(page, 'member-login', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
    await page.locator('input[type="password"]').first().fill(MEMBER.password);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4500);
  });
  await step(page, 'earnings-saldo', async () => {
    await page.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const body = await page.evaluate(() => document.body.innerText);
    results.saldoFull = body.slice(0, 1500);
    results.saldoHas6000 = /6\.?000/.test(body);
    await page.screenshot({ path: `${OUT}/e2e-saldo2.png` });
  });
  await ctx.close();
}

writeFileSync('qa-probes/qa3-gate0-approve2.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-approve2.json');
await browser.close();
