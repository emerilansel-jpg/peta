// Probe: load localhost:5173 and capture console + page state
// QA probe — reports what the app does WITHOUT env vars configured
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const logs = { error: [], warning: [], info: [] };
page.on('console', (msg) => {
  const lvl = msg.type();
  if (logs[lvl]) logs[lvl].push(msg.text().slice(0, 300));
});
page.on('pageerror', (err) => logs.error.push('PAGEERROR: ' + err.message.slice(0, 300)));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => logs.error.push('GOTO: ' + e.message));

const title = await page.title().catch(() => '?');
let bodyText = 'EVALERR'; try { bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : 'NO BODY'); } catch (e) { bodyText = 'EVALERR: ' + e.message; }
let h1 = 'EVALERR'; try { h1 = await page.evaluate(() => document.querySelector('h1')?.textContent || 'NO H1'); } catch (e) { h1 = 'EVALERR: ' + e.message; }

console.log(JSON.stringify({ title, h1, bodyText, logs }, null, 2));
await browser.close();
