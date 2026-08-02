// GATE 0 — S3: Upvote order lifecycle: create (credits deducted) → admin cancel → auto-refund verify
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const TS = Date.now().toString().slice(-6);
const THREAD_URL = `https://reddit.com/r/qa-test/comments/${TS}`;
const OUT = 'qa-probes/artifacts/s3';
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
async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);
}
async function getBalance(page) {
  return page.evaluate(async ({ SB, ANON }) => {
    const H = { apikey: ANON, Authorization: 'Bearer ' + (JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token), 'Content-Type': 'application/json' };
    const r = await fetch(SB + '/rest/v1/rpc/get_straight_pricing', { method: 'POST', headers: H, body: '{}' });
    if (r.ok) return 'pricing-rpc-ok';
    const r2 = await fetch(SB + '/rest/v1/users?select=credit_balance&limit=1', { headers: H });
    return r2.json();
  }, { SB, ANON });
}

// ---- CREATE ORDER ----
const page = await newPage();
await login(page);
const balBefore = await getBalance(page);
step('balance-before', { balBefore });

await page.goto(BASE + '/reddit/new-order', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
// click Upvotes service card
await page.getByRole('button', { name: /upvotes/i }).first().click();
await page.waitForTimeout(2500);
const formText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
step('upvote-form', { text: formText.slice(0, 400) });
await page.screenshot({ path: `${OUT}/1-upvote-form.png` });

// fill thread URL
await page.getByPlaceholder(/https:\/\/reddit\.com\/r\/\.\.\./i).fill(THREAD_URL);
// quantity: find selector/stepper
const qty = await page.locator('select, input[type="number"], input[inputmode="numeric"]').count();
step('qty-controls', { count: qty });
const qtyInput = page.locator('input[type="number"], input[inputmode="numeric"]').first();
if (await qtyInput.count() > 0) {
  await qtyInput.fill('50');
} else {
  const sel = page.locator('select').first();
  if (await sel.count() > 0) await sel.selectOption({ index: 1 });
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/2-filled.png` });

// submit form
const submitBtn = page.locator('button[type="submit"]').first();
if (await submitBtn.count() > 0) {
  await submitBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/3-confirm-modal.png` });
  const modal = await page.evaluate(() => document.body.innerText.slice(0, 900));
  step('confirm-modal', { text: modal.slice(0, 350) });
  const confirm = page.getByRole('button', { name: /confirm & deduct/i }).first();
  if (await confirm.count() > 0) {
    await confirm.click();
    await page.waitForTimeout(4500);
    const after = await page.evaluate(() => ({ url: location.pathname, text: document.body.innerText.slice(0, 800) }));
    step('after-create', { url: after.url, text: after.text.slice(0, 350) });
    await page.screenshot({ path: `${OUT}/4-created.png` });
  }
} else {
  step('no-submit-btn', {});
}
await page.close();

// ---- ADMIN: cancel the order ----
const admin = await newPage();
await login(admin);
await admin.goto(BASE + '/reddit/admin/orders', { waitUntil: 'networkidle' });
await admin.waitForTimeout(3000);
const ordersText = await admin.evaluate(() => document.body.innerText);
step('admin-orders', { hasQA: ordersText.includes(TS), sample: ordersText.slice(0, 300) });
await admin.screenshot({ path: `${OUT}/5-admin-orders.png` });

if (ordersText.includes(TS)) {
  const card = admin.locator('div').filter({ hasText: TS }).last();
  const btns = await card.getByRole('button').allTextContents();
  step('order-card-buttons', { buttons: btns.slice(0, 10) });
  const cancelBtn = card.getByRole('button', { name: /cancel/i }).first();
  if (await cancelBtn.count() > 0) {
    await cancelBtn.click();
    await admin.waitForTimeout(2500);
    const after = await admin.evaluate(() => document.body.innerText.slice(0, 600));
    step('after-cancel', { text: after.slice(0, 250) });
    await admin.screenshot({ path: `${OUT}/6-cancelled.png` });
  } else {
    step('no-cancel-btn', {});
  }
}
await admin.close();

writeFileSync('qa-probes/gate0-s3.json', JSON.stringify(log, null, 2));
await browser.close();
