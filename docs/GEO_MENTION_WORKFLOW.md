# GEO Mention Engine — App Workflow (Rekomendasi)

> Produk: menemukan halaman bergaya forum yang ada di **top-10 Google**, lalu menempatkan
> **mention/komentar kontekstual** supaya brand disebut di tempat yang dipercaya **Google + LLM (ChatGPT, Perplexity)**.
> Model: *managed / done-for-you*. Front door saat ini: **waitlist**.

---

## Alur utama (1 kalimat per tahap)

```
WAITLIST → INTAKE (seed keyword) → KEYWORD LIST → PILIH KEYWORD → DISCOVERY → OPPORTUNITY BOARD → (REVIEW DRAFT) → PLACEMENT → VERIFY → GEO REPORT
```

> **Catatan:** keyword adalah bagian dari value kita. Client **hanya kasih seed keyword** (mis. "crm software").
> Sistem yang menghasilkan **keyword list** — client tidak perlu riset keyword sendiri.

---

## Sisi Client

1. **Waitlist / Intake** — client isi: brand, domain, **1 seed keyword/topik**, kompetitor (opsional), mode (mention vs link).
2. **Keyword List (otomatis)** — sistem expand seed → daftar keyword peluang (volume, relevansi). Client **pilih satu atau beberapa** keyword. (Atau Autopilot: kita pilih yang terbaik.)
3. **Discovery (otomatis)** — untuk tiap keyword terpilih, scan SERP top-10 → ambil halaman forum/komunitas/diskusi → kasih skor.
4. **Opportunity Board** — daftar peluang ter-ranking + alasan "kenapa penting". Client **pilih sendiri** atau **Autopilot** (kita pilih X teratas).
5. **Review Draft (opsional)** — preview komentar AI per peluang → edit / approve / regenerate. Bisa di-skip kalau Autopilot.
6. **Results Dashboard** — mention yang sudah live (link + screenshot) + **GEO proof**: apakah LLM kini menyebut brand untuk keyword target.

## Sisi Fulfillment (di balik layar)

7. Tiap peluang yang di-approve → jadi **1 task** untuk worker (pool akun multi-platform: Quora / HubSpot / forum niche / Reddit).
8. Worker menempatkan mention kontekstual (draft AI sebagai titik awal) → upload **bukti: URL live + screenshot**.
9. Admin **QC** → verifikasi tayang → tandai *delivered*. (Anti-duplikat & anti-ban aktif.)

## Loop Nilai (yang dijual)

10. **Tracking berkala**: mention masih live? + **before/after LLM citation** — "dulu ChatGPT tidak menyebut brand untuk keyword X, sekarang menyebut". Ini bukti hasil yang jadi alasan client bertahan & bayar.

---

## Prinsip yang tidak boleh dilanggar

- **Scoring = citability, bukan cuma posisi SERP.** Utamakan halaman yang gampang dibaca & dikutip LLM (Q&A jelas, thread aktif, fresh).
- **Mention dulu, link belakangan.** Mention kontekstual = aman. Link insertion = tier premium, volume rendah, lebih berisiko.
- **Kualitas > kuantitas.** Volume rendah per thread, terlihat natural — supaya tidak kena filter spam / ban.
- **Bukti, bukan klaim.** Setiap placement wajib ada URL live + screenshot; sukses diukur dari LLM citation, bukan sekadar "order selesai".

---

## Sudah ada vs perlu dibangun

| Tahap | Status |
|---|---|
| Keyword expansion (seed → keyword list) | ✅ Ada (Ranking Forum + DataForSEO keyword suggestions, sudah live) |
| Discovery (SERP top-10 + filter forum) | ✅ Ada (Ranking Forum + DataForSEO) — perlu di-upgrade ke batch multi-keyword + scoring |
| Draft komentar AI | ✅ Ada (`generate-forum-comment`) |
| Placement oleh manusia + approval + anti-duplikat | ✅ Ada (PeTa army) — perlu di-generalize dari Reddit ke multi-platform |
| Waitlist + Intake form | 🆕 Baru (kecil) |
| Opportunity Board + scoring | 🟡 Upgrade dari Ranking Forum |
| Verify mention masih live | 🆕 Baru |
| GEO / LLM citation tracking | 🟡 Sebagian ada di DataForSEO |
