// QA2 — GATE 0: Email flow verification
// Test forgot password → verify email sent (check Resend logs via API or SMTP logs)
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

// 1. Forgot password flow
await page.goto(BASE + '/forgot-password', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

await page.getByPlaceholder('kamu@email.com').fill('info@jetdigitalpro.com');
await page.getByRole('button', { name: /kirim|send/i }).first().click();
await page.waitForTimeout(5000);

const afterForgot = await page.evaluate(() => ({
  url: location.pathname,
  text: document.body.innerText.slice(0, 500),
  hasSuccess: document.body.innerText.toLowerCase().includes('link reset') || document.body.innerText.toLowerCase().includes('email terkirim'),
}));
step('forgot-password-flow', afterForgot);

// 2. Check network requests for edge function call
const edgeFunctionCalls = [];
page.on('request', (req) => {
  if (req.url().includes('functions/v1/send-password-reset-email')) {
    edgeFunctionCalls.push({ url: req.url(), method: req.method() });
  }
});

await page.goto(BASE + '/forgot-password', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.getByPlaceholder('kamu@email.com').fill('test@jetdigitalpro.com');
await page.getByRole('button', { name: /kirim|send/i }).first().click();
await page.waitForTimeout(3000);

step('edge-function-calls', { count: edgeFunctionCalls.length, calls: edgeFunctionCalls });

writeFileSync('qa-probes/qa2-gate0-email.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Email flow test complete');
