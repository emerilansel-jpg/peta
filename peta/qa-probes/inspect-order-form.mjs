// Inspector: upvote order form state as admin
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);

await page.goto(BASE + '/reddit/new-order', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /upvotes/i }).first().click();
await page.waitForTimeout(3000);

const dump = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input, select, textarea, button')].map((el) => ({
    tag: el.tagName, type: el.type || '', placeholder: el.placeholder || '', value: el.value || '',
    disabled: el.disabled, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
  }));
  return { fields: inputs.slice(0, 30), body: document.body.innerText.slice(0, 900) };
});
console.log(JSON.stringify(dump.fields, null, 1));
console.log('BODY:', dump.body.slice(0, 600));
await browser.close();
