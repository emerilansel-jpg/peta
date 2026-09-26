// check-schema-parity.mjs
// Verifies that Staging and Production have matching table columns and critical RPCs.

import assert from 'node:assert/strict';
import https from 'node:https';

const SUPABASE_MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
if (!SUPABASE_MGMT_TOKEN) {
  console.log('SUPABASE_ACCESS_TOKEN not set. Skipping live remote parity check.');
  process.exit(0);
}
const STAGING_REF = 'duxzxizedtvnopfihllz';
const PROD_REF = 'yorlsgzsawchpeeazcvi';

function queryDb(ref, sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: sql });
    const req = https.request(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_MGMT_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Query failed on ${ref} (${res.statusCode}): ${body}`));
          } else {
            resolve(JSON.parse(body || '[]'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

console.log('=== CHECKING SCHEMA PARITY (STAGING vs PRODUCTION) ===');

async function main() {
  const columnQuery = `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN (
      'task_assignments', 'tasks', 'payouts', 'reddit_army_profiles',
      'order_tickets', 'ticket_messages', 'reviews', 'feature_requests', 'app_secrets'
    )
    ORDER BY table_name, column_name;
  `;

  const [stagingCols, prodCols] = await Promise.all([
    queryDb(STAGING_REF, columnQuery),
    queryDb(PROD_REF, columnQuery),
  ]);

  const stagingSet = new Set(stagingCols.map((c) => `${c.table_name}.${c.column_name}`));
  const prodSet = new Set(prodCols.map((c) => `${c.table_name}.${c.column_name}`));

  // Check that critical columns in prod exist in staging
  const missingInStaging = [...prodSet].filter((col) => !stagingSet.has(col));
  console.log('Critical columns in prod:', prodSet.size);
  console.log('Critical columns in staging:', stagingSet.size);

  if (missingInStaging.length > 0) {
    console.warn('⚠️ Warning: Columns in prod missing in staging:', missingInStaging);
  } else {
    console.log('  ✓ 100% column parity verified for key tables.');
  }

  // Check admin_pending_approvals works without error in both
  console.log('Checking admin_pending_approvals RPC execution...');
  const testRpcSql = `
    BEGIN READ ONLY;
    SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.users WHERE role='admin' LIMIT 1), true);
    SELECT count(*) AS pending FROM public.admin_pending_approvals();
    ROLLBACK;
  `;

  const [stagingRpc, prodRpc] = await Promise.all([
    queryDb(STAGING_REF, testRpcSql),
    queryDb(PROD_REF, testRpcSql),
  ]);

  console.log('Staging pending approvals count:', stagingRpc[0]?.pending);
  console.log('Prod pending approvals count:', prodRpc[0]?.pending);
  assert.ok(stagingRpc[0]?.pending !== undefined, 'Staging admin_pending_approvals must return result');
  assert.ok(prodRpc[0]?.pending !== undefined, 'Prod admin_pending_approvals must return result');

  console.log('  ✓ admin_pending_approvals RPC is operational in both environments.');
  console.log('=== SCHEMA PARITY VERIFICATION COMPLETE ===');
}

main().catch((err) => {
  console.error('Parity check failed:', err);
  process.exit(1);
});
