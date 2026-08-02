// GATE 0 — Phase D: full onboarding walk with correct checkbox interaction.
// Fresh member via register, then complete all 6 steps, verify credits.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const TS = Date.now().toString().slice(-8);
const MEMBER = {
  name: 'QA Onboarding Test',
  email: `qa-obo-${TS}@penghasilantambahan.com`,
  password: 'QaTest#2026!',
  whatsapp: `0857${TS}000`,
};
const OUT = 'qa-probes/artifacts/onboarding';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const results = [];
let lastErrors = [], lastFailed = [];
page.on('console', (m) => { if (m.type() === 'error') lastErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => lastErrors.push('PAGEERROR: ' + e.message.slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 400) lastFailed.push(`${r.status()} ${r.url().slice(0, 130)}`); });

async function stepState(label) {
  const st = await page.evaluate(() => {
    const h2 = document.querySelector('h2')?.textContent?.trim() || '';
    const stepLabel = [...document.querySelectorAll('div')].find((d) => /^Step \d/.test(d.textContent?.trim() || ''))?.textContent?.trim() || '';
    return { h2: h2.slice(0, 60), stepLabel, bodyLen: document.body.innerText.length };
  });
  results.push({ label, ...st, errors: [...new Set(lastErrors)].slice(0, 3), failed: [...new Set(lastFailed)].slice(0, 4) });
  lastErrors = []; lastFailed = [];
  await page.screenshot({ path: `${OUT}/${label.replace(/\s+/g, '_')}.png` });
}

// ---- REGISTER ----
await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);
await page.getByPlaceholder('Nama kamu').fill(MEMBER.name);
await page.getByPlaceholder('kamu@email.com').fill(MEMBER.email);
await page.getByPlaceholder('08xxxxxxxxxx').fill(MEMBER.whatsapp);
await page.locator('input[type="password"]').fill(MEMBER.password);
await page.getByRole('button', { name: /daftar|buat akun|join/i }).first().click();
await page.waitForTimeout(5000);
results.push({ label: 'after-register', url: page.url().replace(BASE, '') });

if (!page.url().includes('/onboarding')) {
  console.log('FATAL: did not land on onboarding:', page.url());
  process.exit(1);
}

// Step 1: claim signup bonus
await page.getByRole('button', { name: /Klaim Bonus Rp25/i }).click();
await page.waitForTimeout(2500);
await stepState('step1-claimed');

// Step 2: WA group — check checkbox + continue
await page.locator('#step-2').check();
await page.getByRole('button', { name: /Sudah Gabung/i }).click();
await page.waitForTimeout(2500);
await stepState('step2-wa-group');

// Step 3: WARP — check checkbox + continue
await page.locator('#step-3').check();
await page.getByRole('button', { name: /Lanjut|selesai|Sudah|ya/i }).first().click();
await page.waitForTimeout(2500);
await stepState('step3-warp');

// Step 4: Reddit account — check checkbox (have account) + continue
const btn4 = await page.getByRole('button').allTextContents();
const hasCb = (await page.locator('#step-4').count()) > 0;
if (hasCb) await page.locator('#step-4').check();
await page.getByRole('button', { name: /Lanjut|ya, punya|punya akun/i }).first().click();
await page.waitForTimeout(2500);
await stepState('step4-reddit-account');

// Step 5: Reddit URL — fill username + submit
const urlInput = await page.locator('input[type="url"], input[type="text"]').count();
const bodyTxt = await page.evaluate(() => document.body.innerText);
if (/reddit\.com\/user/i.test(bodyTxt) || urlInput > 0) {
  const input = page.locator('input').last();
  await input.fill(`https://www.reddit.com/user/qa_test_${TS}`);
  await page.getByRole('button', { name: /Lanjut|simpan|tambahkan|cek/i }).first().click();
  await page.waitForTimeout(3500);
  await stepState('step5-reddit-url');
} else {
  results.push({ label: 'step5-skipped', reason: 'no url input found', body: bodyTxt.slice(0, 200) });
}

// Step 6: Mulai Earn
const btn6 = await page.getByRole('button').allTextContents();
results.push({ label: 'step6-buttons', buttons: btn6.slice(0, 8) });
await page.getByRole('button', { name: /Mulai Earn|Mulai|selesai/i }).first().click();
await page.waitForTimeout(3500);
results.push({ label: 'after-onboarding', url: page.url().replace(BASE, '') });

// ---- VERIFY: earnings/account shows balance ----
await page.goto(BASE + '/earnings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const earnings = await page.evaluate(() => document.body.innerText.slice(0, 900));
results.push({ label: 'earnings-after-onboarding', text: earnings });

writeFileSync('qa-probes/gate0-onboarding-e2e.json', JSON.stringify({ member: MEMBER, results }, null, 2));
for (const r of results) console.log(JSON.stringify(r).slice(0, 400));
await browser.close();
