import { chromium } from 'playwright';
import { STRAIGHT_URL } from './qa3-lib.mjs';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let failed = [];
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`); });
await page.goto(STRAIGHT_URL + '/reddit', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// find Start free / Sign up links
const links = await page.locator('a').evaluateAll(els => els.map(e => ({ text: e.innerText.trim().slice(0, 30), href: e.getAttribute('href') })));
console.log('LINKS:', JSON.stringify(links.filter(l => /start|sign|register|free|topup|order|review|ticket|waitlist|feature/i.test(l.text + ' ' + (l.href || ''))).slice(0, 25), null, 1));
console.log('FAILED:', JSON.stringify([...new Set(failed)]));
// what does /reddit/register actually do?
await page.goto(STRAIGHT_URL + '/reddit/register', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('register URL →', page.url().replace(STRAIGHT_URL, ''), 'status ok');
await browser.close();
