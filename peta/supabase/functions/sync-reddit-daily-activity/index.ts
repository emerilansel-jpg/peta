// Edge Function: sync-reddit-daily-activity
//
// Fetches today's Reddit activity (comments + posts) for one or more Reddit
// Army program members, then upserts the result via the
// `record_reddit_daily_activity` SECURITY DEFINER RPC.
//
// Trigger: pg_cron via pg_net (every hour) OR manual admin call from
// /admin/reddit-army > Daily Sync tab.
//
// Request body:
//   { "user_ids": ["uuid1", "uuid2", ...] }  // empty = all phase2/resigning users
//
// Authentication: caller MUST send the Supabase service-role key in the
// Authorization header (anon key is rejected — this function bypasses RLS).
//
// Required secrets:
//   REDDIT_CLIENT_ID     — Reddit "installed app" client id
//   REDDIT_USER_AGENT    — descriptive UA string
//   SUPABASE_URL         — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
//
// Reddit API:
//   - GET /user/{u}/comments?limit=100&t=day   → today's comments
//   - GET /user/{u}/submitted?limit=100&t=day  → today's posts
//   - GET /user/{u}/about                       → current karma (optional)
//
// Rate limiting: 1 request / 3s throttle inside this function.
// Per-call batch size: 20 users max.
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
const THROTTLE_MS = 3000;

// --- OAuth (module-scope cached token, same pattern as sync-reddit-karma) ---
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
    if (!r.ok) {
      console.warn(`reddit oauth token http ${r.status}`);
      return null;
    }
    const j = await r.json();
    if (!j?.access_token) return null;
    cachedToken = {
      value: j.access_token,
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    };
    return j.access_token;
  } catch (e) {
    console.warn('reddit oauth token failed', e);
    return null;
  }
}

// --- Reddit fetch helpers ---

function utcStartOfToday(): number {
  // Start of today UTC in seconds (Reddit uses UTC epoch seconds).
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

type ActivityResult = {
  comments_today: number;
  posts_today: number;
  karma_at_end: number | null;
};

async function fetchActivityForUser(
  username: string,
  oauthToken: string | null
): Promise<ActivityResult | { error: string }> {
  const cutoff = utcStartOfToday();
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (oauthToken) headers['Authorization'] = `Bearer ${oauthToken}`;

  // Try OAuth host first, fall back to www.reddit.com (anonymous) if no token.
  const host = oauthToken ? 'https://oauth.reddit.com' : 'https://www.reddit.com';

  try {
    // Comments today
    const cRes = await fetch(`${host}/user/${encodeURIComponent(username)}/comments.json?limit=100&t=day`, {
      headers,
    });
    if (cRes.status === 404) return { error: 'not_found' };
    if (cRes.status === 403) return { error: 'suspended' };
    if (!cRes.ok) return { error: `comments_http_${cRes.status}` };
    const cJson = await cRes.json();
    const comments = (cJson?.data?.children ?? []).filter(
      (c: any) => (c?.data?.created_utc ?? 0) >= cutoff
    ).length;

    // Posts today
    await sleep(THROTTLE_MS);
    const pRes = await fetch(`${host}/user/${encodeURIComponent(username)}/submitted.json?limit=100&t=day`, {
      headers,
    });
    if (!pRes.ok) return { error: `posts_http_${pRes.status}` };
    const pJson = await pRes.json();
    const posts = (pJson?.data?.children ?? []).filter(
      (c: any) => (c?.data?.created_utc ?? 0) >= cutoff
    ).length;

    // Karma (best-effort; failures here are non-fatal).
    let karma: number | null = null;
    try {
      await sleep(THROTTLE_MS);
      const aRes = await fetch(`${host}/user/${encodeURIComponent(username)}/about.json`, { headers });
      if (aRes.ok) {
        const aJson = await aRes.json();
        karma = aJson?.data?.total_karma ?? null;
      }
    } catch {
      // ignore karma fetch failures
    }

    return { comments_today: comments, posts_today: posts, karma_at_end: karma };
  } catch (e) {
    return { error: `network_${(e as Error).message.slice(0, 50)}` };
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
  // If user_ids is provided, fetch those. Otherwise query for all active members.
  const url = userIds.length
    ? `${SUPABASE_URL}/rest/v1/rpc/list_reddit_army_sync_targets`
    : `${SUPABASE_URL}/rest/v1/rpc/list_reddit_army_sync_targets`;

  const res = await fetch(url, {
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

    const oauthToken = await getInstalledAppToken();

    let synced = 0;
    const errors: { user_id: string; reason: string }[] = [];

    for (const t of targets) {
      const r = await fetchActivityForUser(t.username, oauthToken);
      if ('error' in r) {
        errors.push({ user_id: t.user_id, reason: r.error });
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

    return json({ ok: true, synced, failed: errors.length, errors });
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
