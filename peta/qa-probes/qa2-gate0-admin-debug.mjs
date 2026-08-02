// Debug admin login - capture screenshot, URL, console errors
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';

mkdirSync('qa-probes/screenshots', { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

page.on('pageerror', (err) => {
  consoleErrors.push(`PAGE ERROR: ${err.message}`);
});

console.log('Navigating to login...');
await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

await page.screenshot({ path: 'qa-probes/screenshots/admin-login-1-before.png' });

console.log('Filling form...');
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
await page.getByPlaceholder('••••••••').fill(ADMIN_PASS);

await page.screenshot({ path: 'qa-probes/screenshots/admin-login-2-filled.png' });

console.log('Clicking submit...');
await page.getByRole('button', { name: /masuk|login/i }).first().click();

console.log('Waiting for navigation...');
await page.waitForTimeout(5000);

await page.screenshot({ path: 'qa-probes/screenshots/admin-login-3-after.png' });

const currentUrl = page.url();
console.log('Current URL:', currentUrl);

// Check localStorage for session
const sessionData = await page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const sessionKeys = keys.filter(k => k.includes('sb-') || k.includes('supabase') || k.includes('auth'));
  const data = {};
  sessionKeys.forEach(k => {
    try {
      data[k] = localStorage.getItem(k);
    } catch (e) {
      data[k] = `ERROR: ${e.message}`;
    }
  });
  return { allKeys: keys, sessionKeys, data };
});

console.log('LocalStorage keys:', sessionData.allKeys.length);
console.log('Session-related keys:', sessionData.sessionKeys);

const token = await page.evaluate(() => {
  // Try multiple possible keys
  const possibleKeys = [
    'sb-peta-auth-token',
    'sb-duxzxizedtvnopfihllz-auth-token',
    'supabase.auth.token',
  ];
  
  for (const key of possibleKeys) {
    const val = localStorage.getItem(key);
    if (val) {
      try {
        const parsed = JSON.parse(val);
        if (parsed.access_token) return parsed.access_token;
      } catch (e) {}
    }
  }
  return null;
});

console.log('Token found:', !!token);

if (consoleErrors.length > 0) {
  console.log('Console errors:', consoleErrors);
}

writeFileSync('qa-probes/qa2-gate0-admin-debug.json', JSON.stringify({
  url: currentUrl,
  tokenFound: !!token,
  localStorage: sessionData,
  consoleErrors,
}, null, 2));

await browser.close();
