// Supabase Edge Function: inbox-poll-email
//
// This function was originally intended to poll the Spacemail IMAP mailbox for
// new inbound emails. However, Supabase Edge Functions do not support outbound
// raw TLS/ IMAP connections reliably, so the polling mechanism is disabled.
//
// Inbound emails are still ingested via:
//   - Spacemail email forwarding / webhook pointing to a Supabase function
//   - Manual "Log inbound manual" button in the admin Inbox UI
//
// This function returns success so the admin Inbox UI does not show an error
// toast on every auto-poll (every 60s) or manual poll click.
//
// Deploy:
//   supabase functions deploy inbox-poll-email --project-ref <ref>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // IMAP polling is intentionally disabled. Returning success keeps the
  // Inbox UI quiet during its 60s auto-poll cycle.
  return json({
    ok: true,
    processed: 0,
    skipped: 0,
    errors: [],
    note: 'IMAP polling disabled in Edge Function runtime. Use Spacemail forwarding or manual log.',
  });
});
