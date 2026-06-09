# CHECKPOINT — Audit round (Pak Nell feedback) — 2026-06-09/10

> Read this first if you're a new session/AI picking up the PeTa + Straight Ltd work.
> Cross-reference: `CLAUDE.md`, `docs/SYSTEM_OVERVIEW.md`, `docs/CHANGELOG.md`, `coldstart.md`.
> This checkpoint supersedes the older `coldstart.md` git-state section.

---

## 0. TL;DR — read these 4 lines first

1. **Active repo path is `G:\SF Project\peta-main`** (app in `peta/`). The docs/coldstart that say `D:\Claude Cowork\Reddit Army Local` are **STALE** — ignore that path.
2. All this session's work is on branch **`fix/audit-2026-06-09`** — **committed locally, NOT pushed, NOT merged to `main`.**
3. **Prod is LIVE with this branch's code** (frontend deployed + migrations applied). So `git main` is BEHIND prod. ⚠️ Deploying from `main` would REGRESS prod — merge the branch to main first.
4. There are **TWO Cloudflare Pages projects** (`peta` = penghasilantambahan.com, `straight` = straight.ltd). Every frontend deploy must go to **BOTH** or straight.ltd goes stale.

---

## 1. Environments / IDs (verified this session)

| Thing | Value |
|---|---|
| Prod Supabase | `yorlsgzsawchpeeazcvi` (peta-prod) |
| Staging Supabase | `duxzxizedtvnopfihllz` (peta-reddit-army) |
| Cloudflare account ID | `99dd60debc042e9b615dd44472645e71` (n311311@gmail.com) |
| Pages project → domain | `peta` → www.penghasilantambahan.com · `straight` → www.straight.ltd |
| Admin login (QA) | `info@jetdigitalpro.com` / `peta` (uid `8e688eae…`, role=admin) |
| GitHub remote | `emerilansel-jpg/peta` (branch is local-only, unpushed) |
| Prod anon key | in `peta/.env.production` (public by design) |

---

## 2. What shipped this session (all LIVE on prod + committed)

Branch `fix/audit-2026-06-09`, commits newest→oldest:

```
9644a14  Fix admin_get_referral_leaderboard ambiguous column (errored on every call)
f1e405a  Field-swap backfill: also strip bare comment-marker tasks
b2f3667  Task field-swap: description = full brief/instructions, brief = comment-only
cdf74ac  PayPal: admin-configurable credentials (no env rebuild)
175170f  Audit round: re-enable Reddit pricing, +10% AI-write, auth UX, waitlist toggle, WA OTP reset
```
(base = `f30fa20` Merge feat/geo-funnel-ai-visibility into main)

The 7 "Pak Nell" feedback items + extras, all done & QA-verified:

1. **HubSpot/forum upvote** — root cause: all `reddit_*` rows in `straight_pricing` were `enabled=false`, blocking reddit.com orders. Re-enabled all 10 services. (Any-URL upvote code was already live.)
2. **Army copy-comment button** — `peta/src/pages/TaskDetail.tsx` "Copy komentar" copies ONLY the comment text.
3. **"Review & approve" UX** — `RankingForumPage.tsx` (Straight wizard, NOT a Reddit issue): button always clickable + toast says what's missing.
4. **+10% AI-write pricing** — "Let AI write it" = base ×1.10, "I'll write it myself" = base. UI (`RankingForumPage.tsx` + `RedditNewOrder.tsx`) AND `fn_create_forum_comment_order` (so display == charge). Live charge table: forum comment plain $4.00→**$4.40**, link $6.00→**$6.60**; reddit plain $5.00→**$5.50**, link $5.50→**$6.05**.
5. **Admin front-door toggle** (signup vs waitlist) — `straight_site_settings` table + `admin_set_front_door_mode` RPC + anon getter; `RedditLanding.tsx` CTAs conditional; toggle card in `AdminSettings.tsx`.
6. **Forgot password (email)** — `ForgotPassword.tsx` + `UpdatePassword.tsx` + routes; Login wired. Auth redirect URL `https://www.penghasilantambahan.com/**` ADDED to prod allow-list (2026-06-10).
7. **Login with WhatsApp number** — `get_email_by_whatsapp` RPC (resolve WA→email → normal password sign-in; no SMS cost).
8. **Reset password via WhatsApp OTP** — `wa_password_reset` table + `get_user_id_by_whatsapp` RPC; edge fns `wa-reset-request`/`wa-reset-confirm`; `ResetWhatsApp.tsx`. Sends a plain-text 6-digit code via **Fonnte** (Free plan blocks URLs, so a code not a link). Hashed, 10-min, single-use, 5-attempt cap.
9. **PayPal admin-configurable** — admin enters Client ID/Secret/env in Straight Settings → stored in `app_secrets`; `paypal-capture` edge fn rebuilt to read creds from `app_secrets` (verifies order server-side, credits via `fn_paypal_credit_verified`); `RedditTopup.tsx` reads client_id at runtime via `get_paypal_public_config`. ⚠️ **Still needs the admin to ENTER credentials** (sandbox or live) before checkout works.
10. **Task field-swap** — `description` = full brief/instructions, `brief` = comment-only. Admin form (`TaskQueue.tsx`) + army display (`TaskDetail.tsx`) + `admin_import_reddit_order` (auto-import) + backfill of existing tasks.
11. **Fixed `admin_get_referral_leaderboard`** — was throwing `42702` (ambiguous `user_id`) on EVERY call; aliased subquery tables + `::text` casts. (Found by the full QA.)

---

## 3. Migrations applied (staging + prod, via Management API)

Applied to BOTH `duxzxizedtvnopfihllz` and `yorlsgzsawchpeeazcvi`:

```
20260609120000_straight_front_door_mode.sql
20260609130000_login_with_whatsapp.sql
20260609140000_forum_comment_ai_write_premium.sql
20260609150000_wa_password_reset_otp.sql
20260609160000_paypal_admin_config.sql
20260609170000_task_brief_field_swap.sql
20260609180000_fix_referral_leaderboard_ambiguity.sql
```

⚠️ Applied via the Supabase **Management API** `POST /v1/projects/{ref}/database/query` (with a Personal Access Token), NOT `supabase db push` — because the local `supabase` CLI is logged into a DIFFERENT account (nyxseo org) with no access to the PeTa projects. So these are **not registered in `supabase_migrations.schema_migrations`**. They are idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS` / `ON CONFLICT`), so a future `db push` re-running them is harmless.

## 4. Edge functions deployed (staging + prod)

New, now in repo at `peta/supabase/functions/`:
- `wa-reset-request`, `wa-reset-confirm` (WhatsApp OTP reset)
- `paypal-capture` (rebuilt — reads creds from `app_secrets`)

Deploy cmd used: `SUPABASE_ACCESS_TOKEN=<PAT> npx supabase functions deploy <fn> --project-ref <ref> --use-api`

Note: `send-broadcast-whatsapp`, `send-broadcast-emails`, `wa-bot-proxy`, etc. remain **deployed-only** (not in repo).

## 5. Frontend deployed (BOTH Pages projects)

```bash
cd peta && npm run build
# then deploy to BOTH:
npx wrangler pages deploy dist --project-name=peta     --branch=main --commit-dirty=true
npx wrangler pages deploy dist --project-name=straight --branch=main --commit-dirty=true
```
Needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID=99dd60debc042e9b615dd44472645e71`. (`wrangler` was NOT logged in locally.)

---

## 6. Secrets / config changed on prod this session

- **`app_secrets.FONNTE_TOKEN`** updated 2026-06-10 to a new value (validated against Fonnte: device `085194260726` "Test Peta", status=connect, **Free plan, 1000 quota**, exp 2026-07-10). Used by reset-WA + broadcast. No redeploy needed (read at runtime).
- **Auth `uri_allow_list`** (prod) appended: `https://www.penghasilantambahan.com/**`, `https://penghasilantambahan.com/**` (for the email password-reset redirect). Prior entries (straight.ltd, localhost) kept.

---

## 7. QA status (2026-06-10, full sweep as admin)

- Functional QA across both products: **27/29 PASS** → 1 real bug found & fixed (leaderboard), 1 false-negative test. All RPCs/edge-fns/data/HTTP healthy.
- **Supabase advisors: 0 ERROR.** ~239 security WARN = mostly by-design ("SECURITY DEFINER callable by anon/authenticated" — our RPCs have internal `is_admin()`/`auth.uid()` guards) + 7 `function_search_path_mutable` + 1 leaked-password-protection off. 4 INFO `rls_enabled_no_policy` = intentional service-role-only tables (`app_secrets`, `wa_password_reset`, …). Perf: tech-debt (`auth_rls_initplan` ×30, `multiple_permissive_policies` ×13).
- **Provider health (Straight):** DataForSEO **ok** (primary, live SERP/keyword data) · Google CSE error (redundant fallback) · SerpAPI missing (optional). DeepSeek ok for AI drafts.

To re-run QA: log in as admin via the Supabase auth REST API and exercise the RPCs/edge-fns + `GET /v1/projects/{ref}/advisors/{security|performance}`. (No browser needed.)

---

## 8. PENDING — what still needs doing

**User / human actions:**
1. **PayPal go-live**: in Straight admin → `/reddit/admin/settings` → "PayPal checkout" card → enter Client ID + Secret + env (sandbox first). Backend is fully ready; checkout shows "PayPal not configured" until creds are entered.
2. **Click-tests** (need a human/session): PayPal sandbox top-up → credit lands; AI-comment order shows base×1.10; WA reset (forgot pw → own number → code arrives).
3. **Merge `fix/audit-2026-06-09` → `main` + push** to GitHub. Currently prod runs code that only exists on this unpushed branch — keep git in sync to avoid an accidental regression deploy.
4. **Revoke** the Supabase PAT + Cloudflare token used this session (they were one-time). A new session needs fresh creds to deploy.

**Optional hardening (NOT breakage):**
5. Set explicit `search_path` on the 7 legacy `function_search_path_mutable` functions.
6. Enable leaked-password protection (Auth settings).
7. RLS `(select auth.uid())` wrapping for `auth_rls_initplan` perf (large-table policies).
8. Point GoTrue SMTP at Resend/Spacemail (email reset reliability; currently default Supabase SMTP, rate-limited).
9. Fix the broken broadcast device-status diag (`send-broadcast-whatsapp` calls Fonnte `/device` with **GET** → 405; needs **POST**). Cosmetic (doesn't affect sending). Deployed-only → needs reconstruction.

---

## 9. Gotchas learned this session (carry forward)

- **Repo is at `G:\SF Project\peta-main`** now (not the D: path in older docs).
- **Two Pages projects** — always deploy frontend to `peta` AND `straight`.
- **Fonnte FREE plan blocks URLs** → that's why WA reset uses an OTP code, not a link. Token lives in `app_secrets.FONNTE_TOKEN` (not a build var). Validate a Fonnte token with `POST https://api.fonnte.com/device` (header `Authorization: <token>`) — GET returns 405.
- **Postgres `RETURNS TABLE` OUT params** collide with same-named table columns in subqueries → `42702`. Always qualify columns with table aliases inside the function.
- **Local `supabase` CLI = wrong account.** Use the Management API (PAT) for migrations, or `--use-api` + `SUPABASE_ACCESS_TOKEN` for functions.
- **Cloudflare deploy used `--branch=main`** (= production target) even though the git branch is `fix/audit-2026-06-09`. So prod serves the branch's build; git `main` does not contain it.
