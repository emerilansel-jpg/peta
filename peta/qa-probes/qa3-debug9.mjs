import { signIn, TS, rpc } from './qa3-lib.mjs';
for (const tag of ['m1', 'm2', 'm3']) {
  const s = await signIn(`qa3-${tag}-${TS}@penghasilantambahan.com`, 'Qa3Pass#2026!');
  console.log(tag, '→', s.status, s.error?.message ?? s.error_description ?? 'OK');
}
// try m1 with the reset password variants
const s2 = await signIn(`qa3-m1-${TS}@penghasilantambahan.com`, 'Qa3Pass#2026!x');
console.log('m1 wrong-pwd →', s2.status, s2.error?.message ?? 'OK?!');
