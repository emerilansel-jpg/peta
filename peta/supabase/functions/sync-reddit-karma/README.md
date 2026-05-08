# sync-reddit-karma

Server-side proxy that fetches a Reddit user's karma + account age and
returns them to the client. Reddit blocks Supabase egress IPs on the
public JSON endpoints, so we authenticate via OAuth using a registered
"installed app" client_id.

## One-time setup

### 1. Register a Reddit "installed" app

1. Log into reddit.com (any account; a service account is fine).
2. Visit https://www.reddit.com/prefs/apps
3. Scroll down and click **"are you a developer? create an app..."**
4. Fill:
   - **name:** `PeTa Karma Sync`
   - **type:** select **`installed app`** (not `script` and not `web app`)
   - **description:** `Karma verification for PeTa`
   - **about url:** `https://penghasilantambahan.com`
   - **redirect uri:** `https://penghasilantambahan.com` (required even though we won't use it)
5. Click **create app**.
6. Copy the **client_id** — it appears under the app name and looks
   like a 14-character string (e.g. `abc123XYZdef-A`). There is **no
   client_secret** for installed apps.

### 2. Add the secret to Supabase

Replace `<client_id>` with the value from step 1, and `<reddit_user>`
with your Reddit username.

```bash
# Production
supabase secrets set \
  REDDIT_CLIENT_ID=<client_id> \
  REDDIT_USER_AGENT="PeTaApp/1.0 by /u/<reddit_user>" \
  --project-ref yorlsgzsawchpeeazcvi

# Staging
supabase secrets set \
  REDDIT_CLIENT_ID=<client_id> \
  REDDIT_USER_AGENT="PeTaApp/1.0 by /u/<reddit_user>" \
  --project-ref duxzxizedtvnopfihllz
```

Or via the Supabase dashboard: **Project → Settings → Edge Functions →
Secrets**, add the two keys.

### 3. Verify

After saving the secrets, click **"Cek karma"** anywhere on the app.
The function returns `{ via: "oauth", karma: <real-number>, ... }`
when OAuth succeeds. If you see `{ fallback: true, reason: ..., oauthConfigured: false }`
in the network tab, the secret didn't get picked up.

## Behaviour

- **OAuth path** (used when `REDDIT_CLIENT_ID` is set): hits
  `oauth.reddit.com/user/<u>/about` with a bearer token. Bearer tokens
  are minted via `installed_client` grant and cached in module scope
  for ~50 minutes.
- **Public-fallback path**: tries `old.reddit.com`, `api.reddit.com`,
  `www.reddit.com` with two user-agent strings. Used when OAuth fails
  or the secret isn't set. Most calls hit `403` from Supabase egress.
- **No-data response**: returns `{ success: true, fallback: true,
  karma: 0, accountAgeDays: 0, reason }`. The client is responsible
  for not clobbering admin-set karma when `fallback === true`.

## Rate limits

Reddit's free OAuth tier allows ~100 queries/min. Way more than we
need for sync-on-demand. If we ever hit rate limits, cache karma per
user for 5 minutes server-side.
