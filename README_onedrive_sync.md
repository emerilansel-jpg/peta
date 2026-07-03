# OneDrive Sync Script

Python script untuk upload/sync folder lokal ke OneDrive personal via Microsoft Graph API.

## Quickstart

1. **Setup credentials** (Azure App Registration): lihat [SETUP.md](SETUP.md)
2. **Install dependencies**:
   ```bash
   pip install requests python-dotenv
   ```
3. **Copy .env**:
   ```bash
   cp .env.example .env
   # Isi dengan CLIENT_ID dan CLIENT_SECRET
   ```
4. **Authenticate** (satu kali, buka browser):
   ```bash
   python onedrive_sync.py --auth
   ```
5. **Sync**:
   ```bash
   python onedrive_sync.py --sync ./folder-lokal backup/remote-folder
   ```

## Commands

| Command | Description |
|---|---|
| `--auth` | Login Microsoft, simpan refresh token |
| `--sync LOCAL REMOTE` | Upload folder lokal ke OneDrive |
| `--dry-run` | Simulasi, tidak benar-benar upload |
| `--delete-remote` | Hapus file remote yang tidak ada di lokal |
| `--exclude PATTERN` | Tambah pola exclude (bisa berkali-kali) |

## Exclusion — Script & Credentials Tidak Ikut Upload

Script ini punya 3 lapis proteksi agar file sync-nya sendiri tidak ikut terupload:

1. **Hardcoded excludes** (selalu aktif): `onedrive_sync.py`, `.env`, `.env.*`, `tokens.json`, `tokens*.json`, `.syncignore`, `README_onedrive_sync.md`, `SETUP.md`, `*.log`, `sync.log`.
2. **`.syncignore`** di root folder yang di-sync: isi pola exclude seperti `.gitignore`.
3. **CLI `--exclude`** untuk exclude tambahan saat run.

Contoh `.syncignore`:

```text
node_modules/
*.tmp
.DS_Store
Thumbs.db
secret-folder/
```

## Automation

Setelah `--auth`, script bisa jalan headless. Pasang di Task Scheduler (Windows) atau cron (Linux/WSL) untuk auto-upload.

Contoh Task Scheduler: lihat [SETUP.md](SETUP.md) bagian 4.

## Kredensial yang Dibutuhkan

| Kredensial | Dari Mana | Kegunaan |
|---|---|---|
| `CLIENT_ID` | Azure App Registration → Application ID | Identifikasi aplikasi |
| `CLIENT_SECRET` | Azure App Registration → Certificates & secrets | Autentikasi aplikasi |
| `TENANT` | `common` (default) | Microsoft identity endpoint |
| `REFRESH_TOKEN` | Hasil `--auth` (auto-simpan di `tokens.json`) | Akses tanpa login ulang |

**Tidak butuh password akun Microsoft.** Cukup OAuth consent sekali.
