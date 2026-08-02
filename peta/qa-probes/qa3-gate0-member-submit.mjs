// QA3 GATE 0 — Member submit follow-up: fill proof URL + username, submit, verify state.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const adminState = JSON.parse(readFileSync('qa-probes/qa3-gate0-admin.json', 'utf8'));
const memberState = JSON.parse(readFileSync('qa-probes/qa3-gate0-member.json', 'utf8'));
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

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await step(page, 'login', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
  await page.locator('input[type="password"]').first().fill(MEMBER.password);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
});

// Re-open the forum task detail (assignment may already exist from prior run)
await step(page, 'open-task-detail', async () => {
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator(`text=${'QA3 Forum Task ' + TS}`).first().click();
  await page.waitForTimeout(2500);
});

// Fill proof section: comment textarea, proof URL, username
await step(page, 'fill-proof-section', async () => {
  // screenshot of the current state first
  await page.screenshot({ path: `${OUT}/member-taskdetail-before-submit.png` });
  const body = await page.evaluate(() => document.body.innerText);
  results.hasSubmitForm = /Submit untuk Approval|Submit URL/i.test(body);

  // proof URL input
  const proof = page.getByPlaceholder(/https:\/\/community\.hubspot\.com/).first();
  await proof.fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
  await page.waitForTimeout(300);
  // submitted username
  const username = page.getByPlaceholder(/nama profile HubSpot/i).first();
  await username.fill('qa3-hubspot-user');
  await page.waitForTimeout(300);
  // user note textarea (optional)
  const note = page.locator('textarea').last();
  if (await note.isVisible().catch(() => false)) {
    await note.fill(`QA3 catatan ${TS}`);
  }
  await page.waitForTimeout(500);
  // scroll to submit & verify enabled
  const submit = page.getByRole('button', { name: /submit untuk approval/i }).first();
  const disabled = await submit.isDisabled().catch(() => true);
  results.submitDisabledAfterFill = disabled;
  await page.screenshot({ path: `${OUT}/member-taskdetail-filled.png` });
  if (disabled) throw new Error('submit still disabled after filling proof+username');
  await submit.click();
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => document.body.innerText);
  results.afterSubmit = after.slice(0, 500);
  await page.screenshot({ path: `${OUT}/member-taskdetail-submitted.png` });
});

// Verify in task history
await step(page, 'verify-history', async () => {
  await page.goto(BASE + '/task-history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.historySample = body.slice(0, 600);
  results.historyHasTask = body.includes(`QA3 Forum Task ${TS}`);
  await page.screenshot({ path: `${OUT}/member-history2.png` });
});

writeFileSync('qa-probes/qa3-gate0-member-submit.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-member-submit.json');
await browser.close();
