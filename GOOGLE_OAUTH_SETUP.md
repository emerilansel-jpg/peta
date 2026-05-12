# Google OAuth Setup

The error you got — `"Unsupported provider: provider is not enabled"` — means Google OAuth is not enabled in your Supabase project. You need to set it up once. ~5 minutes.

## Step 1: Get Google OAuth credentials

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project (if you don't have one) — call it "RedditBoost" or anything
3. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
4. If prompted, configure consent screen first:
   - User type: External
   - App name: RedditBoost
   - Support email: your email
   - Authorized domains: leave blank for now
   - Scopes: keep defaults (email, profile, openid)
   - Test users: add your email
5. Back to Credentials → **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Type: **Web application**
   - Name: RedditBoost Web
   - **Authorized redirect URIs**: paste this exact URL:
     ```
     https://duxzxizedtvnopfihllz.supabase.co/auth/v1/callback
     ```
   - Click **CREATE**
6. Copy the **Client ID** and **Client Secret** that appears

## Step 2: Enable in Supabase

1. Go to https://supabase.com/dashboard/project/duxzxizedtvnopfihllz/auth/providers
2. Find **Google** in the list
3. Toggle to **Enabled**
4. Paste:
   - **Client ID (for OAuth)** → the Client ID from Google
   - **Client Secret (for OAuth)** → the Client Secret from Google
5. Click **Save**

## Step 3: Test

1. Refresh http://localhost:5173/reddit/signup
2. Click "Continue with Google"
3. Google login screen appears
4. Pick your account → consent
5. Redirected back to `/reddit/dashboard` with active session

## Behind the scenes

When a Google user signs in:
- Supabase creates a row in `auth.users`
- The `handle_new_user` trigger creates a row in `public.users` with:
  - `email` from Google
  - `full_name` from Google's display name
  - `role = 'army'`
  - `is_active = true`
- They're redirected to `/reddit/dashboard`

No code changes needed — once Google is enabled in Supabase, the existing button works.

## Going to production

When you deploy to your real domain (e.g. `redditboost.com`):

1. In Google Cloud Console → Credentials → your OAuth client → edit
2. Add to **Authorized redirect URIs**:
   ```
   https://duxzxizedtvnopfihllz.supabase.co/auth/v1/callback
   ```
   (same URL — Supabase always handles the callback)
3. In OAuth consent screen → add your production domain to Authorized domains
4. If not in production yet, click **PUBLISH APP** when ready (otherwise only test users can sign in)
