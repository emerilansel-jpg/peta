// Supabase Edge Function: paypal-capture
//
// Verifies a PayPal order SERVER-SIDE and credits the user. The client (RedditTopup)
// captures the order in the browser then calls this with just { paypal_order_id }.
// The authoritative amount is read from PayPal here — the client never sends it,
// closing the "fake order id with $1000" exploit.
//
// Credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV) are read from
// the app_secrets table, so the admin can set them in the Straight Settings UI
// without an env redeploy. Crediting goes through fn_paypal_credit_verified
// (service-role, idempotent on paypal_order_id).
//
// Deploy: supabase functions deploy paypal-capture --project-ref <ref> --use-api

// @ts-ignore - Deno runtime, resolved at deploy
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore - Deno runtime, resolved at deploy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const MAX_TOPUP_CENTS = 500000; // $5,000 sanity ceiling per order

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { paypal_order_id } = await req.json().catch(() => ({}));
    if (!paypal_order_id || typeof paypal_order_id !== 'string') {
      return json({ error: 'paypal_order_id required' }, 400);
    }

    // @ts-ignore - Deno env API
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    // @ts-ignore - Deno env API
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, serviceKey);

    // Identify the user from their JWT (sent automatically by functions.invoke).
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'not authenticated' }, 401);
    const userId = userData.user.id;

    // Load PayPal credentials from app_secrets.
    const { data: secrets } = await supabase
      .from('app_secrets')
      .select('key,value')
      .in('key', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENV']);
    const secretMap: Record<string, string> = {};
    for (const r of secrets || []) secretMap[r.key] = r.value;
    const clientId = secretMap['PAYPAL_CLIENT_ID'];
    const clientSecret = secretMap['PAYPAL_CLIENT_SECRET'];
    const env = secretMap['PAYPAL_ENV'] === 'live' ? 'live' : 'sandbox';
    if (!clientId || !clientSecret) {
      console.error('PayPal credentials missing in app_secrets');
      return json({ error: 'PayPal not configured' }, 500);
    }
    const apiBase = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

    // 1) OAuth token (client_credentials).
    const basic = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) {
      console.error('PayPal OAuth failed', tokenRes.status, await tokenRes.text().catch(() => ''));
      return json({ error: 'PayPal auth failed — check credentials/environment' }, 502);
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // 2) Fetch the order and validate it.
    const orderRes = await fetch(`${apiBase}/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!orderRes.ok) {
      console.error('PayPal order fetch failed', orderRes.status, await orderRes.text().catch(() => ''));
      return json({ error: 'PayPal order not found' }, 502);
    }
    const order = await orderRes.json();

    if (order.status !== 'COMPLETED') {
      return json({ error: `PayPal order not completed (status: ${order.status})` }, 400);
    }
    const pu = order.purchase_units?.[0];
    const amount = pu?.amount;
    if (!amount || amount.currency_code !== 'USD') {
      return json({ error: 'Unexpected order currency' }, 400);
    }
    const amountCents = Math.round(parseFloat(amount.value) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > MAX_TOPUP_CENTS) {
      return json({ error: 'Order amount out of range' }, 400);
    }
    const captureId = pu?.payments?.captures?.[0]?.id || paypal_order_id;

    // 3) Credit the user (idempotent on paypal_order_id).
    const { data: topup, error: creditErr } = await supabase.rpc('fn_paypal_credit_verified', {
      p_user_id: userId,
      p_amount_cents: amountCents,
      p_paypal_order_id: paypal_order_id,
      p_paypal_capture_id: captureId,
    });
    if (creditErr) {
      console.error('credit error', creditErr);
      return json({ error: 'Failed to credit account' }, 500);
    }

    return json({ ok: true, credited_cents: amountCents, topup });
  } catch (err: any) {
    console.error('paypal-capture error', err);
    return json({ error: 'Internal error' }, 500);
  }
});
