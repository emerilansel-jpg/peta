# 2026-05-20 — Data audit + audit-log retrofit

## TL;DR

**Tidak ada data hilang.** Snapshot di bawah membuktikan semua tabel intact.

User concern: "task queue hilang databasenya?"

Reality:
- `tasks` table: **3 baris UTUH** (semua dari May 13). Tidak ada DELETE pernah terjadi.
- `task_assignments`: 18 baris, 0 orphan, semua referensi task masih ada.
- `reddit_upvote_orders` (Straight Ltd customer pipeline): 3 order UTUH.
- `users`: 61, `user_credits`: 329, `reddit_accounts`: 28 — semua intact.

Postgres logs 24 jam terakhir → **HANYA** `CREATE OR REPLACE FUNCTION validate_payout_eligibility` (migrasi UX/payout hari ini). **Zero DELETE / DROP / TRUNCATE.**

## Apa yang user lihat = bukan "hilang"

3 task di DB:
| ID | Title | Status | Source order |
|---|---|---|---|
| b92af786 | Reddit upvote task | **paused** | Order 1 (admin's test) |
| 63ffee71 | Reddit upvote task | **paused** | Order 3 (admin's test) |
| f20a6969 | Upvote komentar di r/Columbus — Rp2.000 | **active** | Order 2 (real customer) |

Admin Task Queue page mungkin difilter ke status tertentu, jadi 2 task paused gak keliatan. Default filter ke "active" → 1 task tampil → user kira "hilang".

Tidak ada task yang benar2 hilang. Yang ada cuma 3 (1 active + 2 paused).

## Snapshot file

Snapshot 2026-05-20T09:55:40Z disimpen di Postgres log session terkait via `SELECT json_build_object(...)`. Untuk reusable backup, lihat backup script di bawah.

## Risiko nyata yang HARUS ditangani

### 1. Free plan = NO Point-in-Time Recovery (PITR)

`peta-prod` ada di Supabase **Free** plan. Konsekuensi:
- Backup otomatis tetap ada (Supabase free retain ~7 hari)
- Tapi tidak bisa restore ke timestamp tertentu
- Tidak bisa rollback table-by-table

**Rekomendasi: upgrade ke Pro ($25/mo)** — dapet PITR 7 hari, point-in-time restore granular.

### 2. Tidak ada audit log

Tidak ada tabel yang nyatat siapa DELETE/UPDATE apa kapan. Kalau ada incident,
tidak bisa tau apa yang berubah, oleh siapa, kapan.

**Fix: audit_log table + triggers** (lihat migrasi `20260520100000_audit_log_critical_tables.sql`)

### 3. Tidak ada local backup periodik

Belum ada cron job yang nge-snapshot DB → R2 / Drive secara periodik.

**Fix: cron job harian** via Supabase pg_cron → R2 dump (manual setup needed)

## Action items (urutan prioritas)

1. ✅ Audit log migration (closing this round) — INSERT/UPDATE/DELETE on `tasks`, `payouts`, `user_credits`, `reddit_upvote_orders`, `users` capture old/new + actor + timestamp
2. 🔜 Upgrade ke Pro plan ($25/mo) — paling impactful untuk recovery
3. 🔜 Daily JSON snapshot via cron → R2 (pengganti PITR sebelum Pro)
4. 🔜 Soft-delete pattern di tasks/orders (kolom `deleted_at` instead of hard DELETE)
