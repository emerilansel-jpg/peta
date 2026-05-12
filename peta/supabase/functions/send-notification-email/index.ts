// Supabase Edge Function: send-notification-email
//
// Sends an email via Resend when a notification is triggered.
// Set the RESEND_API_KEY secret first:
//   supabase secrets set RESEND_API_KEY=re_xxx --project-ref duxzxizedtvnopfihllz
//
// Then deploy:
//   supabase functions deploy send-notification-email --project-ref duxzxizedtvnopfihllz
//
// Then enable the DB trigger (see SQL in EMAIL_NOTIFICATIONS.md).

// @ts-ignore - Deno runtime, will be resolved at deploy
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

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
  const appLink = link || 'https://redditboost.pro/reddit/dashboard';
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
        return 'Open RedditBoost';
    }
  })();

  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f8fafc; margin: 0; padding: 0;">
<div style="max-width: 600px; margin: 24px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
<div style="background: linear-gradient(to right, #f97316, #f59e0b); padding: 24px; color: white;">
<div style="display: flex; align-items: center; gap: 8px;">
<div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.2); display: inline-flex; align-items: center; justify-content: center; font-weight: bold;">R</div>
<strong style="font-size: 18px;">RedditBoost</strong>
</div>
</div>
<div style="padding: 32px 24px;">
<h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 20px;">${payload.subject}</h2>
<p style="margin: 0 0 24px 0; color: #475569; font-size: 14px; line-height: 1.5;">${payload.body}</p>
<a href="${appLink}" style="display: inline-block; padding: 10px 20px; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">${linkText} →</a>
</div>
<div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; text-align: center;">
You received this because you have a RedditBoost account.<br>
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
    const apiKey = Deno.env.get('RESEND_API_KEY');
    // @ts-ignore - Deno env API
    const fromAddress = Deno.env.get('EMAIL_FROM') || 'RedditBoost <onboarding@resend.dev>';

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
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
        html: emailTemplate(payload, payload.link),
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend error:', resendData);
      return new Response(JSON.stringify({ error: 'Email send failed', detail: resendData }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: resendData.id }), {
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
