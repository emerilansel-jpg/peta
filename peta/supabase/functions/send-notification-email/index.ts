// Supabase Edge Function: send-notification-email
//
// Sends an email via SMTP (nodemailer) when a notification is triggered.
// Required secrets: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD,
// EMAIL_FROM (optional, default: Straight Ltd <care@straight.ltd>).
//
// History: previously used Resend HTTP API (RESEND_API_KEY) but the key's account
// had no verified sending domain → all sends failed 403 "domain is not verified"
// (QA3 CRITICAL). Switched to the same SMTP transport as send-password-reset-email,
// which is verified working in production.
//
// Then deploy:
//   supabase functions deploy send-notification-email --project-ref <ref>
//
// Then enable the DB trigger (see SQL in EMAIL_NOTIFICATIONS.md).

// @ts-ignore - Deno runtime, will be resolved at deploy
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore - Deno runtime, will be resolved at deploy
import nodemailer from 'npm:nodemailer';

interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  type?: 'message' | 'order_status' | 'review' | 'credit' | 'general';
  link?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Tailwind-like inline email styles (works in most email clients)
function emailTemplate(payload: EmailRequest, link?: string): string {
  const appLink = link || 'https://straight.ltd/reddit/dashboard';
  const linkText = (() => {
    switch (payload.type) {
      case 'message':
        return 'View message';
      case 'order_status':
        return 'View order';
      case 'review':
        return 'See review';
      case 'credit':
        return 'View dashboard';
      default:
        return 'Open Straight Ltd';
    }
  })();

  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f8fafc; margin: 0; padding: 0;">
<div style="max-width: 600px; margin: 24px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
<div style="background: linear-gradient(to right, #f97316, #f59e0b); padding: 24px; color: white;">
<div style="display: flex; align-items: center; gap: 8px;">
<div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.2); display: inline-flex; align-items: center; justify-content: center; font-weight: bold;">R</div>
<strong style="font-size: 18px;">Straight Ltd</strong>
</div>
</div>
<div style="padding: 32px 24px;">
<h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 20px;">${payload.subject}</h2>
<p style="margin: 0 0 24px 0; color: #475569; font-size: 14px; line-height: 1.5;">${payload.body}</p>
<a href="${appLink}" style="display: inline-block; padding: 10px 20px; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">${linkText} →</a>
</div>
<div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; text-align: center;">
You received this because you have a Straight Ltd account.<br>
<a href="${appLink}" style="color: #f97316;">Manage notifications</a>
</div>
</div>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: EmailRequest = await req.json();

    if (!payload.to || !payload.subject || !payload.body) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // @ts-ignore - Deno env API
    const smtpHost = Deno.env.get('SMTP_HOST');
    // @ts-ignore - Deno env API
    const smtpPort = Deno.env.get('SMTP_PORT');
    // @ts-ignore - Deno env API
    const smtpUser = Deno.env.get('SMTP_USER');
    // @ts-ignore - Deno env API
    const smtpPass = Deno.env.get('SMTP_PASSWORD');
    // @ts-ignore - Deno env API
    const fromAddress = Deno.env.get('EMAIL_FROM') || 'Straight Ltd <care@straight.ltd>';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return new Response(JSON.stringify({ error: 'SMTP not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

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
      to: payload.to,
      subject: payload.subject,
      html: emailTemplate(payload, payload.link),
    });

    return new Response(JSON.stringify({ ok: true, id: info.messageId }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', detail: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
