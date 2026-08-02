// QA3 GATE 0 — Member E2E: login, onboarding (founding cap), forum task claim→submit, earnings UI.
// Member is read from qa3-gate0-admin.json (created via admin UI in prior probe).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const adminState = JSON.parse(readFileSync('qa-probes/qa3-gate0-admin.json', 'utf8'));
const MEMBER = adminState.member;
const OUT = 'qa-probes/artifacts/qa3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = { member: MEMBER.email, steps: [] };

async function step(page, name, fn) {
  const errors = [];
  const onErr = (m) => errors.push(m.text().slice(0, 160));
  const onPageErr = (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160));
  const onFailed = (r) => { if (r.status() >= 400 && !r.url().includes('/auth/')) errors.push(`${r.status()} ${r.url().slice(0, 100)}`); };
  page.on('console', onErr); page.on('pageerror', onPageErr); page.on('response', onFailed);
  try { await fn(); } catch (e) { errors.push('EXC: ' + e.message.slice(0, 220)); }
  page.removeListener('console', onErr); page.removeListener('pageerror', onPageErr); page.removeListener('response', onFailed);
  results.steps.push({ name, errors: errors.slice(0, 6) });
  console.log(`[${errors.length ? 'WARN' : ' OK '}] ${name}${errors.length ? '\n    → ' + errors.slice(0, 3).join('\n    → ') : ''}`);
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// 1. Member login
await step(page, 'member-login', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
  await page.locator('input[type="password"]').first().fill(MEMBER.password);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
  results.landingAfterLogin = page.url().replace(BASE, '');
  await page.screenshot({ path: `${OUT}/member-after-login.png` });
});

// 2. Onboarding — founding cap check
await step(page, 'onboarding-founding-cap', async () => {
  await page.goto(BASE + '/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.foundingCapText = body.match(/.{0,60}founding.{0,120}/i)?.[0] || body.match(/.{0,60}Bonus.{0,120}/i)?.[0] || '(none)';
  results.onboardingHasBonusStep = /Rp\s?25\.?000|25\.?000/i.test(body);
  await page.screenshot({ path: `${OUT}/member-onboarding.png` });
});

// 3. Tasks page — forum task visible without reddit account
await step(page, 'tasks-page', async () => {
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.tasksPageHasForumTask = body.includes(`QA3 Forum Task ${adminState.ts}`);
  results.tasksPageHasRedditTask = body.includes(`QA3 Reddit Comment ${adminState.ts}`);
  results.tasksPageSample = body.slice(0, 500);
  await page.screenshot({ path: `${OUT}/member-tasks.png` });
});

// 4. Claim forum task → detail → submit comment
let taskUrl = null;
await step(page, 'claim-forum-task', async () => {
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  // find the task card link
  const card = page.locator(`text=${'QA3 Forum Task ' + adminState.ts}`).first();
  await card.click();
  await page.waitForTimeout(2500);
  taskUrl = page.url();
  results.taskDetailUrl = taskUrl;
  const body = await page.evaluate(() => document.body.innerText);
  results.taskDetailHasForumTarget = body.includes('hubspot.com');
  await page.screenshot({ path: `${OUT}/member-task-detail.png` });
});

await step(page, 'start-task-and-write-comment', async () => {
  const body = await page.evaluate(() => document.body.innerText);
  // 2-step wizard: pick account OR write comment directly (forum may skip account)
  const startBtn = page.getByRole('button', { name: /mulai|kerjakan|claim/i }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(2000);
  }
  const body2 = await page.evaluate(() => document.body.innerText);
  results.afterStart = body2.slice(0, 400);
  // find comment textarea
  const ta = page.locator('textarea').first();
  if (await ta.isVisible().catch(() => false)) {
    await ta.fill(`QA3 test comment ${adminState.ts} — ini bukti uji fungsional, bukan komentar asli.`);
    await page.waitForTimeout(400);
    // proof URL field if present
    const proof = page.getByPlaceholder(/https:\/\/|bukti|link/i).first();
    if (await proof.isVisible().catch(() => false)) {
      await proof.fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
      await page.waitForTimeout(300);
    }
    const submit = page.getByRole('button', { name: /kirim|submit/i }).first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
      await page.waitForTimeout(3500);
    }
  }
  const finalBody = await page.evaluate(() => document.body.innerText);
  results.submitConfirmation = /berhasil|sukses|terkirim|approved|submitted/i.test(finalBody);
  results.submitPageSample = finalBody.slice(0, 400);
  await page.screenshot({ path: `${OUT}/member-submitted.png` });
});

// 5. Task history
await step(page, 'task-history', async () => {
  await page.goto(BASE + '/task-history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText);
  results.historyHasSubmission = body.includes(`QA3 Forum Task ${adminState.ts}`) || /submitted|menunggu|pending/i.test(body);
  await page.screenshot({ path: `${OUT}/member-history.png` });
});

// 6. Earnings page — saldo + payout eligibility
await step(page, 'earnings-page', async () => {
  await page.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.earningsSample = body.slice(0, 700);
  results.hasSaldo = /saldo|rp\s?[0-9]/i.test(body);
  results.hasPayoutInfo = /payout|penarikan|tarik|150\.?000|20\.?000/i.test(body);
  await page.screenshot({ path: `${OUT}/member-earnings.png` });
});

// 7. Account page
await step(page, 'account-page', async () => {
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText);
  results.accountHasWhatsapp = MEMBER.whatsapp.slice(0, 5) in body || body.includes(MEMBER.whatsapp);
  await page.screenshot({ path: `${OUT}/member-account.png` });
});

writeFileSync('qa-probes/qa3-gate0-member.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-member.json');
await browser.close();
