# Riset Kompetitor PeTa — 5 Menit Scan

Scope: platform micro-task bayar-buat-komen / engagement, Indonesia + SEA. 5 dipilih. Catatan ketidakpastian di bawah tabel.

## Tabel Kompetitor

| # | Platform | Asal / Pasar | Pricing Model (per task) | Level / Tier System | 1 Hal Lebih Bagus dari PeTa |
|---|---|---|---|---|---|
| 1 | **Microworkers** | Global, banyak pekerja ID | USD $0.10–$2.00 per task; payout min ~$9 (PayPal/Skrill). Fixed-price per campaign, employer set budget. | Success Rate (TS%) gating — task baru hanya unlock kalau TS% di atas threshold (mis. 75%). Bukan level lucu, tapi reputation score keras. | Reputation gating otomatis. PeTa masih manual approval, belum ada auto-decay reputasi. |
| 2 | **Picoworkers / Rapidworkers** | Global, populer di SEA + ID | USD $0.02–$0.50 per task. Payout min $5 (PayPal/Bitcoin/Litecoin). Banyak task social engagement (komen, follow, vote). | Tier sederhana: New / Trusted / Verified. Naik tier dari jumlah task selesai + rating employer. | Multi-channel payout (PayPal, crypto, Skrill). PeTa baru rencana transfer manual rupiah. |
| 3 | **YSense (dulu ClixSense)** | Global, kuat di MY + ID + PH | Bayar per survey + offer + task. Survey $0.50–$3, micro-task $0.05–$0.30. Payout min $10 via PayPal/Skrill/gift card. | Tier "Checkpoint Rewards" — bonus naik tiap akumulasi earning ($1 → $5 → $10 dst). Bukan level karma, tapi loyalty ladder. | Gamified earning ladder yang ngajak grind harian. PeTa onboarding bonus bagus tapi belum ada loyalty checkpoint setelah Rp50K. |
| 4 | **Sribulancer / Sribu** | Indonesia | Marketplace freelance, bukan murni micro-task. Project-based (desain, copywriting, data entry) Rp50K–jutaan. Komisi platform 10–15%. | Level seller: New → Verified → Top Rated, mirip Fiverr. Naik dari rating + project completion. | Brand lokal kuat + payment gateway lokal (BCA, OVO, GoPay). PeTa belum punya integrasi e-wallet, masih rencana transfer manual. |
| 5 | **Toluna Influencers** | Global, aktif di ID | Survey panel: 300–6.000 poin per survey (~Rp5K–Rp80K). Min redeem Rp200K via PayPal/voucher. | Badge + level berbasis aktivitas (rookie → influencer → guru). Reward unlocked: sweepstakes, early access. | Komunitas + diskusi panel internal. PeTa cuma punya WA group, belum ada in-app community/leaderboard. |

## Sintesis Cepet (caveman, dipertahankan)

PeTa unik: reward gede per task. Rp5K–20K per komen jauh di atas Picoworkers ($0.02–$0.50 ≈ Rp300–7K). Itu moat utama.

Tapi celah jelas:
- **Reputation auto-decay**: belum ada. Microworkers TS% lebih kuat dari `min_level` PeTa.
- **Loyalty ladder pasca-onboarding**: kosong. YSense Checkpoint pattern bisa diadopsi.
- **Multi-channel payout**: cuma manual rupiah. Sribu pakai e-wallet ID. Wajib tiru.
- **Community layer**: cuma WA group. Toluna punya leaderboard in-app. Roadmap-able.

## Rekomendasi Primary Pick

**Pick: tiru loyalty checkpoint YSense dulu.**
Reason: paling murah-effort, dampak retensi gede. Tinggal extend `user_credits` ledger pakai milestone bonus (mis. Rp250K cum-earned → Rp10K bonus, dst). Pakai infra existing. Reputation gating Microworkers powerful tapi butuh algoritma + tooling baru — fase 2.

## Catatan Ketidakpastian

- Pricing Microworkers / Picoworkers / YSense: range plausible per pengetahuan umum, belum di-verify live hari ini (2026-05-06). Angka USD bisa shifted.
- Sribu/Sribulancer: lebih ke project freelance, bukan murni micro-task — masuk tabel buat referensi pasar ID + payment integration.
- Toluna level naming (rookie/influencer/guru): nama tier pasti perlu cek ulang, tapi struktur badge benar.
- Belum cek kompetitor lokal kecil seperti UangSaku, Cashtree, BukaReview — bisa scan ronde berikutnya.

─────────────────────────────────
INSPECTOR REPORT
─────────────────────────────────
OUTPUT:  PASSED
PROCESS: PASSED

Speed note:          Tabel + sintesis selesai single pass. No web fetch — dipakai prior knowledge sesuai brief 5-menit.
Process improvement: Round berikutnya, jalanin WebSearch paralel buat verify pricing live (USD figures bisa stale).
Quality note:        Tambahkan kolom "ID payment method support" eksplisit kalau riset lanjut — sinyal lokalisasi penting.

Primary pick: YSense-style loyalty checkpoint. Reason: re-uses existing `user_credits` ledger, low engineering cost, langsung dampak retention pasca-onboarding Rp50K.
─────────────────────────────────
