import { signIn, rpc, SB, ANON, TS } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
// Try: admin_update_user_password with a fresh gotrue-created user
// First find the user id via users table joined by trigger raw meta
const email = `qa3-signup-${TS}@penghasilantambahan.com`;
// users table has no email; but the signup user row exists in public.users with full_name null.
const q = await fetch(`${SB}/rest/v1/users?select=id,full_name&full_name=is.null&role=eq.army&order=created_at.desc&limit=3`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
const rows = await q.json();
console.log('recent null-fullname users:', JSON.stringify(rows));
if (rows?.[0]?.id) {
  const r2 = await rpc('admin_update_user_password', { p_user_id: rows[0].id, p_password: 'Qa3Pass#2026!' }, jwt);
  console.log('rpc reset on signup user:', r2.status, JSON.stringify(r2.body).slice(0, 120));
  const s = await signIn(email, 'Qa3Pass#2026!');
  console.log('login after RPC reset (signup user):', s.status, s.error?.message ?? s.error_description ?? 'OK');
}
