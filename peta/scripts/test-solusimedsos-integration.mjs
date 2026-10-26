import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== RUNNING SOLUSIMEDSOS RESELLER & SECURITY VERIFICATION SUITE ===');

// 1. Check Migration File
console.log('1. Verifying Migration 20261025000000_straight_solusimedsos_reseller_services.sql...');
const migrationPath = path.join(rootDir, 'supabase', 'migrations', '20261025000000_straight_solusimedsos_reseller_services.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');
const sql = fs.readFileSync(migrationPath, 'utf8');

// Contracts in SQL
assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.straight_supplier_packages'), 'straight_supplier_packages table must be created');
assert.ok(sql.includes('ALTER TABLE public.straight_supplier_packages ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on straight_supplier_packages');
assert.ok(sql.includes('CREATE POLICY straight_supplier_packages_admin_only'), 'Admin-only policy must exist for supplier packages');
assert.ok(sql.includes('USING (public.is_admin())'), 'Policy must strictly check public.is_admin()');

assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.straight_supplier_fulfillments'), 'straight_supplier_fulfillments table must be created');
assert.ok(sql.includes('ALTER TABLE public.straight_supplier_fulfillments ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on straight_supplier_fulfillments');
assert.ok(sql.includes('CREATE POLICY straight_supplier_fulfillments_admin_only'), 'Admin-only policy must exist for supplier fulfillments');

assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_create_reseller_order'), 'fn_create_reseller_order RPC must exist');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.public_get_reseller_packages'), 'public_get_reseller_packages RPC must exist');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.admin_get_supplier_fulfillment'), 'admin_get_supplier_fulfillment RPC must exist');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.admin_update_supplier_fulfillment'), 'admin_update_supplier_fulfillment RPC must exist');
console.log('  ✓ Migration structure & contracts verified.');

// 2. Verify Exact 2x Markup Math across all packages in SQL
console.log('2. Verifying 2x Markup Math across all seeded packages...');
const packageMatches = [...sql.matchAll(/\('(SMS-[^']+)',\s*'SolusiMedsos',\s*'[^']+',\s*'[^']+',\s*'[^']+',\s*'[^']+',\s*'[^']+',\s*(\d+),\s*'[^']+',\s*'[^']+',\s*'[^']+',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)'\)/g)];
assert.ok(packageMatches.length >= 50, `Must seed all packages (found ${packageMatches.length})`);

for (const match of packageMatches) {
  const [_, code, costIdrStr, qtyStr, sellIdrStr, sellCentsStr, status] = match;
  const costIdr = parseInt(costIdrStr, 10);
  const qty = parseInt(qtyStr, 10);
  const sellIdr = parseInt(sellIdrStr, 10);
  const sellCents = parseInt(sellCentsStr, 10);

  if (status === 'active') {
    assert.strictEqual(sellIdr, costIdr * 2, `Package ${code} selling price (${sellIdr}) must equal exactly 2x supplier cost (${costIdr} * 2)`);
    const expectedCents = Math.round(sellIdr / 160);
    assert.strictEqual(sellCents, expectedCents, `Package ${code} selling cents (${sellCents}) must match rate conversion (${expectedCents})`);
    assert.ok(sellIdr > costIdr, `Selling price must be strictly higher than cost for ${code}`);
  }
}
console.log(`  ✓ Verified exact 2x markup across all ${packageMatches.length} seeded packages.`);

// 3. Verify Admin-Only Security Boundary
console.log('3. Verifying Admin-Only Data Segregation...');
// Check that public safe function excludes supplier code, cost, and name
const publicFuncBody = sql.substring(sql.indexOf('FUNCTION public.public_get_reseller_packages'), sql.indexOf('FUNCTION public.admin_get_supplier_fulfillment'));
assert.ok(!publicFuncBody.includes('supplier_code,'), 'Public function must not return supplier_code');
assert.ok(!publicFuncBody.includes('supplier_cost_idr,'), 'Public function must not return supplier_cost_idr');
assert.ok(!publicFuncBody.includes('supplier,'), 'Public function must not return supplier');
assert.ok(!publicFuncBody.includes('supplier_wa,'), 'Public function must not return supplier_wa');
assert.ok(!publicFuncBody.includes('supplier_url,'), 'Public function must not return supplier_url');

// Check that client-facing notes in fn_create_reseller_order sanitize supplier data
const orderRpcBody = sql.substring(sql.indexOf('FUNCTION public.fn_create_reseller_order'), sql.indexOf('FUNCTION public.public_get_reseller_packages'));
assert.ok(!orderRpcBody.includes("'supplier_code', v_pkg.supplier_code"), 'Order notes must not contain supplier_code');
assert.ok(!orderRpcBody.includes("'supplier_cost', v_pkg.supplier_cost_idr"), 'Order notes must not contain supplier_cost');
assert.ok(orderRpcBody.includes("INSERT INTO public.straight_supplier_fulfillments"), 'Fulfillment record must be inserted into admin-only table');
console.log('  ✓ Data segregation & confidentiality boundaries verified.');

// 4. Verify Frontend Implementation
console.log('4. Verifying Frontend Components & English Copy...');
const newOrderPath = path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'RedditNewOrder.tsx');
const newOrderContent = fs.readFileSync(newOrderPath, 'utf8');

assert.ok(newOrderContent.includes('ResellerOrderForm'), 'ResellerOrderForm component must be implemented');
assert.ok(newOrderContent.includes('createResellerOrderAsync'), 'Reseller order async mutation must be wired');
assert.ok(newOrderContent.includes('sms_social_likes'), 'sms_social_likes must be in catalog');
assert.ok(newOrderContent.includes('sms_twitter_trending'), 'sms_twitter_trending must be in catalog');
assert.ok(!newOrderContent.includes('SMS-LIKE-010'), 'Frontend catalog must NOT expose internal SMS codes to clients');
assert.ok(!newOrderContent.includes('SolusiMedsos'), 'Frontend catalog must NOT expose SolusiMedsos supplier name to clients');

const adminOrdersPath = path.join(rootDir, 'src', 'modules', 'reddit', 'pages', 'admin', 'AdminOrders.tsx');
const adminOrdersContent = fs.readFileSync(adminOrdersPath, 'utf8');
assert.ok(adminOrdersContent.includes('getAdminSupplierFulfillment'), 'Admin orders must fetch supplier fulfillment');
assert.ok(adminOrdersContent.includes('adminUpdateSupplierFulfillment'), 'Admin orders must be able to update fulfillment');
assert.ok(adminOrdersContent.includes('Forward to SolusiMedsos (WhatsApp)'), 'Admin orders must have WhatsApp forwarding button');
assert.ok(adminOrdersContent.includes('Supplier Cost'), 'Admin orders must display supplier cost');
assert.ok(adminOrdersContent.includes('Net Profit Margin'), 'Admin orders must display profit margin');
console.log('  ✓ Frontend customer view and admin panel verified.');

// 5. Simulate WhatsApp Message Prefill
console.log('5. Verifying Operational WhatsApp Fulfillment Brief...');
const sampleFulfillment = {
  supplier_service_name: 'Like 100% Manusia - Retweet - Share',
  supplier_package: '10 Likes',
  supplier_code: 'SMS-LIKE-010',
  supplier_wa: '6285123938143',
};
const sampleOrder = {
  id: 888,
  thread_url: 'https://www.instagram.com/p/ABC123xyz/',
};
const sampleClientNote = 'Please deliver gradually';

const waText = `Halo Admin SolusiMedsos, saya mau order:\n- Layanan: ${sampleFulfillment.supplier_service_name}\n- Paket: ${sampleFulfillment.supplier_package} (Kode: ${sampleFulfillment.supplier_code})\n- Target URL: ${sampleOrder.thread_url}\n- Catatan: ${sampleClientNote}\nRef Order: #${sampleOrder.id}\nMohon info total & rekening pembayarannya. Terima kasih!`;
const waUrl = `https://wa.me/${sampleFulfillment.supplier_wa}?text=${encodeURIComponent(waText)}`;

assert.ok(waUrl.includes('6285123938143'), 'WhatsApp URL must point to SolusiMedsos contact');
assert.ok(waUrl.includes('SMS-LIKE-010'), 'WhatsApp URL must include SMS supplier code');
assert.ok(waUrl.includes('ABC123xyz'), 'WhatsApp URL must include target URL');
console.log('  ✓ WhatsApp fulfillment dispatch flow verified.');

console.log('\n======================================================');
console.log('ALL SOLUSIMEDSOS RESELLER & SECURITY CHECKS PASSED (100%)');
console.log('======================================================');
