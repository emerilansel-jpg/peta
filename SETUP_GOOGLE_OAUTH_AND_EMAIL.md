# Step-by-Step: Google OAuth + Email Notifications

Two separate features. Roughly **15 minutes total** if done in one session.

---

# PART 1 — Google OAuth (5 minutes)

## Step 1.1 — Open Google Cloud Console

1. Open in your browser: https://console.cloud.google.com/
2. If you've never used GCP before, accept the Terms of Service when prompted.

## Step 1.2 — Create a project

1. Click the project dropdown at the top (says "Select a project" if none).
2. Click **NEW PROJECT** (top-right of the popup).
3. Project name: **RedditBoost** (any name works).
4. Click **CREATE**.
5. Wait ~10 seconds. Make sure the project selector at the top shows "RedditBoost".

## Step 1.3 — Configure OAuth consent screen

1. In the left sidebar menu, navigate to: **APIs & Services** → **OAuth consent screen**.
2. Choose **External** → Click **CREATE**.
3. Fill in:
   - **App name**: RedditBoost
   - **User support email**: your email
   - **App logo**: skip
   - **App domain**: skip (for now)
   - **Developer contact info**: your email
4. Click **SAVE AND CONTINUE**.
5. **Scopes** screen: click **SAVE AND CONTINUE** (default scopes are fine — email, profile, openid).
6. **Test users** screen: click **+ ADD USERS** → add your own email → **SAVE AND CONTINUE**.
   - (This is needed only while the app is in Testing mode. Once you publish, anyone can sign in.)
7. **Summary** screen: click **BACK TO DASHBOARD**.

## Step 1.4 — Create OAuth Client ID

1. Left sidebar: **APIs & Services** → **Credentials**.
2. At the top, click **+ CREATE CREDENTIALS** → **OAuth client ID**.
3. **Application type**: select **Web application**.
4. **Name**: RedditBoost Web (any name).
5. **Authorized JavaScript origins** — skip (leave empty).
6. **Authorized redirect URIs** — click **+ ADD URI**, paste exactly:
   ```
   https://duxzxizedtvnopfihllz.supabase.co/auth/v1/callback
   ```
7. Click **CREATE**.
8. A modal appears with **Client ID** and **Client Secret**. **Copy both** — you'll paste them into Supabase next.
9. Keep this tab open.

## Step 1.5 — Enable Google in Supabase

1. Open in another tab: https://supabase.com/dashboard/project/duxzxizedtvnopfihllz/auth/providers
2. Scroll down, find **Google** in the providers list.
3. Click to expand → toggle **Enabled** to ON.
4. Paste:
   - **Client ID (for OAuth)** → the Client ID from step 1.4.
   - **Client Secret (for OAuth)** → the Client Secret from step 1.4.
5. Click **Save**.

## Step 1.6 — Test it

1. Open: http://localhost:5173/reddit/signup
2. Click **Continue with Google**.
3. Pick your Google account → consent screen → click **Continue**.
4. You should land at `/reddit/dashboard` with a new account created.

## Step 1.7 — Going live (later)

When you publish to the public:

1. Back in **APIs & Services** → **OAuth consent screen** → click **PUBLISH APP**.
2. (Without publishing, only the test users you added can sign in.)
3. The same Client ID + redirect URI work — no code changes.

### Common errors

| Error | Fix |
|---|---|
| `"redirect_uri_mismatch"` | The redirect URI in step 1.4.6 must match exactly. Including `https://`. No trailing slash. |
| `"Access blocked: app not verified"` | App still in Testing mode. Add your email to Test Users (step 1.3.6) OR Publish App (step 1.7). |
| `"Unsupported provider"` | Google not enabled in Supabase (step 1.5). |

---

# PART 2 — Email Notifications (10 minutes)

This sends emails to clients when they get a new message, order update, credit added, etc. Uses Resend (free tier: 3,000 emails/month).

## Step 2.1 — Create Resend account

1. Go to https://resend.com/signup
2. Sign up with email (use your business email)
3. Verify your email (check inbox for verification link)
4. Login to https://resend.com/dashboard

## Step 2.2 — Add a sender (skip if using test mode)

**Option A — Quick test mode** (only sends emails to YOUR own verified email — fine for testing)
- Use `onboarding@resend.dev` as your sender. No domain setup needed.
- Skip to step 2.3.

**Option B — Production sender** (sends to anyone, needs your domain)
1. In Resend → **Domains** → **+ Add Domain**.
2. Enter your domain (e.g. `redditboost.pro` or your existing domain).
3. Resend gives you 3 DNS records (SPF, DKIM, DMARC). Add them to your DNS provider (Cloudflare/Namecheap/etc).
4. Wait ~5 min, click **Verify DNS**.
5. Once verified, you can send from `anything@yourdomain.com`.

## Step 2.3 — Get the API key

1. In Resend → **API Keys** → **Create API Key**.
2. Name: **RedditBoost Production**, Permission: **Full access**, Domain: **All domains**.
3. Click **Add**.
4. **Copy the API key** (starts with `re_`). You won't see it again.

## Step 2.4 — Install Supabase CLI (if not already)

```bash
# Windows (PowerShell)
scoop install supabase

# Or via npm
npm install -g supabase
```

Verify:
```bash
supabase --version
```

## Step 2.5 — Login + link your project

```bash
supabase login
# follow the browser flow

cd "D:\Claude Cowork\Reddit Army Local\peta"
supabase link --project-ref duxzxizedtvnopfihllz
```

## Step 2.6 — Set secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx --project-ref duxzxizedtvnopfihllz
supabase secrets set EMAIL_FROM="RedditBoost <onboarding@resend.dev>" --project-ref duxzxizedtvnopfihllz
```

If you set up your own domain in step 2.2, use that instead:
```bash
supabase secrets set EMAIL_FROM="RedditBoost <noreply@yourdomain.com>" --project-ref duxzxizedtvnopfihllz
```

## Step 2.7 — Deploy the edge function

The function is already written in [peta/supabase/functions/send-notification-email/index.ts](peta/supabase/functions/send-notification-email/index.ts).

Deploy it:
```bash
cd "D:\Claude Cowork\Reddit Army Local\peta"
supabase functions deploy send-notification-email --project-ref duxzxizedtvnopfihllz --no-verify-jwt
```

Wait for "Deployed Function" message.

## Step 2.8 — Get your anon key

1. Open: https://supabase.com/dashboard/project/duxzxizedtvnopfihllz/settings/api
2. Copy the **anon public** key (starts with `eyJhbGc...`).

## Step 2.9 — Enable the email trigger

1. Open: https://supabase.com/dashboard/project/duxzxizedtvnopfihllz/sql/new
2. Paste the SQL below (**replace `<paste-your-anon-key-here>`** with the key from step 2.8):

```sql
-- Enable HTTP from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Trigger function
CREATE OR REPLACE FUNCTION public.fn_send_email_on_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_user_email TEXT;
  v_function_url TEXT := 'https://duxzxizedtvnopfihllz.supabase.co/functions/v1/send-notification-email';
  v_anon_key TEXT := '<paste-your-anon-key-here>';
BEGIN
  -- Only email user notifications (not admin internal ones)
  IF NEW.target_role != 'user' THEN RETURN NEW; END IF;
  -- Skip noisy types (uncomment to filter)
  -- IF NEW.type NOT IN ('message', 'order_status') THEN RETURN NEW; END IF;

  SELECT email INTO v_user_email FROM public.users WHERE id = NEW.user_id;
  IF v_user_email IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := jsonb_build_object(
      'to', v_user_email,
      'subject', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'type', NEW.type,
      'link', CASE WHEN NEW.link IS NOT NULL THEN 'http://localhost:5173' || NEW.link ELSE NULL END
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_send_email_on_notification ON public.notifications;
CREATE TRIGGER trg_send_email_on_notification AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE PROCEDURE public.fn_send_email_on_notification();
```

3. Click **Run**. Should show "Success. No rows returned."

## Step 2.10 — Test it

1. Login as admin at http://localhost:5173/reddit/login (info@jetdigitalpro.com / peta)
2. Go to **Messages** → pick a client conversation
3. Send a message: "Test email"
4. Check the client's email inbox (might be in Spam — flag as Not Spam to fix future delivery)
5. You should see a RedditBoost-branded email with the message + "View message" button.

### Common errors

| Error | Fix |
|---|---|
| Function deploys but no email arrives | Check Resend dashboard → **Logs** for the actual error |
| `RESEND_API_KEY not configured` | Re-run step 2.6 with the correct key |
| Email in spam | Set up your own domain (step 2.2 option B) — `onboarding@resend.dev` is shared |
| `permission denied for table notifications` | Re-run the SQL in step 2.9 |

## Step 2.11 — Going to production

When you deploy to real domain:

1. Update the URL in the trigger function:
```sql
'link', CASE WHEN NEW.link IS NOT NULL THEN 'https://yourdomain.com' || NEW.link ELSE NULL END
```
2. Make sure `EMAIL_FROM` uses your verified domain (not `resend.dev`).

---

# Quick checklist

After completing both parts, verify:

- [ ] Sign up via Google works at `/reddit/signup` (Part 1)
- [ ] Send admin message → arrives in client inbox (Part 2)
- [ ] Email has RedditBoost branding + working "View message" link

If both work, you're done with infrastructure setup.
