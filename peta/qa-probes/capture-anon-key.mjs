// Capture FULL apikey header from app requests + test it from Node with Origin
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';

const browser = await chromium.launch();
const page = await browser.newPage();
const apikeys = new Set();
page.on('request', (r) => {
  if (/supabase\.co/.test(r.url())) apikeys.add((r.headers()['apikey'] || '').trim());
});
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
console.log('KEYS SEEN:', [...apikeys]);
const key = [...apikeys][0];
writeFileSync('qa-probes/prod-anon-key.txt', key);

// test from Node with browser-like Origin
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const r = await fetch(SB + '/rest/v1/users?select=id&limit=1', {
  headers: { apikey: key, Authorization: 'Bearer ' + key, Origin: 'https://www.penghasilantambahan.com', 'Accept': 'application/json' },
});
console.log('Node fetch with Origin:', r.status, (await r.text()).slice(0, 150));
await browser.close();
