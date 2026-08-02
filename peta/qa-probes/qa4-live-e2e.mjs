// QA4 LIVE E2E — full loop on prod: admin creates member+task → member submit → admin approve.
// Key assertion: NO send-peta-email error in console after approve (FIX 1 live).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const TS = Date.now().toString().slice(-8);
const MEMBER = {
  name: 'QA4 Live Member',
  email: `qa4-${TS}@penghasilantambahan.com`,
  password: 'Qa4Live#2026!',
  whatsapp: `0814${TS}`,
};
const TITLE = `QA4 Live E2E ${TS}`;
const OUT = 'qa-probes/artifacts/qa4';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = { ts: TS, member: MEMBER.email, taskTitle: TITLE, steps: [] };
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

// ---------- ADMIN: member + task ----------
{
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
  await step(page, 'create-member', async () => {
    await page.goto(BASE + '/admin/team', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /tambah/i }).first().click();
    await page.waitForTimeout(700);
    await page.getByPlaceholder('Nama lengkap').fill(MEMBER.name);
    await page.locator('input[type="email"]').fill(MEMBER.email);
    await page.getByPlaceholder('Kirim ke member nanti').fill(MEMBER.password);
    await page.getByPlaceholder('08xxxxxxxxxx').fill(MEMBER.whatsapp);
    await page.getByRole('button', { name: 'Buat Member' }).click();
    await page.waitForTimeout(4000);
  });
  await step(page, 'create-forum-task', async () => {
    await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /task baru/i }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /forum comment/i }).filter({ visible: true }).first().click();
    await page.waitForTimeout(400);
    await page.getByPlaceholder(/Contoh/).first().fill(TITLE);
    const descTa = page.locator('textarea').first();
    await descTa.fill(`QA4 live E2E: komentar test ${TS}`);
    await page.getByPlaceholder(/https:\/\/www\.quora\.com/).first().fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
    const briefTa = page.locator('textarea').nth(1);
    await briefTa.fill(`QA4 komentar final test ${TS}`);
    await page.getByPlaceholder('0').first().fill('6000');
    await page.getByPlaceholder('1').first().fill('2');
    await page.getByRole('button', { name: /publish active/i }).first().click();
    await page.waitForTimeout(3500);
  });
  await ctx.close();
}

// ---------- MEMBER: claim + submit ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await step(page, 'member-login', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
    await page.locator('input[type="password"]').first().fill(MEMBER.password);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4500);
  });
  await step(page, 'claim', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.locator(`text=${TITLE}`).first().click();
    await page.waitForTimeout(2500);
    const btn = page.getByRole('button', { name: /mulai|kerjakan|claim/i }).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(2500); }
  });
  await step(page, 'submit', async () => {
    const proof = page.getByPlaceholder(/https:\/\/community\.hubspot\.com/).first();
    await proof.fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
    const username = page.getByPlaceholder(/nama profile HubSpot/i).first();
    await username.fill('qa4-live-user');
    const submit = page.getByRole('button', { name: /submit untuk approval/i }).first();
    results.submitDisabled = await submit.isDisabled().catch(() => true);
    if (results.submitDisabled) throw new Error('submit disabled on live');
    await submit.click();
    await page.waitForTimeout(4000);
    const body = await page.evaluate(() => document.body.innerText);
    results.submitted = /tersubmit/i.test(body);
    await page.screenshot({ path: `${OUT}/live-e2e-submitted.png` });
  });
  await ctx.close();
}

// ---------- ADMIN: approve + watch console for email errors ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrs.push('PAGEERROR: ' + e.message.slice(0, 200)));
  await step(page, 'admin-login-2', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4500);
  });
  await step(page, 'approve', async () => {
    await page.goto(BASE + '/admin/approval', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const approveBtn = page.getByRole('button', { name: 'Approve', exact: true }).first();
    const n = await approveBtn.count().catch(() => 0);
    results.approveButtons = n;
    if (n > 0) {
      await approveBtn.click();
      await page.waitForTimeout(4500);
      results.toast = (await page.evaluate(() => document.body.innerText)).match(/(Approved|Gagal[^\n]*)/i)?.[0] || '';
      await page.screenshot({ path: `${OUT}/live-e2e-approved.png` });
    } else {
      results.toast = 'NO_APPROVE_BUTTON';
    }
    results.approveConsoleErrors = consoleErrs.filter((e) => !e.includes('favicon'));
    await page.waitForTimeout(2500);
  });
  await ctx.close();
}

writeFileSync('qa-probes/qa4-live-e2e.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa4-live-e2e.json');
await browser.close();
