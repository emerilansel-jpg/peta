// Supabase Edge Function: send-task-blast
//
// Sends WhatsApp notifications via Fonnte when a task is activated.
// Supports:
//   - test_mode: sends only to admin's own number
//   - group blast: sends to WA group (if WA_GROUP_JID configured)
//   - individual DMs: sends to all eligible army members
//
// Requires: FONNTE_TOKEN secret set in Supabase.
// Optional: app_secrets.key='WA_GROUP_JID' for group auto-send.
//
// Deploy:
//   supabase functions deploy send-task-blast --project-ref <ref>

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

function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  if (!p.startsWith('62')) p = '62' + p;
  return p;
}

interface BlastPayload {
  task_id: string;
  test_mode?: boolean;
  test_whatsapp?: string;
}

interface NotificationRow {
  id: string;
  channel: string;
  phone: string;
  message: string;
}

async function sendFonnte(
  token: string,
  target: string,
  message: string,
  isGroup = false
): Promise<{ ok: boolean; status?: string; detail?: unknown }> {
  const body: Record<string, unknown> = {
    target,
    message,
    countryCode: '62',
  };
  if (isGroup) {
    body.type = 'group';
  }

  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('Fonnte send failed:', data);
    return { ok: false, detail: data };
  }

  return { ok: true, status: data.status || 'sent', detail: data };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const payload: BlastPayload = await req.json();
    if (!payload.task_id) {
      return json({ error: 'task_id_required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const fonnteToken = Deno.env.get('FONNTE_TOKEN');

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'supabase_not_configured' }, 500);
    }
    if (!fonnteToken) {
      return json({ error: 'fonnte_not_configured' }, 500);
    }

    // 1. Queue notifications via RPC
    const queueRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/admin_queue_task_notifications`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_task_id: payload.task_id,
          p_test_mode: payload.test_mode ?? false,
          p_test_whatsapp: payload.test_whatsapp ?? null,
        }),
      }
    );

    if (!queueRes.ok) {
      const err = await queueRes.text();
      console.error('Queue RPC failed:', err);
      return json({ error: 'queue_failed', detail: err }, 502);
    }

    const queueData = await queueRes.json();
    const notifIds: string[] = queueData.notification_ids || [];

    if (notifIds.length === 0) {
      return json({ ok: true, sent: 0, message: 'No recipients matched' });
    }

    // 2. Fetch pending notification rows
    const idsParam = notifIds.map((id) => `"${id}"`).join(',');
    const pendingRes = await fetch(
      `${supabaseUrl}/rest/v1/task_notifications?id=in.(${idsParam})&status=eq.pending`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!pendingRes.ok) {
      const err = await pendingRes.text();
      return json({ error: 'fetch_pending_failed', detail: err }, 502);
    }

    const pendingRows: NotificationRow[] = await pendingRes.json();

    // 3. Send each via Fonnte
    let sent = 0;
    let failed = 0;
    const results: Array<{
      id: string;
      ok: boolean;
      channel: string;
      target: string;
      error?: string;
    }> = [];

    for (const row of pendingRows) {
      const isGroup = row.channel === 'whatsapp_group';
      const target = isGroup ? row.phone : normalizePhone(row.phone);

      const fonnteResult = await sendFonnte(fonnteToken, target, row.message, isGroup);

      const markStatus = fonnteResult.ok ? 'sent' : 'failed';
      const markError = fonnteResult.ok
        ? null
        : JSON.stringify(fonnteResult.detail || 'unknown');

      // Mark in DB
      await fetch(`${supabaseUrl}/rest/v1/rpc/admin_mark_task_notification`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_notification_id: row.id,
          p_status: markStatus,
          p_error: markError,
          p_fonnte_response: fonnteResult.detail
            ? JSON.stringify(fonnteResult.detail)
            : null,
        }),
      });

      if (fonnteResult.ok) {
        sent++;
      } else {
        failed++;
      }

      results.push({
        id: row.id,
        ok: fonnteResult.ok,
        channel: row.channel,
        target,
        error: markError || undefined,
      });
    }

    return json({
      ok: true,
      test_mode: queueData.test_mode,
      total: notifIds.length,
      sent,
      failed,
      results,
    });
  } catch (e) {
    console.error('Function error:', e);
    return json(
      { error: 'internal_error', detail: (e as Error).message },
      500
    );
  }
});
