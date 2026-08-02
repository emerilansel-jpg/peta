import { signIn, SB, ANON, TS } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
// inspect users table shape + find qa3 rows
const u = await fetch(`${SB}/rest/v1/users?select=id,full_name,role,is_active,referral_code&limit=5`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
console.log('users sample:', u.status, (await u.text()).slice(0, 800));
const q = await fetch(`${SB}/rest/v1/users?select=id,full_name,role,is_active&full_name=ilike.*QA3*`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
console.log('qa3 users:', q.status, await q.text());
