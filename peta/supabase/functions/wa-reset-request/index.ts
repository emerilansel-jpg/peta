// Supabase Edge Function: wa-reset-request
//
// Step 1 of the WhatsApp OTP password reset. Resolves a WhatsApp number to a
// user, generates a 6-digit code, stores it hashed (single-use, 10-min expiry),
// and sends it via Fonnte as PLAIN TEXT (no URL — works on Fonnte's free plan).
//
// Always responds { ok: true } so the endpoint never reveals whether a number
// is registered. Reads FONNTE_TOKEN from the app_secrets table.
//
// Deploy:
//   supabase functions deploy wa-reset-request --project-ref <ref>
// (No extra secrets needed beyond the auto-injected SUPABASE_* env vars.)

// @ts-ignore - Deno runtime, resolved at deploy
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore - Deno runtime, resolved at deploy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 45;

function normalizeWa(input: string): string {
  const d = (input || '').replace(/\D/g, '');
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
}

function gen6(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, '0');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { phone } = await req.json().catch(() => ({ phone: '' }));
    const wa = normalizeWa(String(phone || ''));
    // Generic success even on bad input — never leak registration status.
    if (!wa || wa.length < 8) return json({ ok: true });

    // @ts-ignore - Deno env API
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    // @ts-ignore - Deno env API
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: userId, error: resolveErr } = await supabase.rpc('get_user_id_by_whatsapp', {
      p_whatsapp: wa,
    });
    if (resolveErr) console.error('resolve error', resolveErr);
    if (!userId) return json({ ok: true }); // not registered — pretend success

    // Cooldown: don't spam WhatsApp on rapid re-clicks.
    const { data: recent } = await supabase
      .from('wa_password_reset')
      .select('created_at')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gte('created_at', new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000).toISOString())
      .limit(1);
    if (recent && recent.length > 0) return json({ ok: true });

    const code = gen6();
    const codeHash = await sha256Hex(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    // Invalidate any earlier unconsumed codes, then store the fresh one.
    await supabase
      .from('wa_password_reset')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('consumed_at', null);

    const { error: insErr } = await supabase
      .from('wa_password_reset')
      .insert({ user_id: userId, code_hash: codeHash, expires_at: expiresAt });
    if (insErr) {
      console.error('insert error', insErr);
      return json({ ok: true });
    }

    // Read the Fonnte token from app_secrets (service-role only table).
    const { data: secret } = await supabase
      .from('app_secrets')
      .select('value')
      .eq('key', 'FONNTE_TOKEN')
      .maybeSingle();
    const fonnteToken = secret?.value;
    if (!fonnteToken) {
      console.error('FONNTE_TOKEN missing in app_secrets — cannot send reset code');
      return json({ ok: true });
    }

    const message =
      `Kode reset password PeTa kamu: ${code}\n\n` +
      `Berlaku ${CODE_TTL_MINUTES} menit. Jangan kasih kode ini ke siapa pun. ` +
      `Kalau kamu nggak minta reset, abaikan pesan ini.`;

    const fonnteRes = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: fonnteToken },
      body: new URLSearchParams({ target: wa, message }),
    });
    if (!fonnteRes.ok) {
      console.error('Fonnte send failed', fonnteRes.status, await fonnteRes.text().catch(() => ''));
    }

    return json({ ok: true });
  } catch (err: any) {
    console.error('wa-reset-request error', err);
    // Still generic to the client; the error is logged for the admin.
    return json({ ok: true });
  }
});
