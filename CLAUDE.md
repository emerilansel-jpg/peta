# PeTa — Project State for Claude

> Auto-loaded into every Claude session. Keep this file dense and current.

## What this is

**PeTa** = "Penghasilan Tambahan" — Indonesian micro-task platform. Members are paid Rp5K–20K per Reddit comment and Rp500–2K per upvote. Aimed at Indonesian users; UI copy is in Bahasa Indonesia (casual / gaul tone).

The Reddit dependency is **internal** — public marketing copy (Landing, Login, Register) does NOT mention Reddit; it just says "komen di internet" / "bayar buat komen". Reddit/WARP only surface inside onboarding and admin.

## Stack

- **Frontend:** Vite 8 + React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite` plugin, NOT PostCSS)
- **State:** TanStack Query (server) + React useState (local)
- **Routing:** React Router v7
- **Backend:** Supabase (Postgres + Auth + RLS + Edge Functions)
- **Hosting:** Vercel — domain `penghasilantambahan.com` (live)
- **Project root:** `D:\Claude Cowork\Reddit Army Local\` — the actual app lives in `peta/` subfolder

## Environments

| Env | Supabase project ID | URL | Purpose |
|---|---|---|---|
| **staging** | `duxzxizedtvnopfihllz` | https://duxzxizedtvnopfihllz.supabase.co | Local dev + staging.penghasilantambahan.com |
| **prod**    | `yorlsgzsawchpeeazcvi` | https://yorlsgzsawchpeeazcvi.supabase.co | penghasilantambahan.com |

Same migration files apply to both — see `peta/supabase/migrations/`. Always test on staging first.

Env vars (Vercel + local `.env.local`):
```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

The current admin: `info@jetdigitalpro.com` / `peta` (4-char pwd, written directly to `auth.users.encrypted_password` to bypass policy — only for the seeded admin row).

## Database schema (key tables)

- **users** — extends `auth.users`, adds `full_name`, `whatsapp` (UNIQUE), `referral_code` (auto-gen), `referred_by`, `role` ('army'|'admin'), `is_active`, `wa_group_dismissed`, `pending_karma`, `pending_karma_url`
- **reddit_accounts** — username (UNIQUE), karma, account_age_days, level (0–5, auto-updated by `tg_set_reddit_level` trigger), `status_flag` (ok/suspended/not_found/unknown), `flagged_at`, `UNIQUE(user_id)` — 1 account per user
- **tasks** — title, description, target_url, `task_category` ('reddit_upvote'|'comment'|'post_thread'), `min_karma`, `min_account_age_days`, `per_account_limit`, `brief`, `start_at`/`end_at`, max_assignments, current_assignments, reward_amount, status ('draft'|'active'|'paused'|'completed'), created_by, `source_order_id`
- **task_assignments** — task_id, reddit_account_id, status ('in_progress'|'submitted'|'approved'|'rejected'), draft_comment, proof_url, admin_notes
- **broadcasts** — subject, body, channels, email_sent/failed, wa_sent/failed
- **broadcast_recipients** — broadcast_id, channel (email|whatsapp), phone, status, error, sent_at
- **app_secrets** — key/value credential store (RLS enabled, no policies = service_role only). Used for FONNTE_TOKEN etc.
- **payouts** — user_id, amount (min Rp150K), status ('pending'|'paid'|'cancelled'), paid_at, payment_method
- **user_credits** — generic credit ledger; `source` IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','manual_adjustment'). Has unique partial index `(user_id, description) WHERE source='signup_bonus'` for idempotency.
- **referral_clicks** — `ref_code`, `referrer_user_id`, `visitor_session`, `user_agent`, `created_at`. Dedup per `(ref_code, visitor_session)`.
- **activity_logs** — user_id, action, details JSONB

### RLS pattern
Every table has RLS enabled. Helper function `is_admin()` (SECURITY DEFINER, bypasses RLS recursion) is used in policies instead of inline `EXISTS(SELECT FROM users)` (which causes infinite recursion under PostgREST).

### Server-side RPCs (SECURITY DEFINER)
- `is_admin()` → bool
- `claim_onboarding_bonus(p_step)` — only path for army users to write to `user_credits` (steps: `signup`, `wa_group`, `warp`, `reddit_account`, `reddit_url`)
- `admin_create_member(email, password, whatsapp, full_name)` → uuid
- `admin_update_member(id, full_name, whatsapp, is_active)`
- `admin_delete_member(id)` — hard-deletes from `auth.users`, cascades
- `is_whatsapp_taken(text)` → bool — anon-callable pre-flight check before signup
- `dismiss_wa_group()` — sets `users.wa_group_dismissed = true` (hide-forever)
- `compute_level(karma int)` → int — used by `tg_set_reddit_level` trigger
- `get_referral_count(uuid)` → int
- `submit_karma_claim(karma int, proof_url text)` — honor-system: writes `pending_karma` for admin review (Reddit data-center IPs blocked)
- `admin_reject_karma_claim(user_id, reason)` / `admin_set_karma(user_id, karma)`
- `request_payout(amount int)` → row — server-gated payout INSERT (eligibility runs SECURITY DEFINER)
- `validate_payout_eligibility(user_id, amount)` → json — pre-flight; returns `{eligible, reason, message, ...}`. Reasons: `holding_period` | `earnings_floor` | `weekly_cap`
- `track_referral_click(ref_code, session, user_agent)` — anon-callable; dedup per `(ref_code, session)`
- `get_referral_analytics(user_id)` → json — `{totalClicks, uniqueClicks, signups, totalEarned, conversionRate}`
- `admin_get_referral_leaderboard(limit int)` → table — top N by signups
- `admin_update_task(...)` — full task edit (category, karma/age gates, brief, schedule, status)
- `admin_create_broadcast(...)` / `admin_list_broadcasts()` / `admin_broadcast_recipients(id)`
- `admin_set_secret(key, value)` — upsert into `app_secrets` (admin-only, SECURITY DEFINER)
- `list_eligible_tasks_for_user()` → table — server-side filtering (karma/age/category/per-account/window)

### Triggers
- `handle_new_user` (on `auth.users` INSERT) — creates `public.users` row, copies `full_name`+`whatsapp`+`referral_code` from `raw_user_meta_data`, awards Rp20K referral bonuses to both sides if `referral_code` matches an existing user. Pre-checks WA uniqueness + RAISES Indonesian message (Supabase Auth wraps as "Database error" — Register.tsx pattern-matches as fallback).
- `generate_referral_code` (on `public.users` BEFORE INSERT) — auto-generates 8-char hex code
- `tg_set_reddit_level` (on `reddit_accounts` BEFORE INSERT/UPDATE) — auto-computes level from karma
- `auto_import_reddit_order_to_task` — straight.ltd order → PeTa task queue
- `tg_notify_reddit_flagged` — queues email + WA when reddit_accounts.status_flag changes (48h dedup)

### Edge Functions
- `sync-reddit-karma` v4 — deployed but data-center IPs blocked by Reddit. Honor-system claim queue is the working path; OAuth installed-app flow planned.
- `send-broadcast-emails` v5 — Spacemail SMTP (`mail.spacemail.com:465` SSL, `peta@penghasilantambahan.com`). Dual-provider: auto-picks Resend API if `RESEND_API_KEY` set, else SMTP.
- `send-broadcast-whatsapp` v2 — Fonnte gateway. Reads `FONNTE_TOKEN` from `app_secrets` table (not env var). 1.1s pacing per message. Background, no popup tabs.
- `send-notification-email` v5 — Straight Ltd transactional emails (same SMTP infra)

## Levels & rewards

Levels (0–5): 🥚 Pemula → 🦴 Bocil → 🔥 Aktif → ⚔️ Pejuang → 🏙️ Senior → 👑 Legend
Rewards per comment task: **Rp5.000 → Rp20.000** (escalates with level).
Upvote tasks pay Rp500–Rp2.000 regardless of level.

Onboarding bonuses (total **Rp50.000**):
- Signup: Rp25K · WA Group: Rp5K · WARP: Rp10K · Reddit account: Rp5K · Reddit URL: Rp5K

## Payout rules

Min payout: **Rp150.000** per request.

**Eligibility gates (server-enforced via `validate_payout_eligibility` RPC, reasons returned as JSON):**

1. **Holding period** — 7 days account age **OR** 5 approved tasks before payout opens (`reason: 'holding_period'`)
2. **Earnings floor** — must have **Rp150K from approved task rewards + `signup_bonus` credits** before ANY payout (including referral balance) bisa cair (`reason: 'earnings_floor'`). Closes "panen referral lalu kabur" loophole.
3. **Weekly cap** — Rp500.000 outflow per user per 7d (`reason: 'weekly_cap'`); admin override via direct UPDATE.

`getTotalEarnings(userId)` returns `{earned, referral, fromWork, total}`:
- `fromWork` = approved tasks + `signup_bonus` (counts toward floor)
- `referral` = `referral_bonus_referrer` + `referral_bonus_referee` (locked behind floor)
- `earned` = `fromWork` + manual adjustments
- `total` = `earned` + `referral`

Earnings.tsx mirrors the gate visually: yellow progress bar to floor, "(locked)" badge on referral bucket, CTA disabled with "Locked — kurang Rp X dari task" message until cleared.

## Onboarding flow (6 steps)

`peta/src/pages/Onboarding.tsx` — uses per-user localStorage key `onboarding_completed:<uid>`. Each step calls `safeClaim(stepKey)` which RPCs `claim_onboarding_bonus()` and never throws (so step always advances on first click). On success: confetti via `<ConfettiBurst>` and toast.

1. **Welcome** — claim Rp25K (WhatsApp prefilled from registration; only asked here for legacy accounts)
2. **WhatsApp Group** — `WHATSAPP_GROUP_URL` from `peta/src/lib/config.ts`. Mandatory.
3. **WARP** — Cloudflare WARP install (Reddit unblock for ID ISPs)
4. **Reddit account** — open reddit.com/register
5. **Reddit URL** — captures username, calls `addRedditAccount` (which tries `https://www.reddit.com/user/<u>/about.json`, falls back to karma=0 if blocked)
6. **Mulai Earn** — navigates to `/tasks`

If user already has a `reddit_accounts` row, mount-time effect redirects to `/tasks` so onboarding can never loop.

## Tasks page — real tasks + engagement

`peta/src/pages/Tasks.tsx` shows **real eligible tasks** at top (via `list_eligible_tasks_for_user` RPC, 30s refetch), followed by engagement sections:
- Real `getCommunityStats()` (totalMembers, totalPaid)
- Real `getCommunityFeed()` (recent signups + paid payouts + referral bonuses, names masked `Ahm***`)
- Per-user streak counter in localStorage with milestone bonuses (3/7/14/30 days)
- WhatsApp group join CTA (saved in `peta_wa_joined`)
- 8 blurred preview task cards (visible rewards, locked overlay) — shown below real tasks
- Reddit flagged-account red banner if status_flag is suspended/not_found
- Email save reminder banner (dismissable via localStorage)

No fake "X member online" or fake activity feed — user explicitly required real data only.

## Key files reference

```
peta/
├── src/
│   ├── pages/
│   │   ├── Landing.tsx          ← Public marketing (no Reddit branding)
│   │   ├── Login.tsx            ← Bottom-sheet style on mobile
│   │   ├── Register.tsx         ← 4 fields: Nama, Email, WhatsApp, Password (+ optional referral)
│   │   ├── Onboarding.tsx       ← 6 steps, confetti, RPC-based bonus
│   │   ├── Tasks.tsx            ← Real tasks (RPC) + streak + community stats
│   │   ├── TaskDetail.tsx       ← Screenshot upload + brief + submit flow
│   │   ├── Account.tsx          ← Reddit accounts CRUD, WhatsApp edit, referral share
│   │   ├── Earnings.tsx         ← Saldo, milestone progress, payout sheet (min Rp150K)
│   │   └── admin/
│   │       ├── Dashboard.tsx
│   │       ├── Team.tsx         ← CRUD via admin RPCs, click-to-WA links
│   │       ├── TaskQueue.tsx    ← 3-category tasks, draft/schedule, brief, order import
│   │       ├── ApprovalQueue.tsx ← Table + lightbox, screenshot thumbnails
│   │       ├── Broadcast.tsx    ← Email + WhatsApp compose, test, blast, history
│   │       ├── Payroll.tsx
│   │       └── RedditAccounts.tsx ← Status flags, bulk sync, problem filter
│   ├── components/
│   │   ├── Layout.tsx           ← Mobile bottom-nav (army) + drawer (admin)
│   │   ├── AdminGuard.tsx       ← role='admin' route guard
│   │   ├── Confetti.tsx         ← CSS-only confetti, ref-stable onDone
│   │   ├── Card.tsx, Button.tsx, Skeleton.tsx, Toast.tsx
│   ├── lib/
│   │   ├── supabase.ts          ← createClient(...)
│   │   ├── api.ts               ← All Supabase queries; helpers: getTotalEarnings, getCommunityFeed, claimOnboardingBonus, getReferralStats, syncRedditKarma, sendBroadcastEmails/Whatsapp, uploadTaskProofImage
│   │   ├── levels.ts            ← LEVELS array, calculateLevel()
│   │   └── config.ts            ← WHATSAPP_GROUP_URL, DAILY_RESET_HOUR
│   └── index.css                ← Tailwind v4 import + design tokens + confetti keyframes
├── supabase/
│   ├── config.toml              ← Local dev config
│   └── migrations/              ← 13+ timestamped .sql files (apply in order)
│       ├── ...                       (initial 8 — auth, RLS, onboarding bonuses, admin RPCs)
│       ├── 20260507033500_karma_level_admin_referral_fixes.sql
│       ├── 20260507040000_wa_group_dismiss_preference.sql
│       ├── 20260507065000_karma_claim_pending.sql
│       ├── 20260508060000_payout_eligibility_and_phone_unique.sql
│       ├── 20260508070000_handle_new_user_friendly_wa_conflict.sql
│       ├── 20260508080000_referral_clicks_analytics.sql
│       ├── 20260509060000_payout_earnings_floor.sql
│       └── (+ task_category, reddit_status_flag, broadcasts, app_secrets — applied via MCP)
│       └── 20260509060000_payout_earnings_floor.sql
└── package.json
```

## Design system

- Primary `#FF6B6B` · Secondary `#4ECDC4` · Accent `#FFD93D` · Success `#06D6A0` · Warning `#FFB740` · Danger `#EF4444`
- Tap targets enforced 44/48/52px in `Button.tsx` (sm/md/lg)
- Mobile-first: every page tested at 390px width
- `tap-shrink` class for press feedback, `safe-top`/`safe-bottom`/`pb-bottomnav` utilities
- Use `100dvh` not `100vh` (mobile browser bar)

## Git / Deploy strategy

- Repo: `https://github.com/emerilansel-jpg/peta.git` (initialised, live)
- `main` branch → `penghasilantambahan.com` (Vercel auto-deploy)
- `staging` branch → `staging.penghasilantambahan.com` (or use Vercel auto preview)
- **Always** apply migrations on staging (`duxzxizedtvnopfihllz`) first, test, then on prod (`yorlsgzsawchpeeazcvi`)
- Migrations applied via Supabase MCP `apply_migration` (NOT CLI)
- GSC verified via Spaceship DNS TXT (Domain property)

See `DEPLOYMENT.md` for the full step-by-step.

## SEO / discoverability

- `peta/index.html` — JSON-LD: Organization, WebSite, Service, FAQPage; OG meta → `/og.png` 1200x1200
- `peta/public/robots.txt` — allows public, blocks `/login`, `/register`, `/onboarding`, `/account`, `/earnings`, `/admin/*`
- `peta/public/sitemap.xml` — `/`, `/login`, `/register`
- Target keyword: "Penghasilan Tambahan"
- GSC TXT record at Spaceship: `google-site-verification=gDJrr2dY9Dzmxp0A1uUgBrQ7-JkUM-a2FaV4_w6cvro`

## Behavior rules learned from user

- User wants **no fake data**. If unsure, show empty state honestly, not pretend numbers.
- User prefers **CRO/copywriting** in Bahasa Indonesia gaul tone — not formal corporate.
- Public-facing pages must NOT mention Reddit by name (re-platform-able).
- Don't introduce new dependencies if a CSS-only solution works (confetti).
- The Tasks page is intentionally a "coming soon" — don't restore the real task list there until told.
