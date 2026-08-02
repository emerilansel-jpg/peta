// QA2 — GATE 0: Email flow verification (detail)
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

// Capture network responses for the edge function
const edgeResponses = [];
page.on('response', async (r) => {
  if (r.url().includes('functions/v1/send-password-reset-email')) {
    const body = await r.text().catch(() => '');
    edgeResponses.push({ status: r.status(), body: body.slice(0, 200) });
  }
});

await page.goto(BASE + '/forgot-password', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

// Use admin email (exists in DB)
await page.getByPlaceholder('kamu@email.com').fill('info@jetdigitalpro.com');
await page.getByRole('button', { name: /kirim/i }).first().click();

// Wait longer for the edge function roundtrip
await page.waitForTimeout(8000);

const after = await page.evaluate(() => ({
  url: location.pathname,
  text: document.body.innerText.slice(0, 600),
  toasts: [...document.querySelectorAll('[class*="toast"], [role="status"]')].map((e) => e.textContent).slice(0, 5),
}));

step('after-submit', after);
step('edge-responses', { edgeResponses });

writeFileSync('qa-probes/qa2-gate0-email2.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Email detail test complete');
