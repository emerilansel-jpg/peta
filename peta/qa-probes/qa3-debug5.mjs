import { signIn, rpc, SB, ANON, TS } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
const email = `qa3-signup-${TS}@penghasilantambahan.com`;
// find the user id
const u = await fetch(`${SB}/rest/v1/rpc/admin_find_user_by_email`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ p_email: email }),
});
console.log('find rpc:', u.status, await u.text());
