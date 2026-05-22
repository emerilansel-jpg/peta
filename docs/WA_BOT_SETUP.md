# WhatsApp Verifier Bot — Setup & Usage Guide

> The bot reads `peta` keyword in the official PeTa WhatsApp group and auto-credits Rp5K to the matching army member. Built 2026-05-21.

---

## Architecture (5-minute version)

```
[Army types "peta" in WA group]
         │
         ▼
[Evolution API (Contabo VPS) reads message]
         │ POST webhook
         ▼
[N8N workflow on same VPS]
         │ POST RPC
         ▼
[Supabase claim_wa_group_by_phone(phone, secret)]
         │ INSERT credit Rp5K
         │ UPDATE users.wa_group_verified = true
         ▼
[N8N DMs the sender confirmation via Evolution]
```

VPS public IP: `46.250.239.138`
- N8N dashboard: `https://n8n.46-250-239-138.sslip.io` (browser will warn about self-signed cert → Advanced → Proceed)
- Evolution API admin: `https://wa.46-250-239-138.sslip.io/manager`
- Evolution API endpoint (for Supabase/N8N): `http://46.250.239.138:8080` (HTTP, port 8080, API key required)

---

## Prerequisites

- Burner WhatsApp number (Indonesian SIM recommended, Rp20-50K)
- Admin access to PeTa (`info@jetdigitalpro.com` / current admin password)
- The burner number must be invited to the PeTa WhatsApp group

---

## First-time setup (one-off, ~15 min)

### Step 1 — Buka admin WA Bot page

1. Login admin: `https://www.penghasilantambahan.com/admin/wa-bot`
2. Tab "WA Bot" di sidebar (icon Radio)

### Step 2 — Create instance + scan QR

1. Klik tombol **"Create / Reset Instance"** (yellow)
2. QR code akan muncul di kotak kiri (max 1 menit)
3. Di burner phone: WhatsApp → Settings → Linked Devices → Link a Device → scan QR
4. Status badge berubah dari `🔴 DISCONNECTED` ke `🟡 CONNECTING` ke `🟢 CONNECTED` (max 30 detik)

### Step 3 — Setup N8N workflow

1. Login N8N: `https://n8n.46-250-239-138.sslip.io` (creds: `admin` / passwd di `/opt/peta-bot/.env`)
2. Workflows → ⋮ → **Import from File** → pilih `peta/docs/n8n-wa-verifier-workflow.json`
3. Settings → **Variables** → tambah:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://yorlsgzsawchpeeazcvi.supabase.co` |
   | `SUPABASE_ANON_KEY` | (dari Supabase dashboard → Settings → API → anon public) |
   | `WA_VERIFY_WEBHOOK_SECRET` | (run `SELECT value FROM app_secrets WHERE key='WA_VERIFY_WEBHOOK_SECRET'`) |
   | `EVOLUTION_API_URL` | `http://localhost:8080` (N8N runs on same VPS → use localhost) |
   | `EVOLUTION_API_KEY` | (dari `/opt/peta-bot/.env`) |
   | `EVOLUTION_INSTANCE` | `peta-bot` |
   | `PETA_GROUP_JID` | (set di Step 5) |

4. Activate workflow (toggle top-right corner)
5. Click the **Webhook** node → copy the **Production URL** (looks like `https://n8n.46-250-239-138.sslip.io/webhook/wa-incoming`)

### Step 4 — Paste webhook URL ke Admin UI

1. Back to `/admin/wa-bot`
2. Paste URL ke field "N8N Webhook URL"
3. Klik **Save**
4. Sukses → Evolution otomatis ter-configure untuk POST ke N8N

### Step 5 — Set group JID

1. Invite burner number ke grup WhatsApp PeTa (kirim invite link, atau add by phone)
2. Tunggu 30 detik (Evolution sync grup list)
3. Di `/admin/wa-bot`, klik **"Pilih dari list"** di section Group JID
4. Pilih grup PeTa yang benar (format: `1234567890@g.us`)
5. Sukses → JID tersimpan di `app_secrets.PETA_WA_GROUP_JID`

### Step 6 — Update N8N env var

1. Back to N8N → Settings → Variables
2. Update `PETA_GROUP_JID` dengan nilai yang baru
3. Save

### Step 7 — Test end-to-end

1. Dari nomor army yang **terdaftar di PeTa** (cek `users.whatsapp`)
2. Buka grup PeTa di WhatsApp → ketik **`peta`** → kirim
3. Within 10 detik:
   - DM masuk ke nomor tsb: "✅ Bonus Rp5.000 udah masuk saldo PeTa kamu!"
   - Saldo Earnings page nambah Rp5K
   - `user_credits` punya row baru source='wa_group_verified'
   - `users.wa_group_verified = true`

✅ Setup selesai!

---

## Daily operations

### Cek apakah bot masih connected

`/admin/wa-bot` → auto-refresh every 5 detik. Status badge harus 🟢 CONNECTED.

Kalau 🔴 DISCONNECTED:
- WhatsApp di burner phone mungkin logout (Linked Devices removed)
- Atau bot account kena ban WhatsApp (max risk kalau blast besar)
- Fix: scan ulang QR

### Lihat siapa belum verified

`/admin/wa-bot` → section "Army Belum Verified" → list semua army yang punya `wa_group_verified=false` + `users.whatsapp` ada.

Tiap row punya tombol **DM →** yang buka `wa.me/[phone]?text=...` dengan pesan template:
> "Hai! Untuk unlock bonus Rp5.000 dari PeTa, join grup WhatsApp ini lalu ketik 'peta' — saldo langsung masuk otomatis. Link grup: [paste link grup]"

User klik → kebuka WhatsApp Web/App → send → done.

### Disconnect / restart bot

Tombol di `/admin/wa-bot`:
- **Disconnect** — log out WhatsApp session (perlu scan QR lagi setelah ini)
- **Restart Connection** — soft restart (tetap pakai session yang sama)
- **Create / Reset Instance** — hard reset, hapus session, kembali ke step 2

---

## Troubleshooting

### "Edge Function returned a non-2xx status code"

Edge function (`wa-bot-proxy`) tidak bisa reach Evolution API. Common causes:

1. **Evolution API down** — SSH ke VPS, jalanin `docker compose -f /opt/peta-bot/docker-compose.yml ps`. Kalau peta-evolution status bukan "Up", jalanin `docker compose up -d evolution-api`.
2. **EVOLUTION_API_URL salah** — should be `http://46.250.239.138:8080` (HTTP, port 8080). Cek `SELECT value FROM app_secrets WHERE key='EVOLUTION_API_URL'`.
3. **EVOLUTION_API_KEY salah** — should match `/opt/peta-bot/.env`. Cek `SELECT value FROM app_secrets WHERE key='EVOLUTION_API_KEY'`.
4. **Firewall block port 8080** — SSH ke VPS, `ufw status` harus include `8080/tcp ALLOW`.

### "Bot kena banned WhatsApp"

WhatsApp algoritma ban nomor yang:
- Blast banyak DM ke nomor yang ga save kontak
- Pattern message identik berulang
- Login dari banyak device IP berbeda

Mitigasi:
- Burner number minimal 1 minggu lama (jangan langsung new)
- Save the bot number ke contacts (oleh user lain di grup)
- Jangan kirim DM tanpa context (kita cuma DM confirmation pasca user ketik 'peta', low frequency)
- Kalau ban → ganti burner SIM, scan QR ulang. Session lama hilang, mulai fresh.

### "Bot connected tapi 'peta' di grup ga trigger"

Cek di urutan:
1. **Group JID benar?** `SELECT value FROM app_secrets WHERE key='PETA_WA_GROUP_JID'` — pastikan ID grup persis cocok (case-sensitive).
2. **N8N workflow active?** Login N8N, lihat workflow "PeTa WA Verifier" — toggle harus ON.
3. **Webhook URL tersimpan di Evolution?** Cek di `/admin/wa-bot` field "N8N Webhook URL" tidak kosong. Save ulang kalau ragu.
4. **N8N env var `PETA_GROUP_JID` cocok?** Cek di N8N Settings → Variables.
5. **Phone format army cocok?** RPC `normalize_wa_phone` strips `+`/`0`/non-digits, leading `0`→`62`. So `081234...`, `+6281234...`, `6281234...` semua match.

Test paling cepat: SSH ke VPS, tail logs Evolution + N8N:
```bash
ssh root@46.250.239.138 'docker compose -f /opt/peta-bot/docker-compose.yml logs -f evolution-api n8n'
```
Tanya ke user untuk ketik 'peta', lihat log real-time.

### Webhook secret rotation

Untuk rotate secret:
```sql
UPDATE app_secrets SET value = encode(gen_random_bytes(32), 'hex')
WHERE key = 'WA_VERIFY_WEBHOOK_SECRET'
RETURNING value;
```
Copy nilai baru → update N8N variable `WA_VERIFY_WEBHOOK_SECRET` → save & restart workflow.

---

## Cost summary

| Item | Cost / month |
|---|---|
| Contabo VPS S | ~Rp 75.000 |
| Burner SIM data | ~Rp 50.000 |
| Supabase Edge Function calls | included in free tier |
| **Total** | **~Rp 125.000** |

ROI: 1 verified army member = Rp5K credit + saves admin manual DM. Auto-verifies infinite army members at zero per-event cost. Break-even at ~25 verifications/month.

---

## Future improvements

1. **Real domain** — point `wa.penghasilantambahan.com` A record to VPS, switch Caddy to Let's Encrypt (kill self-signed cert warning). Spaceship DNS step.
2. **Migrate Fonnte broadcast to Evolution** — one stack instead of two. Saves Fonnte rate-limit headache.
3. **Group invite link in onboarding** — show invite link + "ketik 'peta' di grup" copy in Step 2 of `/onboarding` so new signups self-serve verify.
4. **Backup bot account** — if main number bans, have a warmed-up second number ready to swap. Manual scan QR + update `EVOLUTION_INSTANCE` if needed.
5. **Monitoring** — uptime check on `http://46.250.239.138:8080` + Slack/Telegram alert if down.
6. **Auto-pause if WA Web disconnects** — currently bot just sits silent. Future: send admin email if status drops to `close` for >5 min.
