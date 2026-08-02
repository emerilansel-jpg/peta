import { signIn, TS, SB, ANON } from './qa3-lib.mjs';
const email = `qa3-m1-${TS}@penghasilantambahan.com`;
const r = await signIn(email, 'Qa3Pass#2026!');
console.log('signin status', r.status, 'error:', r.error?.message ?? r.error_description ?? r.msg ?? JSON.stringify(r));
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
for (const e of [email, `qa3-m2-${TS}@penghasilantambahan.com`]) {
  const u = await fetch(`${SB}/rest/v1/users?select=email,is_active,role&email=eq.${e}`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
  console.log('users row for', e, u.status, await u.text());
}
