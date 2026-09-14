import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const { olderThanMinutes = 1, limit = 100 } = await req.json().catch(() => ({}));
    const fonnteToken = Deno.env.get('FONNTE_TOKEN');

    if (!fonnteToken) {
      return json({
        ok: false,
        retried: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        error: 'FONNTE_TOKEN not configured',
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();

    const { data: recipients, error } = await adminClient
      .from('broadcast_recipients')
      .select('*, broadcasts(body)')
      .eq('channel', 'whatsapp')
      .in('status', ['pending', 'failed'])
      .lte('created_at', cutoff)
      .limit(limit);

    if (error) {
      return json({ ok: false, error: error.message }, 500);
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of recipients || []) {
      const target = r.whatsapp_snapshot;
      const messageText = r.broadcasts?.body;

      if (!target || !messageText) {
        skipped++;
        await adminClient.from('broadcast_recipients').update({ status: 'skipped', error: 'missing_target_or_body' }).eq('id', r.id);
        continue;
      }

      try {
        const fonnteRes = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            'Authorization': fonnteToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target,
            message: messageText,
            delay: '1',
          }),
        });
        const resData = await fonnteRes.json();
        if (resData.status === true || resData.status === 'true') {
          sent++;
          await adminClient.from('broadcast_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id);
        } else {
          failed++;
          await adminClient.from('broadcast_recipients').update({ status: 'failed', error: resData.reason || 'retry_fonnte_failed' }).eq('id', r.id);
        }
      } catch (err: any) {
        failed++;
        await adminClient.from('broadcast_recipients').update({ status: 'failed', error: err.message || 'retry_network_error' }).eq('id', r.id);
      }
    }

    return json({
      ok: true,
      retried: recipients?.length || 0,
      sent,
      failed,
      skipped,
    });
  } catch (err: any) {
    return json({ ok: false, error: err.message || 'internal_error' }, 500);
  }
});
