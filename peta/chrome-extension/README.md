# PeTa WA Verifier — Chrome Extension

Auto-verify army yang ketik `peta` di grup WhatsApp PeTa → credit Rp5.000 otomatis.

## Cara Install (5 menit)

### 1. Download extension
- Download `peta-wa-verifier.zip` dari `/admin/wa-bot` di dashboard PeTa
- Atau dari source: folder `peta/chrome-extension/` ini

### 2. Extract
- Klik kanan zip → Extract All → simpan di folder permanen (jangan dihapus, Chrome akan terus load dari sini)
- Contoh: `C:\Users\You\peta-wa-verifier\`

### 3. Load di Chrome
1. Buka Chrome → ketik `chrome://extensions` di address bar
2. Toggle **"Developer mode"** di pojok kanan atas
3. Klik tombol **"Load unpacked"**
4. Pilih folder yang sudah di-extract tadi
5. Extension "PeTa WA Verifier" akan muncul di list

### 4. Pin extension (opsional, biar gampang akses)
- Klik icon puzzle (🧩) di toolbar Chrome → cari "PeTa WA Verifier" → klik icon 📌 untuk pin

### 5. Setup
1. Klik icon extension di toolbar → popup terbuka
2. **Nama Grup**: ketik nama grup PeTa di WA persis (case insensitive, partial OK). Contoh: `PeTa Army`
3. **Extension Token**: copy dari `/admin/wa-bot` → paste di sini
4. Toggle **"Aktifkan auto-verify"** ke ON
5. Klik **Simpan**
6. Klik **Test Connection** → harus muncul "Backend OK ✅"

### 6. Buka WhatsApp Web
1. Tab baru: https://web.whatsapp.com
2. Scan QR pakai burner phone yang udah join grup PeTa
3. Buka grup PeTa (extension hanya monitor saat tab WA Web kebuka)
4. Done — extension scan otomatis tiap 3 detik

## Cara Kerja

```
[Army ketik "peta" di grup WA]
         ↓
[Chrome Extension baca DOM message di grup]
         ↓ extract sender phone dari data-id attribute
[Background script POST ke Supabase edge fn]
         ↓ extension_token + phone
[Edge fn `wa-extension-verify`]
         ↓ validate token
         ↓ call claim_wa_group_by_phone(phone) RPC
[RPC credits Rp5.000 + sets users.wa_group_verified=true]
         ↓
[Extension shows toast: ✅ Bonus Rp5.000 terkirim]
```

## Maintenance

- **Token compromised?** → di `/admin/wa-bot`, klik "Rotate Token" → paste token baru ke extension
- **Mau pause?** → klik extension icon → toggle OFF "Aktifkan auto-verify"
- **WA Web sering logout?** → simpan tab WA Web di pinned tab, jangan close
- **Update extension** → download zip baru, replace folder, refresh di `chrome://extensions`

## Troubleshooting

| Symptom | Fix |
|---|---|
| Badge "No token" | Paste extension token dari /admin/wa-bot |
| Badge "WA closed" | Buka https://web.whatsapp.com di tab |
| Badge "Idle (buka grup X)" | Click grup PeTa di sidebar WA Web |
| Stats counter naik tapi army ga dapet bonus | Cek log di /admin/wa-bot → "Recent Verifications" — kemungkinan nomor belum daftar PeTa |
| Backend err | Test Connection di popup. Kalau gagal, token kemungkinan udah di-rotate |

## Security

- Extension token tersimpan di Chrome's local storage (encrypted at rest by Chrome)
- Token TIDAK pernah dikirim ke 3rd party — cuma ke Supabase edge fn PeTa
- Edge fn punya idempotency check — array yang udah verified ga akan di-double-credit
- Semua verifikasi di-log ke `wa_extension_log` table buat audit
- Kalau extension hilang/diakses orang lain: rotate token di `/admin/wa-bot` → token lama langsung invalid

## Limits

- Extension cuma jalan saat tab WA Web kebuka (ga ada background scanning)
- Polling 3 detik — lag max 3-6 detik dari saat army ketik "peta" sampe bonus masuk
- Trigger word: persis kata `peta` (case insensitive, word boundary). "petalah" atau "petani" TIDAK trigger
- Kalau admin close tab WA Web → bot ga aktif sampe tab dibuka lagi

## Tips

- Jalankan WA Web di laptop yang nyala terus (server admin, mini PC, dll)
- Pin tab biar ga close accidental
- Cek extension stats minggu pertama buat verify accuracy
