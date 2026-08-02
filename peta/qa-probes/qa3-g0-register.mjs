// QA3 Gate 0 — Phase C: PUBLIC register → onboarding walk (founding cap)
import { chromium } from 'playwright';
import { save, PROD_URL, TS } from './qa3-lib.mjs';
import { mkdirSync } from 'fs';

const ART = 'qa-probes/qa3-artifacts/register';
mkdirSync(ART, { recursive: true });
const out = {};
const email = `qa3-reg-${TS}@gmail.com`;
const member = { name: 'QA3 Register User', email, whatsapp: `0857${TS.slice(-8)}`, password: 'Qa3Reg#2026!' };
out.member = member;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let errs = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 150)));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace('https://yorlsgzsawchpeeazcvi.supabase.co', 'SB').slice(0, 110)}`); });

// ---- REGISTER ----
await page.goto(PROD_URL + '/register', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForTimeout(800);
const regText = await page.locator('body').innerText();
out.registerPageHasReddit = /reddit/i.test(regText);
await page.getByPlaceholder(/nama/i).fill(member.name);
await page.getByPlaceholder(/kamu@email\.com|email/i).fill(member.email);
await page.getByPlaceholder(/08/i).fill(member.whatsapp);
await page.locator('input[type="password"]').fill(member.password);
await page.screenshot({ path: `${ART}/register-filled.png` });
await page.getByRole('button', { name: /daftar|buat akun|join/i }).first().click();
await page.waitForTimeout(6000);
out.afterRegister = { url: page.url().replace(PROD_URL, ''), errors: [...new Set(errs)].slice(0, 5), failed: [...new Set(failed)].slice(0, 6) };
await page.screenshot({ path: `${ART}/after-register.png` });

// ---- ONBOARDING WALK ----
const steps = [];
for (let i = 0; i < 8; i++) {
  const url = page.url().replace(PROD_URL, '');
  const text = (await page.locator('body').innerText()).slice(0, 700);
  const btns = await page.getByRole('button').allTextContents();
  const primary = btns.find((t) => /claim|klaim|lanjut|ambil|ya|buka|selesai|mulai|nanti|lewati|skip/i.test(t));
  steps.push({ i, url, text: text.slice(0, 250), primary: primary?.trim().slice(0, 40) });
  if (!primary || url.includes('/tasks')) break;
  try {
    await page.getByRole('button', { name: new RegExp(primary.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
  } catch { break; }
  await page.waitForTimeout(2500);
  if (page.url().includes('/tasks')) { await page.screenshot({ path: `${ART}/onboarding-done.png` }); break; }
}
out.onboardingSteps = steps;
out.onboardingErrors = [...new Set(errs)].slice(0, 5);
out.onboardingFailed = [...new Set(failed)].slice(0, 6);

// ---- TASKS PAGE after onboarding ----
await page.waitForTimeout(1000);
out.tasksUrl = page.url().replace(PROD_URL, '');
const tasksText = await page.locator('body').innerText();
out.foundingCapVisible = /founding|penuh/i.test(tasksText);
out.saldoRp0 = /Rp0/.test(tasksText);
out.tasksTextSample = tasksText.slice(0, 500);
await page.screenshot({ path: `${ART}/tasks-after-onboarding.png` });

// ---- EARNINGS ----
await page.goto(PROD_URL + '/earnings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
out.earningsText = (await page.locator('body').innerText()).slice(0, 800);
await page.screenshot({ path: `${ART}/earnings-register-user.png` });

await browser.close();
save('qa3-g0-register.json', out);
console.log(JSON.stringify(out, null, 2));
