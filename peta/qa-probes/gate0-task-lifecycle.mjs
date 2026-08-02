// GATE 0 — S1: Full task lifecycle E2E on PROD.
// admin creates+activates task → member claims+submits → admin approves → member saldo increases.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
const TS = Date.now().toString().slice(-8);
const TASK_TITLE = `QA Test Task ${TS}`;
const TASK_URL = `https://reddit.com/r/qa-test-${TS}`;
const COMMENT = `QA E2E test comment ${TS} — great post!`;
const OUT = 'qa-probes/artifacts/tasklife';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const log = [];
const step = (name, data) => { log.push({ name, ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 220)); };

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
  return page.url().replace(BASE, '');
}

// ============ ADMIN: create + activate task ============
const admin = await newPage();
await login(admin, ADMIN_EMAIL, ADMIN_PASS);
await admin.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
await admin.waitForTimeout(1500);
await admin.getByRole('button', { name: /task baru/i }).first().click();
await admin.waitForTimeout(800);
// category: default reddit_comment is pre-selected
const catCards = await admin.locator('button').filter({ hasText: /Upvote|comment|thread|upload/i }).allTextContents();
step('task-create-sheet', { catCards: catCards.slice(0, 5) });
// Judul
await admin.getByPlaceholder(/Contoh: Comment/i).fill(TASK_TITLE);
// Target URL
const urlInput = await admin.locator('input').filter({ has: undefined }).all();
// find input with placeholder https://reddit.com
const targetInput = admin.locator('input[placeholder*="reddit.com"], input[placeholder*="quora"]');
await targetInput.fill(TASK_URL);
// Brief (komentar siap posting) — textarea with placeholder containing 'contoh'
const briefArea = admin.locator('textarea').filter({ hasText: '' }).first();
await admin.locator('textarea').first().fill(COMMENT);
await admin.screenshot({ path: `${OUT}/1-sheet-filled.png` });
await admin.getByRole('button', { name: /Publish Active/i }).click();
await admin.waitForTimeout(3500);
const listHas = await admin.evaluate((t) => document.body.innerText.includes(t), TASK_TITLE);
step('task-created-in-list', { listHas });
await admin.screenshot({ path: `${OUT}/2-task-list.png` });

// verify the task shows as active in the queue
const statusText = await admin.evaluate(() => document.body.innerText.slice(0, 4000));
step('task-status-in-queue', { active: /QA Test Task/.test(statusText), isActive: /active/i.test(statusText) });
await admin.screenshot({ path: `${OUT}/3-activated.png` });
await admin.close();

// ============ MEMBER: claim + submit ============
const member = await newPage();
await login(member, MEMBER_EMAIL, MEMBER_PASS);
await member.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
await member.waitForTimeout(2000);
const taskLink = member.getByRole('link').filter({ hasText: TASK_TITLE });
const taskLinkCount = await taskLink.count();
step('member-sees-task', { count: taskLinkCount });
await member.screenshot({ path: `${OUT}/4-member-tasks.png` });
if (taskLinkCount > 0) {
  await taskLink.first().click();
  await member.waitForTimeout(2500);
  step('task-detail', { url: member.url().replace(BASE, '') });
  await member.screenshot({ path: `${OUT}/5-task-detail.png` });
  const detailText = await member.evaluate(() => document.body.innerText.slice(0, 900));
  step('task-detail-text', { text: detailText.slice(0, 300) });

  // claim / start wizard — look for CTA
  const claimBtn = member.getByRole('button', { name: /ambil|kerjakan|mulai|claim/i }).first();
  if (await claimBtn.count() > 0) {
    await claimBtn.click();
    await member.waitForTimeout(2500);
    await member.screenshot({ path: `${OUT}/6-wizard.png` });
    const wiz = await member.evaluate(() => document.body.innerText.slice(0, 800));
    step('wizard', { text: wiz.slice(0, 300) });

    // pick account (radio/card with the reddit username)
    const accSel = member.locator('button').filter({ hasText: /qa_test_86644849/i });
    if (await accSel.count() > 0) await accSel.first().click();
    await member.waitForTimeout(500);
    // textarea for draft comment
    const ta = member.locator('textarea').first();
    if (await ta.count() > 0) {
      await ta.fill(COMMENT);
      await member.waitForTimeout(300);
    }
    await member.screenshot({ path: `${OUT}/7-comment-filled.png` });
    // submit
    const subBtn = member.getByRole('button', { name: /kirim|submit|ajukan|selesai/i }).first();
    if (await subBtn.count() > 0) {
      await subBtn.click();
      await member.waitForTimeout(3500);
      await member.screenshot({ path: `${OUT}/8-submitted.png` });
      const after = await member.evaluate(() => document.body.innerText.slice(0, 600));
      step('after-submit', { text: after.slice(0, 250), url: member.url().replace(BASE, '') });
    }
  }
}
await member.close();

// ============ ADMIN: approve ============
const admin2 = await newPage();
await login(admin2, ADMIN_EMAIL, ADMIN_PASS);
await admin2.goto(BASE + '/admin/approval', { waitUntil: 'networkidle' });
await admin2.waitForTimeout(2500);
const apprText = await admin2.evaluate(() => document.body.innerText);
const hasPending = /pending/i.test(apprText);
step('approval-queue', { hasPending, taskVisible: apprText.includes(TASK_TITLE) });
await admin2.screenshot({ path: `${OUT}/9-approval.png` });
if (apprText.includes(TASK_TITLE)) {
  const card = admin2.locator('div').filter({ hasText: TASK_TITLE }).last();
  const approveBtn = card.getByRole('button', { name: /approve|setujui/i }).first();
  if (await approveBtn.count() > 0) {
    await approveBtn.click();
    await admin2.waitForTimeout(1500);
    // possible ConfirmDialog
    const confirm = admin2.getByRole('button', { name: /ya|approve|konfirmasi/i }).last();
    if (await confirm.count() > 0 && await confirm.isVisible().catch(() => false)) {
      await confirm.click();
      await admin2.waitForTimeout(2000);
    }
    await admin2.waitForTimeout(2500);
    const after = await admin2.evaluate(() => document.body.innerText.slice(0, 500));
    step('after-approve', { text: after.slice(0, 220) });
    await admin2.screenshot({ path: `${OUT}/10-approved.png` });
  } else {
    step('approve-btn-not-found', {});
  }
}
await admin2.close();

// ============ MEMBER: verify saldo ============
const member2 = await newPage();
await login(member2, MEMBER_EMAIL, MEMBER_PASS);
await member2.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await member2.waitForTimeout(2500);
const earn = await member2.evaluate(() => document.body.innerText.slice(0, 1200));
step('member-earnings-after', { text: earn.slice(0, 400) });
await member2.screenshot({ path: `${OUT}/11-earnings.png` });
await member2.close();

writeFileSync('qa-probes/gate0-task-lifecycle.json', JSON.stringify(log, null, 2));
console.log('\nDONE. Full log saved to qa-probes/gate0-task-lifecycle.json');
await browser.close();
