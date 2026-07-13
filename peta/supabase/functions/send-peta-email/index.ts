// Supabase Edge Function: send-peta-email
//
// Sends a single transactional email for PeTa using Resend.
// Required secrets:
//   RESEND_API_KEY   (e.g. re_xxx)
//   EMAIL_FROM       (optional, default: PeTA <peta@penghasilantambahan.com>)
//
// Deploy:
//   supabase secrets set RESEND_API_KEY=re_xxx --project-ref <ref>
//   supabase functions deploy send-peta-email --project-ref <ref>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  type?: 'welcome' | 'payout_request' | 'payout_paid' | 'task_approved' | 'general';
  link?: string;
  preview_text?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const LOGO_URL = 'https://www.penghasilantambahan.com/logo-horizontal.png';
const PRIMARY = '#ff8b6b';
// Approximation of oklch(0.91 0.18 98.65) — light peach, used for subtle backgrounds.
const PEACH_LIGHT = '#FFDEC8';
const DARK = '#1A1D1F';
const MUTED = '#5E6470';

function emailTemplate(payload: EmailRequest): string {
  const appLink = payload.link || 'https://penghasilantambahan.com';
  const ctaText = (() => {
    switch (payload.type) {
      case 'welcome': return 'Mulai Sekarang';
      case 'payout_request': return 'Cek Status Payout';
      case 'payout_paid': return 'Lihat Riwayat';
      case 'task_approved': return 'Lihat Saldo';
      default: return 'Kunjungi PeTa';
    }
  })();

  const preview = payload.preview_text
    ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${payload.preview_text}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${payload.subject}</title>
</head>
<body style="margin:0; padding:0; background-color:${PEACH_LIGHT}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
${preview}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${PEACH_LIGHT};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <!-- Main Container -->
      <table role="presentation" width="100%" max-width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; border-radius:24px; overflow:hidden; background-color:#ffffff; box-shadow:0 16px 40px rgba(26,29,31,0.10);">
        <!-- Header with Logo -->
        <tr>
          <td align="center" style="background:linear-gradient(135deg, ${PRIMARY} 0%, #FF6B6B 100%); padding:36px 24px 32px;">
            <img src="${LOGO_URL}" alt="PeTa · PenghasilanTambahan.com" width="180" style="display:block; width:180px; max-width:70%; height:auto; border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic;">
          </td>
        </tr>
        <!-- Content Body -->
        <tr>
          <td style="padding:40px 32px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding-bottom:20px;">
                  <h1 style="margin:0; color:${DARK}; font-size:24px; font-weight:800; line-height:1.3; letter-spacing:-0.3px;">${payload.subject}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:28px; color:${MUTED}; font-size:16px; line-height:1.65;">
                  ${payload.body}
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:16px;">
                  <a href="${appLink}" style="display:inline-block; padding:15px 32px; background-color:${PRIMARY}; color:#ffffff; text-decoration:none; border-radius:12px; font-weight:700; font-size:15px; box-shadow:0 4px 14px rgba(255,139,107,0.35);">${ctaText}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Divider -->
        <tr>
          <td style="padding:0 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #F0E7E2;">
              <tr><td style="font-size:0; line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:28px 32px 36px; text-align:center;">
            <p style="margin:0 0 8px; color:${MUTED}; font-size:13px; line-height:1.5;">
              Email ini dikirim otomatis oleh <strong style="color:${DARK};">PeTa · PenghasilanTambahan.com</strong>
            </p>
            <p style="margin:0; color:${MUTED}; font-size:12px; line-height:1.5;">
              Simpan <a href="mailto:peta@penghasilantambahan.com" style="color:${PRIMARY}; text-decoration:none; font-weight:600;">peta@penghasilantambahan.com</a> ke kontak kamu biar nggak masuk spam.
            </p>
          </td>
        </tr>
      </table>
      <!-- Subtle footer outside card -->
      <table role="presentation" width="100%" max-width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; margin-top:20px;">
        <tr>
          <td align="center" style="color:#A78B7A; font-size:12px; line-height:1.5;">
            © ${new Date().getFullYear()} PeTa · PenghasilanTambahan.com. All rights reserved.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const payload: EmailRequest = await req.json();

    if (!payload.to || !payload.subject || !payload.body) {
      return json({ error: 'missing_required_fields', fields: 'to, subject, body' }, 400);
    }

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('EMAIL_FROM') || 'PeTA <peta@penghasilantambahan.com>';

    if (!apiKey) {
      return json({ error: 'resend_api_key_not_configured' }, 500);
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: payload.to,
        subject: payload.subject,
        html: emailTemplate(payload),
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend error:', resendData);
      return json({ error: 'resend_send_failed', detail: resendData }, 502);
    }

    return json({ ok: true, id: resendData.id }, 200);
  } catch (err: any) {
    console.error('Function error:', err);
    return json({ error: 'internal_error', detail: err.message }, 500);
  }
});
