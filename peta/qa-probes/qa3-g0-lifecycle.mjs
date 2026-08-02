// QA3 Gate 0 — Phase B: full task lifecycle
// m1 submits forum task proof → admin approves → verify ledger + earnings UI
import { chromium } from 'playwright';
import { signIn, rpc, select, save, SB, ANON } from './qa3-lib.mjs';
import { readFileSync } from 'fs';
import { mkdirSync } from 'fs';

const members = JSON.parse(readFileSync('qa-probes/qa3-members.json', 'utf8'));
const ART = 'qa-probes/qa3-artifacts/lifecycle';
mkdirSync(ART, { recursive: true });
const out = {};

const a = await signIn('info@jetdigitalpro.com', 'peta');
const adminJwt = a.access_token;
out.adminJwt = !!adminJwt;

// ---- 1. member submits proof via UI ----
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 150)));
await page.goto('https://www.penghasilantambahan.com/login', { waitUntil: 'networkidle' });
await page.getByPlaceholder(/kamu@email\.com|0812xxxx/).fill(members.m1.email);
await page.getByPlaceholder('••••••••').fill(members.m1.password);
await page.getByRole('button', { name: /masuk|login/i }).first().click();
await page.waitForTimeout(4000);
await page.goto('https://www.penghasilantambahan.com/task/07e806d6-c79a-452a-9b38-dabb5a3b44fe', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.locator('input[type="url"]').fill('https://community.hubspot.com/t5/Forums/qa3-proof-comment-1');
await page.locator('input[type="text"]').fill('qa3_test_username');
await page.waitForTimeout(500);
const submitBtn = page.getByRole('button', { name: /submit untuk approval/i }).last();
const disabledBefore = await submitBtn.isDisabled();
await submitBtn.click();
await page.waitForTimeout(3500);
out.submit = { disabledBefore, errors: [...new Set(errs)].slice(0, 4) };
await page.screenshot({ path: `${ART}/after-submit.png` });

// ---- 2. verify assignment status via API ----
const asg = await fetch(`${SB}/rest/v1/task_assignments?select=id,status,draft_comment,proof_url,user_id&task_id=eq.07e806d6-c79a-452a-9b38-dabb5a3b44fe&order=created_at.desc&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${adminJwt}` } });
const asgRows = await asg.json();
out.assignmentAfterSubmit = asgRows.map(x => ({ id: x.id?.slice(0, 8), status: x.status, proof: x.proof_url, user: x.user_id?.slice(0, 8) }));
const assignmentId = asgRows[0]?.id;
await browser.close();

// ---- 3. admin approves ----
if (assignmentId) {
  const ap = await rpc('admin_approve_assignment', { p_assignment_id: assignmentId }, adminJwt);
  out.approve = { status: ap.status, body: ap.body };
  // 4. verify status + ledger
  const a2 = await fetch(`${SB}/rest/v1/task_assignments?select=id,status&id=eq.${assignmentId}`, { headers: { apikey: ANON, Authorization: `Bearer ${adminJwt}` } });
  out.assignmentAfterApprove = await a2.json();
  const creds = await fetch(`${SB}/rest/v1/user_credits?select=amount,source,description,created_at&user_id=eq.${members.m1.id}&order=created_at.desc&limit=5`, { headers: { apikey: ANON, Authorization: `Bearer ${adminJwt}` } });
  out.ledger = await creds.json();
}

save('qa3-g0-lifecycle.json', out);
console.log(JSON.stringify(out, null, 2));
