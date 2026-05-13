# Resend Setup — Handoff (UPDATED 2026-05-13)

## What's Done in Code

Edge function `send-broadcast-emails` (v2) is deployed on staging + prod with:

- **Default `FROM`**: `PeTa <peta@penghasilantambahan.com>` (overridable via `BROADCAST_FROM` secret)
- **Spam-folder reminder**: Every email body now ends with a prominent yellow callout asking recipients to save the sender to their contacts. Plain-text fallback too.
- **Test endpoint**: `/admin/broadcast` page has "Test ke Saya Dulu" button — sends test to admin's own email + WA before blasting full audience.

## What's Done in Resend

| Item | Status |
|---|---|
| Account created | ✅ |
| Email verified | ✅ |
| Login | https://resend.com/login |
| Email | `n311311@gmail.com` |
| Password | `PetaResend!2026SecurePwd` |
| API key | ❌ — Resend dashboard hangs on "Loading..." in browser automation context |
| Domain `penghasilantambahan.com` | ❌ — needs to be added after API key |

> **Why the dashboard hangs:** Resend's React app is stuck on a perpetual "Loading…" state in Nell's Computer browser. Likely conflict between Resend's hydration logic and the Chrome extension that drives automation. The account itself works fine — log in manually in a regular browser tab and everything renders normally. Burned 10+ attempts before stopping.

## What You Need to Do (≈ 5 min total)

### Step 1: Get the API key (30 sec)

1. Open a NORMAL browser tab (not driven by extensions) → https://resend.com/login
2. Login with creds above
3. Click **"API keys"** in left sidebar → **Create API key**
4. Name: `PeTa Production` · Permission: **Full access** · Domain: **All domains**
5. Click **Add** → **copy the key** (`re_...`) — only shown once
6. **Paste in chat**, I'll set both Supabase secrets via MCP in 2 seconds

### Step 2: Add domain at Resend (1 min)

1. In Resend dashboard → **Domains** → **Add Domain**
2. Enter `penghasilantambahan.com`
3. Resend gives you 3 records:
   - SPF: `TXT @ "v=spf1 include:_spf.resend.com ~all"` (or similar)
   - DKIM: `TXT resend._domainkey "p=..."` (long key)
   - DMARC: `TXT _dmarc "v=DMARC1; p=none;..."`
4. **Screenshot the records** and paste in chat — I'll guide DNS step OR you can do it directly.

### Step 3: Add DNS records at Spaceship (3 min)

1. Login: https://www.spaceship.com → Launchpad → Domains → `penghasilantambahan.com` → Advanced DNS
2. Add each TXT record from step 2
3. Save. Propagation: usually 5-30 min.

### Step 4: Verify + Set `peta@` mailbox (auto-routed)

1. Back at Resend → **Domains** → click your domain → click **Verify** (after DNS propagates)
2. Once verified, Resend can send emails FROM `peta@penghasilantambahan.com` (any prefix on your domain works without inbox creation)
3. **Important:** `peta@penghasilantambahan.com` doesn't receive replies unless you also set up MX records for an inbox. Out of scope for sending broadcasts.

### Step 5: Optionally set BROADCAST_FROM secret

If you want to change the From display name:

```
BROADCAST_FROM="PeTa Indonesia <peta@penghasilantambahan.com>"
```

Set in Supabase staging + prod via Settings → Edge Functions → Manage Secrets.

(Default already uses `peta@penghasilantambahan.com` if `BROADCAST_FROM` is unset.)

## After Setup — Smoke Test

1. Login as admin → `/admin/broadcast`
2. Compose: subject "Test from PeTa", body "Halo, ini test broadcast."
3. Click **"Test ke Saya Dulu"** (orange button)
4. Open email → should arrive from `peta@penghasilantambahan.com`
5. Check that the spam-folder reminder is visible at the bottom
6. If it works, click **"Kirim ke Semua Member Aktif"** for real blast

## Auto-Notifications Already Wired

Once API key + domain are configured, these fire automatically:

- **Reddit account flagged** (suspended / not_found) → email + WA queued for that user
- **Future**: Easy to add — payout approved, signup welcome, etc. — just call `admin_create_broadcast` from any RPC or trigger

## WhatsApp Status (works WITHOUT Resend)

- One-click blast via `wa.me` links ("Buka SEMUA" button in `/admin/broadcast`)
- Batch 10 button for popup-blocker-safe mode
- Per-recipient manual click-through (sent status tracked)
- No third-party WhatsApp API account needed
