# PeTa / Straight Ltd — Changelog

Reverse-chronological. Most recent first. Each entry lists what shipped, why, and any gotcha worth carrying forward.

---

## 2026-06-09 — Audit round: pricing fix, auth UX, +10% AI, waitlist toggle, WA reset

Branch `fix/audit-2026-06-09` (worked from `G:\SF Project\peta-main` — note the repo moved off the old `D:\Claude Cowork\Reddit Army Local` path the docs reference).

**Shipped (live now):**
- **Re-enabled all `reddit_*` rows in `straight_pricing` on prod** — they had been left `enabled=false` (only `forum_*` on), so any reddit.com order was silently blocked. Done via `admin_set_straight_pricing` RPC over REST (prices kept at seed values).

**Built on the branch (compiles; pending prod deploy + migration apply):**
- **Army copy-comment button** (`TaskDetail.tsx`) — copies ONLY the comment text, not the Indonesian instructions.
- **Straight "Review & approve" UX** (`RankingForumPage.tsx`) — button no longer disabled-with-no-reason; it's always clickable and toasts exactly what's missing (it was never a Reddit issue).
- **+10% AI-write pricing** — "Let AI write it" = base comment price ×1.10, "I'll write it myself" = base (client writes their own per-page comment). Mirrored in UI (`RankingForumPage.tsx` + `RedditNewOrder.tsx`) AND `fn_create_forum_comment_order` so display == charge. Migration `20260609140000`.
- **Admin front-door toggle** (signup vs waitlist) — new `straight_site_settings` singleton (anon-readable) + `admin_set_front_door_mode` RPC; `RedditLanding` CTAs conditional; toggle card in `AdminSettings`. Migration `20260609120000`.
- **Forgot password (email)** — `ForgotPassword.tsx` + `UpdatePassword.tsx` + routes; Login "Lupa password?" now navigates instead of a fake toast. Needs Auth redirect-URL allowlist + SMTP.
- **Login with WhatsApp number** — `get_email_by_whatsapp` RPC (resolve → normal password sign-in, no SMS cost). Migration `20260609130000`.
- **Password reset via WhatsApp OTP (Fonnte free)** — plain-text 6-digit code (no URL, so it passes Fonnte's free-plan link block). Table `wa_password_reset` + `get_user_id_by_whatsapp` (migration `20260609150000`); edge fns `wa-reset-request` / `wa-reset-confirm`; `ResetWhatsApp.tsx`. Hashed, 10-min, single-use, 5-attempt cap, 45s cooldown.
- **PayPal (#8) prep** — frontend is complete; documented `VITE_PAYPAL_CLIENT_ID` in `.env.example`/`.env.production`. Still needs LIVE client id + live `PAYPAL_CLIENT_ID/SECRET` secrets + confirm `paypal-capture` edge fn deployed (it's deployed-only, not in repo).

**Gotchas:**
- `wrangler` isn't logged in and the `supabase` CLI here is signed into a different org (no access to the PeTa projects), so deploy + migration apply must be done with the owner's auth.
- `fn_create_forum_comment_order` lives in two migrations now (`20260605090000` then `20260609140000`); the latter adds the +10% AI premium — apply in order.
- Fonnte FREE strips/blocks URLs ("invalid message request on free package"), which is why password reset uses an OTP code, not a link.

---

## 2026-05-21 — WhatsApp Verifier Bot end-to-end

**Shipped:**
- Contabo VPS bootstrap (`46.250.239.138`, Ubuntu 24.04, Docker + UFW + fail2ban)
- Docker compose stack: N8N + Evolution API + Postgres + Redis + Caddy
- Migration `20260521100000_wa_group_verified_and_claim_rpc`:
  - `users.wa_group_verified` + `wa_group_verified_at` columns
  - `normalize_wa_phone(text)` IMMUTABLE helper
  - `claim_wa_group_by_phone(phone, webhook_secret)` SECURITY DEFINER, idempotent, Rp5K credit
  - `admin_list_wa_unverified()` for admin UI
- Edge function `wa-bot-proxy` — JWT + admin role check, hides Evolution API key, proxies status/qr/create/restart/disconnect/set_webhook/set_group_jid/list_groups/get_config
- Admin UI `/admin/wa-bot` (Layout sidebar nav added)
- N8N workflow template `peta/docs/n8n-wa-verifier-workflow.json` (6 nodes)
- Setup guide `docs/WA_BOT_SETUP.md`

**Why:** User wanted: "setiap army ketik 'peta' di grup WA → otomatis dapat Rp5.000". Phase 1 (manual DM unverified army) + Phase 2 (auto verifier).

**Gotchas:**
- Let's Encrypt rate-limited sslip.io domain (250K certs/week shared). Caddy uses `tls internal` (self-signed) for browser-facing endpoints. **Browser will show "Not secure" warning** — accept once, fine for admin tool.
- Supabase Edge Functions can't talk to self-signed certs. Fix: expose Evolution on HTTP port 8080 directly (`http://46.250.239.138:8080`). API key authenticates the calls. UFW allows 8080.
- N8N volume needs `chown -R 1000:1000 /opt/peta-bot/data/n8n` (container runs as uid 1000).
- WhatsApp Web ban risk: use burner SIM, low msg volume, only confirm-DM reply pattern.

**Cost:** ~Rp 125K/mo (VPS + burner SIM). Break-even at 25 verifications.

---

## 2026-05-20 — Major outage day, then bonus rules redesign + audit log

### Morning: payout rules overhaul (post double-count discovery)
- New payout rule decreed by user: "saldo dari task bisa dicairkan kapan saja, TIDAK ADA BATAS minimum". Bonus (signup + referral) still locked behind Rp100K task floor.
- Migration `20260520070626_payout_task_immediate_bonus_floor_100k` — rewrote `validate_payout_eligibility` with split task vs bonus buckets.
- Migration `20260520090832_payout_eligibility_include_milestone_credits` — generalized `manual_adj` into `other_credits` so `karma_milestone` (and future cashable sources) counts toward cashable pool. Explicit exclusion of `task_reward` (trigger mirror — double count if included).
- Migration `20260520120000_payout_no_minimum` — removed `IF p_amount < 150000` check in `request_payout`.
- Client `getTotalEarnings` split bonus into `signupBonus` + `referralBonus` for Rincian display. Skip `task_reward` source.

### Afternoon: Earnings hero UX (3 iterations)
1. First pass: Rincian Saldo card + locked bonus indicator + CTA → /tasks
2. Second pass: split "Bonus signup + referral" into two rows. Invalidate `['earnings']` query after payout.
3. Third pass: no-min hero with "💰 Tarik Semua" preset, "✅ No minimum" footer, custom input min=1.

### Afternoon: Approval Queue empty bug — 7 turns to root cause
- Symptom: 2 submitted assignments in DB, but admin Approval Queue rendered "Inbox zero!"
- Investigated: PostgREST embed → RLS → JWT → varchar cast errors → schema cache
- ROOT CAUSE: `.env.local` (staging) was being baked into `npm run build`, so PROD URL `www.penghasilantambahan.com` served staging Supabase. **All UI calls hit staging DB.** Spent 6 turns chasing ghost bugs.
- Diagnostic banner (`admin_session_debug` RPC) finally surfaced auth.uid mismatch (staging user id on prod URL).
- Fix:
  - Renamed `peta/.env.local` → `peta/.env.development.local` (Vite only loads in dev mode)
  - Added `peta/.env.production` (committed, prod URL + anon key)
  - `.gitignore` whitelist `!.env.production`
  - `.env.example` rewritten with history note
- Side fixes shipped along the way (kept, all real bugs):
  - `admin_pending_approvals()` SECURITY DEFINER RPC + flat-row shape
  - Explicit `::text` casts in RETURNS TABLE (varchar→text)
  - Session diagnostic banner (`admin_session_debug` RPC)

### Late afternoon: Audit log
- Migration `20260520100000_audit_log_critical_tables` — `audit_log` table + trigger function `tg_audit_log` attached to tasks, payouts, user_credits, reddit_upvote_orders, reddit_accounts, task_assignments.
- Every INSERT/UPDATE/DELETE captures old/new jsonb + actor_id + timestamp.
- Admin RPC `admin_recent_audit(table, limit, action)` for inspection.
- JSON snapshot of all critical tables saved to `backups/2026-05-20_snapshot_audit.md`.
- Recommended: upgrade Supabase to Pro for PITR. Free tier = no granular restore.

### Other: Task cleanup
- Deleted 2 admin test orders + linked tasks from prod (Order 1 + 3 + tasks b92af786 + 63ffee71 + 9 assignments). Audit log captured.
- Replicated real Columbus task to staging for parity.

**Key lessons:**
- ALWAYS check bundle env target (`.env.*`) when "deployed but unchanged" symptom shows up.
- PostgREST embeds can silently return [] under RLS/auth issues. Prefer SECURITY DEFINER RPCs with explicit guards.
- Postgres won't auto-cast varchar→text in RETURNS TABLE. Always `::text`.
- Diagnostic banners (visible session state) > guessing root cause. Ship them DAY 1.

---

## 2026-05-18 — Cloudflare migration + Resend + crisis fixes

- Vercel → Cloudflare Pages (Vercel Hobby tier hit edge-request limit)
- `penghasilantambahan.com` + `straight.ltd` both on Pages via host-aware middleware
- Email blast: Spacemail → **Resend** primary (Spacemail kept as fallback). Custom domain verified.
- pg_cron retry job for stuck WA pending
- 8 critical bugs fixed:
  - admin preview bypass on tasks (admin without Reddit acct sees all active)
  - inbox messages invisible (PL/pgSQL ambiguous id)
  - per_account_limit not enforced at DB level (`enforce_per_account_limit_and_approval_payout`)
  - approval didn't pay credits (added `tg_on_assignment_approved` trigger)
  - order qty drift (auto-sync delivered_upvotes)
  - "Straight Ltd" footprint leak in army task descriptions (`scrub_straight_footprint_from_auto_import`)
  - 2-button broadcast confusion (unified)
  - email signature leak

- CRO/UX wins: 4× bonus framing, WARP reminder pre-Step-1, real screenshot in TaskDetail, breakdown chips, 3-layer blast indicators
- Fonnte Lite hit WA restriction after 60-msg burst → researched alternatives (Evolution API chosen later for verifier)
- Security audit: closed 4 RLS holes (referral_clicks `WITH CHECK true` regression + 2 overpermissive storage LIST policies + 1 mutable search_path). 131 → 127 lints.

---

## 2026-05-13 — Admin buildout + broadcast + task system + 1-Reddit-per-user

- Task queue 3-category (reddit_upvote, reddit_comment, reddit_post_thread)
- Broadcast: email + WhatsApp via Fonnte
- 1 Reddit account per user (`UNIQUE(user_id)` constraint)
- Reddit health monitoring (status_flag flag + dedup)
- Screenshot proof upload
- `app_secrets` DB-backed credentials (Fonnte token, etc.)
- Karma milestone bonus
- Fixed: missing RPC, wrong WA column, SMTP placeholder password, test flow didn't hit Fonnte

---

## 2026-05-12 — Reddit Upvotes (Straight Ltd) schema + Google OAuth

- Reddit Upvotes order flow (full schema + auto-import to PeTa tasks)
- Google OAuth working (handle_new_user trigger detects oauth provider, sets role appropriately)
- PayPal switched to Live
- Spacemail SMTP pipeline (DKIM+SPF+DMARC)
- Separate Straight client from PeTa army (`role` column added)
- EmailWhitelistNotice modal for spam-folder education
- Brand assets generated + wired

---

## 2026-05-08/09 — CRO redesign + brand + security + analytics + payout floor (v1)

- Tasks page redesign (referral hero + karma + streak + WA)
- Brand refresh (Founding 100, no fake data, white-pill logo, sharp-generated assets)
- Multi-platform SocialShare
- SEO + GSC DNS verification
- Tier 1 anti-fraud: phone unique + 7-day holding + 5 approved tasks + Rp500K weekly cap + friendly WA conflict
- Referral click analytics (army card + admin leaderboard)
- **Rp150K earnings floor** (task + signup_bonus before referral payout) — superseded 2026-05-20 with no-min rule + Rp100K bonus unlock floor
- Reddit karma honor-system pivot (Reddit blocks data-center IPs)

---

## 2026-05-05 to 07 — Initial schema + RLS + onboarding bonuses + admin RPCs

Foundation laid:
- Auth (Supabase) + RLS pattern (`is_admin()` SECURITY DEFINER bypass)
- Onboarding 6-step flow with confetti + bonuses (Rp50K total)
- Karma level system (0–5: Pemula → Legend)
- Admin RPCs (create/update/delete member)
- Referral codes (auto-gen 8-char hex)
- WA group dismiss preference
- Karma claim pending (admin review queue)
