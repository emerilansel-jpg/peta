// QA2 — RED TEAM: URL/ID manipulation, long input, slow network, double-submit
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'https://www.penghasilantambahan.com';
const log = [];
const step = (n, d) => { log.push({ name: n, ...d }); console.log('STEP', n, JSON.stringify(d).slice(0, 200)); };

// ===== 1. URL/ID manipulation =====
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const out = {};
  for (const c of ['/task/not-a-uuid', '/task/00000000-0000-0000-0000-000000000000', '/admin/nonexistent-page', '/reddit/admin/nonexistent']) {
    try {
      await page.goto(BASE + c, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);
      out[c] = { url: page.url().replace(BASE, ''), len: await page.evaluate(() => document.body.innerText.length) };
    } catch (e) { out[c] = { error: e.message.slice(0, 80) }; }
  }
  step('url-manipulation', out);
  await browser.close();
}

// ===== 2. Long text input (10K chars) =====
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(800);
  const long = 'A'.repeat(10000);
  await page.getByPlaceholder('Nama kamu').fill(long);
  const val = await page.getByPlaceholder('Nama kamu').inputValue();
  step('long-input', { entered: val.length, accepted: val.length === 10000, noCrash: true });
  await browser.close();
}

// ===== 3. Slow network → loading state =====
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', async (route) => {
    if (['script', 'xhr', 'fetch'].includes(route.request().resourceType())) {
      await new Promise((r) => setTimeout(r, 1200));
    }
    await route.continue();
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(600);
  const during = await page.evaluate(() => document.body.innerText.length);
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => document.body.innerText.slice(0, 150));
  step('slow-network', { duringLen: during, afterText: after.slice(0, 100) });
  await browser.close();
}

// ===== 4. Back-forward navigation =====
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.goto(BASE + '/reddit', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.goBack();
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => location.pathname);
  await page.goBack();
  await page.waitForTimeout(800);
  const back2 = await page.evaluate(() => location.pathname);
  await page.goForward();
  await page.waitForTimeout(800);
  const fwd = await page.evaluate(() => location.pathname);
  step('back-forward', { back, back2, fwd });
  await browser.close();
}

writeFileSync('qa-probes/qa2-redteam.json', JSON.stringify(log, null, 2));
await browser.close();
console.log('Red team tests complete');
