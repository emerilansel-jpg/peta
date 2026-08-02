// GATE 1 — verify whether the member's UPDATE actually modified another user's row
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const OTHER_IDS = ['3c7b5940-5484-4d3d-a929-2f510faf6fca', 'b62c1231-802b-4b32-9210-28eae1cc1812'];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);

const out = await page.evaluate(async ({ SB, ANON, OTHER_IDS }) => {
  const tok = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token;
  const H = { apikey: ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const res = {};
  for (const id of OTHER_IDS) {
    const r = await fetch(SB + '/rest/v1/users?select=id,email,full_name,updated_at&id=eq.' + id, { headers: H });
    res[id.slice(0, 8)] = await r.json();
  }
  return res;
}, { SB, ANON, OTHER_IDS });

console.log(JSON.stringify(out, null, 2));
writeFileSync('qa-probes/gate1-verify-update.json', JSON.stringify(out, null, 2));
await browser.close();
