import { signIn, rpc, TS } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
// fresh member via RPC with SAME password as working gotrue signup
const email = `qa3-m3-${TS}@penghasilantambahan.com`;
const c = await rpc('admin_create_member', { p_email: email, p_password: 'Qa3Pass#2026!', p_whatsapp: '0815' + TS, p_full_name: 'QA3 Member Tiga' }, jwt);
console.log('create m3:', c.status, JSON.stringify(c.body).slice(0, 100));
await new Promise(r => setTimeout(r, 1500));
const s = await signIn(email, 'Qa3Pass#2026!');
console.log('login m3:', s.status, s.error?.message ?? s.error_description ?? 'OK token=' + !!s.access_token);
// sanity: admin still logs in
const a2 = await signIn('info@jetdigitalpro.com', 'peta');
console.log('admin login sanity:', a2.status, !!a2.access_token);
