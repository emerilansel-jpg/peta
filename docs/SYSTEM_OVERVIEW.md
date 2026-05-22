# PeTa + Straight Ltd — System Overview (cold-start reference)

> **Audience:** any AI agent (Claude, GPT, Gemini) or new dev joining mid-stride.
> Read this first. Cross-reference `CHANGELOG.md` for recent decisions, `WA_BOT_SETUP.md` for the WhatsApp verifier pipeline.

---

## 1. Two products, one backend

| Product | Domain | Audience | Currency | Role tag |
|---|---|---|---|---|
| **PeTa** (Penghasilan Tambahan) | `penghasilantambahan.com` (+ `www`) | Indonesian micro-task workers | IDR | `users.role = 'army'` |
| **Straight Ltd** | `straight.ltd` (+ `www`) | International (mostly US) clients | USD | `users.role = 'client'` |

Both share:
- ONE Supabase prod project (`yorlsgzsawchpeeazcvi`)
- ONE Cloudflare Pages deploy (`peta-cvm.pages.dev`)
- ONE React app codebase
- Hostname-based routing in `peta/src/App.tsx` (`HostnameHomeRouter`) → `straight.ltd` lands on `/reddit`, PeTa stays on `/`

Distinguishing role:
- `users.role = 'admin'` → access `/admin/*` (PeTa admin console)
- `users.role = 'army'` → onboarding, `/tasks`, `/earnings`, `/account`
- `users.role = 'client'` → `/reddit/*` (Straight Ltd dashboard)

---

## 2. Environments

| Env | Supabase | URL | Purpose |
|---|---|---|---|
| Prod | `yorlsgzsawchpeeazcvi` | https://yorlsgzsawchpeeazcvi.supabase.co | `penghasilantambahan.com` + `straight.ltd` |
| Staging | `duxzxizedtvnopfihllz` | https://duxzxizedtvnopfihllz.supabase.co | local dev + `staging.penghasilantambahan.com` (when set up) |

**Env file convention (CRITICAL — caused major outage 2026-05-20):**

| File | When loaded | Status |
|---|---|---|
| `peta/.env.development.local` | `npm run dev` (Vite dev mode) only | gitignored, points at staging |
| `peta/.env.production` | `npm run build` only | **committed** (anon key is public by design) |
| `peta/.env.local` | BOTH dev and build | **DO NOT USE** — would override `.env.production` |

Always apply migrations to staging FIRST via Supabase MCP `apply_migration`, then prod. Files live in `peta/supabase/migrations/` and apply in alphabetical (timestamp) order.

---

## 3. Database schema (key tables)

### Core users
- **`auth.users`** — Supabase Auth, source of truth for email + password
- **`users`** (public) — mirrors auth.users by id, adds: `full_name`, `whatsapp` (UNIQUE), `referral_code`, `referred_by`, `role`, `is_active`, `wa_group_dismissed`, `wa_group_verified` (NEW 2026-05-21), `wa_group_verified_at`
- **`user_credits`** — money ledger. `source` ∈ ('signup_bonus', 'referral_bonus_referrer', 'referral_bonus_referee', 'task_reward', 'manual_adjustment', 'karma_milestone', 'wa_group_verified'). Has `reference_id` for idempotent ties to other rows (e.g. task assignments).

### PeTa task system
- **`tasks`** — `title`, `description`, `target_url`, `task_category` ('reddit_upvote'|'reddit_comment'|'reddit_post_thread'), `min_karma`, `min_account_age_days`, `per_account_limit`, `brief`, `start_at`/`end_at`, `max_assignments`, `current_assignments`, `reward_amount`, `status` ('draft'|'active'|'paused'|'completed'), `created_by`, `source_order_id` (FK to reddit_upvote_orders)
- **`task_assignments`** — `task_id`, `reddit_account_id`, `status` ('in_progress'|'submitted'|'approved'|'rejected'), `draft_comment`, `proof_url`, `admin_notes`, `can_retry`
- **`reddit_accounts`** — 1 per user (UNIQUE user_id), `username`, `karma`, `account_age_days`, `level` (0–5), `status_flag` ('ok'|'suspended'|'not_found'|'unknown')

### Straight Ltd order system
- **`reddit_upvote_orders`** — client orders that auto-import into PeTa tasks via `auto_import_reddit_order_to_task` trigger. Fields: `user_id`, `subreddit`, `thread_url`, `requested_upvotes`, `delivered_upvotes`, `cost_credits`, `status`

### Payouts (PeTa army)
- **`payouts`** — `user_id`, `amount`, `status` ('pending'|'paid'|'cancelled'), `paid_at`, `payment_method`. Created via `request_payout(amount)` RPC. **NO minimum amount** (decreed 2026-05-20); bonus floor logic in `validate_payout_eligibility`.

### Communication
- **`broadcasts`** + **`broadcast_recipients`** — admin mass-DM (email + WhatsApp via Fonnte)
- **`inbox_threads`** + **`inbox_messages`** — admin support inbox
- **`audit_log`** (NEW 2026-05-20) — every INSERT/UPDATE/DELETE on critical tables (tasks, payouts, user_credits, reddit_upvote_orders, reddit_accounts, task_assignments). Forensic recovery on demand. Query via `admin_recent_audit(table, limit, action)`.

### Secrets
- **`app_secrets`** — credential store, RLS-locked (no policies = service_role only). Keys in prod right now:
  - `FONNTE_TOKEN` — WhatsApp broadcast gateway
  - `RESEND_API_KEY` — transactional email
  - `EVOLUTION_API_URL` (`http://46.250.239.138:8080`) — WA bot API
  - `EVOLUTION_API_KEY` — auth for above
  - `EVOLUTION_INSTANCE` (`peta-bot`)
  - `WA_VERIFY_WEBHOOK_SECRET` — gates `claim_wa_group_by_phone` RPC
  - `N8N_WEBHOOK_URL` — Evolution → N8N target
  - `PETA_WA_GROUP_JID` — the official PeTa WA group JID (set via admin UI after bot joins)

### Other
- **`activity_logs`**, **`referral_clicks`**, **`pending_karma`** flow — see migrations

---

## 4. Key RPCs (Postgres functions) — all SECURITY DEFINER unless noted

| RPC | What it does | Who calls |
|---|---|---|
| `is_admin()` | bool — checks current auth.uid() has role='admin' | RLS policies, edge functions |
| `claim_onboarding_bonus(step)` | Grants signup/wa_group/warp/reddit_account/reddit_url bonus (idempotent) | Army (onboarding) |
| `admin_create_member(...)` / `admin_update_member` / `admin_delete_member` | Admin CRUD | Admin Team page |
| `is_whatsapp_taken(phone)` | bool — anon-callable pre-flight | Register form |
| `dismiss_wa_group()` | Sets users.wa_group_dismissed = true | Tasks page CTA |
| `request_payout(amount)` | Inserts payouts row after eligibility check (auth + holding + bonus floor + weekly cap, **NO MIN amount**) | Army Earnings page |
| `validate_payout_eligibility(user, amount)` → json | Pre-flight check, returns `{eligible, reason, message, task_earnings, bonus_total, bonus_unlocked, ...}`. Reasons: `holding_period`, `earnings_floor`, `weekly_cap`, `insufficient_balance` | Army UI |
| `track_referral_click(code, session, ua)` | anon-callable, dedup per (code, session) | Public landing |
| `get_referral_analytics(user_id)` → json | `{totalClicks, uniqueClicks, signups, totalEarned, conversionRate}` | Army account page |
| `admin_get_referral_leaderboard(limit)` | Top N referrers | Admin |
| `submit_karma_claim(karma, proof_url)` | Honor-system karma submission | Army (Reddit data-center IPs blocked karma sync) |
| `admin_set_karma(user, karma)` / `admin_reject_karma_claim(user, reason)` | Manual karma override | Admin |
| `list_eligible_tasks_for_user()` | Filters tasks by karma/age/category/per-account-limit + status='active' + within start_at/end_at window. Admin without Reddit acct sees all active (preview mode). | Army Tasks page |
| `admin_update_task(...)` | Full task edit | Admin TaskQueue |
| `admin_pending_approvals()` (NEW 2026-05-20) | SECURITY DEFINER bypass for approval queue — returns flat rows (no PostgREST embed flakiness). Raises 'forbidden' if not admin. | Admin Approval page |
| `admin_session_debug()` (NEW 2026-05-20) | Diagnostic — returns `{auth_uid, public_users_role, is_admin, submitted_count}`. Anon-callable, surfaces session issues. | Admin Approval page |
| `claim_wa_group_by_phone(phone, secret)` (NEW 2026-05-21) | Webhook-secret-gated. Grants Rp5K bonus when phone matches a registered army + first time. | N8N webhook |
| `admin_list_wa_unverified()` (NEW 2026-05-21) | Lists army army with `wa_group_verified=false` | Admin WA Bot page |
| `admin_recent_audit(table, limit, action)` (NEW 2026-05-20) | Inspect audit_log | Admin (manual SQL or future UI) |
| `admin_create_broadcast(...)` / `admin_list_broadcasts()` / `admin_broadcast_recipients(id)` | Broadcast system | Admin |
| `admin_set_secret(key, value)` | Upsert app_secrets | Admin Secrets page |
| `normalize_wa_phone(text)` → text (NEW 2026-05-21) | IMMUTABLE — strips +62/0/non-digits, normalizes leading 0→62. Used by `claim_wa_group_by_phone`. | Internal |

---

## 5. Edge Functions (Supabase)

| Function | Auth | Purpose |
|---|---|---|
| `send-broadcast-emails` v5+ | service_role | Resend or Spacemail SMTP fallback (dual-provider). 1.1s pacing for WhatsApp parity. |
| `send-broadcast-whatsapp` v2+ | service_role | Fonnte gateway; reads token from `app_secrets.FONNTE_TOKEN`. |
| `send-notification-email` v5+ | service_role | Transactional (verification, payout confirm, etc.) |
| `sync-reddit-karma` v4 | service_role | OAuth installed-app planned, currently honor-system since Reddit blocks data-center IPs. |
| `wa-bot-proxy` (NEW 2026-05-21) | JWT + admin role check | Proxies Evolution API for the admin WA Bot UI. Hides `EVOLUTION_API_KEY`. Actions: status, qr, create, restart, disconnect, set_webhook, set_group_jid, list_groups, get_config. |

---

## 6. Frontend routes

```
Public:
  /                         — Landing (PeTa) or /reddit redirect (straight.ltd)
  /login, /register         — Auth
  /verify, /forgot-password
  /reddit                   — Straight Ltd public landing
  /reddit/pricing
  /reddit/checkout
  /reddit/order-confirmed

Army (logged in, role=army):
  /onboarding               — 6-step setup with confetti + bonuses
  /tasks                    — Active tasks + referral hero + karma + streak
  /task/:id                 — Detail + screenshot upload
  /earnings                 — Saldo + Cair (Rincian breakdown: signup vs referral)
  /account                  — Reddit acct + WhatsApp edit + referral share
  /karma                    — KarmaMission honor-system claim

Client (role=client):
  /reddit/dashboard
  /reddit/orders
  /reddit/tickets
  ...

Admin (role=admin, AdminGuard):
  /admin                    — Dashboard
  /admin/tasks              — Task Queue (3-category create/edit, order import)
  /admin/approval           — Approval Queue (uses admin_pending_approvals RPC)
  /admin/accounts           — Reddit accounts + bulk sync + flag filter
  /admin/broadcast          — Email + WhatsApp blast
  /admin/wa-bot             — NEW 2026-05-21: WhatsApp verifier bot UI (QR + config + unverified list)
  /admin/inbox              — Support inbox
  /admin/secrets            — app_secrets CRUD
  /admin/team               — Member CRUD
  /admin/payroll            — Approve/pay payouts
  /reddit/admin/*           — Straight Ltd admin (orders, tickets, clients, reviews, finance)
```

---

## 7. Payout rules (army, post-2026-05-20 redesign)

1. **No minimum payout amount.** Saldo dari task cair berapapun, kapan aja.
2. **Holding period** — 7-day account age **OR** 5 approved tasks before payout opens (`reason: holding_period`)
3. **Bonus unlock floor** — signup_bonus + referral_bonus_* credits are LOCKED until `task_earnings >= Rp100.000`. Once unlocked, joins the cashable pool freely. (`reason: earnings_floor`)
4. **Weekly cap** — Rp500.000 outflow per user per 7d (`reason: weekly_cap`); admin can override via direct UPDATE.
5. **Insufficient balance** — `reason: insufficient_balance` when amount > available

Math:
```
tasks         = SUM(approved task_assignments * tasks.reward_amount)
cashable_now  = tasks + manual_adjustment + karma_milestone + (bonus IF tasks ≥ Rp100K ELSE 0)
available     = cashable_now − (pending + paid payouts)
```

`task_reward` source in `user_credits` is the trigger-mirror of approved task_assignments. We use `task_assignments` as canonical to avoid double-count. Server function (`validate_payout_eligibility`) and client (`getTotalEarnings`) both exclude `task_reward` from credit sums.

---

## 8. WhatsApp Bot Verifier (NEW 2026-05-21)

**Goal:** army types "peta" in PeTa's WA group → auto-credit Rp5.000.

**Stack:**
- VPS Contabo `46.250.239.138` — Ubuntu 24.04, 4 vCPU, 8GB RAM
- Docker compose at `/opt/peta-bot/docker-compose.yml`:
  - `peta-evolution` (atendai/evolution-api:v2.2.3) — Baileys-based WA Web client
  - `peta-n8n` (n8nio/n8n:latest) — workflow engine
  - `peta-postgres` (16-alpine) — Evolution session/message storage
  - `peta-redis` (7-alpine) — Evolution cache
  - `peta-caddy` (2-alpine) — reverse proxy with `tls internal` (self-signed; Let's Encrypt rate-limited sslip.io)
- Ports: 22 (SSH), 80 (Caddy), 443 (Caddy HTTPS), 8080 (Evolution direct HTTP — Supabase Edge Function can't talk to self-signed cert, so HTTP fallback)
- UFW firewall: allow only 22/80/443/8080
- fail2ban active

**Flow:**
```
Army types "peta" in WA group
  ↓ (Evolution bot reads group msg)
Evolution POSTs webhook to https://n8n.../webhook/wa-incoming
  ↓ (N8N workflow normalizes payload)
N8N IF: isGroup && text=='peta' && groupJid==PETA_WA_GROUP_JID
  ↓ (true)
N8N HTTP POST to Supabase RPC claim_wa_group_by_phone(phone, webhook_secret)
  ↓ (RPC inserts Rp5K credit + sets users.wa_group_verified=true)
N8N DMs sender via Evolution: "✅ Bonus Rp5.000 udah masuk saldo PeTa kamu!"
```

**Admin manages via `/admin/wa-bot`:**
- View connection status (auto-refresh 5s)
- Scan QR with burner WhatsApp
- Save N8N webhook URL → auto-set in Evolution
- Pick PeTa group JID from bot's joined groups
- See unverified army list with one-click `wa.me` DM links

See `docs/WA_BOT_SETUP.md` for detailed step-by-step.

---

## 9. Hosting & deploy

### Web app
- **Cloudflare Pages project:** `peta` (under account `n311311@gmail.com`)
- **Domain bindings:** `www.penghasilantambahan.com`, `www.straight.ltd`, `peta-cvm.pages.dev`
- **Apex redirects:** `penghasilantambahan.com` and `straight.ltd` use Spaceship URL redirect → `www.*`
- **Git integration:** **NO** (`Git Provider: No`). Deploy is manual via `wrangler pages deploy dist`. Push to GitHub does NOT auto-deploy.
- **Build:** `cd peta && npm run build` (auto-loads `.env.production`)
- **GitHub repo:** `https://github.com/emerilansel-jpg/peta.git`. Branches: `main` (prod target), `staging` (dev branch — usually one merge ahead of main).

### VPS (WA bot)
- **Contabo VPS:** `46.250.239.138`, customer ID 14993579 (`n311311@gmail.com`)
- **SSH:** `root@46.250.239.138` (password in user's password manager, NOT in repo)
- **All bot config:** `/opt/peta-bot/` (docker-compose.yml, .env, Caddyfile)
- **Logs:** `docker compose logs -f [service]`

### Supabase
- **Org:** `emerilansel-jpg's Org` (plan: **free** — no PITR backup, recommend upgrade to Pro $25/mo for prod safety)
- **Backups:** see `backups/` dir for manual JSON snapshots taken via execute_sql.

### Email
- **Spacemail** (legacy): SMTP `mail.spacemail.com:465`, `peta@penghasilantambahan.com` mailbox
- **Resend** (current default): API key in `app_secrets.RESEND_API_KEY`, sender `peta@penghasilantambahan.com`, DKIM/SPF/DMARC verified on Spaceship DNS

### WhatsApp gateways
- **Fonnte Lite** (free outbound): rate-limited to ~60 msg/burst; OK for low-volume admin DMs
- **Evolution API** (NEW): Baileys-based, runs on Contabo, used for the verifier bot (in + out). 
- Long-term: consider migrating broadcast from Fonnte to Evolution (one stack instead of two)

---

## 10. Forensic / safety net

- `audit_log` table captures every write on tasks, payouts, user_credits, reddit_upvote_orders, reddit_accounts, task_assignments — with actor_id + old/new jsonb.
- Query via `SELECT * FROM admin_recent_audit('tasks', 50, 'DELETE');`
- For full restore: need Supabase Pro (PITR) — currently impossible on Free tier beyond ~7 days.
- Manual snapshots saved to `backups/` periodically.

---

## 11. Known gotchas / lessons learned

1. **Env files** — `.env.local` overrides everything at build time. Use `.env.development.local` (dev only) + `.env.production` (build only). See incident in `CHANGELOG.md` (2026-05-20).
2. **PostgREST embedded resources** can silently return empty under RLS/auth edge cases. Prefer SECURITY DEFINER RPCs with explicit guards (see `admin_pending_approvals`).
3. **Type casts in RETURNS TABLE** — Postgres won't auto-cast varchar→text inside SECURITY DEFINER RPC. Always `::text` join columns. Affects `auth.users.email`, `public.users.full_name`, etc.
4. **Supabase Edge Function fetch can't accept self-signed certs** → use HTTP for VPS-internal traffic (e.g. Evolution API at `http://46.250.239.138:8080`). API key in body/header authenticates.
5. **Let's Encrypt rate limit on sslip.io is permanent** (250K certs / week shared across all users). Use real domain or `tls internal` (self-signed).
6. **Cloudflare Pages is NOT git-connected** — every deploy is manual `wrangler pages deploy dist`. Forgetting this leads to "I pushed but nothing changed".
7. **`task_reward` credits are mirrors** of approved task_assignments. Don't double-count — server uses assignments, client must skip `task_reward` source.
8. **Hostname-based routing** in App.tsx — `straight.ltd` → `/reddit`. Don't break this.
9. **N8N data directory** needs `chown -R 1000:1000` on host because n8n container runs as uid 1000.
10. **WhatsApp Web ban risk:** use burner number, avoid blast patterns, send DM replies only as confirmation (low msg rate).

---

## 12. Quick commands cheatsheet

```bash
# Deploy frontend
cd peta && npm run build && npx wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true

# Apply migration to both envs (via Supabase MCP, NOT CLI)
# Use mcp__supabase__apply_migration with the project_id

# SSH to VPS
ssh root@46.250.239.138

# Restart WA bot stack
ssh root@46.250.239.138 'cd /opt/peta-bot && docker compose restart'

# View Evolution logs
ssh root@46.250.239.138 'docker compose -f /opt/peta-bot/docker-compose.yml logs --tail 50 evolution-api'

# Query prod DB via execute_sql MCP, e.g.:
# SELECT key, value FROM app_secrets WHERE key LIKE 'EVOLUTION%';
```

---

## 13. AI handoff checklist (for cold-start delegation)

When delegating to another AI tool (Claude, GPT, Gemini, custom agent), provide these files in order:

1. **`CLAUDE.md`** — top-level project state, env credentials
2. **`docs/SYSTEM_OVERVIEW.md`** (this file) — architecture, schema, RPCs, gotchas
3. **`docs/CHANGELOG.md`** — chronological recent changes (read last 5 entries minimum)
4. **`docs/WA_BOT_SETUP.md`** — full setup guide for the WhatsApp verifier
5. **`peta/.env.example`** — env file convention
6. **`peta/supabase/migrations/`** — last 5-10 files for current schema state

Then give them the task. Avoid pasting raw DB rows — instruct them to query via Supabase MCP `execute_sql` or `apply_migration`.
