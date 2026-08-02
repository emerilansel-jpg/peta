// GATE 0 — Verify test member's ledger: user_credits rows, earnings breakdown,
// reddit_accounts — all queried as the member (also validates RLS from user POV).
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ANON = 'sb_publishable_bNHruuoS5zoLtvbp7Eq-Yw_oDvUelRi';
const SB = 'https://yorlsgzsawchpeeazcvi.supabase.co';
// latest member from onboarding run
const MEMBER = { email: 'qa-obo-86644849@penghasilantambahan.com', password: 'QaTest#2026!' };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(MEMBER.email);
await page.locator('input[type="password"]').first().fill(MEMBER.password);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);
console.log('logged in as:', MEMBER.email, '->', page.url().replace(BASE, ''));

const token = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.includes('auth-token'));
  for (const k of keys) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v?.access_token) return v.access_token;
    } catch {}
  }
  return null;
});
console.log('token extracted:', !!token);

const out = await page.evaluate(async ({ SB, ANON }) => {
  const H = { apikey: ANON, Authorization: 'Bearer ' + (JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('auth-token')))).access_token), 'Content-Type': 'application/json' };
  const j = async (url, opts = {}) => (await fetch(url, { headers: H, ...opts })).json();
  return {
    me: await j(SB + '/rest/v1/users?select=id,email,role,credit_balance,is_active&limit=1'),
    credits: await j(SB + '/rest/v1/user_credits?select=source,amount,created_at&order=created_at.asc'),
    reddit_accounts: await j(SB + '/rest/v1/reddit_accounts?select=username,karma,level,created_at'),
    earnings: await j(SB + '/rest/v1/rpc/get_user_earnings', { method: 'POST', body: '{}' }),
  };
}, { SB, ANON });
console.log(JSON.stringify(out, null, 2));
writeFileSync('qa-probes/gate0-member-ledger.json', JSON.stringify(out, null, 2));
await browser.close();
