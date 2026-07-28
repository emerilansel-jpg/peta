// Edge Function: sync-reddit-daily-activity (v2 — CORS proxy edition)
//
// Fetches today's Reddit activity (comments + posts) for one or more Reddit
// Army program members, then upserts the result via the
// `record_reddit_daily_activity` SECURITY DEFINER RPC.
//
// v2 NOTE (2026-07-30):
//   Reddit now requires pre-approval ("Responsible Builder Policy") to
//   register an OAuth app, which blocks self-serve CLIENT_ID setup. This
//   version therefore uses the same multi-tier CORS proxy chain that the
//   client-side syncRedditKarma() already uses successfully:
//     1. api.codetabs.com/v1/proxy   (note trailing slash requirement)
//     2. api.allorigins.win/raw
//     3. corsproxy.io
//   These proxies relay Reddit's public .json endpoints from their own IPs,
//   sidestepping Reddit's data-center IP block.
//
//   If REDDIT_CLIENT_ID is set (after future Reddit approval), the function
//   still prefers the OAuth path because it has higher rate limits.
//
// Trigger: pg_cron via pg_net (every hour) OR manual admin call from
// /admin/reddit-army > Daily Sync tab.
//
// Request body:
//   { "user_ids": ["uuid1", ...] }  // empty = all phase2/resigning users
//
// Authentication: caller MUST send the service-role key in the
// Authorization header (anon key is rejected — bypasses RLS).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CLIENT_ID = Deno.env.get('REDDIT_CLIENT_ID') || '';
const USER_AGENT = Deno.env.get('REDDIT_USER_AGENT')
  || 'PeTaApp/1.0 (Indonesia community task platform)';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BATCH_MAX = 20;
const THROTTLE_MS = 2000;     // between users
const RETRY_DELAY_MS = 400;   // between proxy retries
const ATTEMPTS_PER_PROXY = 2;

// --- OAuth (only used if REDDIT_CLIENT_ID is configured) ---
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getInstalledAppToken(): Promise<string | null> {
  if (!CLIENT_ID) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const basic = btoa(`${CLIENT_ID}:`);
  const body = new URLSearchParams({
    grant_type: 'https://oauth.reddit.com/grants/installed_client',
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
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.access_token) return null;
    cachedToken = {
      value: j.access_token,
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    };
    return j.access_token;
  } catch {
    return null;
  }
}

// --- Proxy chain (mirror of client-side syncRedditKarma) ---

function buildProxyUrls(redditPath: string): string[] {
  // redditPath e.g. "/user/{u}/comments.json?limit=100&t=day"
  const target = `https://www.reddit.com${redditPath}`;
  const enc = encodeURIComponent(target);
  // Order matters: codetabs (needs trailing slash) → allorigins → corsproxy
  return [
    `https://api.codetabs.com/v1/proxy/?quest=${enc}`,
    `https://api.allorigins.win/raw?url=${enc}`,
    `https://corsproxy.io/?${enc}`,
  ];
}

async function fetchRedditJson(redditPath: string): Promise<any | null> {
  const proxies = buildProxyUrls(redditPath);
  for (const proxyUrl of proxies) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_PROXY; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);
      try {
        const r = await fetch(proxyUrl, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!r.ok) continue;
        const text = await r.text();
        try {
          return JSON.parse(text);
        } catch {
          continue; // proxy returned HTML error page — try next
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

// OAuth path (preferred if CLIENT_ID is configured — higher rate limits).
async function fetchRedditJsonOAuth(redditPath: string, token: string): Promise<any | null> {
  try {
    const r = await fetch(`https://oauth.reddit.com${redditPath}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// --- Activity fetcher ---

function utcStartOfToday(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

type ActivityResult = {
  comments_today: number;
  posts_today: number;
  karma_at_end: number | null;
};

type ActivityError = { error: string; statusFlag?: 'suspended' | 'not_found' | 'unknown' };

async function fetchActivityForUser(username: string): Promise<ActivityResult | ActivityError> {
  const cutoff = utcStartOfToday();
  const oauthToken = await getInstalledAppToken();

  // Helper: try OAuth path first (if configured), then proxy chain.
  const fetcher = async (path: string) => {
    if (oauthToken) {
      const o = await fetchRedditJsonOAuth(path, oauthToken);
      if (o) return o;
    }
    return await fetchRedditJson(path);
  };

  try {
    // Comments today — check for 404 (not_found) / 403 (suspended) early
    const cPath = `/user/${encodeURIComponent(username)}/comments.json?limit=100&t=day`;
    const cJson = await fetcher(cPath);
    if (!cJson) {
      // Could be not_found or suspended — probe with about.json to disambiguate
      const about = await fetcher(`/user/${encodeURIComponent(username)}/about.json`);
      if (!about) return { error: 'no_data', statusFlag: 'unknown' };
      if (about?.data?.is_suspended) return { error: 'suspended', statusFlag: 'suspended' };
      // If about.json worked but comments.json didn't, likely user has 0 comments.
      const aboutKarma = about?.data?.total_karma ?? null;
      return {
        comments_today: 0,
        posts_today: 0,
        karma_at_end: aboutKarma,
      };
    }
    // Reddit returns {error: 404} body for non-existent users
    if (cJson?.error === 404) return { error: 'not_found', statusFlag: 'not_found' };
    if (cJson?.data?.is_suspended) return { error: 'suspended', statusFlag: 'suspended' };

    const comments = (cJson?.data?.children ?? []).filter(
      (c: any) => (c?.data?.created_utc ?? 0) >= cutoff
    ).length;

    // Posts today
    const pPath = `/user/${encodeURIComponent(username)}/submitted.json?limit=100&t=day`;
    const pJson = await fetcher(pPath);
    const posts = (pJson?.data?.children ?? []).filter(
      (c: any) => (c?.data?.created_utc ?? 0) >= cutoff
    ).length;

    // Karma — best-effort, failures non-fatal.
    let karma: number | null = null;
    const aJson = await fetcher(`/user/${encodeURIComponent(username)}/about.json`);
    if (aJson && !aJson?.error) {
      karma = aJson?.data?.total_karma ?? null;
    }

    return { comments_today: comments, posts_today: posts, karma_at_end: karma };
  } catch (e) {
    return { error: `network_${(e as Error).message.slice(0, 50)}`, statusFlag: 'unknown' };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Supabase helpers ---

async function getTargetUsers(userIds: string[]): Promise<
  Array<{ user_id: string; username: string; reddit_account_id: string }>
> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_reddit_army_sync_targets`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ p_user_ids: userIds.length ? userIds : null }),
  });
  if (!res.ok) {
    throw new Error(`list targets failed: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  return rows ?? [];
}

async function recordActivity(opts: {
  user_id: string;
  reddit_account_id: string;
  comments_today: number;
  posts_today: number;
  karma_at_end: number | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_reddit_daily_activity`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_user_id: opts.user_id,
      p_reddit_account_id: opts.reddit_account_id,
      p_activity_date: today,
      p_comments_today: opts.comments_today,
      p_posts_today: opts.posts_today,
      p_karma_at_end: opts.karma_at_end,
      p_sync_source: 'auto_cron',
    }),
  });
  if (!res.ok) {
    throw new Error(`record failed for ${opts.user_id}: ${res.status} ${await res.text()}`);
  }
}

// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const userIds: string[] = Array.isArray(body?.user_ids) ? body.user_ids : [];

    if (userIds.length > BATCH_MAX) {
      return json({ ok: false, error: `batch_max_exceeded (max ${BATCH_MAX})` }, 400);
    }

    const targets = await getTargetUsers(userIds);
    if (targets.length === 0) {
      return json({ ok: true, synced: 0, failed: 0, errors: [], note: 'no eligible users' });
    }

    let synced = 0;
    const errors: { user_id: string; reason: string }[] = [];
    const statusFlags: { user_id: string; statusFlag: string }[] = [];

    for (const t of targets) {
      const r = await fetchActivityForUser(t.username);
      if ('error' in r) {
        errors.push({ user_id: t.user_id, reason: r.error });
        if (r.statusFlag) {
          statusFlags.push({ user_id: t.user_id, statusFlag: r.statusFlag });
        }
      } else {
        try {
          await recordActivity({
            user_id: t.user_id,
            reddit_account_id: t.reddit_account_id,
            comments_today: r.comments_today,
            posts_today: r.posts_today,
            karma_at_end: r.karma_at_end,
          });
          synced++;
        } catch (e) {
          errors.push({ user_id: t.user_id, reason: `record_${(e as Error).message.slice(0, 50)}` });
        }
      }
      await sleep(THROTTLE_MS);
    }

    const elapsedMs = Date.now() - startedAt;
    return json({
      ok: true,
      synced,
      failed: errors.length,
      errors,
      statusFlags,
      elapsed_ms: elapsedMs,
      proxy_mode: CLIENT_ID ? 'oauth+proxy_fallback' : 'proxy_only',
    });
  } catch (e) {
    console.error('sync-reddit-daily-activity fatal', e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
