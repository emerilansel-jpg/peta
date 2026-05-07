// Edge Function: sync-reddit-karma
//
// Reddit blocks plain browser CORS to /user/<u>/about.json with 403 since
// 2023, so we proxy through this server-side function. Reddit also blocks
// most data-center IPs even with a User-Agent — we try a fallback chain
// (old.reddit.com, api.reddit.com, www.reddit.com × 3 user agents) before
// returning a graceful fallback. Admin manual entry via admin_set_karma()
// is the canonical path when scraping fails.
//
// Deploy: supabase functions deploy sync-reddit-karma
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function sanitizeUsername(raw: unknown): string | null {
  if (!raw) return null;
  const u = String(raw).trim();
  const m = u.match(/(?:reddit\.com\/(?:u|user)\/)?(?:u\/)?([A-Za-z0-9_-]{3,32})/);
  return m ? m[1] : null;
}

async function fetchRedditAbout(username: string): Promise<{ ok: true; data: any } | { ok: false; reason: string }> {
  const targets = [
    `https://old.reddit.com/user/${username}/about.json`,
    `https://api.reddit.com/user/${username}/about`,
    `https://www.reddit.com/user/${username}/about.json`,
  ];
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'PeTaApp:karma-sync:v1.0 (by /u/peta_app)',
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
    const res = await fetchRedditAbout(username);
    if (!res.ok) {
      return new Response(JSON.stringify({
        success: true, fallback: true, reason: res.reason,
        username, karma: 0, accountAgeDays: 0,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const d = res.data;
    const karma = (d.link_karma || 0) + (d.comment_karma || 0);
    const accountAgeDays = Math.floor((Date.now() - (d.created_utc * 1000)) / 86400000);
    return new Response(JSON.stringify({
      success: true, username, karma, accountAgeDays,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({
      success: true, fallback: true, reason: 'exception',
      karma: 0, accountAgeDays: 0, error: String(e),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
