# PeTa — System QA Plan & Assessment

Tanggal: 14 September 2026. Baseline: HEAD `d951884` + working-tree changes (termasuk migrasi submitted_at). Owner usulan: developer/QA PeTa. Dokumen assessment, bukan implementasi perbaikan.

## 1. Executive summary

**Belum dapat dinyatakan seluruh fitur berfungsi 100%.** Pemeriksaan terbatas menghasilkan bug nyata, terutama staging approval, akses langsung payout, dan pelaporan sukses palsu pada misi. Build sukses tidak membuktikan perjalanan pengguna end-to-end sukses.

Audit ini membaca codebase dan katalog database staging/production, menjalankan tes offline/build/lint. Tidak mengubah kode aplikasi, deploy, membuat transaksi, mengirim email/WhatsApp, atau mencairkan uang. Hanya dokumen ini dibuat. Laporan sebelumnya dalam percakapan terlalu luas menyebut staging sudah beres: penambahan kolom sukses, tetapi pemanggilan admin_pending_approvals di staging sekarang terbukti gagal.

Status bukti:
- **LULUS TERBATAS:** pemeriksaan tertentu berhasil; bukan seluruh fitur.
- **GAGAL RUNTIME:** error direproduksi pada environment yang disebut.
- **TERKONFIRMASI KONFIGURASI:** policy/definisi aktif diverifikasi read-only, tanpa eksploitasi.
- **TEMUAN KODE:** jalur salah terlihat pada kode; belum direproduksi lewat UI atau transaksi staging.
- **BELUM DIUJI / TERBLOKIR:** bukan dianggap lulus.

## 2. Scope & objectives

### Matriks QA per fitur

Semua skenario write di bawah adalah **rencana**, bukan hasil eksekusi audit ini. Gunakan staging setara production dan akun sintetis.

| Fitur | Prioritas | Skenario wajib / kriteria lulus | Status assessment |
|---|---|---|---|
| Landing, login/register publik | P2 | CTA menuju halaman tepat; validasi field; copy publik tanpa Reddit; angka komunitas nyata; tidak ada data palsu | UI belum diuji |
| Registrasi, login, logout, sesi | P1 | Email baru/duplikat, password salah, akun nonaktif, reload, sesi kedaluwarsa; akses admin ditolak untuk member | E2E belum diuji |
| Lupa/reset password via email/WA | P1 | Token valid/kedaluwarsa/replay; cooldown; provider gagal; tujuan link hanya domain resmi; respons tidak membocorkan akun | Temuan kode tujuan link reset |
| Onboarding & bonus | P1 | Lanjut dari langkah terakhir sesudah reload; setiap bonus sekali; kegagalan RPC tidak dicatat sebagai sukses; batas founding | Temuan kode resume dan batas founding |
| Tasks, filter, kategori, detail | P1 | Daftar sesuai status/jadwal/role/level; empty state; tidak mengembalikan task tersembunyi; kuota akurat | Ada real task list di source saat ini; E2E belum diuji |
| Claim task & draft | P1 | Kuota terakhir dengan dua pengguna; double-click; task tutup; batas akun; draft tersimpan sesudah reload | Tes workflow offline lulus; runtime belum diuji |
| Submit bukti task biasa | P1 | Screenshot/link; file tidak valid/besar; bukti kosong; sesi habis; DB gagal; bukti tersimpan lalu muncul di admin | Kontrak offline parsial; E2E belum diuji |
| Reddit Army aktivasi & akun | P1 | Akun sendiri/warmed, suspended/not-found, assignment owner benar; kredensial tidak terlihat member lain | Belum diuji runtime |
| Reddit Army claim/submit/retry | P1 | RPC gagal harus gagal di UI; update nol baris tidak sukses; multiproof utuh; final rejection tidak bisa diulang | Beberapa temuan kode |
| Penggantian akun Reddit | P1 | Request/pending/approve/reject; duplicate username; task, saldo, history tetap; data lama terlindungi | Kontrak/simulasi offline lulus; E2E belum diuji |
| Check-in, level, reward, streak | P1 | Satu kredit per hari; timezone/pergantian hari; bukti valid; milestone tepat; retry tidak menggandakan bonus | Belum diuji runtime |
| Resign, rejoin, ghosting, bonus hold | P1 | State/masa tunggu; aktivitas minimum; freeze/release benar; scheduler idempotent | Belum diuji runtime |
| Referral | P1 | Referral valid/tidak valid/self-referral; duplikat request; bonus kedua pihak sesuai eligibility | Belum diuji runtime |
| Earnings, ledger, payout member | P1 | Saldo rekonsiliasi; minimum, holding, unlock, limit; dua request bersamaan; akses langsung tabel harus ditolak | Konfigurasi production bermasalah |
| Admin dashboard & member/team | P1 | Guard backend; statistik sesuai SQL; create/update/deactivate; pagination/filter; bukan sekadar route guard | Belum diuji E2E |
| Admin task queue/import | P1 | Create/edit/pause/delete; validasi URL/reward/kuota; import malformed; slot tidak bocor | Belum diuji E2E |
| Admin approval/visibility | P1 | Semua submitted terlihat; approve/reject/retry; 72 jam; tidak ada double-credit; proof/image URL bisa dibuka | Staging GAGAL RUNTIME; production read RPC lulus terbatas |
| Admin payroll | P1 | Pending/paid/cancel; transaksi idempotent; saldo terpotong sekali; jejak audit/rekening benar | Belum diuji transaksi |
| Admin Reddit operations | P1 | Account inventory/replacement, Army review, warming, level/check-in, holds, audit akses role | Belum diuji E2E |
| Admin inbox | P2 | Thread/reply/archive; delivery failure; manual inbound; polling sesuai kontrak | Belum diuji; IMAP polling pada source sengaja no-op, bukan otomatis bug |
| Admin secrets & WA bot | P1 | Admin-only secret access; tidak bocor di response/log; gateway config/status/QR/group; failure aman | Belum diuji E2E |
| Task history & retry | P1 | Filter status/platform; detail bukti; retryable vs final rejection; history tetap | Temuan kode retry; E2E belum diuji |
| Account self-delete | P1 | Konfirmasi; auth invalidation; dampak ledger/payout/history terdefinisi; member lain tidak terhapus | Belum diuji; hanya fixture disposable |
| Forum/content/category management | P2 | CRUD sesuai role; import/queue; perubahan kategori tidak merusak existing task | Belum diuji E2E |
| Straight client/order & admin integrasi | P1 | Host/routing terpisah; order/screening/revisi/approval/publish sinkron; file/link aman | Tes screening offline lulus; integrasi E2E belum diuji |
| Email, WA, notification, broadcast | P1 | Sandbox delivery, retry/dedupe/rate-limit; provider gagal; tidak kirim ke pengguna asli | Belum diuji provider |
| Storage bukti | P1 | Owner-only writes; jenis/ukuran file; sesi habis; upload sebagian; retry; objek tanpa assignment | Belum diuji upload nyata |
| RLS/RPC & keamanan | P1 | Guest/member A/member B/admin; cross-user reads/writes; role tampering; SECURITY DEFINER; ledger/payout hanya jalur resmi | Payout bypass terkonfirmasi konfigurasi |
| Mobile, aksesibilitas, browser | P2 | 390px + desktop; keyboard/focus/label; touch targets; Chrome/Firefox/WebKit; jaringan putus | Belum diuji browser |
| Deployment, migrations, scheduler | P1 | Skema/kontrak sama di staging; replay migrasi; semua RPC dipanggil; cron idempotent; rollback diuji | Drift staging terkonfirmasi |

Route inventory sumber: `peta/src/App.tsx:148-248`. PeTa member: `/tasks`, `/task/:taskId`, `/task-history`, `/reddit-army`, `/account`, `/earnings`; onboarding saat ini empat stage. Admin: `/admin`, `/admin/accounts`, `/admin/tasks`, `/admin/approval`, `/admin/team`, `/admin/payroll`, `/admin/reddit-army`, `/admin/broadcast`, `/admin/inbox`, `/admin/secrets`, `/admin/wa-bot`. Auth/reset/terms/privacy/help/404 juga masuk smoke.

Straight berbagi codebase/backend sehingga masuk uji regresi integrasi, bukan dianggap sudah diaudit penuh: dashboard/order/detail/topup/reviews/feature-requests/ranking-forum/AI-visibility; admin order/tickets/clients/reviews/finance/settings/retention/waitlist. Test tambahan: PayPal sandbox capture/replay, kredit client, ticket reply, pricing flags, reward review, ranking/AI provider failure; legacy `/reddit/...` dan clean host routes harus tepat. Fitur sengaja paused/coming-soon tidak dinilai gagal hanya karena dinonaktifkan.

Target usulan: seluruh skenario kritis di atas terdaftar, seluruh skenario kritis yang disepakati lulus sebelum release, nol temuan P1 terbuka. Itu tidak sama dengan jaminan software tanpa bug.

## 3. Test levels & types

1. **Static:** TypeScript, lint, review SQL/RLS dan kontrak frontend–RPC.
2. **Unit/offline:** aturan reward, eligibility, normalisasi URL, perubahan state, screening.
3. **Integration DB/API:** database disposable/setara production; authenticated role asli; row count dan side effects diverifikasi.
4. **E2E staging:** member dan admin mengerjakan satu alur lengkap, bukan sekadar membuka halaman.
5. **Nonfunctional:** aksesibilitas/responsive, ketahanan jaringan, keamanan ownership, performa baca ringan.
6. **Production smoke:** hanya read-only secara default. Tidak menjalankan payout, broadcast, reset email nyata atau test destructive.

## 4. Current tests & target pyramid

Hasil baru pada audit ini:
- `node scripts/test-straight-screening.mjs`: PASS (offline).
- `node scripts/test-contributor-backend.mjs`: PASS (kontrak SQL/TS dan simulasi; bukan eksekusi seluruh backend).
- `node scripts/test-reddit-replacement.mjs`: PASS ketika dijalankan dari root aplikasi `peta/`.
- `npm run build --ignore-scripts`: PASS; warning dynamic import dan bundle besar. JS 1,567.47 kB / gzip 379.90 kB.
- `npm run lint --ignore-scripts`: FAIL, 356 errors + 7 warnings. Ini temuan quality gate, bukan 356 bug runtime.
- Seluruh perintah di atas dijalankan dalam konteks `peta/` atau melalui absolute npm prefix yang setara.

Jumlah suite bukan jumlah test case; coverage baris/branch, flaky rate dan pass rate seluruh aplikasi belum diukur. Jangan mengambil persentase suite di atas sebagai persentase fitur bekerja.

Target awal usulan, bukan implementasi: 35 skenario unit/offline, 20 integrasi, 10 E2E kritis (sekitar 54:31:15). Integration sengaja lebih besar daripada rasio textbook karena sebagian besar logika bisnis berada di Postgres. Waktu target: offline <3 menit, PR <15 menit, E2E staging <30 menit.

## 5. Risk assessment & bug register

P1 = harus ditangani sebelum sertifikasi release; P2 = masalah correctness/operasional berikutnya. Prioritas bukan klaim telah terjadi penyalahgunaan.

### B01 — Antrean approval staging rusak [P1, GAGAL RUNTIME]
- Environment: staging `duxzxizedtvnopfihllz`.
- Reproduksi read-only: transaksi READ ONLY, set claim admin hanya pada transaksi, panggil `SELECT count(*) FROM public.admin_pending_approvals()`.
- Aktual: `ERROR 42703: column ta.user_note does not exist`.
- Production: fungsi yang sama berhasil, `pending_approvals=0`; tidak membuktikan rendering row/bukti karena antrean kosong.
- Penyebab: migrasi baru mengganti fungsi dengan referensi kolom workflow yang belum ada di staging; menambahkan submitted_at saja tidak menyamakan skema.
- Referensi: `peta/supabase/migrations/20260914100000_add_task_assignments_submitted_at.sql`, blok admin_pending_approvals, terutama SELECT `ta.user_note`, `ta.proof_media`, `ta.contributor_workflow`.
- Retest: migrasi pada baseline sesuai; panggil fungsi dengan fixture submitted; seluruh kolom/proof tampil dan role member ditolak.

### B02 — Validasi payout dapat dilewati melalui tabel [P1, KONFIGURASI PRODUCTION TERKONFIRMASI]
- Live policy `payouts_insert_own`: hanya `user_id = auth.uid()`; role authenticated memiliki INSERT; satu-satunya trigger user di tabel adalah audit log.
- Ini membuka jalur membuat payout tanpa menjalankan `validate_payout_eligibility` pada RPC. Tidak dilakukan INSERT percobaan atau pencairan.
- Referensi: `peta/supabase/migrations/20260505053054_peta_rls_policies.sql:77-78`; audit-only trigger `20260520100000_audit_log_critical_tables.sql:69-73`.
- Retest staging: direct insert oleh member harus ditolak; RPC legitimate tetap sukses setelah pemeriksaan saldo/limit.

### B03 — Dua request payout dapat lolos saldo yang sama [P1, TEMUAN DEFINISI LIVE; RACE BELUM DIEKSEKUSI]
- Production RPC memeriksa eligibility lalu INSERT tanpa lock per-user; validator STABLE membaca saldo/committed payout tanpa lock.
- Dua transaksi serentak dapat sama-sama membaca saldo sebelum request lain tercatat.
- Referensi: `peta/supabase/migrations/20260716110000_peta_payout_payment_method.sql:59-64`, `107-113`; validator `196-202`. Definisi aktif diverifikasi read-only.
- Retest staging: dua sesi serentak terhadap saldo yang hanya cukup satu request; total pending/paid tidak boleh melebihi saldo atau cap.

### B04 — Submit bukti bisa tampil sukses walau nol baris tersimpan [P1, TEMUAN KODE]
- `submitChallengeAssignmentProof` hanya memeriksa error UPDATE, tidak mengecek row yang berubah. PostgREST dapat mengembalikan sukses untuk UPDATE tanpa row cocok, termasuk row tersembunyi RLS atau ID sudah tidak ada.
- UI lalu memberi toast sukses dan menutup submit sheet. Upload file sebelumnya tidak membuktikan assignment tersimpan.
- Referensi: `peta/src/lib/api.ts:2420-2432`; `peta/src/pages/RedditArmy.tsx:741-750`.
- Retest staging: assignment hilang/tidak dapat diakses menghasilkan error yang jelas; draft/file tetap dapat dicoba ulang; sukses hanya setelah row submitted dan bukti terverifikasi.

### B05 — Gagal claim misi malah ditampilkan berhasil [P2, TEMUAN KODE]
- Helper claim mengembalikan `{ok:false,error}`, bukan throw. `claimMut.onSuccess` tidak memeriksa hasil.
- Referensi: `peta/src/lib/api.ts:2010`; `peta/src/pages/RedditArmy.tsx:384-394`.
- Retest: kuota penuh/akun tidak eligible/RPC error tidak boleh menampilkan “Misi dimulai”.

### B06 — Final rejection dapat dicoba lagi melalui claim baru [P1, TEMUAN KODE; RUNTIME BELUM DIUJI]
- `claim_challenge_task` hanya mencari assignment in_progress/submitted/approved lalu INSERT baru. Tidak memeriksa rejected dengan can_retry=false.
- Referensi: `peta/supabase/migrations/20260911000000_replace_reddit_account_flow.sql:233-244`.
- Berlaku bila syarat akun/level/task/kuota lain masih memenuhi. Assignment baru juga memiliki lifecycle/timestamp baru.
- Retest staging: rejected final tidak dapat di-claim ulang; rejected retryable mengikuti lifecycle yang didefinisikan tanpa menghapus history.

### B07 — Waktu submit dipercaya dari perangkat pengguna [P2, TEMUAN KODE]
- Frontend mengirim submitted_at dari jam browser; guard mengizinkan field tersebut dan hanya mengisi otomatis saat NULL; admin mengurutkan berdasar field itu.
- Referensi: `peta/src/lib/api.ts:2428`; migrasi `20260914100000_add_task_assignments_submitted_at.sql:74-85`, bagian ORDER BY admin queue.
- Jam perangkat salah/field diubah menyebabkan waktu dan urutan review keliru. Ini bukan bukti bypass first_proof_submitted_at/72 jam yang merupakan field berbeda.
- Retest: server menentukan timestamp; perubahan jam klien tidak memengaruhi waktu/urutan.

### B08 — Reload onboarding melompati langkah yang belum selesai [P2, TEMUAN KODE]
- Setelah bonus signup pertama tercatat, mount memeriksa keberadaan satu credit source signup_bonus dan langsung redirect ke tasks.
- Referensi: `peta/src/pages/Onboarding.tsx:73-81`.
- Reproduksi staging yang direncanakan: selesaikan langkah pertama, reload sebelum langkah berikutnya; harus kembali ke langkah belum selesai, bukan dianggap tuntas.

### B09 — Batas founding memakai jumlah seluruh member saat klaim [P2, TEMUAN KODE]
- Kondisi COUNT army >=100 menolak member ke-100 dan member awal yang belum menyelesaikan bonus setelah jumlah army mencapai 100; pesan menyatakan hanya slot 101+ yang ditolak.
- Referensi: `peta/supabase/migrations/20260903_update_onboarding_bonus_no_reddit.sql:31-34`.
- Retest database sintetis di batas 99/100/101; hak bonus berdasarkan eligibility member, bukan waktu klaim global.
- Definisi deployed terbaru fungsi ini belum diverifikasi pada audit ini.

### B10 — Link reset password menerima domain tujuan dari request [P1, TEMUAN KODE; DEPLOYMENT BELUM DIVERIFIKASI]
- `base_url` dan `reset_path` diterima tanpa allowlist, lalu link berisi token reset dibangun dari input tersebut.
- Referensi (diverifikasi langsung): `peta/supabase/functions/send-password-reset-email/index.ts:99,193`; jalur WhatsApp `peta/supabase/functions/send-wa-password-reset/index.ts:47,133` — `base_url` dari body request dipakai membangun link berisi token.
- Risiko token terkirim ke domain tidak resmi jika penerima mengklik link. Tidak mengirim email/WhatsApp atau mencoba mengambil token selama audit.
- Retest sandbox: domain/path nonresmi ditolak; link selalu domain PeTa/Straight resmi; token kedaluwarsa/single-use tetap benar.

### B11 — Empat edge function dipanggil frontend tetapi tidak ada di repo [P1, KETERSEDIAAN DEPLOYMENT BELUM DIVERIFIKASI]
- Frontend memanggil: `send-broadcast-emails` (`peta/src/lib/api.ts:1178`), `send-broadcast-whatsapp` (`:1203`, `:1218`), `retry-pending-whatsapp` (`:1239`), `inbox-send-reply` (`:1660`).
- Direktori `peta/supabase/functions/` tidak berisi keempatnya. Ketidakadaan di repo tidak membuktikan tidak ter-deploy (deployment belum diverifikasi), tetapi build tidak mengecek keberadaan fungsi, dan fungsi yang hilang dari repo tidak bisa diaudit atau diperbaiki dari sini.
- Dampak bila tidak ter-deploy: seluruh broadcast email/WA, retry WA, dan reply inbox admin gagal saat dipanggil.
- Retest: inventaris fungsi ter-deploy via Management API; panggilan sandbox uji; bila memang hilang, pulihkan kode (artefak lama `.agents/qa-reports/fn-send-broadcast-emails.ts` dst. menunjukkan kode pernah ada) dan masukkan ke repo.

### Blokir/quality gate tambahan
- **Staging schema drift:** hanya 16 kolom task_assignments, dibanding 26 production; staging tidak memiliki submit_assignment_proof, self_report_daily_activity, list_challenge_tasks_for_user dan admin_review_assignment_visibility pada inventory nama tersebut. Staging tidak valid sebagai representasi full workflow saat ini.
- **HTTP probe production terblokir:** Python GET ke root/login/reddit-army mendapat 403. Ini bukan bukti UI down; belum diuji dengan browser pengguna.
- **HTTPS staging:** klien Python menolak sertifikat sebagai expired. Catat sebagai blocker akses dari lingkungan audit; belum dilakukan inspeksi rantai sertifikat independen.
- **Lint gagal:** perlu baseline atau perbaikan terukur sebelum menjadi gate; jumlah lint tidak setara jumlah bug aplikasi. Contoh nyata: `src/components/AdminGuard.tsx:29:41` (`no-explicit-any`), `src/components/Confetti.tsx:48:5` (`set-state-in-effect`), `supabase/functions/wa-reset-request/index.ts:14:1` (`ban-ts-comment`).
- **Tidak ada CI test workflow:** konfigurasi Vercel hanya build; dependency Playwright ada tanpa script/config test. Sukses build bukan gate kualitas.
- **Build tidak mengecek edge function:** `tsconfig.app.json:24` dan `tsconfig.node.json:23` mengecualikan `supabase/functions`; error TypeScript/runtime Deno baru terlihat saat invoke.
- **Inbox IMAP polling sengaja no-op** (`supabase/functions/inbox-poll-email/index.ts:36-43`) — keputusan desain, bukan bug; masuk smoke sebagai perilaku yang diharapkan.
- **Dokumentasi lama:** AGENTS/QA context masih menyebut Tasks coming-soon, no tests, deployment planned; source/test/deployment aktual berbeda. Acceptance criteria harus mengacu kebijakan terbaru yang disahkan, bukan angka lama otomatis.

## 6. Environment & data strategy

- Local/disposable: replay migrations, unit, integration, race test. Tidak menggunakan saldo/data asli.
- Staging: samakan schema, RPC signatures, storage policies, feature flags, dan artifact dengan kandidat production. Simpan output schema diff sebagai bukti; jangan menganggap HTTP 201 migrasi cukup.
- Production: read-only smoke dan katalog; write test memerlukan otorisasi/akun uji tersendiri.
- Fixture: guest; member A/B; admin; member baru/lama; eligible/ineligible payout; akun active/suspended/warmed/replacement pending; assignment seluruh status; proof image/link/multiproof.
- Semua data uji diberi run ID, cleanup hanya fixture milik run tersebut. Sandbox email/WA. Tidak menghapus member, kredit, bukti atau assignment nyata.
- Batas waktu yang wajib diuji: 72 jam visibility; reset expiry/replay; pergantian tanggal lokal; payout weekly cap; founding boundary.

## 7. Tool selection

Tidak menambah dependency pada assessment ini. Pilihan minimal untuk implementasi berikutnya:

| Pilihan | Fit stack (1–5) | Biaya perawatan (5=ringan) | Feedback (1–5) | Keputusan |
|---|---:|---:|---:|---|
| Node assert/scripts existing | 5 | 5 | 5 | Pertahankan untuk regression/offline |
| PostgreSQL disposable + SQL assertions | 5 | 4 | 4 | Utama untuk RLS, RPC, transaksi |
| Playwright untuk 10 E2E inti | 5 | 3 | 3 | Gunakan untuk alur UI, bukan semua unit |
| Framework tes tambahan sekaligus | 3 | 1 | 2 | Tidak diperlukan pada fase awal |

Browser tetap harus diuji; script string-matching migration saja tidak membuktikan SQL bisa dieksekusi.

## 8. Entry/exit criteria

| Level | Entry | Exit |
|---|---|---|
| Offline | Dependency tersedia; baseline revision dicatat | Semua regression terkait pass, tanpa skipped tersembunyi |
| Integration | Schema setara, fixture terisolasi, role nyata | Positive/negative/ownership/concurrency pass; efek saldo dan row count benar |
| E2E | Integration pass; staging HTTPS/akses berfungsi; sandbox provider | Sepuluh alur kritis pass; bukti screenshot/trace dan SQL assertion |
| Release | Tidak ada P1 terbuka; artifact diuji sama dengan yang akan deploy | Smoke production pass; rollback tersedia; tidak ada error baru yang diketahui |

## 9. Quality gates

- **PR:** typecheck/build, offline regression, lint tanpa error baru terhadap baseline yang disahkan, SQL/RPC contract checks. Tidak mengabaikan 356 error lint sebagai pass.
- **Merge:** integration roles + satu smoke member/admin pada artifact kandidat; migration replay berhasil.
- **Deploy:** full critical staging E2E pass, nol P1 terbuka, schema drift nol pada dependency fitur, provider sandbox pass.
- **Nightly (usulan; belum dijadwalkan):** regression lint/build + E2E, cross-browser subset, jadwal/72h, aksesibilitas, ringkasan failures. Jangan menjadwalkan otomatis tanpa permintaan eksplisit.

## 10. Metrics & reporting

Setiap test case menyimpan ID fitur, role, environment, commit/artifact, prasyarat/data, langkah, expected/actual, status, bukti, owner dan severity.

- Coverage skenario = executed / planned; laporkan numerator/denominator.
- Pass rate = passed / executed; tampilkan blocked dan not-run terpisah.
- Target release: 100% skenario kritis yang disepakati dieksekusi dan pass; nol P1. Tidak berarti 100% code coverage atau tanpa bug.
- Rekonsiliasi saldo/kuota: selisih harus 0 pada fixture setelah tiap operasi/retry.
- Regression baru wajib mencakup setiap bug yang diperbaiki.
- Flaky target <2% setelah tersedia cukup histori; saat ini belum terukur.

## 11. Urutan pelaksanaan

1. **Gerbang environment:** selaraskan staging, validasi HTTPS, jalankan RPC sebenarnya dengan fixture; hentikan sertifikasi jika tidak setara.
2. **P1 keamanan & uang:** payout direct-write/concurrency, reset destination, RLS lintas pengguna, ledger idempotency.
3. **P1 task pipeline:** claim, upload, submit, approval, visibility 72 jam, retry, replacement; cek state UI dan DB sekaligus.
4. **Onboarding/retensi/admin/integrasi:** bonus, referral, check-in, resign, task import, client order, notification provider sandbox.
5. **Mobile/browser/nonfunctional:** 390px + desktop, keyboard, Chrome/Firefox/WebKit, jaringan gagal, performa.
6. **Release assessment:** tampilkan matriks pass/fail/blocked/not-run, bug tersisa, keputusan go/no-go.

Owner usulan seluruh tahap: developer PeTa + QA pelaksana. Estimasi harus dihitung setelah staging pulih dan fixture tersedia; tidak menjanjikan tenggat tanpa mengukur pekerjaan penyelarasan.

## 12. Risks & limitations

- Audit ini bukan full E2E. Tidak ada claim/upload/payout/referral/reset email nyata yang dibuat.
- Read RPC production dengan antrean kosong tidak membuktikan isi row/rendering/multi-proof berhasil.
- Source lokal tidak otomatis sama dengan bundle atau edge function yang deployed; temuan kode diberi label sesuai.
- Tidak ada pengujian load/destructive, external Reddit/WA reliability, atau seluruh kombinasi browser.
- Token Cloudflare/GitHub/Supabase dibagikan pada percakapan sebelumnya. Rotasi token tersebut diperlukan sebagai tindakan keamanan terpisah; token tidak dicantumkan di dokumen ini dan tidak dirotasi saat assessment.
- Seluruh temuan dibiarkan untuk dilaporkan sesuai permintaan; **tidak ada fix aplikasi/database pada audit ini**.

## 13. Revision history

| Tanggal | Versi | Perubahan |
|---|---|---|
| 2026-09-14 | 1 | Plan per fitur + assessment kode, tes lokal dan katalog live; koreksi klaim keberhasilan staging sebelumnya |
