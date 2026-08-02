import { SB, ANON, TS } from './qa3-lib.mjs';
for (const tag of ['m1', 'm3']) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: `qa3-${tag}-${TS}@penghasilantambahan.com`, password: 'Qa3Pass#2026!' }),
  });
  const text = await r.text();
  console.log(tag, r.status, text.slice(0, 400));
  console.log('headers:', r.headers.get('x-ratelimit-limit'), r.headers.get('x-ratelimit-remaining'), r.headers.get('retry-after'));
}
