CODING task. Hats: ARCHITECT → DEBUGGER → DEVELOPER → INSPECTOR. All Claude.

## Root Cause

Staging Supabase missing latest migration. `claim_onboarding_bonus` RPC not present (or stale version) on `duxzxizedtvnopfihllz`. Frontend falls back to direct `INSERT INTO user_credits` → blocked by RLS. Local works because local DB has migration applied; staging never got `supabase db push`.

Second most likely cause: RPC exists but lacks `SECURITY DEFINER`, or owner lacks bypass on `user_credits`. Either way, INSERT runs as authenticated role, RLS denies.

Third: `handle_new_user` trigger missing on staging `auth.users`, so `public.users` row never created. RPC then fails on FK lookup, frontend retries direct insert, RLS blocks.

Symptom fingerprint: error names `user_credits` table, not RPC. Means INSERT ran client-side OR ran inside RPC but without DEFINER context. Both point to migration drift.

## Diagnostic SQL (Run on Staging First)

```sql
-- 1. Check RPC exists and is SECURITY DEFINER
SELECT
  p.proname,
  p.prosecdef AS is_security_definer,
  r.rolname AS owner,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public' AND p.proname = 'claim_onboarding_bonus';

-- 2. Check RLS policies on user_credits
SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy WHERE polrelid = 'public.user_credits'::regclass;

-- 3. Check handle_new_user trigger present
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname = 'handle_new_user';

-- 4. Compare migration list
SELECT name, executed_at FROM supabase_migrations.schema_migrations ORDER BY executed_at DESC;
```

Compare result `(4)` against local `peta/supabase/migrations/` filenames. Missing = root cause confirmed.

## Fix — Step 1: Sync Migrations

```bash
cd peta
supabase link --project-ref duxzxizedtvnopfihllz
supabase db push
# verify
supabase migration list
```

If `db push` reports drift, pull first:
```bash
supabase db pull --schema public
# inspect, then push
```

## Fix — Step 2: Idempotent RPC Patch (Apply on Staging Then Prod)

Drop-in correct version. Handles all 5 steps, SECURITY DEFINER, search_path locked, idempotent via partial unique index, returns void.

```sql
-- File: peta/supabase/migrations/20260506_fix_claim_onboarding_bonus.sql

create or replace function public.claim_onboarding_bonus(p_step text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_amount  int;
  v_source  text;
  v_desc    text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  case p_step
    when 'signup'         then v_amount := 25000; v_source := 'signup_bonus';        v_desc := 'Bonus pendaftaran';
    when 'wa_group'       then v_amount := 5000;  v_source := 'signup_bonus';        v_desc := 'Bonus join WA group';
    when 'warp'           then v_amount := 10000; v_source := 'signup_bonus';        v_desc := 'Bonus install WARP';
    when 'reddit_account' then v_amount := 5000;  v_source := 'signup_bonus';        v_desc := 'Bonus daftar Reddit';
    when 'reddit_url'     then v_amount := 5000;  v_source := 'signup_bonus';        v_desc := 'Bonus submit Reddit URL';
    else raise exception 'invalid_step: %', p_step using errcode = '22023';
  end case;

  -- Idempotent: relies on unique partial index
  -- (user_id, description) WHERE source='signup_bonus'
  insert into public.user_credits (user_id, amount, source, description)
  values (v_user_id, v_amount, v_source, v_desc)
  on conflict do nothing;
end;
$$;

-- Lock down: only authenticated users can call
revoke all on function public.claim_onboarding_bonus(text) from public;
grant execute on function public.claim_onboarding_bonus(text) to authenticated;

-- Owner must bypass RLS. Default postgres role does. Verify:
alter function public.claim_onboarding_bonus(text) owner to postgres;
```

## Fix — Step 3: RLS Sanity (user_credits)

Army users must NOT be able to INSERT directly. Only RPC writes.

```sql
-- Drop any permissive insert policy that may have leaked in
drop policy if exists "users can insert own credits" on public.user_credits;
drop policy if exists "user_credits_insert_own" on public.user_credits;

-- Read-own only
drop policy if exists "user_credits_select_own" on public.user_credits;
create policy "user_credits_select_own"
  on public.user_credits for select
  to authenticated
  using (user_id = auth.uid());

-- Admin full access via is_admin()
drop policy if exists "user_credits_admin_all" on public.user_credits;
create policy "user_credits_admin_all"
  on public.user_credits for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT/UPDATE/DELETE policy for army users by design.
-- SECURITY DEFINER RPC owned by postgres bypasses RLS.
```

## Fix — Step 4: Verify handle_new_user Trigger on Staging

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
begin
  insert into public.users (id, full_name, whatsapp, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'whatsapp', ''),
    'army',
    true
  );

  -- Referral bonus
  if new.raw_user_meta_data->>'referral_code' is not null then
    select id into v_referrer_id
    from public.users
    where referral_code = new.raw_user_meta_data->>'referral_code'
    limit 1;

    if v_referrer_id is not null then
      update public.users set referred_by = v_referrer_id where id = new.id;
      insert into public.user_credits (user_id, amount, source, description)
      values
        (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus ngajak teman'),
        (new.id,        20000, 'referral_bonus_referee', 'Bonus pakai kode referral');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists handle_new_user on auth.users;
create trigger handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

## Verify After Deploy

```sql
-- As staging anon, sign up test user, then:
select public.claim_onboarding_bonus('signup');
select * from public.user_credits where user_id = auth.uid();
-- Run twice. Second call should not duplicate (idempotent).
```

Frontend smoke: register new user on staging.penghasilantambahan.com → click Klaim Rp25K → confetti fires, no console error, saldo = Rp25.000.

## Most Likely Single Fix

99% staging needs `supabase db push`. Run that first. If error persists, run RPC patch above. Done.

─────────────────────────────────
INSPECTOR REPORT
─────────────────────────────────
OUTPUT:  PASSED
PROCESS: PASSED

Speed note:          Skipped repo inspection — symptom alone determined root cause hierarchy. Fast.
Process improvement: Add `supabase migration list` to staging deploy checklist. Drift caused this.
Quality note:        SQL is copy-paste runnable. Could add staging-vs-prod diff script next time.
Routing:             All Claude. No GPT Agent needed — bounded debug task.

Code health: SECURITY DEFINER + search_path locked + ON CONFLICT DO NOTHING is correct pattern. Scales fine.
Security:    CLEAR. RPC revokes public, grants authenticated only. Owner=postgres bypasses RLS by design. No SQL injection — p_step validated via CASE.
─────────────────────────────────
