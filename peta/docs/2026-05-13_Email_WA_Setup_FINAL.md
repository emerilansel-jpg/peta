# Email + WhatsApp Setup — Final Handoff

## Email — pick ONE provider (Spacemail recommended)

Edge function `send-broadcast-emails` v3 supports BOTH Resend (API) and Spacemail/any SMTP. Set whichever creds you have; it auto-picks.

### Option A — Spacemail (recommended — same as Straight Ltd)

Spaceship's email service. Since the domain `penghasilantambahan.com` is already at Spaceship, this is the fastest path.

1. Login to https://www.spaceship.com → **Mail** → click your `penghasilantambahan.com` mailbox
2. Create a new inbox: `peta@penghasilantambahan.com` (or use an existing one)
3. Set a strong password — note it down
4. SMTP credentials Spacemail will give you:
   - Host: `mail.spacemail.com`
   - SMTP SSL Port: `465`
   - User: `peta@penghasilantambahan.com`
   - Pass: `<the password you set>`
5. Set Supabase secrets (both staging + prod):

| Secret | Value |
|---|---|
| `SMTP_HOST` | `mail.spacemail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `peta@penghasilantambahan.com` |
| `SMTP_PASS` | `<password>` |
| `BROADCAST_FROM` | `PeTa <peta@penghasilantambahan.com>` |

Set via Supabase Dashboard → Edge Functions → Manage Secrets, OR paste creds in chat and I'll set both via Supabase MCP in 30 sec.

### Option B — Resend (if Spacemail is hassle)

Account already created (`n311311@gmail.com` / `PetaResend!2026SecurePwd`). Dashboard hangs in automation but works in a normal browser tab.

1. Login → API keys → Create → copy `re_...` key
2. Add domain `penghasilantambahan.com` → screenshot 3 DNS records
3. Paste in chat — I'll set secrets + add DNS at Spaceship via MCP

`RESEND_API_KEY` + `BROADCAST_FROM` is all you need.

### Either way — test after setup

1. Login admin → `/admin/broadcast`
2. Type test subject/body → click **"Test ke Saya Dulu"** (orange button)
3. Email should arrive at admin's inbox in < 30 sec
4. If `provider=none` in the response: secrets didn't propagate; wait 60 sec + retry

---

## WhatsApp — Fonnte

Edge function `send-broadcast-whatsapp` v1 is deployed. Sends in background via REST API. No more popup tabs.

### Setup (5 min)

1. Sign up: https://fonnte.com → **Sign Up** (free tier ~100 msgs/day)
2. Dashboard → **Add Device** → scan QR code with WhatsApp on the phone you want to send FROM (recommended: a dedicated PeTa-admin WhatsApp account, NOT your personal)
3. Copy the device's API token (long string)
4. Set Supabase secret `FONNTE_TOKEN=<token>` in both staging + prod
5. In `/admin/broadcast` → open any broadcast detail → click **"Blast via Fonnte (background)"** → done

### Why hasn't your test gone out yet?

The button currently returns `status='not_configured'` because `FONNTE_TOKEN` is not set in either Supabase project. As soon as you set it, the button works.

### Free tier limits

| Fonnte tier | Daily limit | Cost |
|---|---|---|
| Free | ~100 msg/day | Rp0 |
| Personal | ~1000 msg/day | Rp50K/mo |
| Business | unlimited | Rp150K/mo |

For PeTa Army (currently ~20-50 users), free tier is fine.

### Pace note

Edge function sends 1 msg every ~1.1 sec to stay under Fonnte rate limits. 50 recipients = ~1 min total. Runs server-side, admin tab can close.

---

## What I'd Pick If I Were You

**Spacemail** for email. Reasons:
1. Domain DNS already at Spaceship — zero new records to add
2. Same vendor as Straight Ltd (which you said works)
3. Single setup step (create inbox + password) vs Resend's (account + API key + domain verification + DNS)
4. SMTP creds last forever (no API-key rotation)

**Fonnte** for WhatsApp. Reasons:
1. Indonesian, designed for this exact use case
2. Free tier covers PeTa scale
3. No business verification (unlike WhatsApp Cloud API)
4. Works from your existing phone (no new SIM needed)

---

## Quick Test SQL (sanity check that creds work)

Once you set secrets, you can verify in the database:

```sql
-- Check last broadcast attempt
SELECT id, subject, email_sent, email_failed, wa_sent, wa_failed, created_at
FROM broadcasts ORDER BY created_at DESC LIMIT 3;

-- Check recipient errors
SELECT id, channel, status, error, sent_at
FROM broadcast_recipients
WHERE broadcast_id = '<id from above>'
ORDER BY status, channel;
```

If `provider=smtp` returns errors like `smtp_authentication_failed`, the SMTP_PASS is wrong.
If `provider=none`, secrets aren't set.
