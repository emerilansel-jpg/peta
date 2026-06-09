// Supabase Edge Function: wa-reset-confirm
//
// Step 2 of the WhatsApp OTP password reset. Verifies the 6-digit code the army
// member received on WhatsApp and, if valid, sets their new password via the
// Supabase admin API. Codes are single-use, 10-min, max 5 attempts.
//
// Deploy:
//   supabase functions deploy wa-reset-confirm --project-ref <ref>

// @ts-ignore - Deno runtime, resolved at deploy
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore - Deno runtime, resolved at deploy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const MAX_ATTEMPTS = 5;

function normalizeWa(input: string): string {
  const d = (input || '').replace(/\D/g, '');
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
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
    const { phone, code, new_password } = await req.json().catch(() => ({}));
    const wa = normalizeWa(String(phone || ''));
    const otp = String(code || '').replace(/\D/g, '');

    if (!new_password || String(new_password).length < 6) {
      return json({ ok: false, error: 'weak_password' });
    }
    if (!wa || otp.length !== 6) {
      return json({ ok: false, error: 'invalid' });
    }

    // @ts-ignore - Deno env API
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    // @ts-ignore - Deno env API
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: userId } = await supabase.rpc('get_user_id_by_whatsapp', { p_whatsapp: wa });
    if (!userId) return json({ ok: false, error: 'invalid' });

    const { data: rows } = await supabase
      .from('wa_password_reset')
      .select('id, code_hash, expires_at, attempts')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    const row = rows && rows[0];
    if (!row) return json({ ok: false, error: 'expired' });
    if (row.attempts >= MAX_ATTEMPTS) return json({ ok: false, error: 'too_many_attempts' });

    // Count this attempt before checking, so brute force is capped.
    await supabase.from('wa_password_reset').update({ attempts: row.attempts + 1 }).eq('id', row.id);

    const codeHash = await sha256Hex(otp);
    if (codeHash !== row.code_hash) {
      return json({ ok: false, error: 'wrong_code', attempts_left: Math.max(0, MAX_ATTEMPTS - (row.attempts + 1)) });
    }

    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
      password: String(new_password),
    });
    if (updErr) {
      console.error('updateUserById error', updErr);
      return json({ ok: false, error: 'reset_failed' });
    }

    await supabase
      .from('wa_password_reset')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id);

    return json({ ok: true });
  } catch (err: any) {
    console.error('wa-reset-confirm error', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});
