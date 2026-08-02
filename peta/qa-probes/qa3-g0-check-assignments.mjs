import { signIn, select, SB, ANON } from './qa3-lib.mjs';
const a = await signIn('info@jetdigitalpro.com', 'peta');
const jwt = a.access_token;
const r = await fetch(`${SB}/rest/v1/task_assignments?select=id,task_id,reddit_account_id,status,draft_comment,proof_url,created_at,user_id&order=created_at.desc&limit=8`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
console.log(r.status, JSON.stringify((await r.json()).map(x => ({ id: x.id?.slice(0,8), task: x.task_id?.slice(0,8), status: x.status, hasDraft: !!x.draft_comment, hasProof: !!x.proof_url, reddit: x.reddit_account_id })), null, 1));
