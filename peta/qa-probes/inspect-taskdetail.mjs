// Inspector: open task detail as member, dump buttons + walk the wizard manually
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const MEMBER_EMAIL = 'qa-obo-86644849@penghasilantambahan.com';
const MEMBER_PASS = 'QaTest#2026!';
const TASK_URL_ID = process.argv[2] || '210abad4-e4ff-474e-ac7c-1879322cc0c3';
const OUT = 'qa-probes/artifacts/taskdetail';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER_EMAIL);
await page.locator('input[type="password"]').first().fill(MEMBER_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);

await page.goto(BASE + '/task/' + TASK_URL_ID, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const dump = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  return { buttons: btns.slice(0, 20), body: document.body.innerText.slice(0, 1000) };
});
console.log('BUTTONS:', JSON.stringify(dump.buttons, null, 1));
console.log('BODY:', dump.body);
await page.screenshot({ path: `${OUT}/0-detail.png` });
await browser.close();
