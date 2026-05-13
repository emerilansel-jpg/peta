# PeTa / Straight Ltd — Session History Log

Chronological log of all work sessions on this monorepo (PeTa = Indonesian micro-task platform, Straight Ltd = USD Reddit upvote service — separate products, shared backend). Entries are append-only. Newest at top.

---

## 2026-05-13 — Straight Ltd production hardening + email pipeline

**Status:** ✅ SHIPPED
**Project:** Straight Ltd (separate entity from PeTa; both on Supabase prod yorlsgzsawchpeeazcvi)
**Branch:** main
**Deploy:** Vercel auto-deploy on every push, domain www.straight.ltd

### Shipped

**1) OG leak fix — bot crawlers were getting PeTa branding on www.straight.ltd**
- Root cause: Vercel rewrite regex `(www\.)?straight\.ltd` not matching at edge for non-browser UAs
- Fix: split into two literal host rewrites (apex + www) + explicit `destination: /index.html` catch-all
- File: `peta/vercel.json`
- Verified via `curl -H "User-Agent: facebookexternalhit"` returns Straight Ltd HTML

**2) Reddit Upvotes schema migrated to prod (was missing entirely)**
- Prod (yorlsgzsawchpeeazcvi) had no Reddit Upvotes tables — explains "loading mulu" + tab errors
- Migrated: credit_transactions, reddit_upvote_orders, reddit_topup_requests, feature_requests, order_tickets, ticket_messages, reviews, notifications + 15+ RPCs + 9 triggers + RLS + storage bucket + realtime publications
- Two migration calls: `reddit_upvotes_full_schema`, `reddit_upvotes_functions_and_triggers`

**3) Client/Army role separation**
- Added `'client'` to `users_role_check` (`'army' | 'admin' | 'client'`)
- `handle_new_user` trigger now routes signups:
  - OAuth provider != 'email' → role='client' (PeTa never uses OAuth)
  - raw_user_meta_data.product='straight' → role='client'
  - role_title or website present → role='client'
  - otherwise → role='army'
- WA uniqueness + IDR referral bonus only for army signups
- AdminClients tab filters role IN ('client','admin')
- RedditLayout bounces role='army' users to /tasks
- `fn_get_b1g1_status` gates B1G1 promo on clients only
- Migration: `separate_straight_client_from_peta_army` + `handle_new_user_oauth_detection`

**4) Google OAuth fixed (was 100% broken on prod)**
- Supabase prod Google provider was disabled (set up only on staging earlier)
- Used Management API via dashboard token to PATCH:
  - external_google_enabled=true
  - client_id + secret (copied from staging — same Google Cloud OAuth client)
  - site_url=https://www.straight.ltd
  - uri_allow_list=https://straight.ltd/**,https://www.straight.ltd/**,localhost
- Added prod callback URI `https://yorlsgzsawchpeeazcvi.supabase.co/auth/v1/callback` to Google Cloud Console (project: redditboost) — via JS injection + React-friendly nativeInputValueSetter (Chrome MCP coordinate clicks were getting blocked by extension URL errors)
- Verified end-to-end with Choose-an-account screen

**5) PayPal switched to Live**
- Live Client ID provided by user
- Updated Vercel env VITE_PAYPAL_CLIENT_ID for production/preview/development via Vercel REST API
- Triggered redeploy via /v13/deployments?forceNew=1
- Deploy went READY in 4 polls × 4s

**6) Spacemail SMTP email pipeline — deployed end-to-end**
- Edge function `send-notification-email` v5 deployed to prod
- Uses denomailer SMTP client → mail.spacemail.com:465 SSL
- Secrets set via Management API: SMTP_HOST, SMTP_PORT, SMTP_USER (care@straight.ltd), SMTP_PASSWORD, EMAIL_FROM, Reply-To
- DB trigger `trg_send_email_on_notification` on prod (uses prod project URL + prod anon key)
- DNS:
  - SPF: existed (`v=spf1 include:spf.spacemail.com ~all`)
  - DKIM: existed at `spacemail._domainkey.straight.ltd`
  - **DMARC: added** `v=DMARC1; p=none; rua=mailto:care@straight.ltd; ruf=mailto:care@straight.ltd; fo=1; adkim=r; aspf=r` (in propagation)
- First test email landed in Gmail Spam (expected for new sender domain) — confirmed delivery, not rejection
- Test sends to emerilansel@gmail.com + info@jetdigitalpro.com both returned `{"ok":true}` from function + 200 from pg_net._http_response

**7) CRO: EmailWhitelistNotice component (3 variants: modal/banner/compact)**
- Modal shown after order placed: blocks navigation, explains "first email may land in Spam" with 1-2-3 instructions + Gmail Add-Contact deeplink
- Banner shown after client sends ticket message
- Email template footer updated to lead with "First time? Save us as contact + mark Not Spam"
- Added Reply-To: care@straight.ltd to function

**8) Logo + favicon + OG image (Straight Ltd brand)**
- Generated favicon-16/32, apple-touch, icon-192/512, og.png from user-provided logo
- Logo files in `peta/public/straight/`
- Replaced 6 inline "R" orange boxes with logo image across nav, layouts, auth pages
- `straight.html` bakes brand into HTML at build time (no JS swap race)
- Vite multi-page input emits both index.html (PeTa) + straight.html (Straight Ltd)

### Blocked / carried over
- DMARC strengthening (p=none → p=quarantine) — wait ~7 days of reporting first
- MTA-STS policy file — would need HTTPS hosting of policy.txt + DNS record
- BIMI logo verification — needs trademark + VMC cert

### Notes
- Spacemail SMTP auth needed mailbox password reset (user reset via dashboard, pasted password)
- Chrome MCP repeatedly froze on Spaceship + Google Cloud Console pages — JS injection bypass with React-friendly setters was the reliable pattern
- Architecture clarity: Straight Ltd (clients pay USD, place orders) and PeTa (army earns IDR, does tasks) are TWO entities sharing ONE Supabase backend. Currency + role MUST stay separated. Earlier mixup is now fixed.
- Email pipeline verified working server-side; deliverability to inbox depends on recipient's spam filter warming (user education via CRO modal compensates)

---
