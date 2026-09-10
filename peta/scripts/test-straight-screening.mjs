// Offline only: execute the real edge handler with HTTP/provider/persistence stubs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/generate-forum-comment/index.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\s*/m, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
let handler;
let authOk = true;
let rulesOk = true;
let providerVerdict = 'pass';
let saved;
let persistOk = true;
let requested = [];
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
vm.runInNewContext(code, {
  Request, Response, URL, AbortSignal, console,
  Deno: { env: { get: key => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', DEEPSEEK_API_KEY: 'test' })[key] }, serve: fn => { handler = fn; } },
  fetch: async (url, options) => {
    requested.push(url);
    if (url.endsWith('/auth/v1/user')) return response(authOk ? { id: 'user-1' } : {}, authOk ? 200 : 401);
    if (url.includes('straight_ai_settings')) return response([]);
    if (url.includes('/about/rules.json')) return response(rulesOk ? { rules: [{ description: 'Disclose sponsorship. Helpful comments allowed.' }] } : {}, rulesOk ? 200 : 403);
    if (url.includes('www.reddit.com')) return response([{ data: { children: [{ title: 'Relevant question' }] } }]);
    if (url.includes('api.deepseek.com')) return response({ choices: [{ message: { content: providerVerdict === 'malformed' ? 'not json' : JSON.stringify({ verdict: providerVerdict, reason: 'Review result' }) } }] });
    if (url.endsWith('/straight_order_screenings')) {
      saved = JSON.parse(options.body);
      return response([{ id: 'screen-1' }], persistOk ? 201 : 500);
    }
    throw new Error(`Unexpected network boundary: ${url}`);
  },
});
const order = {
  target_url: 'https://www.reddit.com/r/example/comments/abc123/topic/', platform: 'Reddit',
  comment_text: 'Sponsored contribution with a useful caveat.', use_suggested_comment: false,
  brand_name: 'Example', brand_domain: null, brand_mention_mode: 'plain', source_keyword: null,
  notes: null, quantity: 1, comment_drafts: [], is_reply: false, reply_to: null,
};
const run = async (payload = order) => {
  saved = undefined;
  requested = [];
  const result = await handler(new Request('https://edge.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ action: 'screen_order', order: payload }) }));
  return { status: result.status, body: await result.json() };
};
assert.equal((await run()).body.verdict, 'pass');
assert.deepEqual(saved.payload, order, 'Persist exact complete payload');
assert.equal(saved.user_id, 'user-1');
rulesOk = false;
assert.equal((await run()).body.verdict, 'manual_review', 'Missing rules cannot pass');
providerVerdict = 'reject';
assert.equal((await run()).body.verdict, 'reject', 'Missing rules cannot override rejection');
providerVerdict = 'revise';
assert.equal((await run()).body.verdict, 'revise');
providerVerdict = 'malformed';
assert.equal((await run()).body.verdict, 'manual_review');
authOk = false;
assert.equal((await run()).status, 401);
assert.equal(saved, undefined);
authOk = true;
assert.equal((await run({ ...order, quantity: 0 })).status, 400);
assert.equal((await run({ ...order, comment_drafts: [{ comment_text: '' }] })).status, 400);
providerVerdict = 'pass';
assert.equal((await run({ ...order, target_url: 'https://127.0.0.1/private' })).body.verdict, 'manual_review');
assert.ok(requested.every(url => !url.includes('127.0.0.1')), 'Never fetch arbitrary target hosts');
persistOk = false;
assert.equal((await run()).status, 503, 'No checkout clearance without persistence');
console.log('PASS: screening authentication, validation, exact payload persistence, verdicts, unknown rules, SSRF boundary, persistence failure');
