// Supabase Edge Function: fetch-reddit-profile
//
// Server-side fetch of a Reddit user's public profile (about.json) so the
// frontend never depends on CORS proxies (codetabs/allorigins/corsproxy are
// dead or CSP-blocked — QA3 FIX 4).
//
// Response shapes:
//   200 { ok: true,  found: true,  username, karma, account_age_days, source }
//   200 { ok: true,  found: false, username }              // 404 — user doesn't exist
//   200 { ok: false, reason: 'blocked' }                   // Reddit blocked egress — frontend falls back
//   400 { error: 'invalid_username' }
//
// verify_jwt = true (default) so this is not an open proxy. The onboarding
// flow is called by an authenticated army user.
//
// Note: Reddit has been hardening its API — unauthenticated JSON endpoints
// are sometimes blocked from cloud egress IPs (HTTP 403 "blocked by network
// security"). In that case we return ok:false so the UI can degrade
// gracefully. The durable fix is OAuth (REDDIT_CLIENT_ID + installed-app
// flow) — see sync-reddit-karma.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

function sanitizeUsername(raw: unknown): string {
  return String(raw || '')
    .replace(/^.*?(?:reddit\.com\/)?(?:u\/|user\/)?/i, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 32);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const username = sanitizeUsername(body?.username);
    if (!username) return json({ error: 'invalid_username' }, 400);

    // Try multiple endpoints — some are less aggressively blocked than others.
    const targets = [
      `https://old.reddit.com/user/${username}/about.json`,
      `https://api.reddit.com/user/${username}/about`,
      `https://www.reddit.com/user/${username}/about.json`,
    ];

    for (const url of targets) {
      for (const ua of USER_AGENTS) {
        try {
          const r = await fetch(url, {
            headers: { 'User-Agent': ua, 'Accept': 'application/json' },
            redirect: 'follow',
          });
          if (r.status === 404) {
            return json({ ok: true, found: false, username });
          }
          if (r.ok) {
            const j = await r.json();
            const data = j?.data;
            if (data?.name) {
              const createdUtc = Number(data.created_utc || 0);
              const accountAgeDays = createdUtc > 0
                ? Math.max(0, Math.floor((Date.now() / 1000 - createdUtc) / 86400))
                : 0;
              const karma = (Number(data.link_karma) || 0) + (Number(data.comment_karma) || 0);
              return json({
                ok: true,
                found: true,
                username: data.name,
                karma,
                account_age_days: accountAgeDays,
                source: url,
              });
            }
          }
        } catch (e) {
          console.error('fetch-reddit-profile error for', username, e);
        }
      }
    }

    // All targets failed (likely Reddit blocking cloud egress — 403/429).
    return json({ ok: false, reason: 'blocked' });
  } catch (err: any) {
    console.error('Function error:', err);
    return json({ error: 'internal_error', detail: err.message }, 500);
  }
});
