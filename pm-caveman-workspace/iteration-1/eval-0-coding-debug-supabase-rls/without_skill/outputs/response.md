# PeTa staging: `user_credits` RLS error pas klaim bonus signup

## TL;DR

Migration `20260505133314_claim_onboarding_bonus_rpc.sql` (yang bikin RPC `claim_onboarding_bonus`) kemungkinan besar **belum di-push ke staging**. Akibatnya, salah satu dari dua hal terjadi di staging:

1. Frontend manggil `supabase.rpc('claim_onboarding_bonus', ...)` — function ga ada → fallback ke INSERT langsung ke `user_credits` (kalau ada path itu), atau
2. RPC ada tapi versi lama tanpa `SECURITY DEFINER` / tanpa `GRANT EXECUTE ... TO authenticated`, jadi insert dieksekusi sebagai user `authenticated` dan kena RLS.

Either way, root cause-nya: **drift migrasi antara local Postgres lo dan staging Supabase**. Local works karena `supabase db reset` udah apply semua 8 migrasi; staging cuma punya subset.

## Kenapa diagnosa ini paling masuk akal

Bandingin policy `user_credits` (di migrasi `20260505114141_...`) sama RPC (di migrasi `20260505133314_...`):

```sql
-- user_credits cuma punya 2 policy:
CREATE POLICY "Users see own credits" FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "Admins manage credits" FOR ALL  USING (is_admin()) WITH CHECK (is_admin());
```

Penting: **ga ada policy INSERT buat army users.** Jadi army user yang nyoba INSERT ke `user_credits` PASTI kena `new row violates row-level security policy` — kecuali insert-nya lewat function `SECURITY DEFINER` yang owner-nya bypass RLS (default Supabase: function di-own `postgres` yang punya BYPASSRLS).

RPC lo:
```sql
CREATE OR REPLACE FUNCTION public.claim_onboarding_bonus(p_step text)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER             -- <-- ini yang bikin INSERT bypass RLS
SET search_path = public
AS $$ ... $$;

GRANT EXECUTE ON FUNCTION public.claim_onboarding_bonus(text) TO authenticated;
```

Kalau RPC ini ga ada / ga `SECURITY DEFINER` / ga di-grant ke `authenticated` di staging, error yang lo liat 100% ekspektasi.

Pesan errornya juga ngomong eksplisit: "violates RLS for table `user_credits`" — bukan "function does not exist". Itu artinya INSERT-nya beneran ke-trigger, tapi dari role yang ga punya policy. Dua skenario yang nyebabin ini:

- **Skenario A (paling mungkin):** RPC udah ada di staging tapi versi lama tanpa `SECURITY DEFINER` — jadi jalan sebagai `authenticated`, kena RLS.
- **Skenario B:** Ada code path lain yang INSERT langsung tanpa lewat RPC. Liat `peta/src/lib/api.ts` — kalau `claimOnboardingBonus` fallback ke `.from('user_credits').insert(...)` di catch block atau ada legacy code, itu yang ke-trigger di staging.

## Cara konfirmasi (1 menit)

Buka Supabase staging SQL Editor (`duxzxizedtvnopfihllz`) → run:

```sql
-- 1. Cek RPC ada dan SECURITY DEFINER?
SELECT
  p.proname,
  p.prosecdef    AS is_security_definer,
  pg_get_userbyid(p.proowner) AS owner,
  has_function_privilege('authenticated', p.oid, 'execute') AS authenticated_can_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'claim_onboarding_bonus';

-- 2. Cek migrasi mana aja yang udah ke-apply
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10;

-- 3. Cek policy user_credits (harusnya cuma 2: SELECT + admin ALL)
SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.user_credits'::regclass;
```

Yang lo cari:
- Query #1 ga balikin row → RPC ga ada → drift confirmed
- Query #1 balikin row tapi `is_security_definer = false` atau `authenticated_can_exec = false` → bug confirmed, butuh re-apply
- Query #2 ga punya `20260505133314_claim_onboarding_bonus_rpc` → drift confirmed

## Fix

### Opsi 1 (proper, recommended): push semua migrasi ke staging

Dari `peta/`:

```bash
cd peta
npx supabase link --project-ref duxzxizedtvnopfihllz
npx supabase db push
```

Itu bakal apply semua migrasi yang belum ada. Konfirmasi dengan:

```bash
npx supabase migration list --linked
```

### Opsi 2 (quick fix kalau lagi panic): apply RPC manual

Buka SQL Editor staging, paste full body dari `peta/supabase/migrations/20260505133314_claim_onboarding_bonus_rpc.sql`, run. Kelar.

### Opsi 3 (kalau ternyata problem-nya di frontend, bukan RPC)

Kalau query #1 di atas balikin row dengan `is_security_definer = true` dan `authenticated_can_exec = true`, berarti masalahnya ada code path yang INSERT langsung. Cek `peta/src/lib/api.ts` cari `from('user_credits')` atau `.insert(` yang ga lewat RPC, dan ganti jadi:

```ts
const { data, error } = await supabase.rpc('claim_onboarding_bonus', { p_step: stepKey });
if (error) throw error;
```

## Ke depannya: cegah drift ini

1. **CI gate:** sebelum deploy ke Vercel staging, jalanin `supabase db push --dry-run` di GH Actions, fail kalau ada migrasi pending.
2. **Tambah policy INSERT yang aman buat army** di `user_credits` — even meski RPC udah `SECURITY DEFINER`, defense in depth ga ada salahnya. Misalnya:
   ```sql
   CREATE POLICY "users_no_direct_insert" ON public.user_credits
     FOR INSERT WITH CHECK (false);  -- semua INSERT harus lewat SECURITY DEFINER function
   ```
   Itu bikin error fail-fast lebih jelas (langsung di staging waktu testing) daripada nunggu user beneran.
3. **Tulis di `DEPLOYMENT.md`** bahwa setiap migrasi baru harus di-push ke staging DULU sebelum branch di-merge ke main.

## File yang relevan

- `D:\Claude Cowork\Reddit Army Local\peta\supabase\migrations\20260505133314_claim_onboarding_bonus_rpc.sql` — RPC definition
- `D:\Claude Cowork\Reddit Army Local\peta\supabase\migrations\20260505114141_add_whatsapp_referral_credits_task_type.sql` — bikin tabel `user_credits` + policy-nya (ga ada INSERT policy untuk user)
- `D:\Claude Cowork\Reddit Army Local\peta\supabase\migrations\20260505132253_signup_bonus_idempotency_and_backfill.sql` — unique partial index (penting buat ON CONFLICT di RPC)
- `D:\Claude Cowork\Reddit Army Local\peta\src\pages\Onboarding.tsx` — caller `safeClaim()`
- `D:\Claude Cowork\Reddit Army Local\peta\src\lib\api.ts` — `claimOnboardingBonus()` helper
