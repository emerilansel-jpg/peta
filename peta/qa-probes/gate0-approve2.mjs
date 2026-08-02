// GATE 0 — approve the QA assignment + verify member saldo
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
const OUT = 'qa-probes/artifacts/tasklife';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 300)); };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console-err:', m.text().slice(0, 150)); });
  page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 150)));
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

const admin = await newPage();
await login(admin, ADMIN_EMAIL, ADMIN_PASS);
await admin.goto(BASE + '/admin/approval', { waitUntil: 'networkidle' });
await admin.waitForTimeout(3500);
const body = await admin.evaluate(() => document.body.innerText);
step('queue', { hasQA: body.includes('QA Test Task'), sample: body.slice(0, 400) });
await admin.screenshot({ path: `${OUT}/14-approval2.png` });

const approveBtn = admin.locator('button[title="Approve"]:visible').first();
const count = await approveBtn.count();
step('approve-btn', { count });
if (count > 0) {
  await approveBtn.click();
  await admin.waitForTimeout(3000);
  await admin.screenshot({ path: `${OUT}/15-approved2.png` });
  const after = await admin.evaluate(() => document.body.innerText.slice(0, 500));
  step('after-click', { text: after.slice(0, 250) });
}
await admin.close();

const m2 = await newPage();
await login(m2, MEMBER_EMAIL, MEMBER_PASS);
await m2.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await m2.waitForTimeout(2500);
const earn = await m2.evaluate(() => document.body.innerText.slice(0, 1500));
step('member-earnings', { text: earn.slice(0, 600) });
await m2.screenshot({ path: `${OUT}/16-earnings2.png` });
await m2.close();

writeFileSync('qa-probes/gate0-approve2.json', JSON.stringify(log, null, 2));
await browser.close();
