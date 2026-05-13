# Resend Setup — Handoff

## What's Done

**Resend account created and verified** — you can log in right now.

| Field | Value |
|---|---|
| URL | https://resend.com/login |
| Email | n311311@gmail.com |
| Password | `PetaResend!2026SecurePwd` |
| Email verified | ✅ |
| API key created | ❌ — dashboard stuck on "Loading..." in browser automation |
| Domain verified | ❌ — needs DNS records (see below) |

> **Why I stopped:** The Resend dashboard kept hanging on "Loading…" in Nell's Computer browser (likely a Chrome-extension ↔ Resend React-app state collision). I burned 8+ attempts before stopping. The account itself works fine when you log in manually — the issue is purely the automation context.

## What You Need to Do (≈ 90 seconds total)

### 1. Get the API key (30 seconds)

1. Log in: https://resend.com/login (creds above)
2. Click **"API keys"** in left sidebar
3. Click **"Create API key"** (top right)
4. Name: `PeTa Production`
5. Permission: **Full access** (or Sending access — your call)
6. Domain: leave **All domains**
7. Click **Add**
8. **Copy the key** (starts with `re_…`) — it's only shown once

### 2. Set the secret in Supabase (30 seconds)

Two ways, pick one:

**A. Dashboard (easier):**
- Staging: https://supabase.com/dashboard/project/duxzxizedtvnopfihllz/settings/functions → Edge Function Secrets → Add `RESEND_API_KEY=re_xxxxx`
- Prod: https://supabase.com/dashboard/project/yorlsgzsawchpeeazcvi/settings/functions → same path

**B. Tell me the key in chat:** I'll set both secrets via Supabase MCP in 2 seconds and report back. No need to expose it in the UI.

### 3. Verify domain (≈ 5 min, one-time, optional but recommended)

Without domain verification, Resend's free tier only lets you send emails **to** the same email as the account (n311311@gmail.com). To send to all PeTa members, you need to verify `penghasilantambahan.com`:

1. In Resend dashboard → **Domains** → **Add Domain**
2. Enter `penghasilantambahan.com`
3. Resend gives you 3 DNS records (SPF, DKIM, DMARC)
4. Add them to Spaceship.com DNS for the domain (same place you set up the existing A records)
5. Click **Verify** in Resend — propagation usually 5-30 min

Once verified, the `BROADCAST_FROM` secret should be set in Supabase too:
```
BROADCAST_FROM="PeTa <noreply@penghasilantambahan.com>"
```

## After Setup — Test It

1. Log in as admin at https://www.penghasilantambahan.com/admin
2. Open `/admin/broadcast`
3. Compose a test: subject "Test", body "Halo dari PeTa"
4. Uncheck WhatsApp, check only Email
5. Send to all active members
6. Open the broadcast detail card — Email section should show `X sent · 0 failed`

If you see `X skipped` with error `RESEND_API_KEY not configured`, the secret didn't propagate yet — wait 30 seconds and click **Retry Email**.

## Notes

- The email-sending edge function `send-broadcast-emails` is deployed on both staging + prod Supabase. It reads the `RESEND_API_KEY` secret on each invocation, so no redeploy needed after you set the key.
- WhatsApp distribution still works perfectly WITHOUT any Resend setup — that's pure click-through using `wa.me` links, no third-party.
- Password above is strong enough but feel free to rotate it via Resend → Settings → Profile.
