import { SB, ANON, TS, mgmt } from './qa3-lib.mjs';
// 1. auth config
const cfg = await mgmt('/projects/yorlsgzsawchpeeazcvi/config/auth');
console.log('auth config:', cfg.status, JSON.stringify(cfg.body).slice(0, 600));
// 2. try standard signup via gotrue
const email = `qa3-signup-${TS}@penghasilantambahan.com`;
const r = await fetch(`${SB}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email, password: 'Qa3Pass#2026!' }),
});
const j = await r.json();
console.log('signup:', r.status, JSON.stringify({ id: j.id, email: j.email, confirmation_sent_at: j.confirmation_sent_at, error: j.error_description ?? j.msg ?? j.error }).slice(0, 400));
// 3. try login with that
const l = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email, password: 'Qa3Pass#2026!' }),
});
const lj = await l.json();
console.log('login signup-user:', l.status, lj.error_description ?? lj.msg ?? 'OK token=' + !!lj.access_token);
