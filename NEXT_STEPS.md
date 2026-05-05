# 🚀 What's Done & What's Left

## ✅ Done autonomously (95%)

| | |
|---|---|
| ✅ | Bolt Supabase project paused (freed free-tier slot) |
| ✅ | `peta-prod` Supabase project created — id `yorlsgzsawchpeeazcvi`, region Singapore |
| ✅ | All 8 migrations applied to peta-prod (schema + RLS + RPCs + triggers) |
| ✅ | Prod admin seeded: `info@jetdigitalpro.com` / `peta` (change after first login) |
| ✅ | Code pushed to GitHub: `https://github.com/emerilansel-jpg/peta` (main + staging branches) |
| ✅ | Vercel project deployed: production live at `peta-...vercel.app` |
| ✅ | Domain `penghasilantambahan.com` attached to Production env in Vercel |
| ✅ | Domain `staging.penghasilantambahan.com` attached to Preview env in Vercel |

## 🟡 You finish in 5 min total

### 1. DNS at Spaceship.com (5 min — needs your login)

Log in to https://www.spaceship.com → **Launchpad → Domains → penghasilantambahan.com → Manage → DNS / Advanced DNS**.

Replace existing `A` and `CNAME` records (if any) with:

| Type | Host / Name | Value | TTL |
|---|---|---|---|
| `A` | `@` (or blank) | `76.76.21.21` | Auto |
| `CNAME` | `www` | `cname.vercel-dns.com` | Auto |
| `CNAME` | `staging` | `cname.vercel-dns.com` | Auto |

Save. Propagation 5–30 min usually. Vercel auto-issues SSL once it sees the DNS.

Verify with:
```bash
nslookup penghasilantambahan.com   # should resolve to 76.76.21.21
nslookup staging.penghasilantambahan.com  # should CNAME to vercel
```

Or just visit `https://penghasilantambahan.com` in 30 min.

### 2. Per-environment env vars (2 min — important)

Right now both Production and Preview deploys use the **prod** Supabase. That means staging branch will write to production DB. **Bad.**

Fix at https://vercel.com/n311311-6290s-projects/peta/settings/environment-variables :

For each of `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`:
1. Click the row's `⋯` menu → **Edit**
2. Uncheck **Preview** environment (leave only Production checked)
3. Save

Then add Preview duplicates:
1. Click **Add Environment Variable** at top
2. Name: `VITE_SUPABASE_URL` · Value: `https://duxzxizedtvnopfihllz.supabase.co` · Env: **Preview only**
3. Save
4. Repeat for `VITE_SUPABASE_ANON_KEY`. Value:
   ```
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1eHp4aXplZHR2bm9wZmlobGx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDk0NDYsImV4cCI6MjA5MzUyNTQ0Nn0.awbwCZOMtow2w0HIKTLmpO5UqSyjQVzDFC5r6Iw6y5g
   ```

Then redeploy the staging branch: **Deployments → on the latest staging build → ⋯ → Redeploy**.

### 3. Sanity check (5 min — once DNS propagates)

- [ ] `https://penghasilantambahan.com` loads the landing page
- [ ] Click "Daftar" → register fresh account → Onboarding all 6 steps work, confetti, saldo Rp50K
- [ ] Login as `info@jetdigitalpro.com` / `peta` → `/admin/team` shows your test user
- [ ] Earnings page shows correct saldo

## Reference: Project IDs

```
GitHub:           https://github.com/emerilansel-jpg/peta
Vercel project:   https://vercel.com/n311311-6290s-projects/peta
Supabase prod:    https://supabase.com/dashboard/project/yorlsgzsawchpeeazcvi
Supabase staging: https://supabase.com/dashboard/project/duxzxizedtvnopfihllz
```

## Production credentials

```
Admin email:    info@jetdigitalpro.com
Admin password: peta   ← CHANGE THIS after first login
```

## Day-to-day workflow

```bash
# Edit code
git checkout staging
# … hack on code, test against staging Supabase ...
git push                          # auto-deploys to staging.penghasilantambahan.com

# Promote to prod
git checkout main
git merge staging
git push                          # auto-deploys to penghasilantambahan.com

# Schema change
supabase migration new add_xyz    # in peta/ folder
# write SQL, then:
supabase link --project-ref duxzxizedtvnopfihllz
supabase db push                  # apply to staging
# test, then:
supabase link --project-ref yorlsgzsawchpeeazcvi
supabase db push                  # apply to prod
```
