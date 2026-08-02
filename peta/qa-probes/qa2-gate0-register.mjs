// QA2 — GATE 0: E2E Register → Onboarding → Verify bonus behavior
// Test: new user register, walk onboarding, verify founding cap enforcement
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

// 1. Register new test user
const ts = Date.now().toString().slice(-8);
const email = `qa2-test-${ts}@penghasilantambahan.com`;
const password = 'Qa2Test#2026';

await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

await page.getByPlaceholder('Nama kamu').fill('QA2 Test User');
await page.getByPlaceholder('kamu@email.com').fill(email);
await page.getByPlaceholder('08xxxxxxxxxx').fill(`0812345${ts}`);
await page.getByPlaceholder('Minimal 6 karakter').fill(password);

await page.getByRole('button', { name: /daftar|register/i }).first().click();
await page.waitForTimeout(5000);

const afterRegister = await page.evaluate(() => ({
  url: location.pathname,
  title: document.title,
  text: document.body.innerText.slice(0, 400),
}));
step('after-register', afterRegister);

// 2. Onboarding flow (6 steps)
const steps = [
  { click: 'Mulai', wait: 2000 },
  { click: 'Gabung Grup', wait: 3000 },
  { click: 'Download WARP', wait: 3000 },
  { click: 'Buat Akun Reddit', wait: 3000 },
  { click: 'Skip', wait: 2000 }, // skip Reddit URL
  { click: 'Mulai Earn', wait: 3000 },
];

for (let i = 0; i < steps.length; i++) {
  try {
    const btn = page.getByRole('button', { name: new RegExp(steps[i].click, 'i') });
    if (await btn.count() > 0) {
      await btn.first().click();
      await page.waitForTimeout(steps[i].wait);
    }
  } catch (e) {
    step(`onboarding-step-${i+1}-error`, { error: e.message.slice(0, 150) });
  }
}

const afterOnboarding = await page.evaluate(() => ({
  url: location.pathname,
  text: document.body.innerText.slice(0, 500),
}));
step('after-onboarding', afterOnboarding);

// 3. Check earnings (should be 0 due to founding cap)
await page.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const earnings = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    text: text.slice(0, 600),
    balance: text.match(/Rp\s*([\d.,]+)/)?.[1] || '0',
    hasBonus: text.toLowerCase().includes('bonus'),
  };
});
step('earnings-after-onboarding', earnings);

// 4. Verify via API: check user_credits for this user
const token = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
  const session = JSON.parse(localStorage.getItem(k) || '{}');
  return session?.access_token || null;
});

if (token) {
  const credits = await page.evaluate(async (token) => {
    const H = { apikey: 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const resp = await fetch('https://yorlsgzsawchpeeazcvi.supabase.co/rest/v1/user_credits?select=source,amount&order=created_at.desc&limit=10', { headers: H });
    return resp.json();
  }, token);
  step('user-credits-api', { credits });
}

writeFileSync('qa-probes/qa2-gate0-register.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('E2E register flow complete');
