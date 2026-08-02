import { mgmt } from './qa3-lib.mjs';
// secrets list (names only)
const s = await mgmt('/projects/yorlsgzsawchpeeazcvi/secrets');
console.log('SECRET NAMES:', s.status, JSON.stringify((s.body||[]).map(x => x.name)));
// function body of send-peta-email
const b = await mgmt('/projects/yorlsgzsawchpeeazcvi/functions/send-peta-email/body');
console.log('BODY STATUS:', b.status);
const body = b.body?.body ?? b.body ?? '';
console.log('FUNC SOURCE:', typeof body === 'string' ? body.slice(0, 1500) : JSON.stringify(body).slice(0, 1500));
