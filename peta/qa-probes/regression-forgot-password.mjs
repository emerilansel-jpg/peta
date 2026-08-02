// Regression: forgot-password UI flow on prod after email fix
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 150)));

await page.goto(BASE + '/forgot-password', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input[type="email"]').first().fill('info@jetdigitalpro.com');
await page.getByRole('button', { name: /kirim link reset/i }).click();
await page.waitForTimeout(5000);
const text = await page.evaluate(() => document.body.innerText.slice(0, 700));
await page.screenshot({ path: 'qa-probes/artifacts/regression-forgot-password.png' });
console.log(JSON.stringify({ text: text.slice(0, 400), errors: errs.slice(0, 3) }, null, 2));
writeFileSync('qa-probes/regression-forgot-password.json', JSON.stringify({ text, errors: errs }, null, 2));
await browser.close();
