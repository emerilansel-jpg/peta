// QA3 GATE 0 — Full E2E loop: admin creates forum task WITH brief → member claim+submit → admin approve → saldo.
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
const results = { ts: TS, steps: [] };

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

// ---------- ADMIN: create forum task WITH brief ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const TITLE = `QA3 Forum WithBrief ${TS}`;
  results.taskTitle = TITLE;

  await step(page, 'admin-login', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4000);
  });

  await step(page, 'create-forum-task-with-brief', async () => {
    await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /task baru/i }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /forum comment/i }).filter({ visible: true }).first().click();
    await page.waitForTimeout(400);
    await page.getByPlaceholder(/Contoh/).first().fill(TITLE);
    // description
    const descField = page.locator('textarea').first();
    await descField.fill('QA3 happy path: brief + comment post diisi.');
    // target url
    await page.getByPlaceholder(/https:\/\/www\.quora\.com/).first().fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
    // brief (comment post) — second textarea
    const briefTa = page.locator('textarea').nth(1);
    await briefTa.fill('QA3 comment post test — komentar final yang harus diposting member.');
    // reward
    await page.getByPlaceholder('0').first().fill('6000');
    // slots
    await page.getByPlaceholder('1').first().fill('3');
    await page.getByRole('button', { name: /publish active/i }).first().click();
    await page.waitForTimeout(4000);
    const body = await page.evaluate(() => document.body.innerText);
    if (!body.includes(TITLE)) throw new Error('task not visible after publish');
  });
  await ctx.close();
}

// ---------- MEMBER: claim + submit ----------
let taskUrl = null;
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

  await step(page, 'open-task', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.locator(`text=${results.taskTitle}`).first().click();
    await page.waitForTimeout(2500);
    taskUrl = page.url();
    results.taskUrl = taskUrl;
  });

  await step(page, 'claim', async () => {
    const btn = page.getByRole('button', { name: /mulai|kerjakan|claim/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(2500);
    }
    // comment textarea should now be present
    const commentTa = page.locator('textarea').first();
    results.commentPrefilled = await commentTa.inputValue().catch(() => '');
    await page.screenshot({ path: `${OUT}/e2e-claimed.png` });
  });

  await step(page, 'submit', async () => {
    const proof = page.getByPlaceholder(/https:\/\/community\.hubspot\.com/).first();
    await proof.fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
    const username = page.getByPlaceholder(/nama profile HubSpot/i).first();
    await username.fill('qa3-hubspot-user');
    const submit = page.getByRole('button', { name: /submit untuk approval/i }).first();
    const disabled = await submit.isDisabled().catch(() => true);
    results.submitDisabled = disabled;
    if (disabled) throw new Error('submit disabled even with brief-filled task');
    await submit.click();
    await page.waitForTimeout(4000);
    const body = await page.evaluate(() => document.body.innerText);
    results.submitOk = /tersubmit|terkirim/i.test(body);
    await page.screenshot({ path: `${OUT}/e2e-submitted.png` });
  });

  await step(page, 'verify-history', async () => {
    await page.goto(BASE + '/task-history', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const body = await page.evaluate(() => document.body.innerText);
    results.historyHasTask = body.includes(results.taskTitle);
  });
  await ctx.close();
}

// ---------- ADMIN: approve ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await step(page, 'admin-login-2', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4000);
  });
  await step(page, 'approve-in-queue', async () => {
    await page.goto(BASE + '/admin/approval', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const body = await page.evaluate(() => document.body.innerText);
    results.approvalQueueHasTask = body.includes(results.taskTitle);
    await page.screenshot({ path: `${OUT}/e2e-approval-queue.png` });
    if (!results.approvalQueueHasTask) throw new Error('task not in approval queue');
    // click the row / approve button
    const approveBtn = page.getByRole('button', { name: /approve/i }).first();
    if (await approveBtn.isVisible().catch(() => false)) {
      await approveBtn.click();
      await page.waitForTimeout(3500);
    } else {
      // maybe need to expand the row first
      await page.locator(`text=${results.taskTitle}`).first().click();
      await page.waitForTimeout(1200);
      const btn2 = page.getByRole('button', { name: /approve/i }).first();
      await btn2.click();
      await page.waitForTimeout(3500);
    }
    const after = await page.evaluate(() => document.body.innerText);
    results.approved = /approved|disetujui|sukses/i.test(after);
    await page.screenshot({ path: `${OUT}/e2e-approved.png` });
  });
  await ctx.close();
}

// ---------- MEMBER: check saldo ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await step(page, 'member-login-3', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
    await page.locator('input[type="password"]').first().fill(MEMBER.password);
    await page.getByRole('button', { name: /masuk|login/i }).first().click();
    await page.waitForTimeout(4500);
  });
  await step(page, 'earnings-saldo', async () => {
    await page.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const body = await page.evaluate(() => document.body.innerText);
    results.saldoSample = body.slice(0, 500);
    results.saldoHas6000 = /6\.?000/.test(body);
    await page.screenshot({ path: `${OUT}/e2e-saldo.png` });
  });
  await ctx.close();
}

writeFileSync('qa-probes/qa3-gate0-e2e-loop.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-e2e-loop.json');
await browser.close();
