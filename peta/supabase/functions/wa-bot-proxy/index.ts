import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';


// wa-bot-proxy — SECURITY DEFINER edge function that proxies admin UI actions
// to the Evolution API. The EVOLUTION_API_KEY is never sent to the browser.
//
// Required app_secrets rows:
//   EVOLUTION_API_URL   — e.g. https://evolution.46-250-239-138.sslip.io
//   EVOLUTION_API_KEY   — Evolution API key
//   WA_INSTANCE_NAME    — optional; default 'peta'
//   WA_WEBHOOK_SECRET   — optional secret Evolution sends to the webhook
//
// Actions:
//   get_config, status, qr, create, restart, disconnect, set_webhook,
//   list_groups, set_group_jid

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message: string, status = 500) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('missing authorization header', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('supabase env vars missing', 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Verify caller is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return errorResponse('unauthorized', 401);
    }
    const { data: adminCheck } = await supabase.rpc('is_admin');
    if (!adminCheck) {
      return errorResponse('forbidden', 403);
    }

    const { action, ...payload } = await req.json();

    // Read secrets
    const { data: secrets } = await supabase
      .from('app_secrets')
      .select('key, value')
      .in('key', ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'WA_INSTANCE_NAME', 'WA_WEBHOOK_SECRET']);

    const secretMap = new Map((secrets || []).map((s: any) => [s.key, s.value]));
    const apiUrl = secretMap.get('EVOLUTION_API_URL');
    const apiKey = secretMap.get('EVOLUTION_API_KEY');
    const instanceName = secretMap.get('WA_INSTANCE_NAME') || 'peta';
    const webhookSecret = secretMap.get('WA_WEBHOOK_SECRET') || '';

    const config = {
      webhook_url: secretMap.get('WA_WEBHOOK_URL') || '',
      group_jid: secretMap.get('WA_GROUP_JID') || '',
      webhook_secret_set: !!webhookSecret,
    };

    if (action === 'get_config') {
      return jsonResponse(config);
    }

    if (!apiUrl || !apiKey) {
      return errorResponse(
        'WA Bot proxy belum dikonfigurasi. Set EVOLUTION_API_URL dan EVOLUTION_API_KEY di app_secrets.',
        503
      );
    }

    const baseUrl = apiUrl.replace(/\/$/, '');
    const instanceUrl = `${baseUrl}/instance/${instanceName}`;
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    switch (action) {
      case 'status': {
        const res = await fetch(`${instanceUrl}/status`, { headers });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'qr': {
        const res = await fetch(`${instanceUrl}/qr`, { headers });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'create': {
        const res = await fetch(`${baseUrl}/instance/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            instanceName,
            token: apiKey,
            integration: 'WHATSAPP-BAILEYS',
            webhook: config.webhook_url ? { url: config.webhook_url, enabled: true } : undefined,
          }),
        });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'restart': {
        const res = await fetch(`${instanceUrl}/restart`, { method: 'POST', headers });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'disconnect': {
        const res = await fetch(`${instanceUrl}/logout`, { method: 'DELETE', headers });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'set_webhook': {
        const url = payload.url;
        if (!url) return errorResponse('url required', 400);
        await supabase.from('app_secrets').upsert({ key: 'WA_WEBHOOK_URL', value: url });
        const res = await fetch(`${instanceUrl}/webhook`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url, enabled: true }),
        });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'list_groups': {
        const res = await fetch(`${instanceUrl}/fetchGroups`, { headers });
        const body = await res.json().catch(() => ({}));
        return jsonResponse({ body, status: res.status });
      }
      case 'set_group_jid': {
        const jid = payload.jid;
        if (!jid) return errorResponse('jid required', 400);
        await supabase.from('app_secrets').upsert({ key: 'WA_GROUP_JID', value: jid });
        return jsonResponse({ ok: true });
      }
      default:
        return errorResponse('unknown action', 400);
    }
  } catch (e: any) {
    return errorResponse(e.message || 'internal error', 500);
  }
});
