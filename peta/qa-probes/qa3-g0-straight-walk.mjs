// QA3 Gate 0 — Phase E: SaaS straight.ltd walk (public + authed routes)
import { chromium } from 'playwright';
import { save, STRAIGHT_URL } from './qa3-lib.mjs';

const out = {};
const browser = await chromium.launch();
// ---- public routes ----
const pub = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let errs = [], failed = [];
pub.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
pub.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 150)));
pub.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`); });

const publicRoutes = ['/', '/reddit/login', '/reddit/register', '/reddit/waitlist', '/reddit/topup', '/reddit/new-order', '/reddit/reviews', '/reddit/tickets', '/reddit/feature-requests', '/reddit/pricing', '/reddit/orders', '/reddit/dashboard'];
for (const route of publicRoutes) {
  errs = []; failed = [];
  try {
    await pub.goto(STRAIGHT_URL + route, { waitUntil: 'networkidle', timeout: 35000 });
    await pub.waitForTimeout(1000);
    const text = await pub.locator('body').innerText();
    out[route] = {
      url: pub.url().replace(STRAIGHT_URL, ''),
      errors: [...new Set(errs)].slice(0, 4),
      failed: [...new Set(failed)].slice(0, 5),
      hasPaypal: /paypal/i.test(text),
      textSample: text.slice(0, 260),
    };
  } catch (e) { out[route] = { error: String(e).slice(0, 180) }; }
}

// ---- PayPal mode check on topup ----
await pub.goto(STRAIGHT_URL + '/reddit/topup', { waitUntil: 'networkidle', timeout: 35000 });
await pub.waitForTimeout(2500);
const topupText = await pub.locator('body').innerText();
out.topupPaypalMode = {
  hasSandbox: /sandbox/i.test(topupText),
  hasPaypalButton: /paypal/i.test(topupText),
  sample: topupText.slice(0, 500),
};
await pub.screenshot({ path: 'qa-probes/qa3-artifacts/straight-topup.png' });

// ---- new-order service status ----
await pub.goto(STRAIGHT_URL + '/reddit/new-order', { waitUntil: 'networkidle', timeout: 35000 });
await pub.waitForTimeout(2500);
const orderText = await pub.locator('body').innerText();
out.orderPage = { hasRedditService: /reddit/i.test(orderText), sample: orderText.slice(0, 700) };

await browser.close();
save('qa3-g0-straight-walk.json', out);
console.log(JSON.stringify(out, null, 2));
