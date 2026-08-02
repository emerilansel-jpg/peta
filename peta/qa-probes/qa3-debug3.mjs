import { signIn, rpc, TS } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
const uid = 'd0fa8a97-8349-4ea0-805e-996c19b84efd'; // qa3-m1
const r = await rpc('admin_update_user_password', { p_user_id: uid, p_password: 'Qa3Pass#2026!' }, jwt);
console.log('reset rpc:', r.status, JSON.stringify(r.body).slice(0, 300));
const s = await signIn(`qa3-m1-${TS}@penghasilantambahan.com`, 'Qa3Pass#2026!');
console.log('login after reset:', s.status, s.error?.message ?? s.error_description ?? 'OK token=' + !!s.access_token);
