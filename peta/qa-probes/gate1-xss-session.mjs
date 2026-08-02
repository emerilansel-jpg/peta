// GATE 1 — XSS/injection via forms + session/logout behavior
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const ADMIN_EMAIL = 'info@jetdigitalpro.com';
const ADMIN_PASS = 'peta';
const OUT = 'qa-probes/artifacts/gate1';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 300)); };

// ---------- XSS in register name ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const dialogs = [];
  page.on('dialog', async (dlg) => { dialogs.push(dlg.type() + ':' + dlg.message()); await dlg.dismiss(); });
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const xss = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  await page.getByPlaceholder('Nama kamu').fill(xss);
  await page.getByPlaceholder('kamu@email.com').fill('xss-check-' + Date.now().toString().slice(-6) + '@example.com');
  await page.getByPlaceholder('08xxxxxxxxxx').fill('0812' + Date.now().toString().slice(-8));
  await page.locator('input[type="password"]').fill('XssTest#2026');
  // fill referral field if visible
  const ref = page.getByPlaceholder('kode dari teman kamu');
  if (await ref.count() > 0) await ref.fill('"><script>alert(3)</script>');
  await page.getByRole('button', { name: /daftar|buat akun|join/i }).first().click();
  await page.waitForTimeout(5000);
  const url = page.url().replace(BASE, '');
  const rendered = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
  step('xss-register', { finalUrl: url, dialogs, scriptExecuted: /<script>alert\(1\)/.test(rendered) || rendered.includes('onerror=alert'), payloadVisibleRaw: rendered.includes('&lt;script&gt;') });
  await page.screenshot({ path: `${OUT}/1-xss-register.png` });
  // check the account page shows name escaped
  if (url.includes('/onboarding') || url.includes('/tasks')) {
    await page.goto(BASE + '/account', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const accHtml = await page.evaluate(() => document.body.innerHTML);
    step('xss-rendered-on-account', { rawScript: accHtml.includes('<script>alert(1)'), escaped: accHtml.includes('&lt;script&gt;') });
    await page.screenshot({ path: `${OUT}/2-xss-account.png` });
  }
  await page.close();
}

// ---------- Injection chars in login ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill("admin' OR '1'='1'--");
  await page.locator('input[type="password"]').first().fill("' OR 1=1 --");
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(2500);
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 300));
  step('injection-login', { url: page.url().replace(BASE, ''), text: txt.slice(0, 150) });
  await page.close();
}

// ---------- Session: logout + JWT expiry ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByPlaceholder('kamu@email.com atau 0812xxxx').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASS);
  await page.getByRole('button', { name: /masuk|login/i }).first().click();
  await page.waitForTimeout(4000);

  // JWT expiry + claims
  const jwtInfo = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'));
    const v = JSON.parse(localStorage.getItem(k));
    const parts = v.access_token.split('.');
    const payload = JSON.parse(atob(parts[1]));
    return { expIn: (payload.exp - Math.floor(Date.now() / 1000)), iatIn: (Math.floor(Date.now() / 1000) - payload.iat), aud: payload.aud, role: payload.role };
  });
  step('jwt', { jwtInfo });

  // find logout button (layout bottom nav or menu)
  const btns = await page.getByRole('button').allTextContents();
  const logoutBtn = page.getByRole('button', { name: /logout|keluar|sign out/i }).first();
  step('logout-btn', { found: await logoutBtn.count() > 0, buttons: btns.slice(0, 10) });
  if (await logoutBtn.count() > 0) {
    await logoutBtn.click();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => {
      const tokens = Object.keys(localStorage).filter((k) => k.includes('auth-token'));
      return { url: location.pathname, tokenKeysLeft: tokens, hasSession: tokens.length > 0 };
    });
    step('after-logout', { url: after.url, tokenKeysLeft: after.tokenKeysLeft });
    // try to access protected page after logout
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    step('after-logout-protected', { url: page.url().replace(BASE, '') });
  } else {
    step('no-logout-button', {});
  }
  await ctx.close();
}

writeFileSync('qa-probes/gate1-xss-session.json', JSON.stringify(log, null, 2));
await browser.close();
