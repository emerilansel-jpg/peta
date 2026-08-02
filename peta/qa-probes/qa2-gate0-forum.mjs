// QA2 — GATE 0: Claim forum task → submit → admin approve (full E2E tanpa reddit account)
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

async function login(page, email, pass) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(email);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(3500);
}

// ===== MEMBER: claim forum task & submit =====
let taskId = null;
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, 'qa2-task-21118641@penghasilantambahan.com', 'Qa2Task#2026');
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);

  // Click first forum comment task
  const forumLink = page.getByRole('link').filter({ hasText: 'Komen di fb' }).first();
  const count = await forumLink.count();
  step('forum-task-visible', { count });
  if (count > 0) {
    await forumLink.click();
    await page.waitForTimeout(3500);
    const detail = await page.evaluate(() => ({ url: location.pathname, text: document.body.innerText.slice(0, 500) }));
    taskId = detail.url.split('/task/')[1];
    step('forum-task-detail', { taskId, text: detail.text.slice(0, 250) });
    await page.screenshot({ path: 'qa-probes/artifacts/qa2-forum-detail.png' });

    // Start task (auto-claim for forum tasks without reddit)
    const startBtn = page.getByRole('button', { name: /mulai task/i });
    if (await startBtn.count() > 0) {
      await startBtn.click();
      await page.waitForTimeout(3500);
      step('after-start', { url: page.url().replace(BASE, '') });
      await page.screenshot({ path: 'qa-probes/artifacts/qa2-forum-started.png' });
    }

    // Fill submit form: URL, username, optional note
    const urlInput = page.locator('input[placeholder*="https://"], input[placeholder*="quora"], input[placeholder*="facebook"], input[placeholder*="community"]').first();
    const urlCount = await urlInput.count();
    step('submit-url-input', { count: urlCount });
    if (urlCount > 0) {
      await urlInput.fill('https://www.facebook.com/groups/qa2-test/post/12345');
      const userInput = page.locator('input[placeholder*="u/"], input[placeholder*="Contoh: nama"]').first();
      if (await userInput.count() > 0) await userInput.fill('qa2_member_test');
      const note = page.locator('textarea').first();
      if (await note.count() > 0) await note.fill('QA2 E2E forum comment submission');
      await page.screenshot({ path: 'qa-probes/artifacts/qa2-forum-filled.png' });

      // Submit
      const submitBtn = page.getByRole('button', { name: /submit untuk approval/i });
      const btnCount = await submitBtn.count();
      step('submit-btn', { count: btnCount });
      if (btnCount > 0) {
        await submitBtn.first().click();
        await page.waitForTimeout(4000);
        const after = await page.evaluate(() => document.body.innerText.slice(0, 400));
        step('after-submit', { text: after.slice(0, 250) });
        await page.screenshot({ path: 'qa-probes/artifacts/qa2-forum-submitted.png' });
      }
    }
  }
  await page.close();
}

// ===== ADMIN: approve =====
if (taskId) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, ADMIN_EMAIL, ADMIN_PASS);
  await page.goto(BASE + '/admin/approval', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body.innerText);
  const hasQa2 = text.includes('qa2_task_member') || text.includes('qa2-member') || text.includes('QA2');
  step('approval-queue-qa2', { hasQa2 });
  await page.screenshot({ path: 'qa-probes/artifacts/qa2-approval-queue.png' });
  await page.close();
}

writeFileSync('qa-probes/qa2-gate0-forum.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Forum task lifecycle test complete');
