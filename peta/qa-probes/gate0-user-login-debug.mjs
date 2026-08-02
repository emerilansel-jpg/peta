// Debug: capture exact Supabase requests during member login + extract anon key
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const USER_LOGIN = '0882001723410';
const USER_PASS = '@Lastalone99';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const calls = [];

page.on('request', (r) => {
  const u = r.url();
  if (/supabase\.co/.test(u)) {
    calls.push({
      req: r.method() + ' ' + u.replace(/https:\/\/[a-z0-9]+\.supabase\.co/, 'SB').slice(0, 180),
      apikey: (r.headers()['apikey'] || '').slice(0, 40),
    });
  }
});
page.on('response', async (r) => {
  const u = r.url();
  if (/supabase\.co/.test(u) && r.status() >= 400) {
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch {}
    calls.push({ resp: r.status() + ' ' + u.replace(/https:\/\/[a-z0-9]+\.supabase\.co/, 'SB').slice(0, 180), body });
  }
});

await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(USER_LOGIN);
await page.locator('input[type="password"]').first().fill(USER_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(5000);

// toast text
const toastText = await page.evaluate(() => document.body.innerText.includes('salah') || document.body.innerText.slice(0, 600));
console.log('FINAL URL:', page.url());
console.log('TOAST/visible:', JSON.stringify(toastText).slice(0, 500));
console.log('CALLS:');
for (const c of calls) console.log(JSON.stringify(c));
writeFileSync('qa-probes/gate0-user-login-debug.json', JSON.stringify(calls, null, 2));
await browser.close();
