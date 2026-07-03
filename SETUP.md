# OneDrive Sync Script — Setup Guide

## 1. Register Azure App (One-time)

Open [Azure Portal → App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps) (or [Microsoft Entra admin center](https://entra.microsoft.com/)).

### 1.1 New Registration
- **Name**: `OneDriveSync`
- **Supported account types**: `Accounts in any organizational directory and personal Microsoft accounts`
- **Redirect URI**: `Web` → `http://localhost:8080`
- Click **Register**

### 1.2 Copy Credentials
- **Application (client) ID** → `ONEDRIVE_CLIENT_ID`
- Click **Certificates & secrets** → **New client secret** → copy value → `ONEDRIVE_CLIENT_SECRET`

### 1.3 API Permissions
- **API permissions** → **Add a permission** → `Microsoft Graph` → `Delegated permissions`
- Add:
  - `Files.ReadWrite`
  - `offline_access`
- Click **Grant admin consent for personal account** (if asked — for personal accounts this usually just means consent on first login).

## 2. Local Environment

```bash
cp .env.example .env
```

Edit `.env` with values from step 1.

```bash
pip install requests python-dotenv
python onedrive_sync.py --auth
```

A browser opens. Log in with your Microsoft / OneDrive account. After redirect, tokens are saved to `tokens.json`.

## 3. First Sync

```bash
python onedrive_sync.py --sync ./my-folder backup/my-folder
```

Script akan:
- Membuat struktur folder yang sama di OneDrive
- Upload file baru / berubah
- Skip file yang sudah sama (size + hash)
- **Tidak upload file sync sendiri** (`onedrive_sync.py`, `.env`, `tokens.json`, `.syncignore`, dll.)

## 4. Excludes & `.syncignore`

Pola exclude bawaan (hardcoded) melindungi script dan credentials. Tambahan bisa lewat file `.syncignore` di folder sumber:

```text
node_modules/
*.tmp
.DS_Store
secret/
```

Atau via CLI:

```bash
python onedrive_sync.py --sync . backup/auto --exclude "*.bak" --exclude "temp/"
```

## 5. Automation (Auto-Upload)

### Windows Task Scheduler (recommended)

1. Open **Task Scheduler** → **Create Basic Task**
2. Name: `OneDriveSync`
3. Trigger: **Daily** (or whatever you want)
4. Action: **Start a program**
   - Program/script: `python` (or full path to python.exe)
   - Add arguments: `onedrive_sync.py --sync "C:\Users\YourName\Documents" backup/Documents`
   - Start in: `G:\SF Project\peta-main` (or wherever the script lives)
5. Finish. Done.

### Cron (Linux/macOS/WSL)

```bash
# Every day at 2 AM
0 2 * * * cd /path/to/script && /usr/bin/python3 onedrive_sync.py --sync ./data backup/data >> sync.log 2>&1
```

### PowerShell scheduled job

```powershell
$action = New-ScheduledTaskAction -Execute "python" -Argument "onedrive_sync.py --sync . backup/auto" -WorkingDirectory "G:\SF Project\peta-main"
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "OneDriveAutoSync" -Action $action -Trigger $trigger
```

## 6. How Automatic Upload Works

After the first `--auth`:
- `tokens.json` stores a **refresh token** (long-lived).
- Every `--sync` run, the script silently refreshes the access token automatically.
- **No browser needed** after first auth. Fully headless.
- Put `--sync` on Task Scheduler / cron = automatic upload.

## 7. Security Notes

- Keep `tokens.json` and `.env` private. Do not commit them.
- Add both to `.gitignore`.
- The script itself is hardcoded excluded from any sync.
- If you ever revoke the app in Microsoft Account → Security → Apps, re-run `--auth`.
