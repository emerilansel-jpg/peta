// GATE 0 — S1 cont: member submits the claimed task, admin approves, saldo verified.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
const TASK_ID = '210abad4-e4ff-474e-ac7c-1879322cc0c3';
const COMMENT_URL = 'https://reddit.com/r/qa-test/comments/qa-e2e';
const USERNAME = 'qa_test_86644849';
const OUT = 'qa-probes/artifacts/tasklife';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const log = [];
const step = (name, data) => { log.push({ name, ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 250)); };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 180)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 180)));
  page._errs = errs;
  return page;
}
async function login(page, email, pass) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(email);
  await page.locator('input[type="password"]').first().fill(pass);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);
}

// ---- MEMBER: submit ----
const member = await newPage();
await login(member, MEMBER_EMAIL, MEMBER_PASS);
await member.goto(BASE + '/task/' + TASK_ID, { waitUntil: 'networkidle' });
await member.waitForTimeout(2500);
const stageText = await member.evaluate(() => document.body.innerText.slice(0, 800));
step('submit-stage', { text: stageText.slice(0, 250) });

// fill URL input
const urlInput = member.locator('input[placeholder*="reddit.com"], input[placeholder*="youtube"], input[placeholder*="community"]');
step('url-input-count', { count: await urlInput.count() });
await urlInput.fill(COMMENT_URL);
// username input
const userInput = member.locator('input[placeholder*="u/"], input[placeholder*="Contoh: nama"]');
await userInput.fill(USERNAME);
// optional note
const note = member.locator('textarea');
if (await note.count() > 0) await note.first().fill('QA E2E submission');
await member.screenshot({ path: `${OUT}/12-submit-filled.png` });

// submit
await member.getByRole('button', { name: /Submit untuk Approval/i }).click();
await member.waitForTimeout(4000);
const afterSubmit = await member.evaluate(() => document.body.innerText.slice(0, 700));
step('after-submit', { text: afterSubmit.slice(0, 300) });
await member.screenshot({ path: `${OUT}/13-submitted.png` });
await member.close();

// ---- ADMIN: approve ----
const admin = await newPage();
await login(admin, ADMIN_EMAIL, ADMIN_PASS);
await admin.goto(BASE + '/admin/approval', { waitUntil: 'networkidle' });
await admin.waitForTimeout(3000);
const appr = await admin.evaluate(() => document.body.innerText);
step('approval-queue', { hasQA: appr.includes('QA Test Task'), hasSubmitted: /submit/i.test(appr) });
await admin.screenshot({ path: `${OUT}/14-approval.png` });

// find approve button (icon-only, title=Approve) within the QA task card
const card = admin.locator('div').filter({ hasText: 'QA Test Task' }).last();
const approveBtn = card.locator('button[title="Approve"]').first();
step('approve-btn-count', { count: await approveBtn.count() });
if (await approveBtn.count() > 0) {
  await approveBtn.click();
  await admin.waitForTimeout(3000);
  await admin.waitForTimeout(2000);
  const after = await admin.evaluate(() => document.body.innerText.slice(0, 600));
  step('after-approve', { text: after.slice(0, 250) });
  await admin.screenshot({ path: `${OUT}/15-approved.png` });
} else {
  step('no-approve-button', {});
}
await admin.close();

// ---- MEMBER: verify saldo ----
const m2 = await newPage();
await login(m2, MEMBER_EMAIL, MEMBER_PASS);
await m2.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await m2.waitForTimeout(2500);
const earn = await m2.evaluate(() => document.body.innerText.slice(0, 1400));
step('member-earnings', { text: earn.slice(0, 500) });
await m2.screenshot({ path: `${OUT}/16-earnings.png` });
await m2.close();

writeFileSync('qa-probes/gate0-task-approve.json', JSON.stringify(log, null, 2));
console.log('\nDONE');
await browser.close();
