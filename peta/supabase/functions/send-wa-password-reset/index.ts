// Supabase Edge Function: send-wa-password-reset
//
// Sends a password reset link via Fonnte WhatsApp API.
// Requires: FONNTE_TOKEN secret set in Supabase.
//
// Deploy:
//   supabase functions deploy send-wa-password-reset --project-ref <ref>

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

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const { whatsapp, base_url } = await req.json();
    if (!whatsapp) {
      return json({ error: 'whatsapp_required' }, 400);
    }

    const normalizedPhone = normalizePhone(whatsapp);
    if (normalizedPhone.length < 10) {
      return json({ error: 'invalid_phone' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'supabase_not_configured' }, 500);
    }

    // 1. Look up user by whatsapp number
    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/users?whatsapp=eq.${normalizedPhone}&select=id,email,full_name,whatsapp&limit=1`,
      {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!userRes.ok) {
      console.error('User lookup failed:', await userRes.text());
      return json({ error: 'lookup_failed' }, 500);
    }

    const users = await userRes.json();
    if (!users || users.length === 0) {
      // Don't reveal whether number exists — same response either way
      return json({ ok: true, message: 'Jika nomor terdaftar, link reset akan dikirim via WhatsApp.' });
    }

    const user = users[0];

    // 2. Generate token and store it
    const token = generateToken();
    const tokenRes = await fetch(`${supabaseUrl}/rest/v1/password_reset_tokens`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: user.id,
        token,
        method: 'whatsapp',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    });

    if (!tokenRes.ok) {
      console.error('Token store failed:', await tokenRes.text());
      return json({ error: 'token_store_failed' }, 500);
    }

    // 3. Send via Fonnte
    const fonnteToken = Deno.env.get('FONNTE_TOKEN');
    if (!fonnteToken) {
      return json({ error: 'fonnte_not_configured' }, 500);
    }

    const resetUrl = `${base_url || 'https://penghasilantambahan.com'}/reset-password?token=${token}`;
    const message = `🔐 *Reset Password PeTa*

Halo ${user.full_name || 'PeTa Army'}!

Kamu minta reset password. Klik link ini untuk buat password baru:
${resetUrl}

Link aktif 15 menit. Jangan bagikan ke siapa-siapa.

_Ga minta reset? Abaikan pesan ini._`;

    const fonnteRes = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': fonnteToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target: normalizedPhone,
        message,
        countryCode: '62',
      }),
    });

    const fonnteData = await fonnteRes.json().catch(() => ({}));

    if (!fonnteRes.ok) {
      console.error('Fonnte send failed:', fonnteData);
      return json({ error: 'fonnte_send_failed', detail: fonnteData }, 502);
    }

    return json({
      ok: true,
      message: 'Link reset password dikirim ke WhatsApp kamu!',
      fonnte_status: fonnteData.status || 'sent',
    });
  } catch (e) {
    console.error('Function error:', e);
    return json({ error: 'internal_error', detail: (e as Error).message }, 500);
  }
});
