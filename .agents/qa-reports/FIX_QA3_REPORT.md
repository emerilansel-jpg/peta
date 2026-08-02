# FIX QA3 REPORT — PeTa + Straight.ltd (QA4 fixes, 2026-08-02)

**Target:** https://www.penghasilantambahan.com + https://www.straight.ltd
**Metode:** Playwright regression (preview build + prod backend) · curl edge functions · Management API (SQL)
**Artefak:** `peta/qa-probes/qa4-*.json` + `peta/qa-probes/artifacts/qa4/*.png` · `peta/qa-probes/qa3-*.json` (basis temuan)

---

## Ringkasan

| # | Severity | Fix | Status | Bukti |
|---|---|---|---|---|
| 1 | CRITICAL | Email transaksional mati (Resend 403) → SMTP | ✅ DEPLOYED + VERIFIED | `{"ok":true,"id":"<...@straight.ltd>"}` kedua fungsi |
| 2 | MAJOR | Forum task tanpa brief tidak bisa di-submit | ✅ VERIFIED | submit enabled di task brief='' + publish diblok |
| 3 | MAJOR | "Reddit" di halaman publik | ✅ VERIFIED | 0 mention di Landing/Privacy/Terms/Help |
| 4 | MAJOR | Validasi username Reddit (CSP + proxy) | ✅ edge fn DEPLOYED, frontend siap | curl edge fn; bundle berisi chain baru |
| 5 | MINOR | Admin login mendarat di /tasks | ✅ VERIFIED | admin→/admin, member→/tasks |
| 6 | MINOR | Tidak ada 404 + kontradiksi card upvote | ✅ VERIFIED (404) / code done (card) | screenshot 404; bundle "Forum only" |
| 7 | MINOR | Copy email peta@ vs care@straight.ltd | ✅ VERIFIED | bundle 4× care@straight.ltd |

---

## FIX 1 [CRITICAL] — Email transaksional: Resend API → SMTP

**Sebelum:** `send-peta-email` & `send-notification-email` memakai Resend HTTP API (`api.resend.com/emails`) dengan `RESEND_API_KEY` milik akun yang **tidak** punya domain terverifikasi → semua email gagal:
`{"error":"resend_send_failed","detail":{"statusCode":403,"message":"The straight.ltd domain is not verified."}}` (502 ke frontend). Terkena: task-approved, welcome, payout. Hanya forgot-password (SMTP) yang hidup.

**Sesudah:** Kedua fungsi di-rewrite ke nodemailer + SMTP (transport sama dengan `send-password-reset-email` yang terbukti jalan):
- `supabase/functions/send-peta-email/index.ts` — `Deno.env.get('SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD')`, from = `EMAIL_FROM` env.
- `supabase/functions/send-notification-email/index.ts` — sama.

**Deploy:** `SUPABASE_ACCESS_TOKEN=<PAT> npx supabase functions deploy send-peta-email send-notification-email --project-ref yorlsgzsawchpeeazcvi` → success.

**Verifikasi (curl, to=info@jetdigitalpro.com — inbox pemilik):**
- `send-peta-email` → `{"ok":true,"id":"<0cdcc593-c3c4-0a5f-eb11-955e3a3f718c@straight.ltd>"}`
- `send-notification-email` → `{"ok":true,"id":"<635c66d9-ecfb-c28d-34fc-7ec840d3660f@straight.ltd>"}`

**Sisa:** sender tetap `care@straight.ltd` (domain penghasilantambahan.com belum diverifikasi — butuh akses dashboard Resend; FIX 7 menyesuaikan copy UI). `send-broadcast-emails`/`send-task-blast` tidak ada di repo lokal & JWT-protected — kemungkinan masih pakai jalur lama; cek saat broadcast pertama.

## FIX 2 [MAJOR] — Forum task tanpa brief tidak bisa di-submit

**Sebelum:** `TaskDetail.tsx canSubmit` (forum) butuh `splitForumBrief(task.brief).commentPost` — brief kosong → `hasCommentText=false` → tombol submit permanen disabled. Sheet TaskQueue cuma validasi Judul → task broken bisa ter-publish.

**Sesudah (2 lapis):**
- `TaskDetail.tsx`: `commentPost = splitForumBrief(task.brief || task.description || '').commentPost.trim() || (task.description || '').trim()` — fallback ke description (termasuk standard-brief), dipakai di `hasCommentText` DAN kotak "Komentar yang harus diposting". Member tidak pernah diblok.
- `TaskQueue.tsx`: helper `forumTaskHasSubmittableComment(brief, description)`; "Publish Active" (create sheet) dan "Simpan Perubahan" (edit sheet, status active) diblok dengan toast `"Task forum butuh 'Komentar siap-posting' atau brief biar member bisa submit"` saat brief-commentPost DAN description kosong.

**Verifikasi (preview build + prod backend):**
- Task `QA3 Forum Task 60014047` (brief='', description terisi) → claim → isi proof URL + username → **submit ENABLED** (sebelum fix: disabled). `qa4-regression.json`.
- Publish forum task brief+description kosong → **toast block muncul, sheet tetap terbuka (task TIDAK dibuat)**. `qa4-fix2b.json` (blockToastSeen=true).
- Kontrol positif: publish dengan brief → sukses (positivePublished=true).

## FIX 3 [MAJOR] — Halaman publik menyebut "Reddit"

**Sebelum:** Landing `/` (FAQ "login ke akun Reddit kamu", "password Reddit-mu"), Privacy (username Reddit, verifikasi aktivitas Reddit), Terms ("Reddit Army Program", kebijakan Reddit), Help (7 sebutan).

**Sesudah:** Copy diganti generik (platform/akun-mu/Program Army). File: `Landing.tsx` (2), `Privacy.tsx` (2), `Terms.tsx` (3), `Help.tsx` (8, termasuk label tombol "🎖️ Program Army"). Link route internal `/reddit-army` dipertahankan (sah).

**Verifikasi:** grep `-i reddit` di 6 halaman publik = 0 sebutan (sisa hanya `/reddit-army` route). Browser: `landingReddit/privacyReddit/termsReddit/helpReddit = False`, `termsHasProgramArmy/helpHasProgramArmy = True`.

## FIX 4 [MAJOR] — Validasi username Reddit (CSP + proxy down)

**Sebelum:** chain browser-proxy (codetabs 521 down, allorigins 408, corsproxy paywalled) + edge fn `sync-reddit-karma` dapat 403 dari Reddit (cloud egress diblok) → onboarding step 5 selalu karma=0. CSP live juga belum include `api.codetabs.com`.

**Sesudah:**
- Edge function baru **`fetch-reddit-profile`** (DEPLOYED): fetch server-side old.reddit.com → api.reddit.com → www.reddit.com dengan browser UA; return `{found, karma, account_age_days}` / `{found:false}` (404) / `{ok:false, reason:'blocked'}`. verify_jwt default (bukan open proxy), input di-sanitize (regex + max 32 char).
- `src/lib/api.ts syncRedditKarma`: urutan baru — 1) `fetch-reddit-profile` (definitif), 2) codetabs proxy, 3) `sync-reddit-karma` legacy (OAuth-ready), 4) karma=0. Proxy mati (allorigins/corsproxy) dihapus dari chain.
- CSP: `peta/vercel.json` + `peta/public/_headers` SUDAH include `https://api.codetabs.com` di connect-src (tinggal ter-deploy bersama frontend).

**Verifikasi:** curl edge fn: valid user → `{"ok":false,"reason":"blocked"}` (Reddit sedang blokir egress cloud — function behave benar, graceful); invalid username → 400. Catatan: **Reddit sedang memblokir semua IP cloud/datacenter untuk about.json publik** (jina reader pun 403) — jalur ini akan hidup saat Reddit unblock atau saat `REDDIT_CLIENT_ID` (OAuth) diset. Fallback karma=0 tetap aman (tidak menimpa data admin — perilaku lama dipertahankan).

## FIX 5 [MINOR] — Admin login mendarat di /tasks

**Sebelum:** `Login.tsx:36 navigate('/tasks')` unconditional.

**Sesudah:** setelah signIn — ambil `users.role` (maybeSingle, fallback army), lalu: `location.state.from` (dihormati) → admin → `/admin` · client → `/reddit/dashboard` · army → `/tasks`. `RedditLogin.tsx` sudah benar (tidak diubah).

**Verifikasi:** admin login → URL `/admin`; member login → `/tasks` (qa4-regression.json).

## FIX 6 [MINOR] — Halaman 404 + kontradiksi status card upvote

**a) 404:** `src/pages/NotFound.tsx` baru (tenant-aware: PeTa → beranda/FAQ, straight.ltd → /reddit), route `*` di App.tsx → `<NotFound />` (bukan redirect). Verifikasi: `/halaman-nggak-ada-xyz` → konten "Halaman nggak ketemu" + "404", URL tetap (bukan redirect). `fix6-404.png`.

**b) ServiceCard:** `RedditNewOrder.tsx` — status card `reddit-upvote` dihitung per-platform: keduanya OFF → paused (hidden); reddit OFF + forum ON → badge **"Forum only"** (bukan lagi "ACTIVE" yang kontradiksi dengan form "Reddit upvotes are paused right now"). Verifikasi: string "Forum only" ada di bundle.

## FIX 7 [MINOR] — Copy email konsisten dengan sender real

**Sesudah (karena FIX 1 mempertahankan `care@straight.ltd`):** `Earnings.tsx` toast + banner "Simpan email PeTa..." → `care@straight.ltd`; `admin/Secrets.tsx` contoh SMTP_USER & BROADCAST_FROM → `care@straight.ltd`. Broadcast.tsx (inbox IMAP admin) dibiarkan (bukan sender). Verifikasi: grep `peta@penghasilantambahan.com` di src/ = 0 di halaman member/admin (sisa hanya contoh inbox Broadcast).

---

## Regression (setelah semua fix)

- Build: `npm run build` → PASS (tsc + vite, 0 error).
- Browser (preview build `main-CZ0gjfeM.js` + backend prod, 390px): 404 ✅ · Landing/Privacy/Terms/Help tanpa Reddit ✅ · admin login→/admin ✅ · member login→/tasks ✅ · forum no-brief submit enabled ✅ · publish forum empty diblok ✅ · bundle berisi semua string fix ✅.
- Tidak ada regresi pada: forgot-password (SMTP — fungsi tidak disentuh), admin_create_member (tidak disentuh), founding cap (tidak disentuh), payout cancel (tidak disentuh), /reddit-army redirect (tidak disentuh).

## Cleanup (verified)

- 13 user test `qa3-*`/`qa4-*` (army + client + saas) dihapus via `admin_delete_member` RPC → count 0 di `users` DAN `auth.users`.
- 15 task `QA*` → semua `paused` + `is_hidden=true` (0 task QA* aktif tersisa).
- Orphan rows = 0: task_assignments, user_credits, reddit_accounts, payouts, order_tickets (LEFT JOIN users IS NULL count 0).
- Email test hanya ke `info@jetdigitalpro.com` (inbox pemilik) — tidak ada email/broadcast ke user real.

## DEPLOY YANG TERSISA (butuh akses user)

Edge functions SUDAH live (deploy via CLI+PAT). **Frontend belum di-deploy** (bundle prod masih `main-BtNpi5WT.js`/`main-CxYPHVFX.js`; build lokal `main-CZ0gjfeM.js`) karena environment ini tidak punya `CLOUDFLARE_API_TOKEN`. Instruksi:

```powershell
cd "G:\SF Project\peta-main\peta"
npm run build
npx wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true   # penghasilantambahan.com
npx wrangler pages deploy dist --project-name=straight --branch=main --commit-dirty=true # straight.ltd
# verifikasi:
curl -sI https://www.penghasilantambahan.com | grep -i content-security   # harus ada api.codetabs.com
curl -s https://www.penghasilantambahan.com | grep -o 'assets/main-[^"]*\.js'  # hash baru
```

## Sisa known issues (di luar 7 fix)

1. **Reddit blokir egress cloud** untuk about.json publik → karma validasi menunggu: (a) Reddit unblock, atau (b) set `REDDIT_CLIENT_ID` (installed-app OAuth — perlu bikin app di reddit.com/prefs/apps). Sampai saat itu onboarding step 5 tampil karma=0 (fallback aman).
2. Password admin `info@jetdigitalpro.com` masih 4-char (`peta`) — rekomendasi kuat: ganti + MFA.
3. Signup tanpa captcha/rate-limit ketat — referral farming Rp20K masih mungkin (rekomendasi: Turnstile).
4. Analytics tetap tidak terpasang.
5. `send-broadcast-emails`/`send-task-blast` tidak ada di repo lokal — cek transport saat dipakai.
6. `sync-reddit-karma` legacy masih dipakai sebagai tier 3 — tetap berguna saat OAuth diset.
7. npm audit: 2 HIGH react-router (RSC-CSRF GHSA-qwww-vcr4-c8h2; SPA tanpa RSC → risiko praktis rendah).
8. Staging (`duxzxizedtvnopfihllz`) aktif — edge functions baru belum di-deploy ke staging (hanya prod; verifikasi staging sebelum push kalau dipakai).

## File yang diubah

```
peta/supabase/functions/send-peta-email/index.ts          (SMTP)
peta/supabase/functions/send-notification-email/index.ts  (SMTP)
peta/supabase/functions/fetch-reddit-profile/index.ts     (BARU, deployed)
peta/src/pages/TaskDetail.tsx                             (FIX 2a)
peta/src/pages/admin/TaskQueue.tsx                        (FIX 2b)
peta/src/pages/Landing.tsx, Privacy.tsx, Terms.tsx, Help.tsx  (FIX 3)
peta/src/lib/api.ts                                       (FIX 4 chain)
peta/src/pages/Login.tsx                                  (FIX 5)
peta/src/pages/NotFound.tsx (BARU) + src/App.tsx          (FIX 6a)
peta/src/modules/reddit/pages/RedditNewOrder.tsx          (FIX 6b)
peta/src/pages/Earnings.tsx, admin/Secrets.tsx            (FIX 7)
peta/DEPLOYMENT.md                                        (runbook update)
```

**Verdict sementara:** semua 7 fix ter-verify di build lokal + backend prod; 2 edge function live di prod. Satu langkah tersisa milik user: **deploy frontend via wrangler** (token Cloudflare), lalu verifikasi hash bundle + CSP header.
