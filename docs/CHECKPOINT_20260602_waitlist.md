# Checkpoint: Straight Waitlist Feature
**Tanggal:** 2026-06-02
**Git tag:** `checkpoint/waitlist-v1`
**Status:** Kode selesai, migration BELUM di-apply ke DB (staging maupun prod)

---

## Apa yang berubah

| File | Aksi | Keterangan |
|---|---|---|
| `peta/supabase/migrations/20260602120000_straight_waitlist.sql` | BARU | Tabel `waitlist` + RPC `join_waitlist()` anon-callable |
| `peta/supabase/migrations/20260602120000_straight_waitlist.rollback.sql` | BARU | Undo SQL kalau migration sudah di-apply |
| `peta/src/modules/reddit/pages/WaitlistPage.tsx` | BARU | Halaman `/reddit/waitlist` |
| `peta/src/modules/reddit/lib/api.ts` | EDIT | Tambah fungsi `joinWaitlist()` |
| `peta/src/App.tsx` | EDIT | Tambah route `/reddit/waitlist` |
| `docs/GEO_MENTION_WORKFLOW.md` | BARU | Dokumen workflow produk baru |

**Yang TIDAK disentuh:** Semua halaman PeTa, flow order Straight yang sudah live, database prod, army/PeTa workers.

---

## UNDO (kode saja, migration belum di-apply)

```bash
# Di folder G:\SF Project\peta-main
git revert HEAD           # undo commit waitlist, buat revert commit baru
# atau kalau mau reset total (hati-hati, buang perubahan):
git reset --hard HEAD~1   # balik ke commit baseline
```

---

## UNDO (kalau migration sudah di-apply ke staging/prod)

### Step 1: Rollback database
Jalankan via Supabase MCP atau SQL editor:

**Staging** (`duxzxizedtvnopfihllz`):
```sql
-- isi dari file:
-- peta/supabase/migrations/20260602120000_straight_waitlist.rollback.sql
DROP FUNCTION IF EXISTS public.join_waitlist(text, text, text, text, text, text);
DROP POLICY IF EXISTS waitlist_admin_select ON public.waitlist;
DROP POLICY IF EXISTS waitlist_admin_update ON public.waitlist;
DROP INDEX IF EXISTS public.waitlist_email_uniq;
DROP INDEX IF EXISTS public.waitlist_created_idx;
DROP TABLE IF EXISTS public.waitlist CASCADE;
```

**Prod** (`yorlsgzsawchpeeazcvi`): sama persis.

### Step 2: Rollback kode
```bash
git revert HEAD   # undo commit waitlist
npm run build     # rebuild
# lalu deploy ulang ke Cloudflare Pages
```

---

## REDO (apply kembali setelah di-revert)

```bash
git revert HEAD   # undo si revert = restore feature
# apply migration lagi via Supabase MCP
# rebuild + deploy
```

---

## Yang harus dilakukan berikutnya (kalau Pak Nell setuju)

1. Apply migration ke **staging** dulu:
   - File: `peta/supabase/migrations/20260602120000_straight_waitlist.sql`
   - Via Supabase MCP `apply_migration` → project `duxzxizedtvnopfihllz`

2. Test di staging: buka `https://staging.penghasilantambahan.com/reddit/waitlist` → isi form → cek tabel `waitlist` di Supabase dashboard.

3. Kalau OK, apply ke prod → project `yorlsgzsawchpeeazcvi`.

4. Build + deploy frontend ke Cloudflare Pages.

5. (Opsional) Tambah CTA "Join the waitlist" di landing `/reddit` dan di bagian akhir Ranking Forum.
