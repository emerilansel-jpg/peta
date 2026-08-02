import { signIn, SB, ANON } from './qa3-lib.mjs';
import { readFileSync } from 'fs';
const members = JSON.parse(readFileSync('qa-probes/qa3-members.json', 'utf8'));
// member JWT (verify_jwt=true requires authed user)
const m = await signIn(members.m3.email, members.m3.password);
console.log('member token:', m.status, !!m.access_token);
if (!m.access_token) process.exit(1);
// invoke send-peta-email exactly like the frontend does on register
const r = await fetch(`${SB}/functions/v1/send-peta-email`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: ANON,
    Authorization: `Bearer ${m.access_token}`,
  },
  body: JSON.stringify({ to: 'info@jetdigitalpro.com', subject: 'QA3 test welcome', body: 'QA3 test — verify email path', type: 'welcome' }),
});
const text = await r.text();
console.log('send-peta-email:', r.status, text.slice(0, 600));
