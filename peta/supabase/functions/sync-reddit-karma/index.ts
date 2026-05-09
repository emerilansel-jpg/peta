// Edge Function: sync-reddit-karma (v4)
//
// Reddit's anti-bot now blocks data-center IPs even on the public
// JSON endpoints. The only sustainable path is OAuth via a registered
// Reddit "installed app" (no secret required, just a client_id).
//
// Set the secret in Supabase:
//   supabase secrets set REDDIT_CLIENT_ID=xxxxxxxx --project-ref <ref>
//   supabase secrets set REDDIT_USER_AGENT="PeTaApp/1.0 by /u/<owner>"
//
// If REDDIT_CLIENT_ID is set, we use the installed-app OAuth flow:
//   1) POST /api/v1/access_token  (Basic auth: <id>:)  → bearer token
//   2) GET  oauth.reddit.com/user/<u>/about  with that bearer
// Token cached in module scope for ~50 min (Reddit issues 1h tokens).
//
// If REDDIT_CLIENT_ID is missing we still try the public endpoints as
// a best-effort, but they'll usually return 403 from Supabase egress.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLIENT_ID = Deno.env.get('REDDIT_CLIENT_ID') || '';
const USER_AGENT = Deno.env.get('REDDIT_USER_AGENT')
  || 'PeTaApp/1.0 (Indonesia community task platform)';

function sanitizeUsername(raw: unknown): string | null {
  if (!raw) return null;
  const u = String(raw).trim();
  const m = u.match(/(?:reddit\.com\/(?:u|user)\/)?(?:u\/)?([A-Za-z0-9_-]{3,32})/);
  return m ? m[1] : null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getInstalledAppToken(): Promise<string | null> {
  if (!CLIENT_ID) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  // Basic auth with empty password — installed app spec.
  const basic = btoa(`${CLIENT_ID}:`);
  const body = new URLSearchParams({
    grant_type: 'https://oauth.reddit.com/grants/installed_client',
    // Reddit accepts a fixed device_id placeholder for non-tracking.
    device_id: 'DO_NOT_TRACK_THIS_DEVICE',
  });

  try {
    const r = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body,
    });
    if (!r.ok) {
      console.warn(`reddit oauth token http ${r.status}: ${await r.text().catch(()=>"")}`);
      return null;
    }
    const j = await r.json();
    if (!j?.access_token) return null;
    const ttl = (j.expires_in || 3600) * 1000;
    cachedToken = {
      value: j.access_token,
      expiresAt: Date.now() + ttl,
    };
    return j.access_token;
  } catch (e) {
    console.warn('reddit oauth token failed', e);
    return null;
  }
}

async function fetchAboutOAuth(username: string): Promise<{ ok: true; data: any } | { ok: false; reason: string }> {
  const token = await getInstalledAppToken();
  if (!token) return { ok: false, reason: 'no_token' };
  try {
    const r = await fetch(`https://oauth.reddit.com/user/${username}/about`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });
    if (!r.ok) return { ok: false, reason: `oauth_status_${r.status}` };
    const j = await r.json();
    if (j?.data) return { ok: true, data: j.data };
    return { ok: false, reason: 'oauth_no_data' };
  } catch (e) {
    return { ok: false, reason: `oauth_exception_${(e as Error).message}` };
  }
}

async function fetchAboutPublic(username: string): Promise<{ ok: true; data: any } | { ok: false; reason: string }> {
  const targets = [
    `https://old.reddit.com/user/${username}/about.json`,
    `https://api.reddit.com/user/${username}/about`,
    `https://www.reddit.com/user/${username}/about.json`,
  ];
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    USER_AGENT,
  ];
  let lastReason = 'unknown';
  for (const url of targets) {
    for (const ua of userAgents) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': ua, 'Accept': 'application/json' },
          redirect: 'follow',
        });
        if (r.ok) {
          const j = await r.json();
          if (j?.data) return { ok: true, data: j.data };
          lastReason = 'no_data';
        } else {
          lastReason = `status_${r.status}`;
        }
      } catch (e) {
        lastReason = `exception_${(e as Error).message}`;
      }
    }
  }
  return { ok: false, reason: lastReason };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const username = sanitizeUsername(body?.username);
    if (!username) {
      return new Response(JSON.stringify({ success: false, error: 'invalid_username' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // OAuth path first (only works when REDDIT_CLIENT_ID set)
    let res = await fetchAboutOAuth(username);
    const viaOAuth = res.ok;
    if (!res.ok) res = await fetchAboutPublic(username);

    if (!res.ok) {
      return new Response(JSON.stringify({
        success: true, fallback: true, reason: res.reason,
        username, karma: 0, accountAgeDays: 0,
        oauthConfigured: !!CLIENT_ID,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const d = res.data;
    const karma = (d.link_karma || 0) + (d.comment_karma || 0);
    const accountAgeDays = Math.floor((Date.now() - (d.created_utc * 1000)) / 86400000);
    return new Response(JSON.stringify({
      success: true, username, karma, accountAgeDays,
      via: viaOAuth ? 'oauth' : 'public',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({
      success: true, fallback: true, reason: 'exception',
      karma: 0, accountAgeDays: 0, error: String(e),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
