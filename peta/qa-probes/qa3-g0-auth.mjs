// QA3 Gate 0 — Phase 0: admin auth + create qa3-* member + cleanup helper test
import { signIn, rpc, save, mkEmail, ADMIN_EMAIL, ADMIN_PWD } from './qa3-lib.mjs';

const out = {};
// 1. Admin sign in
const a = await signIn(ADMIN_EMAIL, ADMIN_PWD);
out.adminSignIn = { status: a.status, error: a.error?.message ?? a.error_description ?? null, hasToken: !!a.access_token, role: a.user?.role, email: a.user?.email };
if (!a.access_token) {
  out.error = 'ADMIN LOGIN FAILED';
  save('qa3-g0-admin-auth.json', out);
  process.exit(1);
}
const adminJwt = a.access_token;

// 2. Create member via RPC
const member = { email: mkEmail('m1'), password: 'Qa3Pass#2026!', whatsapp: `0813${Date.now().toString().slice(-8)}`, full_name: 'QA3 Member Satu' };
const c = await rpc('admin_create_member', {
  p_email: member.email, p_password: member.password, p_whatsapp: member.whatsapp, p_full_name: member.full_name,
}, adminJwt);
out.createMember = { status: c.status, body: c.body };
out.member = member;

// 3. Create a second member (needed later for Gate 1 access control)
const memberB = { email: mkEmail('m2'), password: 'Qa3Pass#2026!', whatsapp: `0814${Date.now().toString().slice(-8)}`, full_name: 'QA3 Member Dua' };
const c2 = await rpc('admin_create_member', {
  p_email: memberB.email, p_password: memberB.password, p_whatsapp: memberB.whatsapp, p_full_name: memberB.full_name,
}, adminJwt);
out.createMemberB = { status: c2.status, body: c2.body };
out.memberB = memberB;

save('qa3-g0-admin-auth.json', out);
console.log(JSON.stringify(out, null, 2));
