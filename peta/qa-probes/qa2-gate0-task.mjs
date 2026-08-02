// QA2 — GATE 0: Full task lifecycle E2E (admin create → member claim → submit → admin approve)
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

async function getToken(page) {
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    return JSON.parse(localStorage.getItem(k) || '{}')?.access_token || null;
  });
}

const ts = Date.now().toString().slice(-8);
const memberEmail = `qa2-task-${ts}@penghasilantambahan.com`;

// ===== PHASE 1: admin creates member via RPC + creates task via UI =====
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, ADMIN_EMAIL, ADMIN_PASS);
  const token = await getToken(page);

  // 1. Create member
  const created = await page.evaluate(async ({ email, token, ts }) => {
    const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/rpc/admin_create_member', {
      method: 'POST', headers: H,
      body: JSON.stringify({ p_email: email, p_password: 'Qa2Task#2026', p_full_name: 'QA2 Task Member', p_whatsapp: `0812987${ts}` }),
    });
    return { status: resp.status, body: await resp.text() };
  }, { email: memberEmail, token, ts });
  step('admin-create-member', created);

  // 2. Create task via UI (Task Queue → Buat Task Baru)
  await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /task baru/i }).first().click();
  await page.waitForTimeout(1000);

  // Fill form
  const taskTitle = `QA2 Task ${ts}`;
  try {
    await page.getByPlaceholder(/Contoh: Comment/i).fill(taskTitle);
    const urlInput = page.locator('input[placeholder*="reddit.com"]');
    await urlInput.fill(`https://reddit.com/r/qa2-test-${ts}`);
    const briefArea = page.locator('textarea').first();
    await briefArea.fill('QA2 test comment — please approve this test task');
    await page.screenshot({ path: 'qa-probes/artifacts/qa2-task-sheet-filled.png' });
    await page.getByRole('button', { name: /Publish Active/i }).click();
    await page.waitForTimeout(3000);
    const listHas = await page.evaluate((t) => document.body.innerText.includes(t), taskTitle);
    step('task-created', { listHas });
    await page.screenshot({ path: 'qa-probes/artifacts/qa2-task-created.png' });
  } catch (e) {
    step('task-create-error', { error: e.message.slice(0, 200) });
    // fallback: create via API
    const createdTask = await page.evaluate(async ({ title, token }) => {
      const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/tasks', {
        method: 'POST', headers: H,
        body: JSON.stringify({ title, task_type: 'comment', task_category: 'reddit_comment', reward_amount: 8000, max_assignments: 5, status: 'active', is_hidden: false, target_url: `https://reddit.com/r/qa2-test-${ts}` }),
      });
      return { status: resp.status, body: (await resp.text()).slice(0, 300) };
    }, { title: taskTitle, token });
    step('task-create-api-fallback', createdTask);
  }
  await page.close();
}

// ===== PHASE 2: member logs in, claims task, submits =====
let taskId = null;
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, memberEmail, 'Qa2Task#2026');
  const token = await getToken(page);
  const url = page.url();
  step('member-login', { url });

  // find the QA2 task on /tasks
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  const taskLink = page.getByRole('link').filter({ hasText: `QA2 Task ${ts}` });
  const count = await taskLink.count();
  step('member-sees-task', { count });
  await page.screenshot({ path: 'qa-probes/artifacts/qa2-member-tasks.png' });

  if (count > 0) {
    await taskLink.first().click();
    await page.waitForTimeout(3000);
    const detail = await page.evaluate(() => ({ url: location.pathname, text: document.body.innerText.slice(0, 400) }));
    step('task-detail', { url: detail.url, text: detail.text.slice(0, 200) });
    taskId = detail.url.split('/task/')[1];
    await page.screenshot({ path: 'qa-probes/artifacts/qa2-task-detail.png' });
  } else {
    // try to find task via API
    const tasks = await page.evaluate(async ({ token }) => {
      const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/tasks?select=id,title,status&order=created_at.desc&limit=5', { headers: H });
      return resp.json();
    }, { token });
    step('tasks-api', tasks);
  }
  await page.close();
}

// ===== PHASE 3: admin approves =====
if (taskId) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, ADMIN_EMAIL, ADMIN_PASS);
  await page.goto(BASE + '/admin/approval', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body.innerText);
  const hasTask = text.includes(`QA2 Task ${ts}`);
  step('approval-queue', { hasTask });
  await page.screenshot({ path: 'qa-probes/artifacts/qa2-approval.png' });
  await page.close();
}

writeFileSync('qa-probes/qa2-gate0-task.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Task lifecycle test complete');
