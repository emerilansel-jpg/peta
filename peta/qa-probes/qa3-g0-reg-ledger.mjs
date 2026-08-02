import { signIn, SB, ANON, mgmt } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
const email = 'qa3-reg-53679060@gmail.com';
// find user id via users table (full_name = 'QA3 Register User')
const u = await fetch(`${SB}/rest/v1/users?select=id,full_name,role&full_name=eq.QA3 Register User`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
const rows = await u.json();
console.log('user rows:', JSON.stringify(rows));
for (const row of rows) {
  const c = await fetch(`${SB}/rest/v1/user_credits?select=amount,source,description,created_at&user_id=eq.${row.id}&order=created_at.desc`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
  console.log('credits:', c.status, JSON.stringify(await c.json(), null, 1));
  const o = await fetch(`${SB}/rest/v1/onboarding_states?select=*&user_id=eq.${row.id}`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } }).catch(() => null);
  if (o) console.log('onboarding_states:', o.status, JSON.stringify(await o.json()));
}
const cfg = await mgmt('/projects/yorlsgzsawchpeeazcvi/config/auth');
const c = cfg.body;
console.log('SMTP:', JSON.stringify(c.smtp), 'site_url:', c.site_url, 'confirm:', c.security?.confirm_email ?? c.mailer_autoconfirm);
