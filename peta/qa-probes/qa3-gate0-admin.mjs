// QA3 GATE 0 — Admin flows: login, create qa3-* member, create tasks, walk admin pages.
// Evidence: JSON + screenshots. No broadcast sent.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const TS = Date.now().toString().slice(-8);
const MEMBER = {
  name: 'QA3 Member ' + TS,
  email: `qa3-${TS}@penghasilantambahan.com`,
  password: 'Qa3Test#2026!',
  whatsapp: `0813${TS}`,
};
const OUT = 'qa-probes/artifacts/qa3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = { ts: TS, member: MEMBER, steps: [] };

async function step(page, name, fn) {
  const errors = [];
  const onErr = (m) => errors.push(m.text().slice(0, 160));
  const onPageErr = (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160));
  page.on('console', onErr); page.on('pageerror', onPageErr);
  try { await fn(); } catch (e) { errors.push('EXC: ' + e.message.slice(0, 200)); }
  page.removeListener('console', onErr); page.removeListener('pageerror', onPageErr);
  results.steps.push({ name, errors: errors.slice(0, 5) });
  console.log(`[${errors.length ? 'WARN' : ' OK '}] ${name}${errors.length ? ' → ' + errors[0] : ''}`);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// 1. Admin login
await step(page, 'admin-login', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);
  const url = page.url();
  results.loginRedirect = url.replace(BASE, '');
  // NOTE: admin lands on /tasks (member page) — UX finding, recorded not failed.
  await page.screenshot({ path: `${OUT}/admin-dashboard.png` });
});

// 2. Create member via Team UI
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
  const body = await page.evaluate(() => document.body.innerText);
  if (!body.includes(MEMBER.email)) throw new Error('member email not visible after create');
  await page.screenshot({ path: `${OUT}/admin-member-created.png` });
});

// 3. Create tasks (forum + upvote + reddit comment)
async function createTask({ catLabel, title, desc, targetUrl, reward, slots }) {
  await page.goto(BASE + '/admin/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /task baru/i }).first().click();
  await page.waitForTimeout(600);
  // category — click the VISIBLE one (edit sheet may duplicate in DOM); accessible name includes range text
  await page.getByRole('button', { name: new RegExp(catLabel, 'i') }).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Contoh/).first().fill(title);
  // description textarea (second field)
  const descField = page.locator('textarea').first();
  if (await descField.isVisible().catch(() => false)) await descField.fill(desc);
  // target url
  const urlField = page.getByPlaceholder(/https:\/\//).first();
  await urlField.fill(targetUrl);
  // reward
  const rewardEl = page.getByPlaceholder('0').first();
  await rewardEl.fill(String(reward));
  // slots
  const slotsEl = page.getByPlaceholder('1').first();
  await slotsEl.fill(String(slots));
  await page.getByRole('button', { name: /publish active/i }).first().click();
  await page.waitForTimeout(4000);
  const body = await page.evaluate(() => document.body.innerText);
  if (!body.includes(title)) throw new Error('task "' + title + '" not confirmed in list');
}

await step(page, 'create-forum-task', () => createTask({
  catLabel: 'Forum comment', title: `QA3 Forum Task ${TS}`,
  desc: `QA3 desc: komen di thread HubSpot — target ${TS}`,
  targetUrl: 'https://community.hubspot.com/t5/Forums/ct-p/Forums',
  reward: 5000, slots: 3,
}));
await step(page, 'create-upvote-task', () => createTask({
  catLabel: 'Upvote', title: `QA3 Upvote Task ${TS}`,
  desc: `QA3 desc upvote ${TS}`,
  targetUrl: 'https://reddit.com/r/indonesia/comments/qa3up',
  reward: 500, slots: 3,
}));
await step(page, 'create-reddit-comment-task', () => createTask({
  catLabel: 'Reddit comment', title: `QA3 Reddit Comment ${TS}`,
  desc: `QA3 desc comment ${TS}`,
  targetUrl: 'https://reddit.com/r/indonesia/comments/qa3',
  reward: 8000, slots: 3,
}));

// 4. Walk remaining admin pages (no mutations)
for (const route of ['/admin/approval', '/admin/payroll', '/admin/reddit-army', '/admin/accounts', '/admin/inbox']) {
  await step(page, 'walk ' + route, async () => {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const body = await page.evaluate(() => document.body.innerText);
    if (body.trim().length < 50) throw new Error('page appears blank');
    await page.screenshot({ path: `${OUT}/admin${route.replace(/\//g, '_')}.png` });
  });
}

// Broadcast page — verify loaded, DO NOT SEND
await step(page, 'walk /admin/broadcast (no send)', async () => {
  await page.goto(BASE + '/admin/broadcast', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  if (body.trim().length < 50) throw new Error('broadcast page blank');
});
// Secrets page — verify masked
await step(page, 'walk /admin/secrets (masked?)', async () => {
  await page.goto(BASE + '/admin/secrets', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  if (body.trim().length < 50) throw new Error('secrets page blank');
  await page.screenshot({ path: `${OUT}/admin-secrets.png` });
});
// WaBot page
await step(page, 'walk /admin/wa-bot', async () => {
  await page.goto(BASE + '/admin/wa-bot', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText);
  if (body.trim().length < 50) throw new Error('wa-bot page blank');
});

writeFileSync('qa-probes/qa3-gate0-admin.json', JSON.stringify(results, null, 2));
console.log('\nMEMBER_EMAIL=' + MEMBER.email);
console.log('MEMBER_PASS=' + MEMBER.password);
console.log('DONE → qa3-gate0-admin.json');
await browser.close();
