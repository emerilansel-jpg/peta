// QA3 Gate 0 — Phase A: FULL member journey via UI (Chromium, 390px)
// m1: login → onboarding → tasks → forum task claim → submit proof → earnings → account → logout/login persistence
import { chromium } from 'playwright';
import { save, PROD_URL } from './qa3-lib.mjs';
import { mkdirSync, readFileSync } from 'fs';

const ART = 'qa-probes/qa3-artifacts/member';
mkdirSync(ART, { recursive: true });

const members = JSON.parse(readFileSync('qa-probes/qa3-members.json', 'utf8'));
const MEMBER = members.m1;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const results = [];
let errors = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace('https://yorlsgzsawchpeeazcvi.supabase.co', 'SB').slice(0, 140)}`); });
const snapshot = async (name) => {
  results.push({ step: name, url: page.url().replace(PROD_URL, ''), errors: [...new Set(errors)].slice(0, 4), failed: [...new Set(failed)].slice(0, 6) });
  errors = []; failed = [];
  try { await page.screenshot({ path: `${ART}/${name.replace(/[^a-z0-9-]/gi, '_')}.png` }); } catch {}
};

// ---- 1. LOGIN ----
await page.goto(PROD_URL + '/login', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForTimeout(800);
await page.getByPlaceholder(/kamu@email\.com|0812xxxx/).fill(MEMBER.email);
await page.getByPlaceholder('••••••••').fill(MEMBER.password);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(5000);
await snapshot('login');

// ---- 2. ONBOARDING (founding cap state) ----
let onboardingText = '';
if (page.url().includes('/onboarding')) {
  onboardingText = (await page.locator('body').innerText()).slice(0, 900);
  // walk up to 6 steps, clicking primary CTA each time
  for (let i = 0; i < 6; i++) {
    const btns = await page.getByRole('button').allTextContents();
    const primary = btns.find((t) => /claim|klaim|lanjut|ambil|ya|buka|selesai|mulai|nanti|lewati|skip/i.test(t));
    if (!primary) break;
    await page.getByRole('button', { name: new RegExp(primary.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
    await page.waitForTimeout(2000);
    if (page.url().includes('/tasks')) break;
  }
  await page.screenshot({ path: `${ART}/onboarding-end.png` });
}
await snapshot('onboarding');

// ---- 3. TASKS PAGE ----
await page.goto(PROD_URL + '/tasks', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForTimeout(1500);
const tasksText = await page.locator('body').innerText();
const taskTitles = await page.locator('body').getByText(/QA3 (Forum|Reddit|Upvote)/i).allTextContents();
await snapshot('tasks');

// ---- 4. FORUM TASK: claim + submit (no reddit account needed) ----
let forumClaimed = false;
try {
  const forumCard = page.locator('body').getByText(/QA3 Forum Task/i).first();
  if (await forumCard.count()) {
    await forumCard.click();
    await page.waitForTimeout(2500);
    await snapshot('task-detail');
    // Claim button (may require reddit account selection — forum should be direct)
    const claimBtn = page.getByRole('button', { name: /kerjakan|mulai|claim|ambil task/i }).first();
    if (await claimBtn.count()) {
      await claimBtn.click();
      await page.waitForTimeout(2500);
      forumClaimed = true;
      await snapshot('task-claimed');
      // Submit proof
      const proof = page.locator('input[type="url"], input[placeholder*="http"]').first();
      if (await proof.count()) {
        await proof.fill('https://community.hubspot.com/t5/Forums/qa3-test-comment');
        await page.screenshot({ path: `${ART}/proof-filled.png` });
      }
      const submitBtn = page.getByRole('button', { name: /kirim|submit|selesai/i }).first();
      if (await submitBtn.count()) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }
      await snapshot('task-submitted');
    }
  }
} catch (e) { results.push({ step: 'forum-claim-error', msg: String(e).slice(0, 300) }); }

// ---- 5. EARNINGS ----
await page.goto(PROD_URL + '/earnings', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForTimeout(1500);
const earningsText = await page.locator('body').innerText();
await snapshot('earnings');

// ---- 6. ACCOUNT — add reddit account (fallback karma path) ----
await page.goto(PROD_URL + '/account', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForTimeout(1200);
await snapshot('account');

// ---- 7. REDDIT-ARMY redirect ----
await page.goto(PROD_URL + '/reddit-army', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
await snapshot('reddit-army-redirect');

// ---- 8. LOGOUT ----
await page.goto(PROD_URL + '/account', { waitUntil: 'networkidle', timeout: 30000 });
const logoutBtn = page.getByRole('button', { name: /keluar|logout/i }).first();
if (await logoutBtn.count()) {
  await logoutBtn.click();
  await page.waitForTimeout(2500);
}
await snapshot('logout');

// ---- 9. LOGIN AGAIN (persistence) ----
await page.goto(PROD_URL + '/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);
await page.getByPlaceholder(/kamu@email\.com|0812xxxx/).fill(MEMBER.email);
await page.getByPlaceholder('••••••••').fill(MEMBER.password);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4500);
await page.goto(PROD_URL + '/earnings', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);
const earnings2 = await page.locator('body').innerText();
await snapshot('relogin-earnings');

await browser.close();
save('qa3-g0-member-e2e.json', {
  results, onboardingText, tasksText: tasksText.slice(0, 1400), taskTitles,
  forumClaimed, earningsText: earningsText.slice(0, 1600), earnings2: earnings2.slice(0, 600),
});
console.log(JSON.stringify({ results, forumClaimed }, null, 2));
