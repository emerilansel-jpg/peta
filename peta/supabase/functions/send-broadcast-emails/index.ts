import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { SMTPClient } from "npm:emailjs@4.0.3";
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function getSecret(admin, key) {
  const { data } = await admin.from('app_secrets').select('value').eq('key', key).single();
  const v = data?.value;
  return v && String(v).trim().length > 0 ? String(v).trim() : null;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c)=>({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
}
function buildHtml(subject, body, fromAddr) {
  return `
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#0f172a;max-width:600px;margin:0 auto">
  <h2 style="color:#ff6b6b;margin:0 0 16px;font-size:20px">${escapeHtml(subject)}</h2>
  <div style="white-space:pre-wrap;font-size:15px;color:#0f172a">${escapeHtml(body)}</div>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px"/>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;font-size:13px;color:#9a3412;margin-bottom:16px">
    <strong style="color:#7c2d12">事 Penting:</strong> Email PeTa kadang masuk <strong>folder Spam / Promotions</strong>.
    Biar nggak ketinggalan update task &amp; payout, klik <strong>Add to Contacts</strong> /
    simpan <strong>${escapeHtml(fromAddr)}</strong> di kontak email kamu sekarang.
  </div>
  <p style="color:#64748b;font-size:12px;margin:8px 0 4px">
    PeTa · PenghasilanTambahan.com — Komen di internet, dibayar tiap hari.<br/>
    <a href="https://www.penghasilantambahan.com" style="color:#0ea5e9;text-decoration:none">www.penghasilantambahan.com</a>
  </p>
  <p style="color:#94a3b8;font-size:11px;margin:4px 0">Kamu menerima email ini karena terdaftar sebagai PeTa Army.</p>
</div>`;
}
function buildText(subject, body, fromAddr) {
  return `${subject}\n\n${body}\n\n---\nPenting: Email PeTa kadang masuk folder Spam / Promotions. Biar nggak ketinggalan update task & payout, simpan ${fromAddr} di kontak email kamu sekarang.\n\n— PeTa Team\nwww.penghasilantambahan.com`;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  const auth = req.headers.get('Authorization') || '';
  if (!auth.replace(/^Bearer\s+/i, '')) {
    return new Response(JSON.stringify({
      error: 'unauthenticated'
    }), {
      status: 401,
      headers: {
        ...CORS,
        'Content-Type': 'application/json'
      }
    });
  }
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY'), {
    global: {
      headers: {
        Authorization: auth
      }
    }
  });
  const { data: isAdminData, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr || !isAdminData) {
    return new Response(JSON.stringify({
      error: 'admin only'
    }), {
      status: 403,
      headers: {
        ...CORS,
        'Content-Type': 'application/json'
      }
    });
  }
  let body;
  try {
    body = await req.json();
  } catch  {
    body = {};
  }
  const broadcastId = body.broadcast_id;
  if (!broadcastId) {
    return new Response(JSON.stringify({
      error: 'broadcast_id required'
    }), {
      status: 400,
      headers: {
        ...CORS,
        'Content-Type': 'application/json'
      }
    });
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Read credentials from app_secrets (preferred) with env var fallback for legacy.
  const resendKey = await getSecret(admin, 'RESEND_API_KEY') || Deno.env.get('RESEND_API_KEY') || '';
  const smtpHost = await getSecret(admin, 'SMTP_HOST') || Deno.env.get('SMTP_HOST') || 'mail.spacemail.com';
  const smtpUser = await getSecret(admin, 'SMTP_USER') || Deno.env.get('SMTP_USER') || 'peta@penghasilantambahan.com';
  const smtpPass = await getSecret(admin, 'SMTP_PASS') || Deno.env.get('SMTP_PASS') || '';
  const smtpPortRaw = await getSecret(admin, 'SMTP_PORT') || Deno.env.get('SMTP_PORT') || '465';
  const smtpPort = parseInt(smtpPortRaw, 10);
  const fromAddr = await getSecret(admin, 'BROADCAST_FROM') || Deno.env.get('BROADCAST_FROM') || `PeTa <${smtpUser}>`;
  const fromAddrMatch = fromAddr.match(/<([^>]+)>/);
  const fromEmail = fromAddrMatch ? fromAddrMatch[1] : fromAddr;
  const hasResend = resendKey.length > 0;
  const hasSmtp = smtpHost.length > 0 && smtpUser.length > 0 && smtpPass.length > 0;
  const provider = hasResend ? 'resend' : hasSmtp ? 'smtp' : 'none';
  async function sendViaResend(to, subject, html, text) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddr,
          to,
          subject,
          html,
          text,
          tags: [
            {
              name: 'category',
              value: 'broadcast'
            }
          ]
        })
      });
      if (!r.ok) {
        const err = await r.text();
        return {
          ok: false,
          error: `resend_${r.status}_${err.slice(0, 200)}`
        };
      }
      return {
        ok: true
      };
    } catch (e) {
      return {
        ok: false,
        error: `resend_exception_${String(e.message).slice(0, 200)}`
      };
    }
  }
  async function sendViaSmtp(to, subject, html, text) {
    try {
      const client = new SMTPClient({
        user: smtpUser,
        password: smtpPass,
        host: smtpHost,
        port: smtpPort,
        ssl: smtpPort === 465,
        tls: smtpPort === 587,
        timeout: 20000
      });
      await new Promise((resolve, reject)=>{
        client.send({
          from: fromAddr,
          to,
          subject,
          text,
          attachment: [
            {
              data: html,
              alternative: true
            }
          ]
        }, (err)=>err ? reject(err) : resolve());
      });
      return {
        ok: true
      };
    } catch (e) {
      return {
        ok: false,
        error: `smtp_${String(e.message || e).slice(0, 250)}`
      };
    }
  }
  async function sendEmail(to, subject, html, text) {
    if (provider === 'resend') return sendViaResend(to, subject, html, text);
    if (provider === 'smtp') return sendViaSmtp(to, subject, html, text);
    return {
      ok: false,
      error: 'no_email_provider_configured'
    };
  }
  const { data: broadcast, error: bErr } = await admin.from('broadcasts').select('id, subject, body').eq('id', broadcastId).single();
  if (bErr || !broadcast) {
    return new Response(JSON.stringify({
      error: 'broadcast not found'
    }), {
      status: 404,
      headers: {
        ...CORS,
        'Content-Type': 'application/json'
      }
    });
  }
  const { data: recipients } = await admin.from('broadcast_recipients').select('id, email_snapshot').eq('broadcast_id', broadcastId).eq('channel', 'email').eq('status', 'pending');
  let sent = 0, failed = 0, skipped = 0;
  const html = buildHtml(broadcast.subject, broadcast.body, fromEmail);
  const text = buildText(broadcast.subject, broadcast.body, fromEmail);
  for (const r of recipients || []){
    if (!r.email_snapshot) {
      await admin.from('broadcast_recipients').update({
        status: 'skipped',
        error: 'no_email'
      }).eq('id', r.id);
      skipped++;
      continue;
    }
    const { ok, error } = await sendEmail(r.email_snapshot, broadcast.subject, html, text);
    if (ok) {
      await admin.from('broadcast_recipients').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        error: null
      }).eq('id', r.id);
      sent++;
    } else {
      const fb = provider === 'none' ? 'skipped' : 'failed';
      await admin.from('broadcast_recipients').update({
        status: fb,
        error: error || 'unknown'
      }).eq('id', r.id);
      if (fb === 'failed') failed++;
      else skipped++;
    }
  }
  if (sent > 0 || failed > 0) {
    await admin.from('broadcasts').update({
      email_sent: sent,
      email_failed: failed
    }).eq('id', broadcastId);
  }
  return new Response(JSON.stringify({
    success: true,
    sent,
    failed,
    skipped,
    provider,
    resend_configured: hasResend,
    smtp_configured: hasSmtp,
    from_addr: fromEmail
  }), {
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    }
  });
});