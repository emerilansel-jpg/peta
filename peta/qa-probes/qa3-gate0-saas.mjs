// QA3 GATE 0 — SaaS (straight.ltd) flows: landing, topup PayPal mode, new-order, reviews, waitlist, feature requests, contact.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

const STRAIGHT = 'https://www.straight.ltd';
const adminState = JSON.parse(readFileSync('qa-probes/qa3-gate0-admin.json', 'utf8'));
const MEMBER = adminState.member;
const OUT = 'qa-probes/artifacts/qa3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = { steps: [] };
async function step(page, name, fn) {
  const errors = [];
  const onErr = (m) => errors.push(m.text().slice(0, 160));
  const onPageErr = (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160));
  const onFailed = (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().slice(0, 100)}`); };
  page.on('console', onErr); page.on('pageerror', onPageErr); page.on('response', onFailed);
  try { await fn(); } catch (e) { errors.push('EXC: ' + e.message.slice(0, 220)); }
  page.removeListener('console', onErr); page.removeListener('pageerror', onPageErr); page.removeListener('response', onFailed);
  results.steps.push({ name, errors: errors.slice(0, 6) });
  console.log(`[${errors.length ? 'WARN' : ' OK '}] ${name}${errors.length ? '\n    → ' + errors.slice(0, 3).join('\n    → ') : ''}`);
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// 1. Landing + redirect
await step(page, 'landing-redirect', async () => {
  await page.goto(STRAIGHT + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  results.landingUrl = page.url().replace(STRAIGHT, '');
  await page.screenshot({ path: `${OUT}/saas-landing.png` });
});

// 2. Topup — PayPal mode
await step(page, 'topup-paypal-mode', async () => {
  await page.goto(STRAIGHT + '/reddit/topup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // capture loaded scripts
  const scripts = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map(s => s.src));
  const paypal = scripts.filter(s => s.includes('paypal'));
  results.paypalScripts = paypal;
  results.paypalMode = paypal.some(s => s.includes('sandbox')) ? 'SANDBOX' : paypal.some(s => s.includes('www.paypal.com')) ? 'LIVE' : 'none';
  const body = await page.evaluate(() => document.body.innerText);
  results.topupSample = body.slice(0, 600);
  await page.screenshot({ path: `${OUT}/saas-topup.png` });
});

// 3. New order — service status matrix
await step(page, 'new-order-services', async () => {
  await page.goto(STRAIGHT + '/reddit/new-order', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.body.innerText);
  results.orderSample = body.slice(0, 1200);
  results.serviceMarkers = {
    redditUpvote: /reddit upvote/i.test(body),
    forum: /forum/i.test(body),
    youtube: /youtube/i.test(body),
    unavailable: /unavailable|off|tidak tersedia|sold out/i.test(body),
  };
  await page.screenshot({ path: `${OUT}/saas-new-order.png` });
});

// 4. Reviews + waitlist + feature requests + contact (public-adjacent)
await step(page, 'reviews-page', async () => {
  await page.goto(STRAIGHT + '/reddit/reviews', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  results.reviewsSample = (await page.evaluate(() => document.body.innerText)).slice(0, 400);
});
await step(page, 'waitlist-page', async () => {
  await page.goto(STRAIGHT + '/reddit/waitlist', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.waitlistForm = /daftar|join|waitlist|email/i.test(body);
});
await step(page, 'feature-requests-page', async () => {
  await page.goto(STRAIGHT + '/reddit/feature-requests', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  results.featureRequestsSample = (await page.evaluate(() => document.body.innerText)).slice(0, 300);
});
await step(page, 'contact-page', async () => {
  await page.goto(STRAIGHT + '/reddit/contact', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.contactHasForm = /kirim|submit|ticket|bantuan/i.test(body);
  await page.screenshot({ path: `${OUT}/saas-contact.png` });
});

// 5. SaaS dashboard with member account (same Supabase auth)
await step(page, 'saas-login-member', async () => {
  await page.goto(STRAIGHT + '/reddit/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  // same auth backend — try member creds
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  await emailInput.fill(MEMBER.email);
  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(MEMBER.password);
  const btn = page.getByRole('button', { name: /masuk|login|sign in/i }).first();
  await btn.click();
  await page.waitForTimeout(4500);
  results.saasLoginUrl = page.url().replace(STRAIGHT, '');
  await page.screenshot({ path: `${OUT}/saas-after-login.png` });
});

// 6. Tickets (dashboard)
await step(page, 'saas-tickets', async () => {
  await page.goto(STRAIGHT + '/reddit/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  results.dashboardSample = body.slice(0, 500);
  const ticketLinks = await page.locator('a[href*="ticket"]').count().catch(() => 0);
  results.ticketLinks = ticketLinks;
  await page.screenshot({ path: `${OUT}/saas-dashboard.png` });
});

writeFileSync('qa-probes/qa3-gate0-saas.json', JSON.stringify(results, null, 2));
console.log('\nDONE → qa3-gate0-saas.json');
await browser.close();
