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
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ error: 'unauthenticated' }, 401);
  }

  // Verify caller is admin or service_role
  const isServiceRole = SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
    if (adminErr || !isAdmin) {
      return json({ error: 'admin only' }, 403);
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const fonnteToken = Deno.env.get('FONNTE_TOKEN');

    // Diagnostic request
    if (body.diag) {
      if (!fonnteToken) {
        return json({ ok: false, error: 'FONNTE_TOKEN not configured' });
      }
      try {
        const res = await fetch('https://api.fonnte.com/device', {
          headers: { 'Authorization': fonnteToken },
        });
        const deviceData = await res.json();
        return json({ ok: true, device: deviceData });
      } catch (err: any) {
        return json({ ok: false, error: err.message || 'Failed to query Fonnte device' });
      }
    }

    // Broadcast send request
    const { broadcast_id, strip_urls } = body;
    if (!broadcast_id) {
      return json({ error: 'broadcast_id_required' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: broadcast, error: bErr } = await adminClient
      .from('broadcasts')
      .select('*')
      .eq('id', broadcast_id)
      .single();

    if (bErr || !broadcast) {
      return json({ error: 'broadcast_not_found' }, 404);
    }

    const { data: recipients, error: rErr } = await adminClient
      .from('broadcast_recipients')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .eq('channel', 'whatsapp')
      .eq('status', 'pending');

    if (rErr) {
      return json({ error: rErr.message }, 500);
    }

    const total = recipients?.length || 0;
    if (total === 0) {
      return json({ ok: true, total: 0, sent: 0, failed: 0, skipped: 0, status: 'no_pending_recipients' });
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    let messageText = broadcast.body;
    if (strip_urls) {
      messageText = messageText.replace(/https?:\/\/[^\s]+/gi, '');
    }

    if (!fonnteToken) {
      // Mark as manual_pending if no Fonnte token
      await adminClient
        .from('broadcast_recipients')
        .update({ status: 'manual_pending', error: 'fonnte_not_configured' })
        .eq('broadcast_id', broadcast_id)
        .eq('channel', 'whatsapp')
        .eq('status', 'pending');

      return json({
        ok: true,
        total,
        sent: 0,
        failed: 0,
        skipped: total,
        status: 'manual_pending_due_to_unconfigured_fonnte',
        hint: 'FONNTE_TOKEN not configured. Use manual wa.me links.',
      });
    }

    for (const r of recipients || []) {
      const target = r.whatsapp_snapshot;
      if (!target) {
        skipped++;
        await adminClient.from('broadcast_recipients').update({ status: 'skipped', error: 'no_phone' }).eq('id', r.id);
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
          await adminClient.from('broadcast_recipients').update({ status: 'failed', error: resData.reason || 'fonnte_error' }).eq('id', r.id);
        }
      } catch (err: any) {
        failed++;
        await adminClient.from('broadcast_recipients').update({ status: 'failed', error: err.message || 'network_error' }).eq('id', r.id);
      }
    }

    await adminClient
      .from('broadcasts')
      .update({
        wa_sent: (broadcast.wa_sent || 0) + sent,
        wa_failed: (broadcast.wa_failed || 0) + failed,
      })
      .eq('id', broadcast_id);

    return json({
      ok: true,
      total,
      sent,
      failed,
      skipped,
      status: 'completed',
    });
  } catch (err: any) {
    return json({ error: err.message || 'internal_error' }, 500);
  }
});
