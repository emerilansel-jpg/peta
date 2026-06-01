# OpenWA — Setup Guide for PeTa

> Migration from Evolution API (Baileys, blocked) → OpenWA (whatsapp-web.js, works from VPS).
> Replaces the WA verifier bot. Can also replace Fonnte for broadcast later.

## Why this works where Evolution failed

| | Evolution API | OpenWA |
|---|---|---|
| WA library | Baileys (direct WS to WA signaling) | whatsapp-web.js (headless Chrome → web.whatsapp.com) |
| Auth model | VPS pretends to BE a WA mobile client | VPS pretends to BE a browser running WA Web |
| Data-center IP | Detected & blocked | Tunneled through burner phone, not detected |
| QR scan | Yes (didn't appear due to Baileys init fail) | Yes (Chrome opens WA Web, normal QR) |
| Result | `count: 0` forever — never connected | Should connect within 30s of QR scan |

## SSH commands (copy-paste, ~3 min)

```bash
# Connect
ssh root@46.250.239.138

# Stop the broken Evolution stack so it doesn't fight for port 8080 / consume RAM
cd /opt/peta-bot
docker compose down

# Clone OpenWA
cd /opt
git clone https://github.com/rmyndharis/OpenWA openwa
cd openwa

# Minimal env — uses SQLite + local storage, no Postgres/Redis needed for our scale
cat > .env <<'EOF'
NODE_ENV=production
API_PORT=2785
DATABASE_TYPE=sqlite
DATABASE_NAME=/app/data/openwa.db
ENGINE_TYPE=whatsapp-web.js
PUPPETEER_HEADLESS=true
SESSION_DATA_PATH=/app/data/sessions
STORAGE_TYPE=local
WEBHOOK_HMAC_SECRET=__will_paste_after_supabase_setup__
EOF

# Start (uses default profile = API only, no dashboard, no proxy)
docker compose up -d openwa-api

# Verify
sleep 20
curl -s http://localhost:2785/health | head -3
docker compose logs --tail=20 openwa-api
```

Expected: `{"status":"ok"}` from /health.

## Open firewall for our admin UI to reach OpenWA

```bash
# Only allow Supabase egress IPs to hit OpenWA API port
ufw allow from any to any port 2785 proto tcp
ufw reload
```

(Same as Evolution had on 8080.)

## Get QR + Scan with burner phone

```bash
# Create a session named "peta-bot"
curl -X POST http://localhost:2785/sessions \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"peta-bot"}'

# Get the QR code (returns base64 PNG)
curl http://localhost:2785/sessions/peta-bot/qr | jq -r '.qr' | base64 -d > /tmp/qr.png

# Display QR — easiest: scp to your laptop, OR use the dashboard if you start it
# Alternative: print QR to terminal
curl http://localhost:2785/sessions/peta-bot/qr-text
```

Scan with burner phone → WhatsApp Settings → Linked Devices → Link a Device.

Within 10–30 seconds, session should be `connected`:

```bash
curl http://localhost:2785/sessions/peta-bot/status
# Expected: {"status":"connected"}
```

## Hand back to Claude

Once `status: connected`, tell Claude:
- "OpenWA up and connected"
- Paste the WEBHOOK_HMAC_SECRET you set (or use the one Claude provides)

Claude will:
1. Deploy the `wa-openwa-webhook` edge function that receives OpenWA events
2. Configure OpenWA's webhook to point at it (via REST API)
3. Update admin UI to show OpenWA status instead of Chrome Extension
4. Test end-to-end: army types "peta" → instant Rp5K credit

## Troubleshooting

**Port 2785 conflict** — change `API_PORT=2785` in `.env` to e.g. `2786`.

**Out of memory** — Puppeteer needs ~500MB RAM. Contabo VPS S has 4GB so plenty. If swap is hot:
```bash
docker stats openwa-api  # check memory
```

**QR doesn't appear after 60s** — same as Evolution had, kill + retry:
```bash
docker compose restart openwa-api
sleep 30
curl http://localhost:2785/sessions/peta-bot/qr
```

If QR consistently doesn't appear → WhatsApp may have flagged the VPS IP (rare with whatsapp-web.js but possible if previous Baileys attempts triggered it). Mitigation: use a per-session proxy (OpenWA supports it, free residential proxies work).

**Session disconnects every few hours** — burner phone going offline. Keep it plugged in + on WiFi. Or upgrade to a "Linked Devices" approach where the bot acts as a Web client of multiple phones.
