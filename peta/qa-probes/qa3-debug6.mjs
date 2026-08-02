import { signIn, rpc, SB, ANON, TS, mgmt } from './qa3-lib.mjs';
// try management API auth users list
const u = await mgmt(`/projects/yorlsgzsawchpeeazcvi/auth/users?per_page=200`);
console.log('mgmt auth users:', u.status, JSON.stringify(u.body).slice(0, 300));
const users = u.body?.users ?? [];
const target = users.filter(x => x.email?.startsWith('qa3-'));
console.log('qa3 auth users:', JSON.stringify(target.map(x => ({ id: x.id, email: x.email, confirmed: !!x.email_confirmed_at }))));
