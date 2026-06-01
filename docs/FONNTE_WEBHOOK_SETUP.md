# Fonnte Incoming Webhook — Setup Guide

Server-side WA verifier. No laptop, no SSH, no VPS hassle. Fonnte handles the WA infrastructure; PeTa just receives webhooks.

## Architecture

```
[Army types "peta" in PeTa Army group]
            ↓
[Fonnte burner phone (in the group) receives the message]
            ↓ (HTTPS POST with form-data)
[Supabase edge fn: wa-fonnte-webhook]
            ↓ validates ?secret= query param
            ↓ extracts member phone from group payload
            ↓ matches /peta/ word
            ↓ calls claim_wa_group_by_phone RPC
[RPC credits Rp5K + sets users.wa_group_verified=true]
            ↓
[Edge fn sends confirmation DM via Fonnte API]
            ↓
[Army gets DM: "Bonus Rp5.000 udah masuk saldo PeTa kamu!"]
```

## Setup (10 minutes, browser only — no computer-on requirement)

### Step 1 — Verify Fonnte burner is in the PeTa Army group

1. Login Fonnte dashboard: https://md.fonnte.com
2. Cek **My Device** — note the burner phone number
3. In your WhatsApp, open PeTa Army group → Group Info → check if the Fonnte number is listed as member
4. If NOT in group → invite Fonnte's number via WA group invite link

### Step 2 — Set webhook URL in Fonnte

1. Fonnte dashboard → **Device Settings** (or **Devices → [your device] → Settings**)
2. Find section **"Incoming Webhook"** or **"Webhook URL"**
3. Paste this URL:

   ```
   https://yorlsgzsawchpeeazcvi.supabase.co/functions/v1/wa-fonnte-webhook?secret=cb1d3179ef46dd5ac758943e02a22630
   ```

4. **Webhook method**: POST (default)
5. **Trigger on**: All messages (or "Incoming only")
6. **Forward group messages**: Enable / ON (critical — group messages must be forwarded)
7. Click **Save**

### Step 3 — Test webhook

Fonnte dashboard usually has a **"Test Webhook"** button. Click it. Expected response: HTTP 200 with `{"ok":true,"message":"PeTa Fonnte webhook alive"}`.

### Step 4 — End-to-end test with real WA

1. Ask any army member (already registered in PeTa) to type **`peta`** in the PeTa Army group
2. Within 5 seconds:
   - Their saldo nambah Rp5.000 (cek di /earnings)
   - Mereka dapet DM dari Fonnte: "✅ Bonus Rp5.000 udah masuk saldo PeTa kamu!"
3. Admin can verify by going to `/admin/wa-bot` → "Recent Verifications" panel will show the entry

## Operational

- **No computer/laptop needed.** Fonnte runs 24/7 on their infrastructure.
- **Burner phone needs to stay connected** at Fonnte's end (Fonnte's problem, not yours).
- **Cost**: Fonnte Lite ~Rp50K/mo OR Standard ~Rp200K/mo. Both support incoming webhook on receive (no per-message fee for receiving).
- **Capacity**: Unlimited incoming on standard plan. Lite plan may rate-limit, but for receiving "peta" triggers we're well below any limit.

## Security

- Webhook URL has a secret query param (`?secret=...`) which is validated server-side
- Without the secret, edge fn rejects with 401
- The secret is stored in `app_secrets.FONNTE_WEBHOOK_SECRET` and never leaves Supabase
- To rotate: regenerate via SQL `UPDATE app_secrets SET value = encode(gen_random_bytes(16), 'hex') WHERE key = 'FONNTE_WEBHOOK_SECRET' RETURNING value;` → update URL in Fonnte dashboard

## Troubleshooting

| Symptom | Fix |
|---|---|
| Test webhook fails (401) | Check secret in URL matches `app_secrets.FONNTE_WEBHOOK_SECRET` |
| Army types "peta" but no credit | Check Fonnte dashboard → Logs. Is the message reaching Fonnte? If no, Fonnte burner not in group |
| Webhook called but `no_trigger` reason | Verify word boundary: "peta" must be a standalone word. "petalah" or "petani" don't trigger |
| `user_not_found` for real army | Their `users.whatsapp` number doesn't match. Check normalization (leading 0 vs 62) |
| Fonnte not forwarding group messages | Dashboard → Device → enable "Forward group messages" toggle |

## Migration from earlier setups

- **From Evolution API (broken Baileys)**: Evolution can stay running on VPS or be removed. Doesn't affect Fonnte.
- **From Chrome Extension I built earlier**: Both can run simultaneously without conflict (the RPC's `already_claimed` check prevents double-credit). Recommended: stop using Chrome Extension once Fonnte is verified working.
- **From in-browser monitor (Chrome MCP injection)**: Auto-dies on session end. Was a stopgap.
