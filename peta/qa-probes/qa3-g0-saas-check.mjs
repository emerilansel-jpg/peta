import { signIn, SB, ANON } from './qa3-lib.mjs';
// did the SaaS signup user get created? try sign in
const r = await signIn('qa3-saas-53221769@straight.ltd', 'Qa3Saas#2026!');
console.log('saas signin:', r.status, r.error?.message ?? r.error_description ?? 'OK token=' + !!r.access_token);
