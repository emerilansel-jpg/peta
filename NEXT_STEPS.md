# 🚀 Next Steps — Quick Runbook

You're 90% done. These are the ~5 manual steps that need *your* accounts (Claude can't do them):

## Status

- ✅ Migrations exported as files (`peta/supabase/migrations/`)
- ✅ All docs written (CLAUDE.md, DEPLOYMENT.md)
- ✅ `vercel.json` ready
- ✅ Git initialized, first commit done
- ⏸️ **BLOCKED**: prod Supabase project (free tier 2-project limit hit). See option below.
- ⏳ Pending: GitHub push, Vercel deploy, DNS

---

## Step 1 — Free up a Supabase slot (2 min)

Go to https://supabase.com/dashboard. Either:
- **Pause** `bolt-native-database-65652303` if you don't need it (free, reversible)
- **Delete** it if it's truly abandoned
- **Or upgrade** to Pro ($25/mo) — recommended once you have real users

Then come back and tell me **"retry prod project"** — I'll create `peta-prod`, apply all 8 migrations, and run the admin seed automatically.

---

## Step 2 — Push to GitHub (3 min)

```bash
cd "D:\Claude Cowork\Reddit Army Local"

# Set your real git identity (currently placeholder)
git config user.name "Your Name"
git config user.email "you@yourdomain.com"
git commit --amend --no-edit --reset-author

# Create a private repo on github.com (UI), then:
git remote add origin git@github.com:<your-handle>/peta.git
git push -u origin main

# Create staging branch from main
git checkout -b staging
git push -u origin staging
```

---

## Step 3 — Vercel deploy (5 min)

1. https://vercel.com/new → import the GitHub repo
2. **Important: Root Directory = `peta`** (not the repo root)
3. Framework: Vite (auto-detected). Don't change build command.
4. Click "Deploy" — first deploy will fail with a missing env-var error. That's expected.
5. **Settings → Environment Variables** — add 2 vars *twice* (once per env):

   | Name | Production value | Preview (staging branch) value |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://<prod-id>.supabase.co` | `https://duxzxizedtvnopfihllz.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | (prod anon key from Settings → API) | `<your current staging anon key from peta/.env.local>` |

   - For Production var: scope = "Production" only
   - For Preview var: scope = "Preview" + select branch `staging`

6. **Deployments → ⋯ → Redeploy** the latest. Should succeed now.

---

## Step 4 — Hook up the domain (5 min + DNS wait)

Vercel → Settings → Domains:
- Add `penghasilantambahan.com` → assign to **Production**
- Add `staging.penghasilantambahan.com` → assign to **staging branch (Preview)**

Vercel will show DNS records. At your registrar:
- Root domain: `A` record → `76.76.21.21`
- Subdomain: `CNAME` `staging` → `cname.vercel-dns.com`

Wait 5–30 min for propagation. Vercel auto-issues SSL certs.

---

## Step 5 — Verify (5 min)

Visit `https://penghasilantambahan.com` and:

- [ ] Landing page loads
- [ ] Click "Daftar" → register fresh account → onboarding all 6 steps work, confetti, saldo Rp50K
- [ ] Login as admin → `/admin/team` shows your test user
- [ ] `/admin/team` "+ Tambah" creates a new member
- [ ] Earnings page shows correct saldo, payout button disabled below Rp150K

If anything's off, tell me the failing step and I'll fix it.

---

## What's where

| Doc | Read this when… |
|---|---|
| [`README.md`](./README.md) | First-time orientation |
| [`CLAUDE.md`](./CLAUDE.md) | Starting a fresh AI session — paste this in or it auto-loads |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Detailed deployment reference |
| [`NEXT_STEPS.md`](./NEXT_STEPS.md) | This file. Delete after deploy is done. |
| [`peta/supabase/migrations/`](./peta/supabase/migrations/) | Schema-as-code. Apply with `supabase db push`. |
| [`peta/supabase/seed_prod_admin.sql`](./peta/supabase/seed_prod_admin.sql) | One-time prod admin user. Edit password before running. |
