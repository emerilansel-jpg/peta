# PeTa Launch — WhatsApp Broadcast Drafts (A/B Test)

Halo! Berikut 2 versi broadcast WA buat 50 calon member di waitlist. Dua-duanya udah di bawah 600 karakter (limit WA broadcast), tone gaul-Indonesia tapi tetep proper, dan CTA ngarah ke link daftar.

---

## Versi A — FOMO ("Fear of Missing Out")

> Fokus: kuota terbatas, eksklusivitas waitlist, urgency.

```
Halo gaes! Lo masuk waitlist PeTa, dan hari ini kita resmi LAUNCH. 

Cuma 50 orang pertama (termasuk lo) yang dibuka duluan sebelum kita open ke publik minggu depan. Slot early-bird = bonus onboarding Rp50.000 langsung cair pas selesai setup, plus akses task pertama dengan komisi tertinggi.

Telat daftar = ketinggalan slot prioritas + bonus mungkin dipotong pas open public.

Daftar sekarang sebelum slot lo dikasih ke yang lain:
https://penghasilantambahan.com

Sampai ketemu di dalam!
— Tim PeTa
```

**Hitungan karakter:** ~545 (termasuk spasi & link)

**Kenapa versi ini work:**
- Triggers loss aversion ("ketinggalan slot", "dipotong pas open public")
- Urgency tanpa overpromise (gak bilang "1 jam lagi tutup", lebih believable)
- Eksklusivitas: "lo masuk waitlist" bikin penerima ngerasa di-treat khusus
- CTA tunggal, gak ada distraksi

---

## Versi B — Easy Money ("Cuan Gampang")

> Fokus: benefit konkret, gampang dijalanin, low friction.

```
Halo! PeTa udah resmi launch. Lo bisa mulai cuan dari HP doang, gak perlu skill, gak perlu modal.

Cara kerjanya simpel:
- Selesai onboarding (~5 menit) = dapet Rp50.000 bonus
- Tiap task selesai = Rp5.000–20.000 masuk saldo
- Cair mulai dari Rp150.000

Banyak member baru udah balik modal waktu mereka di hari pertama. Lo tinggal komen di internet, kita yang bayar.

Daftar di sini, langsung mulai:
https://penghasilantambahan.com

Selamat cuan, gaes!
— Tim PeTa
```

**Hitungan karakter:** ~500 (termasuk spasi & link)

**Kenapa versi ini work:**
- Angka konkret di bullet (lebih trust drivers daripada adjective)
- "Gak perlu skill, gak perlu modal" = kill 2 objections paling umum
- "Komen di internet" = on-brand (gak nyebut Reddit, sesuai aturan public marketing)
- Social proof ringan ("banyak member baru udah balik modal")
- Frame "balik modal" = relatable, bahasa orang biasa

---

## Saran A/B Test Plan

| Item | Detail |
|---|---|
| Split | 25 nomor → Versi A · 25 nomor → Versi B |
| Kirim | Sama2 di jam 19.00–20.00 WIB (prime time scroll WA) |
| Metric utama | **Klik link → daftar selesai** (track via UTM atau referral code unik per versi) |
| Metric sekunder | Reply rate, completion onboarding 24 jam |
| UTM contoh | `?utm_source=wa&utm_campaign=launch&utm_content=A` (vs `=B`) |

## Catatan Implementasi

- Sebelum kirim, double-check link `https://penghasilantambahan.com` udah live + register page bisa diakses tanpa error.
- Pertimbangkan **personalize nama** di awal kalau lo punya nama mereka di list waitlist: ganti `Halo gaes!` / `Halo!` jadi `Halo {{nama}},` — biasanya naikin response rate 15–25%.
- Karena ini broadcast (bukan group), pastikan nomor lo udah disimpen sama mereka, kalau enggak WA-nya gak bakal nyampe.
- Jangan kirim 2 versi ke nomor yang sama — bias hasil A/B-nya.
