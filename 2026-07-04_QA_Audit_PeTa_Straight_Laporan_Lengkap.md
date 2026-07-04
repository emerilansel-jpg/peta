# Laporan QA Audit Lengkap — PeTa & Straight.ltd

**Tanggal audit:** 4 Juli 2026  
**Auditor:** Kimi Code CLI  
**Domain yang diperiksa:**
- https://www.penghasilantambahan.com (PeTa)
- https://www.straight.ltd (Straight Ltd)

**Cara audit:** Review kode statis + cek cepat situs produksi via curl. Tidak ada file yang diubah.

---

## 1. Kesimpulan Singkat (Executive Summary)

Dua aplikasi ini sudah **live dan bisa diakses**, tapi masih ada beberapa masalah serius yang perlu diperbaiki sebelum tambah fitur baru.

**Masalah paling urgent:**

1. **Straight.ltd — Ranking Forum bisa diakses publik tanpa login.** Siapa saja bisa nyedot kredit DataForSEO (bayar per panggilan API) karena edge function `rank-forum-pages` tidak wajib autentikasi.
2. **Straight.ltd — Harga upvote salah.** UI sudah nunjukin harga `forum_upvote`, tapi backend tetap nge-charge `reddit_upvote` untuk semua URL. Bisa over-charge atau under-charge.
3. **PeTa — Bot WhatsApp mati.** Evolution API `peta-bot` disconnected, Fonnte juga "unknown user". Fitur grup blast dan bonus "ketik peta" tidak jalan.
4. **PeTa — OTP reset via WhatsApp bisa disalahgunakan.** Endpoint kirim OTP bisa dipanggil anonim, bisa jadi spam ke user.
5. **Kedua situs — copy/marketing tidak cocok sama kode.** Contoh: landing Straight masih bilang "$25 credit" padahal bonus signup sudah dihapus; landing PeTa masih bilang "min payout Rp150K" padahal sudah dihapus.

**Sisi positif:**
- Build TypeScript + Vite lulus tanpa error setelah merge.
- Fitur inti (login, register, order, admin panel) ada dan berjalan.
- DataForSEO sudah jadi provider utama dan Ranking Forum punya data live.

---

## 2. Metodologi Audit

1. **Baca kode** file-file utama:
   - PeTa: `peta/src/pages/*`, `peta/src/pages/admin/*`, `peta/src/lib/api.ts`, migrations.
   - Straight: `peta/src/modules/reddit/pages/*`, `peta/src/modules/reddit/lib/api.ts`, edge functions.
2. **Cek situs produksi** dengan curl ke halaman publik.
3. **Bandingkan kode dengan dokumentasi** (`coldstart.md`, `AGENTS.md`, dll).
4. **Kelompokkan temuan** berdasarkan dampak: Critical / High / Medium / Low.

---

## 3. Status Kesehatan Situs Produksi

| Situs | Halaman | Status HTTP | Catatan |
|---|---|---|---|
| straight.ltd | /reddit/login | 200 OK | Aktif |
| straight.ltd | /reddit/signup | 200 OK | Aktif |
| straight.ltd | /reddit/ranking-forum | 200 OK | Aktif |
| straight.ltd | /reddit/new-order | 200 OK | Aktif |
| penghasilantambahan.com | / | 200 OK | Aktif |
| penghasilantambahan.com | /login | 200 OK | Aktif |
| penghasilantambahan.com | /register | 200 OK | Aktif |
| penghasilantambahan.com | /forgot-password | 200 OK | Aktif |

Semua halaman publik utama bisa dijangkau.

---

## 4. Temuan Straight.ltd

### 🔴 Critical — Wajib Diperbaiki Segera

#### C1. Ranking Forum Bisa Diakses Tanpa Login (Membakar Kredit DataForSEO)

- **Lokasi:** `peta/supabase/functions/rank-forum-pages/index.ts`
- **Masalah:** Edge function ini menerima POST dari siapa saja, termasuk pengunjung yang belum login. Setiap panggilan menghabiskan kredit DataForSEO (bayar per keyword + SERP scan).
- **Dampak:** Orang luar bisa pakai API kita gratis, tagihan DataForSEO membengkak, dan data provider health ikut terbuka.
- **Solusi:** Wajibkan JWT token (cek session user) sebelum proses. Tambahkan rate limit per IP/user.

#### C2. Harga Upvote Selalu Dihitung Sebagai Reddit

- **Lokasi:** migration `20260605090000_straight_pricing_wire_charges.sql` dan `fn_create_reddit_upvote_order`
- **Masalah:** UI sudah bisa bedain harga `reddit_upvote` vs `forum_upvote`, tapi backend selalu pakai `fn_straight_unit_price('reddit_upvote', 50)` meskipun URL-nya HubSpot/Quora.
- **Dampak:** Client bisa kelebihan bayar atau kekurangan bayar. Harga tidak konsisten.
- **Solusi:** Ubah RPC supaya cek URL: kalau mengandung `reddit.com` pakai `reddit_upvote`, selain itu pakai `forum_upvote`.

#### C3. Komentar Self-Written Bulk Jadi Duplikat

- **Lokasi:** `peta/src/modules/reddit/pages/RedditNewOrder.tsx`
- **Masalah:** Kalau user pilih "I'll write it myself" dengan quantity > 1, teks yang sama disalin ke semua slot.
- **Dampak:** Banyak army akan posting komentar identik → risiko ban dari platform + kelihatan tidak natural.
- **Solusi:** Matikan quantity > 1 untuk mode self-written, atau wajibkan setiap slot punya teks unik.

#### C4. Migrasi Scalar Drafts Belum Di-apply ke Produksi

- **Lokasi:** `peta/supabase/migrations/20260701070000_fix_comment_drafts_scalar.sql`
- **Masalah:** Ranking Forum bulk order bisa gagal dengan error `cannot get array length of a scalar` (22023). File migrasi sudah ada di repo tapi belum dijalankan di production.
- **Dampak:** User tidak bisa place order dari Ranking Forum di production.
- **Solusi:** Jalankan SQL di Supabase staging dulu, tes, lalu ke production.

---

### 🟠 High — Penting, Harus Segera

#### H1. Tidak Ada Halaman Lupa Password di Straight

- **Lokasi:** `peta/src/modules/reddit/pages/RedditLogin.tsx` baris 94
- **Masalah:** Link "Forgot?" cuma `<a href="#">` yang tidak ngapa-ngapain. Tidak ada route `/reddit/forgot-password`.
- **Dampak:** User yang lupa password tidak bisa recover akun.
- **Solusi:** Buat halaman forgot/reset password untuk Straight (bisa reuse Supabase auth reset).

#### H2. UI Admin PayPal Tidak Ada

- **Lokasi:** `peta/src/modules/reddit/pages/admin/AdminSettings.tsx`
- **Masalah:** `coldstart.md` bilang PayPal bisa dikonfigurasi dari `/reddit/admin/settings`, tapi di kode hanya ada AI provider + registration mode. RPC `admin_get_paypal_config` / `admin_set_paypal_config` sudah ada tapi tidak dipakai.
- **Dampak:** Admin harus edit secret manual di database, bertentangan dengan dokumentasi.
- **Solusi:** Tambahkan card PayPal Settings di AdminSettings.

#### H3. Landing Masih Promosikan "$25 Credit"

- **Lokasi:** `peta/src/modules/reddit/pages/RedditLanding.tsx`
- **Masalah:** Tombol hero masih tulis "Start with $25 credit", padahal keputusan produk 23 Juni 2026 sudah menghapus semua signup credit.
- **Dampak:** Iklan palsu, user komplain.
- **Solusi:** Ganti copy jadi "Start free" atau "Create account".

#### H4. Admin Finance Query Ambil Semua Data

- **Lokasi:** `peta/src/modules/reddit/lib/api.ts`
- **Masalah:** `getAdminFinanceStats` select semua topup dan order ke memory. Saat transaksi banyak, bakal lambat atau crash.
- **Dampak:** Admin dashboard semakin lemot seiring pertumbuhan.
- **Solusi:** Gunakan aggregate SQL di backend atau tambah filter tanggal.

#### H5. AdminGuard Tidak Cek `is_active`

- **Lokasi:** `peta/src/components/AdminGuard.tsx`
- **Masalah:** Guard cuma cek `role = 'admin'`. Kalau admin dinonaktifkan (`is_active = false`), dia masih bisa akses admin page.
- **Dampak:** Security risk — user yang sudah di-ban masih punya akses.
- **Solusi:** Tambahkan cek `is_active = true` di `is_admin()` atau di guard.

---

### 🟡 Medium — Perlu Perhatian

- **M1.** Mode "link" vs "plain" hanya berlaku untuk AI-suggested comment. Self-written tidak kena harga link.
- **M2.** Hanya ada harga `reddit` dan `forum` — tidak bisa bedain Quora vs HubSpot vs platform lain.
- **M3.** Edge function generate comment bisa fetch URL sembarangan — risiko SSRF.
- **M4.** Landing pakai angka statistik hardcode ("12.4M+ upvotes", "98.2% retention") yang bertentangan dengan aturan "no fake data".
- **M5.** Tidak ada UI admin untuk pricing matrix — hanya bisa diubah via SQL.
- **M6.** Admin orders/clients tidak ada pagination, hard limit 100.
- **M7.** Link Terms of Service / Privacy Policy di signup mati (`href="#"`).

---

## 5. Temuan PeTa (PenghasilanTambahan.com)

### 🟠 High — Penting

#### H1. Bot WhatsApp Offline

- **Lokasi:** Operational / runtime
- **Masalah:** Evolution API `peta-bot` status "connecting" (sebenarnya logged out). Fonnte device token juga "unknown user".
- **Dampak:**
  - Bonus "ketik peta = Rp5K" tidak jalan.
  - Group auto-blast tidak jalan.
  - WA OTP reset tidak bisa kirim.
- **Solusi:** Scan ulang QR Evolution API di `http://46.250.239.138:8080/manager`, reconnect Fonnte device, refresh `FONNTE_TOKEN` di Supabase secrets.

#### H2. Endpoint Kirim OTP WA Bisa Disalahgunakan

- **Lokasi:** `peta/src/pages/ResetWhatsApp.tsx` dan `peta/supabase/functions/wa-reset-request/index.ts`
- **Masalah:** Endpoint kirim OTP WA bisa dipanggil tanpa login, hanya pakai anon key. Cooldown 45 detik per user lemah.
- **Dampak:** Attacker bisa spam OTP ke nomor user, boros kredit Fonnte, dan bisa kena rate-limit suspension.
- **Solusi:** Wajibkan autentikasi sebelum kirim OTP, atau tambah hCaptcha + rate limit per IP.

---

### 🟡 Medium — Perlu Diperbaiki

#### M1. Landing Masih Bilang "Min Cair Rp150K"

- **Lokasi:** `peta/src/pages/Landing.tsx` baris 159, 298, 309
- **Masalah:** Copy landing bilang minimal payout Rp150K, padahal migration sudah menghapus minimum payout. Di `Earnings.tsx` sudah benar: "Cair kapan aja, berapapun."
- **Dampak:** User bingong / komplain.
- **Solusi:** Update landing: ganti jadi "Cair berapapun" / "No minimum payout".

#### M2. Bonus Referral Rp25K Tidak Sesuai Database

- **Lokasi:** `Landing.tsx`, `Tasks.tsx`, `Account.tsx`
- **Masalah:** Copy bilang referee dapat Rp25K, tapi trigger `handle_new_user` cuma kasih Rp20K ke kedua belah pihak.
- **Dampak:** Iklan palsu.
- **Solusi:** Update semua copy jadi Rp20K/20K, atau ubah trigger jadi Rp25K untuk referee.

#### M3. Migrasi Scalar Drafts Belum di Production

- **Lokasi:** `peta/supabase/migrations/20260701070000_fix_comment_drafts_scalar.sql`
- **Masalah:** Sama dengan Straight — migrasi terakhir belum di-apply ke prod.
- **Dampak:** Forum comment order bisa error.
- **Solusi:** Apply ke staging dulu, lalu production.

---

### 🟢 Low — Polish

- **L1.** Beberapa admin action masih write langsung ke tabel (bukan RPC), contoh: approve assignment, insert task. Lebih baik pakai RPC supaya konsisten dan gampang di-test.
- **L2.** Edit WhatsApp di Account page tidak cek nomor sudah dipakai orang lain atau belum. Kalau bentrok, user lihat error Postgres mentah.
- **L3.** Sinkronisasi Reddit karma bergantung ke public CORS proxy yang sering gagal. New user bisa stuck di level 0.

---

## 6. Temuan Lintas Sistem (PeTa + Straight)

### 1. Copy/Marketing Tidak Sinkron dengan Kode

Banyak halaman landing dan promo yang masih pakai copy lama. Ini bikin user salah ekspektasi.

| Klaim | Realita | Lokasi |
|---|---|---|
| Straight: "$25 credit" | Signup credit sudah dihapus | `RedditLanding.tsx` |
| Straight: "PayPal admin-configurable" | UI PayPal tidak ada | `AdminSettings.tsx` |
| PeTa: "Min cair Rp150K" | Minimum payout dihapus | `Landing.tsx` |
| PeTa: "Referee dapat Rp25K" | Database cuma Rp20K | `Landing.tsx`, `Tasks.tsx`, `Account.tsx` |

### 2. Tidak Ada Test Otomatis / CI

- Tidak ada file `*.test.*`.
- Tidak ada `.github/workflows`.
- Semua deploy manual via wrangler/supabase CLI.
- **Dampak:** Regresi sering lolos. Fitur baru mudah merusak fitur lama.
- **Solusi:** Setup minimal Vitest untuk unit test + Playwright untuk E2E critical path.

### 3. Edge Function Security Tidak Konsisten

- `rank-forum-pages` tidak wajib auth.
- `wa-reset-request` tidak wajib auth.
- `generate-forum-comment` wajib auth tapi bisa fetch URL sembarangan.
- **Solusi:** Audit semua edge function, terapkan auth + input validation + rate limit.

### 4. Migrasi Database Tertinggal

- `20260701070000_fix_comment_drafts_scalar.sql` belum di-apply ke staging maupun production.
- Ini menyebabkan bug Ranking Forum "Place orders" masih terjadi di production.

### 5. WhatsApp Infrastructure Merupakan Single Point of Failure

- PeTa sangat bergantung pada WhatsApp untuk OTP, notifikasi, dan bonus.
- Bot offline = banyak fitur mati.
- **Solusi:** Siapkan fallback email untuk notifikasi kritis, dan monitoring bot status.

---

## 7. Rekomendasi Prioritas

### Minggu Ini (Critical/High)

1. **Apply migrasi scalar drafts** ke staging → test → production.
2. **Tambahkan autentikasi di `rank-forum-pages`** edge function + rate limit.
3. **Fix harga upvote** supaya platform-aware (`reddit_upvote` vs `forum_upvote`).
4. **Reconnect WhatsApp bot** (Evolution + Fonnte).
5. **Amankan `wa-reset-request`** dengan autentikasi atau captcha.
6. **Hapus "$25 credit"** dari landing Straight.
7. **Fix copy PeTa** landing (min payout dan referral bonus).

### Minggu Depan (Medium)

8. Buat halaman lupa password Straight.
9. Tambahkan UI admin PayPal.
10. Hindari duplikat komentar self-written bulk.
11. Tambahkan pagination di admin orders/clients.
12. Fix admin guard `is_active`.

### Bulan Ini (Low/Strategic)

13. Setup test otomatis (Vitest + Playwright) minimal untuk critical path.
14. Audit semua edge function dari sisi security.
15. Refactor admin table writes ke RPC.
16. Monitoring provider health + alerting.
17. Perjelas copy Terms/Privacy links.

---

## 8. Hal yang Sudah Baik

- **Build lancar:** `npm run build` sukses tanpa TypeScript error setelah merge.
- **DataForSEO aktif:** Ranking Forum punya data live keyword + SERP.
- **Google Sign-In sudah dihapus** dari Straight.ltd dan sudah deploy ke production.
- **Fitur inti lengkap:** login, register, order, admin panel, payouts semua ada.
- **Dokumentasi coldstart.md** cukup lengkap sebagai handoff antar sesi.

---

## 9. Catatan Akhir

Aplikasi ini sudah cukup matang untuk operasional harian, tapi masih butuh perbaikan di tiga area besar sebelum scaling:

1. **Security & cost control** — edge function harus wajib auth + rate limit.
2. **Infrastructure stability** — WhatsApp bot harus selalu online.
3. **Testing & CI** — harus ada test otomatis supaya regresi tidak lolos.

Kalau ada yang mau saya jelaskan lebih detail atau langsung perbaiki salah satu item, kabari saja.
