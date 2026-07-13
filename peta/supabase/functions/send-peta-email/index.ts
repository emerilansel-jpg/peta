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

function emailTemplate(payload: EmailRequest): string {
  const appLink = payload.link || 'https://penghasilantambahan.com';
  const ctaText = (() => {
    switch (payload.type) {
      case 'welcome': return 'Mulai Earning';
      case 'payout_request': return 'Cek Status Payout';
      case 'payout_paid': return 'Login PeTa';
      case 'task_approved': return 'Lihat Riwayat';
      default: return 'Buka PeTa';
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
  <title>${payload.subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #fff5f2; margin: 0; padding: 0;">
${preview}
<div style="max-width: 600px; margin: 24px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
  <div style="background: linear-gradient(135deg, #FF6B6B 0%, #FF8B6B 100%); padding: 28px; color: white; text-align: center;">
    <div style="font-size: 28px; font-weight: 900; letter-spacing: -0.5px;">PeTa</div>
    <div style="font-size: 13px; opacity: 0.9; margin-top: 4px;">PenghasilanTambahan.com</div>
  </div>
  <div style="padding: 32px 24px;">
    <h2 style="margin: 0 0 16px 0; color: #1A1D1F; font-size: 22px; font-weight: 800;">${payload.subject}</h2>
    <div style="margin: 0 0 24px 0; color: #475569; font-size: 15px; line-height: 1.6;">
      ${payload.body}
    </div>
    <a href="${appLink}" style="display: inline-block; padding: 14px 28px; background: #FF6B6B; color: white; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">${ctaText} →</a>
  </div>
  <div style="padding: 20px 24px; border-top: 1px solid #f0f0f0; color: #94a3b8; font-size: 12px; text-align: center; line-height: 1.5;">
    Email ini dikirim otomatis oleh PeTa · PenghasilanTambahan.com<br>
    Simpan email <b>peta@penghasilantambahan.com</b> ke kontak kamu biar nggak masuk spam.
  </div>
</div>
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
