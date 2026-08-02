// QA4 REGRESSION — verify FIX 2/3/5/6 against preview build + prod backend.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'http://localhost:4173';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa3-60014047@penghasilantambahan.com';
const MEMBER_PASS = 'Qa3Test#2026!';
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

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// FIX 6a — 404 page
await step(page, '404-page', async () => {
  await page.goto(BASE + '/halaman-nggak-ada-xyz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.notFoundShown = body.includes('Halaman nggak ketemu') && body.includes('404');
  results.notFoundUrl = page.url();
  await page.screenshot({ path: `${OUT}/fix6-404.png` });
});

// FIX 3 — public pages without Reddit
await step(page, 'landing-no-reddit', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText);
  results.landingReddit = /reddit/i.test(body);
  results.landingHasAman = body.includes('nggak mintain password akun-mu') || body.includes('password akun');
});
await step(page, 'privacy-no-reddit', async () => {
  await page.goto(BASE + '/privacy', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.privacyReddit = /reddit/i.test(body);
});
await step(page, 'terms-no-reddit', async () => {
  await page.goto(BASE + '/terms', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.termsReddit = /reddit/i.test(body);
  results.termsHasProgramArmy = body.includes('Program Army');
});
await step(page, 'help-no-reddit', async () => {
  await page.goto(BASE + '/help', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  results.helpReddit = /reddit/i.test(body);
  results.helpHasProgramArmy = body.includes('Program Army');
});

// FIX 5 — admin login → /admin
await step(page, 'admin-login-redirect', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
  results.adminLoginUrl = page.url().replace(BASE, '');
  await page.screenshot({ path: `${OUT}/fix5-admin-login.png` });
});

// FIX 5 — member login → /tasks
await step(page, 'member-login-redirect', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
  await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
  results.memberLoginUrl = page.url().replace(BASE, '');
  await page.screenshot({ path: `${OUT}/fix5-member-login.png` });
});

// FIX 2a — forum task WITHOUT brief: claim + submit must now work
await step(page, 'forum-no-brief-submit', async () => {
  // member is already logged in from previous step
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  // find the leftover QA3 forum task without brief (in_progress for this member)
  const card = page.locator('text=QA3 Forum Task 60014047').first();
  results.taskFound = (await card.count()) > 0;
  if (results.taskFound) {
    await card.click();
    await page.waitForTimeout(2500);
    // submit section
    const proof = page.getByPlaceholder(/https:\/\/community\.hubspot\.com/).first();
    await proof.fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
    const username = page.getByPlaceholder(/nama profile HubSpot/i).first();
    await username.fill('qa4-hubspot-user');
    await page.waitForTimeout(500);
    const submit = page.getByRole('button', { name: /submit untuk approval/i }).first();
    const disabled = await submit.isDisabled().catch(() => true);
    results.submitDisabled = disabled;
    if (disabled) {
      // maybe not on the assignment yet — try claim button
      const claim = page.getByRole('button', { name: /mulai|kerjakan|claim/i }).first();
      if (await claim.isVisible().catch(() => false)) {
        await claim.click();
        await page.waitForTimeout(2000);
        await proof.fill('https://community.hubspot.com/t5/Forums/ct-p/Forums');
        await username.fill('qa4-hubspot-user');
        await page.waitForTimeout(400);
        results.submitDisabled2 = await submit.isDisabled().catch(() => true);
      }
    }
    await page.screenshot({ path: `${OUT}/fix2-forum-nobrief.png` });
  } else {
    results.submitDisabled = 'task-not-found';
  }
});

// FIX 2b — admin publish forum task with empty brief → blocked
await step(page, 'admin-block-empty-brief', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4500);
  await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /task baru/i }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /forum comment/i }).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Contoh/).first().fill('QA4 Forum NoBrief Blocked');
  // leave brief + description EMPTY
  await page.getByRole('button', { name: /publish active/i }).first().click();
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText);
  results.blockToast = /butuh 'Komentar siap-posting'|Komentar siap-posting/.test(body);
  await page.screenshot({ path: `${OUT}/fix2-block-toast.png` });
});

writeFileSync('qa-probes/qa4-regression.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa4-regression.json');
await browser.close();
