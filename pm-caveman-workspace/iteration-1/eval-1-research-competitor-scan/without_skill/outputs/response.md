# Riset Cepat: Kompetitor PeTa (Indonesia / SEA)

Scope: platform micro-task / paid engagement / paid-to-comment yang relevan untuk pasar Indonesia. Sumber: pengetahuan umum tentang ekosistem GPT (Get-Paid-To) & micro-task SEA per 2024-2026. Beberapa angka pricing range bisa berubah, jadi anggap ini direksional, bukan final.

## Tabel Perbandingan

| # | Platform | Asal / Pasar | Pricing Model (per task) | Level / Tier System | Yang Mereka Lakukan Lebih Bagus Dari PeTa |
|---|----------|--------------|--------------------------|---------------------|-------------------------------------------|
| 1 | **YSense** (dulu ClixSense) | Malaysia, banyak user ID | Survey & micro-task: ~Rp2K–50K per task. Payout via PayPal / e-wallet, min sekitar USD $10 (~Rp160K) | Tier "Trusted Member" (level berdasarkan tugas selesai + verifikasi ID) yang unlock survey premium berbayar lebih tinggi | **Tracking & dashboard earnings real-time** + integrasi PayPal yang super smooth. UX laporan duit jauh lebih matang dari kebanyakan competitor lokal |
| 2 | **Microworkers** | Global, basis user ID besar | Per-task fee tetap dari requester: $0.10–$5 (Rp1.5K–80K). Mayoritas task: comment, signup, social share | Rating "Success Rate" (TSR – Temporary Success Rate); kalau drop di bawah 75% akun di-suspend dari kategori task | **Dual-sided marketplace** — siapa pun bisa post task (bukan cuma admin internal). Likuiditas task jauh lebih tinggi, user gak nunggu task baru |
| 3 | **Rakuten Insight / Toluna Indonesia** | JP/global, aktif di ID | Survey: Rp5K–50K/survey. Bukan komen tapi mirip "tugas ringan dibayar" | Level berdasarkan profile completeness + survey history → akses survey high-paying | **Profil/screening yang detail** sehingga task yang masuk relevan banget — minim waste effort. PeTa belum punya skill matching |
| 4 | **Picoworkers / SproutGigs** | Global, popular di ID/PH/IN | Per-task: $0.05–$2 (Rp750–32K). Banyak job comment, upvote, review | "Level 1–3" berdasarkan jumlah task approved + approval rate. Level naik = bisa ambil task lebih mahal | **Approval queue yang transparan** — user lihat alasan reject jelas + bisa appeal. Trust loop antara worker dan requester lebih kuat |
| 5 | **Jagel.id / Gigsmart-style lokal ID** (mis. Sribulancer micro-gigs, Projects.co.id micro) | Indonesia | Per-gig Rp10K–100K, biasanya untuk komen/review/social engagement | Reputation score (bintang) + badge verified seller | **Lokalisasi pembayaran** — DANA/OVO/GoPay/transfer bank langsung tanpa min payout tinggi. PeTa min Rp150K terasa berat dibanding Rp50K di sini |
| 6 | *(bonus)* **TimeBucks** | Global, banyak Indo user | Komen Reddit/Twitter/TikTok: $0.05–$0.50 (Rp750–8K) per aksi + bonus harian | Level berdasarkan poin streak harian | **Daily login bonus + spin wheel** = engagement loop yang adiktif. PeTa baru mau pasang streak, mereka udah matang |

## Insight Singkat Buat PeTa

1. **Min payout Rp150K kemahalan** dibanding pemain lokal yang allow Rp25–50K via DANA/OVO. Ini friction gede buat user baru yang mau "test" platform. Pertimbangkan cair lebih awal di milestone pertama.
2. **Skill / kualitas matching** belum ada di PeTa — kompetitor pakai approval rate / TSR untuk filter. Level 0–5 PeTa bagus, tapi belum ada feedback loop kualitas (bukan cuma karma Reddit).
3. **Daily engagement loop** (TimeBucks, Picoworkers) = streak + spin + bonus harian. PeTa Tasks "Coming Soon" page udah kasih streak, lanjutkan ini sebagai diferensiasi, jangan dihapus.
4. **Marketplace dua sisi** (Microworkers) = scaling tasks tanpa admin bottleneck. Ini long-term play, tapi worth dipikirin di roadmap.
5. **Transparansi reject** (Picoworkers) = retention factor besar. Pastikan `admin_notes` di `task_assignments` selalu visible ke user dengan UX yang jelas.

## Catatan
Ada beberapa platform khusus "paid Reddit comment" yang grayer (mis. RedditMoney-type services di Telegram/Discord ID), tapi gak masuk daftar karena legitimasi & sustainability-nya rendah dan langsung melanggar ToS Reddit secara terbuka. PeTa positioning lebih aman karena public-facing-nya generic ("komen di internet"), persis seperti rekomendasi di CLAUDE.md.
