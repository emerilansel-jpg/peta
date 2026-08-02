# DEPLOYMENT.md — PeTa Runbook (1 halaman)

> Terakhir diperbarui: 2026-08-02 (QA4 fixes — email SMTP + fetch-reddit-profile). Pemegang runbook: pemilik akun Vercel/Cloudflare + Supabase + Resend.

## Jika app DOWN (prioritas 1-2-3)

1. **Cek status**: `curl -sI https://www.penghasilantambahan.com` (harap 200, SSL valid)
   - Jika 5xx → cek Vercel dashboard → Deployments → "Redeploy" deployment terakhir yang hijau (rollback <5 menit).
2. **Cek Supabase**: https://supabase.com/dashboard/project/yorlsgzsawchpeeazcvi → Health
   - Jika project paused/INACTIVE → Restore via dashboard (data aman, ±10 menit).
3. **Cek error log**:
   - App error: tabel `public.error_logs` (SQL editor: `select * from error_logs order by created_at desc limit 50;`)
   - Edge function: dashboard → Edge Functions → Logs (atau `supabase functions logs`).
   - Email tidak terkirim: cek SMTP logs (email transaksional `send-peta-email`/`send-notification-email` sekarang pakai SMTP via nodemailer sejak QA4 2026-08-02 — bukan lagi Resend HTTP API).

## Backup & restore

- Backup otomatis WAL-G harian aktif (dashboard → Database → Backups). Tidak ada PITR.
- Restore: dashboard → Backups → Restore (bikin project baru lalu pindahkan, atau minta dukungan Supabase utk restore in-place).
- **Belum pernah di-drill** — lakukan uji restore ke project dummy sebelum butuh darurat.

## Deploy frontend

- Build: `npm run build` → `dist/` (sudah terverifikasi PASS).
- Deploy: `wrangler pages deploy dist` (Cloudflare Pages, project `peta`) ATAU Vercel (proyek lama).
- Setelah deploy: cek `curl -sI https://www.penghasilantambahan.com | grep -i content-security` (harus sudah ada `api.codetabs.com` di connect-src).

## Deploy DB migration

- Staging dulu, lalu prod: `supabase db push` (atau Management API `POST /v1/projects/{ref}/database/migrations`).
- Migration terbaru: `20260731_qa_fix_pgcrypto_search_path.sql` + `20260731_qa_fix_founding_cap_and_payout_cancel.sql` (SUDAH di-apply ke prod — jangan di-apply ulang).

## Secret yang dipakai produksi (jangan bocor)

- Supabase secrets: `SMTP_HOST/USER/PASSWORD` (Resend SMTP, user `care@straight.ltd`), `EMAIL_FROM`, `BROADCAST_FROM`, `RESEND_API_KEY` (tidak dipakai lagi oleh send-peta-email/send-notification-email sejak QA4 — diganti SMTP), `PAYPAL_*`, `FONNTE_TOKEN`, `DEEPSEEK_API_KEY`, `DATAFORSEO_*`.
- App secrets table (halaman /admin/secrets): `BROADCAST_FROM` = `PeTa <care@straight.ltd>` (QA 2026-07-31 update).
- **Catatan**: `EMAIL_FROM`/`BROADCAST_FROM` sementara = `care@straight.ltd` karena domain `penghasilantambahan.com` BELUM terverifikasi di akun Resend. Jika domain diverifikasi → ganti balik ke `peta@penghasilantambahan.com`.

## Kontak & kredensial penting

- Admin app: `info@jetdigitalpro.com` — password lemah (4 char) → WAJIB diganti via Supabase Auth.
- Supabase prod: `yorlsgzsawchpeeazcvi` (peta-prod) · staging: `duxzxizedtvnopfihllz` (peta-reddit-army, aktif sejak QA 2026-07-31).
- Resend account: `care@straight.ltd` (dipakai SMTP + API).

## Cron / background jobs

- pg_cron (4 job Reddit Army sync) di migration `20260730_reddit_army_cron_jobs.sql` — cek jalan: SQL editor `select * from cron.job;` dan `cron.job_run_details order by start_time desc limit 10;`.

## Alarm yang belum ada (TODO)

- Analytics (GTM/GA4) belum terpasang — tidak bisa jawab "berapa user hari ini".
- Alerting error (email/Slack) belum ada — pantau manual via error_logs.
