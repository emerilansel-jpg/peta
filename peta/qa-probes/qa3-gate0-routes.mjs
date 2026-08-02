// QA3 GATE 0 — Route sweep: every route on both tenants × viewports.
// Evidence: console errors, pageerrors, failed requests, blank-screen, forbidden Reddit mention on public pages.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const PETA = 'https://www.penghasilantambahan.com';
const STRAIGHT = 'https://www.straight.ltd';
const OUT = 'qa-probes/artifacts/qa3';
mkdirSync(OUT, { recursive: true });

// Routes by tenant. auth=true routes are checked as ANONYMOUS (expect redirect to login).
const petaRoutes = [
  '/', '/login', '/register', '/forgot-password', '/privacy', '/terms', '/help',
  '/tasks', '/task-history', '/reddit-army', '/account', '/earnings', '/onboarding',
  '/admin', '/admin/team', '/admin/tasks', '/admin/approval', '/admin/payroll',
  '/admin/broadcast', '/admin/secrets', '/admin/wa-bot', '/admin/inbox', '/admin/accounts',
  '/karma-mission', '/reset-password', '/update-password', '/reset-whatsapp',
];
const straightRoutes = [
  '/reddit', '/reddit/waitlist', '/reddit/signup', '/reddit/login', '/reddit/terms',
  '/reddit/privacy', '/reddit/refunds', '/reddit/contact', '/reddit/forgot-password',
  '/reddit/dashboard', '/reddit/orders', '/reddit/new-order', '/reddit/topup',
  '/reddit/reviews', '/reddit/feature-requests', '/reddit/ranking-forum', '/reddit/ai-visibility',
  '/reddit/admin', '/reddit/admin/orders', '/reddit/admin/tickets', '/reddit/admin/clients',
  '/reddit/admin/reviews', '/reddit/admin/finance', '/reddit/admin/settings',
];

// Public PeTa pages must NOT mention Reddit/WARP
const redditBanPages = ['/', '/login', '/register', '/forgot-password', '/privacy', '/terms', '/help'];
const REDDIT_WORDS = /\breddit\b|u\/|r\/[a-z]{2,}|warp/i;

const browser = await chromium.launch();
const results = { peta: [], straight: [] };
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

async function sweep(domain, routes, label) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    for (const route of routes) {
      const rec = { route, vp: vp.name, status: null, redirectTo: null, consoleErrors: [], pageErrors: [], failedReqs: [], blank: false, redditMention: null };
      const errs = [];
      const failed = new Set();
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 180)); });
      page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 180)));
      page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('supabase.co/auth')) failed.add(`${r.status()} ${r.url().slice(0, 110)}`); });
      try {
        await page.goto(domain + route, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) {
        rec.pageErrors.push('NAV: ' + e.message.slice(0, 120));
      }
      await page.waitForTimeout(900);
      rec.status = 'loaded';
      rec.finalUrl = page.url().replace(domain, '') || '/';
      rec.consoleErrors = errs.slice(0, 6);
      rec.pageErrors = rec.pageErrors.slice(0, 3);
      rec.failedReqs = [...failed].slice(0, 6);
      const body = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      rec.blank = body.trim().length < 40;
      // Reddit mention check on public PeTa pages only
      if (label === 'peta' && redditBanPages.includes(route)) {
        const hit = body.match(REDDIT_WORDS);
        rec.redditMention = hit ? hit[0] : null;
      }
      if (rec.blank || rec.consoleErrors.length || rec.pageErrors.length || rec.failedReqs.length) {
        try { await page.screenshot({ path: `${OUT}/${label}_${vp.name}_${route.replace(/\//g, '_')}.png`, fullPage: false }); } catch {}
      }
      results[label].push(rec);
    }
    await ctx.close();
  }
}

await sweep(PETA, petaRoutes, 'peta');
await sweep(STRAIGHT, straightRoutes, 'straight');

writeFileSync('qa-probes/qa3-gate0-routes.json', JSON.stringify(results, null, 2));

// Summary
const bad = (r) => r.consoleErrors.length || r.pageErrors.length || r.failedReqs.length || r.blank;
for (const tenant of ['peta', 'straight']) {
  const rows = results[tenant];
  const total = rows.length;
  const broken = rows.filter(bad);
  console.log(`\n=== ${tenant.toUpperCase()}: ${total} route-visits, ${broken.length} with issues ===`);
  for (const r of broken) {
    console.log(`- ${r.vp} ${r.route}: blank=${r.blank} console=${r.consoleErrors.length} pageerr=${r.pageErrors.length} failed=${r.failedReqs.length} reddit=${r.redditMention ?? '-'}`);
    for (const e of r.consoleErrors.slice(0, 2)) console.log(`    console: ${e}`);
    for (const f of r.failedReqs.slice(0, 2)) console.log(`    failed: ${f}`);
  }
}
// Reddit mention on public pages
console.log('\n=== REDDIT MENTION on public PeTa pages ===');
for (const r of results.peta) {
  if (r.redditMention) console.log(`- ${r.vp} ${r.route}: "${r.redditMention}"`);
}
await browser.close();
console.log('\nDONE → qa3-gate0-routes.json');
