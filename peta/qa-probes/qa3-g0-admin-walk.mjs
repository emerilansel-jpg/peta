// QA3 Gate 0 — Phase D: payout eligibility UI (m1) + admin console walk
import { chromium } from 'playwright';
import { save } from './qa3-lib.mjs';
import { readFileSync, mkdirSync } from 'fs';

const members = JSON.parse(readFileSync('qa-probes/qa3-members.json', 'utf8'));
const ART = 'qa-probes/qa3-artifacts/admin';
mkdirSync(ART, { recursive: true });
const out = { payout: {}, admin: {} };
const browser = await chromium.launch();

// ============ PART 1: payout eligibility UI for m1 ============
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 150)));
await page.goto('https://www.penghasilantambahan.com/login', { waitUntil: 'networkidle' });
await page.getByPlaceholder(/kamu@email\.com|0812xxxx/).fill(members.m1.email);
await page.getByPlaceholder('••••••••').fill(members.m1.password);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);
await page.goto('https://www.penghasilantambahan.com/earnings', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const earningsText = await page.locator('body').innerText();
out.payout.text = earningsText.slice(0, 1800);
out.payout.hasSaldo5k = /Rp5\.000/.test(earningsText);
out.payout.payoutSection = /Request|Cair|minimum|belum|cukup/i.test(earningsText);
await page.screenshot({ path: `${ART}/m1-earnings.png` });
errs = [];
await browser.close();

// ============ PART 2: admin console walk ============
const browser2 = await chromium.launch();
const adminPage = await (await browser2.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let aErrs = [], aFailed = [];
adminPage.on('console', (m) => { if (m.type() === 'error') aErrs.push(m.text().slice(0, 150)); });
adminPage.on('pageerror', (e) => aErrs.push('PAGEERROR: ' + e.message.slice(0, 150)));
adminPage.on('response', (r) => { if (r.status() >= 400) aFailed.push(`${r.status()} ${r.url().replace('https://yorlsgzsawchpeeazcvi.supabase.co', 'SB').slice(0, 100)}`); });
await adminPage.goto('https://www.penghasilantambahan.com/login', { waitUntil: 'networkidle' });
await adminPage.getByPlaceholder(/kamu@email\.com|0812xxxx/).fill('info@jetdigitalpro.com');
await adminPage.getByPlaceholder('••••••••').fill('peta');
await adminPage.getByRole('button', { name: /masuk|login/i }).first().click();
await adminPage.waitForTimeout(4500);
const adminRoutes = [
  ['/admin', 'dashboard'],
  ['/admin/tasks', 'taskqueue'],
  ['/admin/approval', 'approval'],
  ['/admin/accounts', 'reddit-accounts'],
  ['/admin/broadcast', 'broadcast'],
  ['/admin/wa-bot', 'wa-bot'],
  ['/admin/inbox', 'inbox'],
  ['/admin/secrets', 'secrets'],
  ['/admin/team', 'team'],
  ['/admin/payroll', 'payroll'],
  ['/admin/reddit-army', 'reddit-army'],
];
for (const [route, name] of adminRoutes) {
  aErrs = []; aFailed = [];
  try {
    await adminPage.goto('https://www.penghasilantambahan.com' + route, { waitUntil: 'networkidle', timeout: 40000 });
    await adminPage.waitForTimeout(1200);
    out.admin[name] = {
      url: adminPage.url().replace('https://www.penghasilantambahan.com', ''),
      errors: [...new Set(aErrs)].slice(0, 4),
      failed: [...new Set(aFailed)].slice(0, 5),
      textSample: (await adminPage.locator('body').innerText()).slice(0, 350),
    };
    await adminPage.screenshot({ path: `${ART}/admin-${name}.png` });
  } catch (e) {
    out.admin[name] = { error: String(e).slice(0, 200) };
  }
}

save('qa3-g0-admin-walk.json', out);
console.log(JSON.stringify({ payout: { hasSaldo5k: out.payout.hasSaldo5k, payoutSection: out.payout.payoutSection }, admin: Object.fromEntries(Object.entries(out.admin).map(([k, v]) => [k, { url: v.url, errors: v.errors, failed: v.failed, hasText: !!(v.textSample ?? v.error) }])) }, null, 2));
