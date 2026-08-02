// QA3 Gate 0 — Phase F2: SaaS signup (defensive) + authed walk
import { chromium } from 'playwright';
import { save, STRAIGHT_URL, TS } from './qa3-lib.mjs';

const out = {};
const email = `qa3-saas-${TS}@straight.ltd`;
out.email = email;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.setDefaultTimeout(15000);
let errs = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 150)));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace('https://yorlsgzsawchpeeazcvi.supabase.co', 'SB').slice(0, 100)}`); });

// ---- signup ----
await page.goto(STRAIGHT_URL + '/reddit/signup', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('input[type="text"]').fill('QA3 SaaS User');
await page.locator('input[type="email"]').fill(email);
await page.locator('input[type="url"]').fill('https://example.com');
await page.locator('input[type="password"]').fill('Qa3Saas#2026!');
const cb = page.locator('input[type="checkbox"]').first();
if (await cb.count()) await cb.check();
await page.getByRole('button', { name: /create account/i }).first().click();
await page.waitForTimeout(6000);
out.afterSignup = { url: page.url().replace(STRAIGHT_URL, ''), errors: [...new Set(errs)].slice(0, 5), failed: [...new Set(failed)].slice(0, 5) };
await page.screenshot({ path: 'qa-probes/qa3-artifacts/straight-after-signup.png' });
const bodyText = await page.locator('body').innerText();
out.signupResultText = bodyText.slice(0, 300);

// ---- authed walk (defensive: domcontentloaded + fixed waits) ----
const routes = ['/reddit/dashboard', '/reddit/topup', '/reddit/new-order', '/reddit/orders', '/reddit/reviews', '/reddit/feature-requests'];
for (const route of routes) {
  errs = []; failed = [];
  try {
    await page.goto(STRAIGHT_URL + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    const text = await page.locator('body').innerText();
    out[route] = {
      url: page.url().replace(STRAIGHT_URL, ''),
      errors: [...new Set(errs)].slice(0, 4),
      failed: [...new Set(failed)].slice(0, 5),
      hasPaypal: /paypal/i.test(text),
      hasSandbox: /sandbox/i.test(text),
      textSample: text.slice(0, 350),
    };
  } catch (e) { out[route] = { error: String(e).slice(0, 150) }; }
}

// ---- waitlist submit + feature request submit ----
try {
  await page.goto(STRAIGHT_URL + '/reddit/waitlist', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  const wInputs = await page.locator('input').evaluateAll(es => es.map(e => ({ t: e.type, ph: e.placeholder })));
  out.waitlistInputs = wInputs;
  const wEmail = page.locator('input[type="email"]').first();
  if (await wEmail.count()) {
    await wEmail.fill(`qa3-wl-${TS}@straight.ltd`);
    const wBtn = page.getByRole('button').first();
    await wBtn.click();
    await page.waitForTimeout(2500);
    out.waitlistSubmit = { text: (await page.locator('body').innerText()).slice(0, 250), errors: [...new Set(errs)].slice(0, 3) };
  }
} catch (e) { out.waitlist = { error: String(e).slice(0, 150) }; }

await browser.close();
save('qa3-g0-straight-authed.json', out);
console.log(JSON.stringify(out, null, 2));
