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
    const { message_id } = await req.json().catch(() => ({}));
    if (!message_id) {
      return json({ error: 'message_id_required' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: msg, error: msgErr } = await adminClient
      .from('inbox_messages')
      .select('*, inbox_threads(*)')
      .eq('id', message_id)
      .single();

    if (msgErr || !msg) {
      return json({ error: 'message_not_found' }, 404);
    }

    const thread = msg.inbox_threads;
    const channel = thread?.channel || 'email';
    let dispatchResult: any = { dispatched: true };

    if (channel === 'whatsapp') {
      const fonnteToken = Deno.env.get('FONNTE_TOKEN');
      const targetPhone = thread?.participant_phone;
      if (!fonnteToken || !targetPhone) {
        await adminClient
          .from('inbox_messages')
          .update({
            delivery_status: 'failed',
            delivery_error: !fonnteToken ? 'fonnte_not_configured' : 'missing_phone',
          })
          .eq('id', message_id);
        return json({ ok: false, error: 'Fonnte token or recipient phone not configured' }, 400);
      }

      const fonnteRes = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          'Authorization': fonnteToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target: targetPhone,
          message: msg.body,
        }),
      });
      const fonnteData = await fonnteRes.json();
      if (fonnteData.status === true || fonnteData.status === 'true') {
        await adminClient
          .from('inbox_messages')
          .update({ delivery_status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', message_id);
        dispatchResult = fonnteData;
      } else {
        await adminClient
          .from('inbox_messages')
          .update({ delivery_status: 'failed', delivery_error: fonnteData.reason || 'fonnte_failed' })
          .eq('id', message_id);
        return json({ ok: false, error: fonnteData.reason || 'Fonnte send failed' }, 500);
      }
    } else {
      // Email reply via basic SMTP or fallback
      const targetEmail = thread?.participant_email;
      if (!targetEmail) {
        await adminClient
          .from('inbox_messages')
          .update({ delivery_status: 'failed', delivery_error: 'missing_email' })
          .eq('id', message_id);
        return json({ ok: false, error: 'Recipient email not configured' }, 400);
      }

      await adminClient
        .from('inbox_messages')
        .update({ delivery_status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', message_id);
      dispatchResult = { queued_for_email: targetEmail };
    }

    return json({
      ok: true,
      messageId: message_id,
      sendResult: dispatchResult,
    });
  } catch (err: any) {
    return json({ error: err.message || 'internal_error' }, 500);
  }
});
