// Supabase Edge Function: send-password-reset-email
//
// Sends a password reset link via SMTP email, branded as PeTA.
// Uses existing SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD).
// Optional: EMAIL_FROM secret (default: PeTA <peta@penghasilantambahan.com>)
//
// Deploy:
//   supabase functions deploy send-password-reset-email --project-ref <ref>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer";

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

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function emailTemplate(resetUrl: string, fullName?: string): string {
  const name = fullName || 'PeTa Army';
  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f8fafc; margin: 0; padding: 0;">
<div style="max-width: 600px; margin: 24px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
<div style="background: linear-gradient(to right, #f97316, #f59e0b); padding: 24px; color: white;">
<div style="display: flex; align-items: center; gap: 8px;">
<div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.2); display: inline-flex; align-items: center; justify-content: center; font-weight: bold;">P</div>
<strong style="font-size: 18px;">PeTA · PenghasilanTambahan.com</strong>
</div>
</div>
<div style="padding: 32px 24px;">
<h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 20px;">Reset Password</h2>
<p style="margin: 0 0 24px 0; color: #475569; font-size: 14px; line-height: 1.5;">
Halo <strong>${name}</strong>,<br><br>
Kamu minta reset password. Klik tombol di bawah untuk buat password baru. Link ini aktif selama <strong>15 menit</strong>.
</p>
<a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Reset Password →</a>
<p style="margin: 24px 0 0 0; color: #94a3b8; font-size: 12px;">
Ga minta reset? Abaikan email ini — akun kamu tetap aman.
</p>
</div>
<div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; text-align: center;">
Email ini dikirim oleh PeTA · PenghasilanTambahan.com
</div>
</div>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const { email, base_url } = await req.json();
    if (!email || typeof email !== 'string') {
      return json({ error: 'email_required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'supabase_not_configured' }, 500);
    }

    // 1. Look up user by email (case-insensitive)
    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/users?email=ilike.${encodeURIComponent(email.trim())}&select=id,email,full_name&limit=1`,
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
      // Don't reveal whether email exists
      return json({ ok: true, message: 'Jika email terdaftar, link reset akan dikirim ke email kamu.' });
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
        method: 'email',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    });

    if (!tokenRes.ok) {
      console.error('Token store failed:', await tokenRes.text());
      return json({ error: 'token_store_failed' }, 500);
    }

    // 3. Send email via SMTP using nodemailer
    const smtpHost = Deno.env.get('SMTP_HOST');
    const smtpPort = Deno.env.get('SMTP_PORT');
    const smtpUser = Deno.env.get('SMTP_USER');
    const smtpPass = Deno.env.get('SMTP_PASSWORD');
    
    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: 'smtp_not_configured' }, 500);
    }

    const fromAddress = Deno.env.get('EMAIL_FROM') || 'PeTA <peta@penghasilantambahan.com>';
    const resetUrl = `${base_url || 'https://penghasilantambahan.com'}/reset-password?token=${token}`;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '465', 10),
      secure: parseInt(smtpPort || '465', 10) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const info = await transporter.sendMail({
      from: fromAddress,
      to: user.email,
      subject: 'Reset Password PeTA',
      html: emailTemplate(resetUrl, user.full_name),
    });

    return json({
      ok: true,
      message: 'Link reset password dikirim ke email kamu!',
      messageId: info.messageId,
    });
  } catch (e) {
    console.error('Function error:', e);
    return json({ error: 'internal_error', detail: (e as Error).message }, 500);
  }
});
