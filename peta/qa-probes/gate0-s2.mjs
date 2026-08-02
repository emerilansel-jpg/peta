// GATE 0 — S2: (a) withdraw button error state at <20K, (b) admin credit balance
// (c) topup page PayPal mode, (d) new-order page structure
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
const OUT = 'qa-probes/artifacts/s2';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 300)); };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console-err:', m.text().slice(0, 160)); });
  page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 160)));
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

// ---- (a) member: withdraw at 8K ----
const member = await newPage();
await login(member, MEMBER_EMAIL, MEMBER_PASS);
await member.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await member.waitForTimeout(2000);
const btns = await member.getByRole('button').allTextContents();
step('earnings-buttons', { buttons: btns.slice(0, 8) });
const tarik = member.getByRole('button', { name: /tarik/i }).first();
if (await tarik.count() > 0 && await tarik.isVisible().catch(() => false)) {
  await tarik.click();
  await member.waitForTimeout(2000);
  const after = await member.evaluate(() => document.body.innerText.slice(0, 600));
  step('after-tarik-click', { text: after.slice(0, 250) });
  await member.screenshot({ path: `${OUT}/a-withdraw-error.png` });
} else {
  step('tarik-not-visible', {});
}
await member.close();

// ---- (b+c+d) admin: credit balance, topup page, new-order page ----
const admin = await newPage();
await login(admin, ADMIN_EMAIL, ADMIN_PASS);

// credit balance via REST (in-page)
const bal = await admin.evaluate(async ({ SB, ANON }) => {
  const H = { apikey: ANON, Authorization: 'Bearer ' + (JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token), 'Content-Type': 'application/json' };
  const r = await fetch(SB + '/rest/v1/users?select=id,email,role,credit_balance', { headers: H });
  return r.json();
}, { SB, ANON });
step('admin-credit-balance', { users: bal.slice(0, 5) });

await admin.goto(BASE + '/reddit/topup', { waitUntil: 'networkidle' });
await admin.waitForTimeout(3000);
const topupText = await admin.evaluate(() => document.body.innerText.slice(0, 1500));
const paypalScripts = await admin.evaluate(() => [...document.querySelectorAll('script[src*="paypal"]')].map((s) => s.getAttribute('src')));
step('topup', { text: topupText.slice(0, 350), paypalScripts });
await admin.screenshot({ path: `${OUT}/b-topup.png` });

await admin.goto(BASE + '/reddit/new-order', { waitUntil: 'networkidle' });
await admin.waitForTimeout(3000);
const orderText = await admin.evaluate(() => document.body.innerText.slice(0, 1600));
step('new-order', { text: orderText.slice(0, 450) });
await admin.screenshot({ path: `${OUT}/c-new-order.png` });
await admin.close();

writeFileSync('qa-probes/gate0-s2.json', JSON.stringify(log, null, 2));
await browser.close();
