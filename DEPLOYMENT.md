# Deployment Guide — PeTa

End-state:
- **`staging.penghasilantambahan.com`** ← `staging` branch ← Supabase project `peta-staging` (current `duxzxizedtvnopfihllz`)
- **`penghasilantambahan.com`** ← `main` branch ← Supabase project `peta-prod` (new)

You only need to do steps 1–7 once. After that it's just `git push`.

---

## 1. Prerequisites (one-time install)

```bash
# Node.js (already installed since you have npm running locally)
node -v   # should be ≥ 18

# Supabase CLI (for managing migrations)
# Windows / scoop:
scoop install supabase
# OR npm:
npm install -g supabase
supabase --version

# Vercel CLI (optional but useful for first-time linking)
npm install -g vercel
```

You also need accounts on:
- **GitHub** (to host the repo)
- **Vercel** (free, sign in with GitHub)
- **Supabase** (you already have this — you currently own `duxzxizedtvnopfihllz`)
- **Domain registrar** (where you bought `penghasilantambahan.com`)

---

## 2. Create the production Supabase project

1. Go to https://supabase.com/dashboard → **New Project**
2. Name: `peta-prod`, region: `Southeast Asia (Singapore)` — closest to ID users
3. Set a strong DB password, save it somewhere safe
4. Wait ~2 min for provisioning

Once ready, grab from **Project Settings → API**:
- `Project URL`  → this is your `VITE_SUPABASE_URL` for prod
- `anon public` key  → this is your `VITE_SUPABASE_ANON_KEY` for prod

**Disable email confirmation** (Auth → Providers → Email → toggle OFF "Confirm email"). Same as staging — onboarding flow auto-confirms via the trigger.

---

## 3. Apply migrations to production

From repo root (`D:\Claude Cowork\Reddit Army Local\peta\`):

```bash
# First time only — login to Supabase CLI
supabase login

# Link to PROD project (you'll be prompted for the DB password from step 2)
supabase link --project-ref <prod-project-id>

# Push all migrations from peta/supabase/migrations/
supabase db push
```

Verify schema:
```bash
supabase db diff   # should report "no diff"
```

After this you should also re-run the staging link when working locally:
```bash
supabase link --project-ref duxzxizedtvnopfihllz
```

> **Working tip:** keep two terminal windows / use `supabase link` to switch when you need to apply changes to one or the other. There is no built-in multi-project mode in the CLI today.

---

## 4. Seed the prod admin user

Once migrations are applied, you have an empty prod DB. Create the admin via SQL Editor in Supabase dashboard (or via `psql`):

```sql
-- Replace email + password with what you actually want
DO $$
DECLARE
  admin_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated',
    'info@jetdigitalpro.com', crypt('CHANGE_ME', gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Admin'),
    NOW(), NOW(),
    '', '', '', '', '', '', '', '',
    false, false
  );
  -- The handle_new_user trigger creates the public.users row with role=army.
  -- Promote to admin:
  UPDATE public.users SET role = 'admin', full_name = 'Admin'
  WHERE id = admin_id;
END $$;
```

Test login at the staging URL pointed at prod project (or via the Supabase auth API) before hooking up Vercel.

---

## 5. Push code to GitHub

```bash
cd "D:\Claude Cowork\Reddit Army Local"

# If not already done:
git init
git add .
git commit -m "Initial commit: PeTa MVP"

# Create the repo on github.com (private), then:
git remote add origin git@github.com:<your-handle>/peta.git
git branch -M main
git push -u origin main

# Create staging branch
git checkout -b staging
git push -u origin staging
```

> The `peta/.env.local` file is git-ignored — secrets won't leak.

---

## 6. Vercel — first deploy

1. Go to https://vercel.com/new → import your GitHub repo
2. **Root directory**: set to `peta` (the actual app is in this subfolder)
3. **Framework preset**: Vite (auto-detected)
4. **Build command**: `npm run build`  · **Output**: `dist`
5. Skip "Environment Variables" for now — set them in step 7.
6. Click Deploy. The first deploy will fail because env vars are missing — that's fine.

---

## 7. Configure environment variables per environment

In Vercel dashboard → your project → **Settings → Environment Variables**:

| Variable                  | Production value         | Preview value (staging branch) |
|---------------------------|--------------------------|-------------------------------|
| `VITE_SUPABASE_URL`       | https://<prod-id>.supabase.co | https://duxzxizedtvnopfihllz.supabase.co |
| `VITE_SUPABASE_ANON_KEY`  | <prod anon key>          | <staging anon key — same as your `.env.local`> |

Use Vercel's **environment scoping**:
- For each var: tick **Production** with the prod value
- Then add the same var name again, tick only **Preview** + select branch `staging`, with the staging value

After saving, redeploy: **Deployments → ⋯ on latest → Redeploy**.

---

## 8. Wire the domain

In Vercel → **Settings → Domains**:

- Add `penghasilantambahan.com` → assign to **Production** (main)
- Add `staging.penghasilantambahan.com` → assign to **staging branch**

Vercel will show DNS records you need to add at your registrar:
- For root: usually `A` record → `76.76.21.21`
- For subdomain: usually `CNAME` `staging` → `cname.vercel-dns.com`

DNS propagation: usually 5–30 min, sometimes up to a few hours.

---

## 9. Future workflow

```bash
# Day-to-day staging work
git checkout staging
# ... edit code, test against staging Supabase ...
git push                                  # auto-deploys to staging.penghasilantambahan.com

# Schema change for staging
supabase link --project-ref duxzxizedtvnopfihllz
# create new migration:
supabase migration new add_xyz
# write SQL in peta/supabase/migrations/<timestamp>_add_xyz.sql, then:
supabase db push                          # applies to staging

# Promote to production
git checkout main
git merge staging
git push                                  # auto-deploys to penghasilantambahan.com
# Apply same migration to prod:
supabase link --project-ref <prod-id>
supabase db push
```

**Always**: staging migration → test → prod migration → prod deploy. Never apply a migration to prod that you haven't tested on staging.

---

## 10. Sanity checklist before going live

- [ ] `/register` creates a user in prod Supabase
- [ ] `handle_new_user` trigger fires (check `users` table — full_name + whatsapp populated)
- [ ] Login works
- [ ] Onboarding 6 steps all advance, confetti shows, saldo grows to Rp50K
- [ ] `/admin/team` shows the new user (login as `info@jetdigitalpro.com`)
- [ ] `/admin/team` add member → user appears
- [ ] Referral link `/register?ref=<code>` awards Rp20K to both sides
- [ ] Earnings page shows Rp50K saldo, "Tarik Saldo" disabled below Rp150K

---

## 11. Common issues

**"new row violates row-level security policy"** — usually means a regular user is trying to write to a table without an INSERT policy (e.g. `user_credits` is admin-only for direct inserts; users go through `claim_onboarding_bonus` RPC instead).

**Supabase email rate limit** — only happens if "Confirm email" is enabled. Make sure it's OFF in both staging and prod.

**Trigger errors after migration** — if you see "column X does not exist", the migration order may be off. Migrations apply in filename order; never rename old migration files.

**Vercel 404 on `/tasks` etc** — Vite SPA needs catch-all routing. Vercel does this automatically if you have a `vercel.json` with `rewrites: [{ "source": "/(.*)", "destination": "/" }]` (already in repo).

---

## Useful Supabase CLI commands

```bash
supabase migration list        # see what's applied
supabase migration new <name>  # create a new migration file
supabase db push               # apply pending migrations
supabase db diff               # show drift between local and remote
supabase db dump --data-only   # export data (for backups)
```
