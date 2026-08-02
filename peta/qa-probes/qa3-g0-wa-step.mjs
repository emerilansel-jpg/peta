import { chromium } from 'playwright';
import { signIn, rpc, mgmt } from './qa3-lib.mjs';
// 1. edge function status via mgmt API
const fns = await mgmt('/projects/yorlsgzsawchpeeazcvi/functions');
console.log('FUNCTIONS:', fns.status, JSON.stringify((fns.body||[]).map(f => ({ slug: f.slug, status: f.status, verify_jwt: f.verify_jwt }))));
// 2. onboarding step 2 buttons
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto('https://www.penghasilantambahan.com/login', { waitUntil: 'networkidle' });
await page.getByPlaceholder(/kamu@email\.com|0812xxxx/).fill('qa3-reg-53679060@gmail.com');
await page.getByPlaceholder('••••••••').fill('Qa3Reg#2026!');
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4500);
console.log('URL after login:', page.url());
// landing on onboarding step?
const btns = await page.getByRole('button').allTextContents();
console.log('ALL BUTTONS:', JSON.stringify(btns.map(b => b.trim().slice(0, 40))));
const body = (await page.locator('body').innerText()).slice(0, 400);
console.log('BODY:', body);
await browser.close();
