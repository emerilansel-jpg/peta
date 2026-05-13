# Reddit OAuth Setup for PeTa Karma Sync

## Why OAuth?

Reddit blocks data-center IPs on public endpoints (even `/user/<u>/about.json`). OAuth via "installed app" flow works because it uses app-level auth instead of IP-based geo-blocking.

## Step 1: Register Reddit "Installed App"

1. Go https://www.reddit.com/prefs/apps → **"Create another app..."** at bottom
2. Fill in:
   - **Name**: "PeTa Karma Sync" (or any name)
   - **Type**: ⦿ **installed app** (NOT web app)
   - **Redirect URI**: `http://localhost` (dummy value, not used)
   - **About URL**: `https://penghasilantambahan.com` (optional)
3. Click **Create**
4. You'll get:
   - **Client ID**: long hex string under app name
   - **Client Secret**: (empty for installed apps — don't fill in)
5. **Copy the Client ID** — you'll need it next.

## Step 2: Set Supabase Secrets (Staging)

### Via Supabase Dashboard:

1. Go **https://supabase.com/dashboard/project/duxzxizedtvnopfihllz** (staging)
2. Click **Settings** → **Secrets**
3. Click **New secret**
4. **Name**: `REDDIT_CLIENT_ID`
   **Value**: `<paste your Client ID from Step 1>`
   → **Save**
5. Click **New secret** again
6. **Name**: `REDDIT_USER_AGENT`
   **Value**: `PeTaApp/1.0 by /u/PeTa-Admin` (or your Reddit username)
   → **Save**

### Via Supabase CLI:

```bash
cd peta
supabase link --project-ref duxzxizedtvnopfihllz
supabase secrets set REDDIT_CLIENT_ID="<your-client-id>"
supabase secrets set REDDIT_USER_AGENT="PeTaApp/1.0 by /u/PeTa-Admin"
```

## Step 3: Verify OAuth Works in Staging

1. Go **https://staging.penghasilantambahan.com**
2. Register a new account
3. Complete Onboarding, reach **Step 5 (Reddit URL)**
4. Enter a valid Reddit username (e.g., `reddit` or `AutoModerator`)
5. Click **Simpan & Lanjut**
6. **Expected**: Karma + age auto-populate instantly
7. **If fails**: Check Supabase edge function logs:
   ```
   Dashboard → Functions → sync-reddit-karma → Invocations (check recent calls)
   ```

## Step 4: Replicate for Production

Once verified in staging, repeat Steps 2–3 for **prod**:

### Via Dashboard:

1. Go **https://supabase.com/dashboard/project/yorlsgzsawchpeeazcvi** (prod)
2. Settings → Secrets
3. Add same `REDDIT_CLIENT_ID` and `REDDIT_USER_AGENT`

### Via CLI:

```bash
supabase link --project-ref yorlsgzsawchpeeazcvi
supabase secrets set REDDIT_CLIENT_ID="<your-client-id>"
supabase secrets set REDDIT_USER_AGENT="PeTaApp/1.0 by /u/PeTa-Admin"
```

## Testing Checklist

### Fresh Signup Flow

- [ ] Register new account on staging
- [ ] Reach Onboarding step 5, enter username (use `reddit` or similar well-known account)
- [ ] Karma + age auto-populate
- [ ] Proceed to step 6
- [ ] Check `reddit_accounts` table: karma > 0, account_age_days > 0

### Admin Manual Sync

- [ ] Login as admin to staging
- [ ] Go `/admin/reddit-accounts`
- [ ] Find a user with karma=0
- [ ] Click 🔄 button
- [ ] Toast: "Karma disync dari Reddit" (not "Reddit blokir...")
- [ ] Karma updates to real value

### Edge Function Logging

If sync fails:
1. Supabase Dashboard → **Functions** → **sync-reddit-karma**
2. **Invocations** tab → recent calls
3. Check `stdout` / `stderr` for:
   - OAuth token fetch failure → CLIENT_ID wrong
   - Public endpoint 403 → fallback (expected, no CLIENT_ID)
   - 200 but no data → invalid username

## Fallback Behavior

If OAuth fails (CLIENT_ID not set, Reddit outage, etc.):
- Edge function returns `fallback: true`, `karma: 0`
- UI shows "Reddit blokir / akun tidak ditemukan — set manual"
- Admin can manually set karma via **✏️ Edit** button
- Honor-system karma claims still work for users who explicitly submit via KarmaMission page

## Maintenance

**Token caching**: OAuth tokens cached for ~50 min per edge function instance. No DB hits needed.

**Rate limits**: Reddit allows ~1 request/sec per installed app. Should be fine for PeTa scale.

**Monitoring**: Check edge function logs weekly for spike in fallback responses.
