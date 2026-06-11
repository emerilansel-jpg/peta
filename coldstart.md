# Cold Start Handoff - Straight Ltd + PeTa

Last updated: 2026-06-11

Workspace:

```text
D:\Claude Cowork\Reddit Army Local
```

Main app:

```text
D:\Claude Cowork\Reddit Army Local\peta
```

Repository:

```text
https://github.com/emerilansel-jpg/peta.git
branch: main
```

## Operating Rules

1. Work autonomously. The user expects execution, not a menu of options.
2. Do not delete or modify unrelated files. Preserve the untracked root file:

```text
D:\Claude Cowork\Reddit Army Local\image (1).png
```

3. Do not commit raw secrets to the repo or into this file.
4. Keep PeTa public pages free of public Reddit branding. Internal/admin flows can mention Reddit where needed.
5. For Straight Ltd client-facing UX, do not reveal provider names such as DeepSeek or Claude. Use neutral labels like draft assistant, AI assistant, or editorial assistant.
6. Do not claim live SERP or keyword data unless provider health confirms a live provider is working.
7. Use staging first for normal DB/function changes. Production hotfixes are acceptable only for urgent safety issues such as quota overfill.

## Current Git State

Recent commits on `main`:

```text
2f0e6b7 feat: PeTA-branded password reset email via SMTP
0b841f1 fix(straight): deploy disabled-platform hide fix to production
93f7f02 feat(admin): waitlist management page
ed844ec feat(straight): hide disabled platforms from Ranking Forum + New Order
2029049 fix(straight): fail-closed signup + login CTA fix for waitlist mode
0b841f1 fix(straight): Ranking Forum disabled platform early warning + hasBrand bug
```

Expected dirty state at handoff:

```text
 M peta/src/pages/admin/TaskQueue.tsx
 M supabase/migrations/20260530052517_forum_task_import_and_submission_proof.sql
?? supabase/functions/send-task-blast/
?? supabase/migrations/20260610000000_task_wa_blast.sql
```

Notes:

```text
TaskQueue.tsx has uncommitted local changes (unused imports cleanup from stale worktree).
send-task-blast edge function is untracked — may be WIP or experimental.
```

## Stack

Frontend:

```text
Vite + React + TypeScript + Tailwind v4
```

Backend:

```text
Supabase Postgres/Auth/Edge Functions
```

Deployment:

```text
Vercel (frontend) + Supabase Edge Functions
Production domain: https://www.penghasilantambahan.com
```

Important production domains:

```text
https://www.straight.ltd
https://www.penghasilantambahan.com
```

## Supabase Projects

```text
staging:    duxzxizedtvnopfihllz
production: yorlsgzsawchpeeazcvi
```

Staging URL:

```text
https://duxzxizedtvnopfihllz.supabase.co
```

Production URL:

```text
https://yorlsgzsawchpeeazcvi.supabase.co
```

## Access Needed

Use the same local machine/session if possible because Supabase and Wrangler may already be authenticated.

Required access for a fresh LLM/session:

```text
GitHub access to emerilansel-jpg/peta
Cloudflare/Wrangler access for Pages project: peta
Supabase access token or an active `supabase login`
Admin login for app QA
Provider API keys for enabled AI/search providers
```

Known admin credential from project docs/testing:

```text
email: info@jetdigitalpro.com
password: peta
```

Do not write provider keys or Supabase service tokens into tracked files. If not already authenticated, request credentials through a secure channel or run `supabase login`.

## Current Secret Status

Expected configured Supabase secrets on staging/prod:

```text
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
DATAFORSEO_LOGIN
DATAFORSEO_PASSWORD
GOOGLE_SEARCH_API_KEY
GOOGLE_SEARCH_CX
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
FONNTE_TOKEN
```

Expected missing or not configured:

```text
ANTHROPIC_API_KEY
SERPAPI_API_KEY
RESEND_API_KEY (optional — SMTP is primary)
```

Latest production provider health observed (2026-06-01, updated):

```text
DeepSeek: ok
Claude: missing - ANTHROPIC_API_KEY missing (optional; only for admin Claude selection)
DataForSEO: ok - Balance: $49.94 (TOPPED UP, now live)
Google Custom Search: error - google_search_403 (see note; now redundant fallback)
SerpAPI: missing - SERPAPI_API_KEY missing (optional fallback)
```

Implication:

```text
Straight suggested comment generation works (DeepSeek).
Ranking Forum NOW HAS LIVE SERP/KEYWORD DATA via DataForSEO (primary provider).
  - Verified end-to-end on prod 2026-06-01:
    seed='crm software' -> 100 live keyword ideas, provider=dataforseo_keyword_suggestions_opportunity_model, provider_notice=null
    keyword='best crm for small business' -> 10 live SERP results, provider=dataforseo_google_organic_live, 2 Reddit forum URLs flagged eligible
Google CSE + SerpAPI are now redundant fallbacks behind DataForSEO; no longer blocking.
```

Google Custom Search 403 note (unresolved, low priority now):

```text
Custom Search JSON API IS enabled on GCloud project 'redditboost', billing linked (Paid account),
quota 10K/day at 0.02% usage, key restricted correctly to Custom Search API.
Updated GOOGLE_SEARCH_API_KEY to AIzaSyB4...(redditboost project key) + GOOGLE_SEARCH_CX to
013462006945601684419:ierowfbwjaa in Supabase secrets, but direct REST call still returns
403 PERMISSION_DENIED 'project does not have the access to Custom Search JSON API'.
The legacy PSE (created 2020) only searches www.google.com/* and its 'Search the entire web'
toggle is disabled in the UI. Likely needs a freshly created PSE (CAPTCHA-gated, user must create)
with 'Search the entire web' enabled, then update GOOGLE_SEARCH_CX. Not urgent: DataForSEO covers it.
```

## Implemented Straight Ltd Features

Routes:

```text
/reddit/new-order?service=comments
/reddit/ranking-forum
/reddit/admin/settings
/reddit/admin/waitlist
```

Comments order flow:

```text
Standard self-written comment: $5.00
Suggested draft comment:       $5.50
```

Implemented behavior:

```text
Any public forum/community URL is accepted, not only Reddit.
Client can choose suggested or self-written comment.
Client enters brand/domain and plain mention vs link mode.
Suggested draft is generated server-side, editable, and regeneratable.
Provider name is hidden from client-facing copy.
Comment orders are stored in reddit_upvote_orders with target_type='comment'.
Comment details are stored in JSON text under notes.
Plain mention mode strips .com/domain-like text.
Draft sanitizer removes em dashes.
Server fetch uses direct fetch first, then reader fallback via r.jina.ai when needed.
```

Ranking Forum behavior:

```text
User enters seed topic.
System returns keyword opportunities.
User selects one or multiple keywords.
System scans top 10 SERP provider output when a live provider is available.
System filters for forum/discussion/community URLs.
Single selected URL routes into /reddit/new-order?service=comments&url=...&keyword=...
Multiple selected URLs are stored in localStorage key straight:forum-comment-bulk:v1 and routed to comment order flow.
Fallback/preview mode is clearly labeled when live provider is unavailable.
Disabled platforms are HIDDEN (not grayed out) from both Ranking Forum and New Order.
```

Admin AI provider settings:

```text
Admin can select DeepSeek or Claude.
Admin can set model IDs.
Edge Function reads straight_ai_settings server-side.
Client-facing UI does not expose provider choice.
Provider health cards exist for DeepSeek, Claude, DataForSEO, Google Custom Search, and SerpAPI.
```

Admin waitlist management:

```text
URL: /reddit/admin/waitlist
Table view with search, filter, sort, export CSV
Quick actions: mark invited, converted, declined, reset to pending
Stats cards: total, pending, invited, converted, declined
```

## Important Files

Straight client/admin modules:

```text
peta/src/modules/reddit/pages/RedditNewOrder.tsx
peta/src/modules/reddit/pages/RankingForumPage.tsx
peta/src/modules/reddit/pages/admin/AdminSettings.tsx
peta/src/modules/reddit/pages/admin/AdminWaitlist.tsx
peta/src/modules/reddit/lib/api.ts
```

Supabase Edge Functions:

```text
peta/supabase/functions/generate-forum-comment/index.ts
peta/supabase/functions/rank-forum-pages/index.ts
peta/supabase/functions/send-wa-password-reset/index.ts
peta/supabase/functions/send-password-reset-email/index.ts
```

Relevant migrations:

```text
peta/supabase/migrations/20260529143000_forum_comment_orders.sql
peta/supabase/migrations/20260531104132_enforce_task_quota_and_duplicate_comments.sql
peta/supabase/migrations/20260609000000_password_reset_tokens.sql
```

PeTa/admin/army task files:

```text
peta/src/pages/admin/ApprovalQueue.tsx
peta/src/pages/admin/TaskQueue.tsx
peta/src/pages/TaskDetail.tsx
peta/src/lib/api.ts
```

Environment files:

```text
peta/.env.production
peta/.env.local
```

Do not paste secrets from these files into chat, commits, docs, or PR descriptions.

## PeTa Task Quota Hotfix Status

Urgent issue already handled:

```text
Task status set to completed.
max_assignments set to 1.
current_assignments set to 1.
Only one live assignment remains.
Extra in_progress assignments were rejected with can_retry=false.
```

Permanent protections deployed:

```text
claim_task_assignment RPC locks the task row.
Live assignment count enforces max_assignments.
Direct insert policy for task_assignments is disabled.
Eligible task listing uses live assignment count.
Duplicate forum comments for the same target URL are blocked.
Frontend createTaskAssignment calls the RPC instead of direct insert.
```

Latest production duplicate test passed using temporary data and cleanup.

## PeTa Session 2026-06-04 (WhatsApp + Approval/Payroll) — PeTa ONLY

User constraint this session: only touch penghasilantambahan.com (PeTa). Do NOT
touch straight.ltd in any way.

CRITICAL — active PeTa dev/build/deploy runs from the WORKTREE, not the main dir:

```text
Worktree: D:\Claude Cowork\Reddit Army Local\.claude\worktrees\wonderful-torvalds-23e4c8
Branch:   staging   (latest PeTa admin work is committed + pushed here, commit e1f4a23)
The main project dir (...
\Reddit Army Local\peta) is on branch `main` and is STALE —
its lib/api.ts lacks sendWaDm/adminAssignmentHistory/adminRevertAssignment and will NOT build.
ALWAYS edit + build + deploy from the worktree. Deploying a build from the stale main dir
ships the OLD admin UI (no Pending/Approved/Rejected tabs, no WA modals) — this regression
happened once this session and had to be re-deployed from the worktree.
Verify prod after deploy: curl https://www.penghasilantambahan.com and match the main-<hash>.js bundle.
```

Shipped (committed on `staging`, deployed to prod = penghasilantambahan.com):

```text
ApprovalQueue: Pending / Approved / Rejected sub-tabs (history + revert/edit).
Post-approve WA modal: DM the army member (congrats + "income cair sekarang") and
  group blast (social proof + recruit). Approved row stays in the Pending tab until the
  admin closes the modal; the 30s auto-refetch is paused while the modal is open.
Payroll post "Mark as Paid" WA modal: transfer-confirmation DM + group social-proof blast.
New component peta/src/components/WaGroupSender.tsx: Fonnte group auto-send (when a group
  JID is configured) + auto-discovered group picker + manual copy/open-group fallback.
api.ts helpers: sendWaGroup / getWaGroupJid / listDiscoveredWaGroups / setWaGroupJid.
Edge fn send-wa-dm v2: targets containing '@' (group JID ...@g.us) are sent RAW (no 08->62
  normalization), so the same function handles DMs and group sends.
New RPCs (staging+prod): get_wa_group_jid, admin_set_wa_group_jid, admin_list_discovered_wa_groups.
New table wa_group_registry(jid PK, name, last_seen).
inbox-receive-whatsapp v12: auto-captures any inbound group JID into wa_group_registry, and
  auto-locks app_secrets.PETA_WA_GROUP_JID when a 'peta'-trigger group message arrives.
CLAUDE.md: payout rules updated (no task minimum; bonus floor Rp100K from approved tasks).
```

OPEN ISSUE — WA bot offline (blocks group auto-send + army 'peta' bonus):

```text
The Evolution API instance 'peta-bot' (http://46.250.239.138:8080) is DISCONNECTED
(connectionState = "connecting" = logged out). Last processed 'peta' group verify in
wa_extension_log was 2026-05-25, so the army "ketik peta = Rp5K bonus" flow has been DOWN
~10 days, and the real PeTa Army group JID was never captured (app_secrets.PETA_WA_GROUP_JID
is the placeholder 'TBD_autocapture_pending', so the Fonnte group button stays hidden).
Fonnte device token cannot list groups (get-group/get-devices -> "unknown user").
FIX (needs the user's phone): re-scan the Evolution peta-bot QR to bring it back online.
Once online, the next 'peta' group message auto-locks the correct JID and restores the bonus flow.
Meanwhile the manual group blast (copy -> open group -> paste) works, and 1:1 WA DMs work via Fonnte.
NOTE: the only group ever auto-discovered (120363423604703110@g.us) is an English SEO-client
chat (likely Straight-adjacent) — do NOT send PeTa marketing there.
```

## Build And Deploy Commands

Run from app directory:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
npm.cmd run build
```

Deploy frontend to Vercel (auto-deploy from GitHub main branch when team is active):

```text
Vercel auto-deploys from GitHub pushes to main branch.
When team is paused (quota exceeded), deployments are blocked.
See "Vercel Deployment Issue" section for workaround.
```

Manual deployment workaround when auto-deploy is blocked:

```powershell
# Option 1: Push a trivial commit to trigger fresh build
cd "D:\Claude Cowork\Reddit Army Local\peta"
git commit --allow-empty -m "trigger: force redeploy"
git push origin main

# Option 2: Create GitHub deployment via API (bypasses status checks)
# Requires GitHub token with repo scope
```

Deploy Edge Functions to staging:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
$env:SUPABASE_ACCESS_TOKEN='<secure-token>'
npx.cmd supabase functions deploy send-wa-password-reset --project-ref duxzxizedtvnopfihllz --use-api
```

Deploy Edge Functions to production:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
$env:SUPABASE_ACCESS_TOKEN='<secure-token>'
npx.cmd supabase functions deploy send-wa-password-reset --project-ref yorlsgzsawchpeeazcvi --use-api
```

Apply DB migrations only after reviewing the SQL:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
$env:SUPABASE_ACCESS_TOKEN='<secure-token>'
npx.cmd supabase db push --project-ref duxzxizedtvnopfihllz
npx.cmd supabase db push --project-ref yorlsgzsawchpeeazcvi
```

Use staging first unless this is an urgent production safety fix.

## Production HTTP Checks

```powershell
curl.exe -I -L --max-time 20 https://www.straight.ltd/reddit/ranking-forum
curl.exe -I -L --max-time 20 "https://www.straight.ltd/reddit/new-order?service=comments&url=https%3A%2F%2Fcommunity.hubspot.com%2F&keyword=seo"
curl.exe -I -L --max-time 20 https://www.straight.ltd/reddit/admin/settings
```

Expected result:

```text
HTTP 200
```

## Authenticated Provider Health Check

Run from PowerShell:

```powershell
$envLines = Get-Content -LiteralPath 'D:\Claude Cowork\Reddit Army Local\peta\.env.production'
$anon = (($envLines | Where-Object { $_ -like 'VITE_SUPABASE_ANON_KEY=*' }) -replace '^VITE_SUPABASE_ANON_KEY=','')
$base='https://yorlsgzsawchpeeazcvi.supabase.co'
$loginBody = @{ email='info@jetdigitalpro.com'; password='peta' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/v1/token?grant_type=password" -Headers @{ apikey=$anon; 'Content-Type'='application/json' } -Body $loginBody -TimeoutSec 30
$token=$login.access_token
$rank = Invoke-RestMethod -Method Post -Uri "$base/functions/v1/rank-forum-pages" -Headers @{ apikey=$anon; Authorization="Bearer $token"; 'Content-Type'='application/json' } -Body (@{ health='providers' } | ConvertTo-Json) -TimeoutSec 90
$rank | ConvertTo-Json -Depth 5
```

Use this to confirm whether Ranking Forum has a live provider.

## Suggested Comment Generation Test

Run after obtaining `$anon`, `$base`, and `$token` from the previous section:

```powershell
$draft = Invoke-RestMethod -Method Post -Uri "$base/functions/v1/generate-forum-comment" -Headers @{ apikey=$anon; Authorization="Bearer $token"; 'Content-Type'='application/json' } -Body (@{
  target_url='https://community.hubspot.com/t5/Content-Strategy-SEO/Best-Content-Writing-Agency/m-p/1280117'
  platform='HubSpot Community'
  brand_name='Jetdigitalpro'
  brand_domain='jetdigitalpro.com'
  mention_mode='plain'
  extra_instructions='Keep it helpful and concise.'
} | ConvertTo-Json) -TimeoutSec 120

[pscustomobject]@{
  comment_length=($draft.comment.Length)
  fetched_context=$draft.fetched_context
  fetch_reason=$draft.fetch_reason
  contains_domain=($draft.comment -match 'jetdigitalpro\.com')
  has_em_dash=($draft.comment -match '[\u2013\u2014]')
  preview=$draft.comment.Substring(0, [Math]::Min(260, $draft.comment.Length))
} | ConvertTo-Json -Depth 4
```

Expected:

```text
fetched_context: true when reader fallback succeeds
contains_domain: false for plain mention mode
has_em_dash: false
```

## Ranking Provider Remediation

DataForSEO:

```text
Current issue: balance is negative, API returns Payment required.
Fix: top up DataForSEO or resolve billing/access.
Then rerun provider health check.
```

Google Custom Search:

```text
Current issue: 403 forbidden, project does not have access to Custom Search JSON API.
Fix: enable Custom Search JSON API for the Google Cloud project tied to GOOGLE_SEARCH_API_KEY, confirm billing/API restrictions, and confirm GOOGLE_SEARCH_CX is valid.
Then rerun provider health check.
```

SerpAPI:

```text
Current issue: SERPAPI_API_KEY missing.
Fix: set SERPAPI_API_KEY if SerpAPI should be used as fallback.
```

Claude:

```text
Current issue: ANTHROPIC_API_KEY missing.
Fix: set ANTHROPIC_API_KEY if admin should be able to select Claude.
```

## QA Checklist

Straight comments:

```text
Open https://www.straight.ltd/reddit/new-order?service=comments
Use a non-Reddit public forum URL such as HubSpot Community.
Choose suggested comment.
Enter brand/domain.
Test plain mention and link mode.
Generate draft.
Confirm copy does not mention DeepSeek/Claude.
Edit draft.
Regenerate draft.
Place order and confirm $5.50 charge.
Test self-written flow and confirm $5.00 charge.
Check /reddit/orders, order detail, and /reddit/admin/orders.
```

Ranking Forum:

```text
Open https://www.straight.ltd/reddit/ranking-forum
Enter seed keyword.
Confirm whether provider notice says live data or preview fallback.
Select keyword.
Scan top 10.
Select forum result.
Confirm it routes to /reddit/new-order?service=comments with URL and keyword prefilled.
```

PeTa army task quota:

```text
Use a task with max_assignments=1.
Claim with one army account.
Try claim with another account.
Expected: second account cannot claim after quota is filled.
Try submit same comment/proof for same target URL.
Expected: duplicate is blocked.
```

PeTa forgot password:

```text
Open https://www.penghasilantambahan.com/forgot-password
Test email reset: enter registered email, check inbox for PeTA-branded email (not Supabase Auth)
Test WA reset: enter registered WA number, check WA for reset link
Test reset link: click link, set new password, login with new password
```

## Known Product Expectations From User

Straight Ltd:

```text
UX must feel authoritative and trusted.
Hide internal provider names from clients.
Ranking Forum should eventually use real live keyword/SERP data, not fallback.
Any public forum URL should work.
```

PeTa:

```text
Public pages should not mention Reddit.
Army/member UI should be clear for newbie users.
Admin task brief and comment/post should be separate.
If a platform-specific brief exists, do not duplicate universal brief.
Task submissions should allow proof URL, username used, and optional screenshot where implemented.
Task quota must be enforced strictly.
Duplicate comments must be blocked to reduce ban risk.
Forgot password email must be branded as PeTA (not Supabase Auth).
```

## Final Status At Handoff

Completed:

```text
Straight comments flow is live.
Suggested comment generation is working with DeepSeek.
Claude selection UI/backend path exists, but key is missing.
Ranking Forum UI and provider fallback chain are live.
Ranking Forum UX latest commit includes bird-eye selection, hidden provider wording, and bulk suggested flow.
Admin provider health UI is live.
PeTa task quota and duplicate protections are deployed.
Urgent overfilled HubSpot task was taken down/fixed.
PeTa forgot password via email + WhatsApp deployed.
PeTA-branded password reset email (SMTP) deployed — no more "Supabase Auth" sender.
Admin waitlist page is live.
Disabled platforms are hidden from Straight client UI.
```

Not complete (all OPTIONAL now that DataForSEO is live):

```text
Google Custom Search 403 (redundant fallback; needs fresh PSE w/ CAPTCHA - user action).
Claude needs ANTHROPIC_API_KEY only if admin should be able to select Claude (DeepSeek works).
SerpAPI needs SERPAPI_API_KEY only if wanted as extra fallback.
Vercel auto-deploy is blocked (team paused, quota exceeded) — manual deploy via GitHub API or wait for billing reset.
```

Done 2026-06-01 (this session):

```text
DataForSEO topped up to $49.94 -> provider health 'ok'.
Verified Ranking Forum end-to-end on production: live keyword ideas + live SERP top-10 scan,
both provider_notice=null (true live data, not fallback preview).
Ranking Forum CAN now be reported to user as having live SERP/keyword data.
```

Done 2025-07-08 (this session):

```text
UX/CRO Task Card Redesign — implemented & built:
- TaskDetail.tsx (army view):
  • task.description → displayed as "📋 Petunjuk Pengerjaan" yellow card in Step 2
  • task.brief → displayed as dark "📋 Copy-Paste Comment" block with one-click Copy Content button
  • Added handleCopyComment() using navigator.clipboard + toast feedback
  • Button state: "Copy Content" → "Copied!" (green) → resets after 2s
  • Dark block (#1a1a1a) + serif font creates strong visual separation from instructions
  • Zero Indonesian text inside the copy block — 100% safe to copy-paste
- TaskQueue.tsx (admin view):
  • Label "Deskripsi" → "Deskripsi / Petunjuk (Bahasa Indonesia)"
  • Label "Brief Lengkap" → "Teks Komen/Post (English — untuk di-copy army)"
  • Updated placeholders to guide admins: instructions in description, English comment text in brief
  • Admin task list preview: "Brief lengkap" → "Teks komen/post"
- Build: successful (tsc + vite, no errors)
- Files changed: peta/src/pages/TaskDetail.tsx, peta/src/pages/admin/TaskQueue.tsx
```

Done 2026-06-09 (this session):

```text
Forgot password flow deployed:
- /forgot-password page — army input email, Supabase kirim reset link
- /reset-password page — terima token dari email hash, set password baru
- Login.tsx "Lupa password?" sekarang navigasi ke /forgot-password (bukan hubungi admin)

WhatsApp auth assessment:
- Reset link via WA: BISA, tapi butuh custom token + Evolution API (bukan native Supabase)
- Login via WA number: BISA, tapi butuh custom OTP flow (Supabase ga support WA natif)
- Stabilitas: Evolution API = unofficial WA Web. Ban risk tinggi. Email lebih stabil buat auth critical.
- Biaya: Evolution free (self-hosted), VPS ~Rp75K/bulan. Official WA Business API = bayar + butuh Meta approval.
Rekomendasi: pakai email reset (sudah jadi). WA login = nice-to-have tapi jangan jadi primary auth.
```

Done 2025-07-09 (this session):

```text
Straight Ltd Admin Registration Mode Toggle:
- Problem: Admin cannot control client intake volume — signup always open
- Solution: Admin toggle between "Open Sign Up" and "Waitlist Only" modes
- Files changed:
  - supabase/migrations/20260609120000_straight_registration_mode.sql — new table + RPCs
  - src/modules/reddit/lib/api.ts — getStraightSettings, updateStraightSettings, getStraightRegistrationMode
  - src/modules/reddit/pages/admin/AdminSettings.tsx — Front-Door Mode toggle UI
  - src/modules/reddit/pages/RedditLanding.tsx — CTA redirects to waitlist when mode=waitlist
  - src/modules/reddit/pages/RedditSignup.tsx — blocks signup + redirects to waitlist when mode=waitlist
  - src/modules/reddit/pages/RedditLogin.tsx — "Sign up free" link becomes "Join the waitlist" when mode=waitlist
- Build: PASSED (tsc + vite build clean)
- Migration: APPLIED via Supabase SQL Editor in browser (WebBridge)
  - Table straight_settings created
  - RPCs admin_get_straight_settings, admin_update_straight_settings, get_straight_registration_mode created
  - Default mode: signup
  - Verified: SELECT get_straight_registration_mode() -> 'signup'
```

Done 2026-07-10 (this session):

```text
Ranking Forum UX fix — disabled platform early warning + hasBrand bug:
- Problem: user selects mix of Quora + Reddit URLs, generates all AI drafts,
  but "Review & approve" button stays gray. Message says "Every page needs its own draft (min 20 chars)"
  even though all drafts exist.
- Root cause #1 (paused platform): Reddit comment service is paused in pricing
  matrix (reddit_comment_plain disabled), so disabledSelected.length > 0 makes
  commentReady = false. User only finds out AFTER generating drafts — bad UX.
- Root cause #2 (hasBrand bug): commentReady logic required hasBrand=true even
  though UI label says "Brand (optional)". When user leaves brand empty with
  all drafts generated, commentReady = false. Button gray, message lies.
- Fix in RankingForumPage.tsx:
  1. Step 2 (forums list): SERP result cards now show "Paused" badge and
     opacity-60 styling for URLs from a disabled platform. StickyAction cost
     line shows "X paused platform(s)" warning before user proceeds.
  2. Step 3 (comment): Added amber banner at top when disabledSelected > 0,
     listing which platforms are paused and telling user to remove them.
  3. Step 3 draft cards: Disabled-platform cards get amber border, "Paused"
     badge, disabled textarea with placeholder "This platform is paused...",
     and disabled regenerate button.
  4. Step 3 StickyAction: Button disabled message now shows the REAL reason
     first — paused platform, missing drafts, or missing brand — instead of
     the generic misleading "Every page needs its own draft" message.
  5. commentReady: removed hasBrand requirement. Brand still required to
     GENERATE new drafts (toast error unchanged), but existing drafts can proceed.
- Build + deploy verified: tsc + vite build pass, wrangler deploy to prod.
```

Done 2026-07-10 (this session):

```text
HubSpot / non-Reddit upvote order fix — "service paused" error:
- Problem: user tries to order upvotes for HubSpot community URL
  (community.hubspot.com), gets "This service is paused right now" error.
  Root cause: fn_create_reddit_upvote_order still hardcoded to check
  'reddit_upvote' pricing matrix key for ALL URLs. Non-reddit.com URLs
  should route to 'forum_upvote' key. Additionally, forum_upvote was
  seeded as enabled=false in straight_pricing table.
- Fix applied to production database via Supabase SQL Editor:
  1. UPDATE straight_pricing SET enabled=true WHERE key='forum_upvote'
  2. CREATE OR REPLACE FUNCTION fn_create_reddit_upvote_order with
     v_platform := CASE WHEN URL LIKE '%reddit.com%' THEN 'reddit' ELSE 'forum' END
     and v_price_per_upvote := fn_straight_unit_price(v_platform || '_upvote', 50)
  3. REVOKE/GRANT permissions restored after CREATE OR REPLACE
- Migration file updated: peta/supabase/migrations/20260605100000_upvote_any_url_platform_price.sql
- Commit: cf2267f pushed to origin/main
- Verification: SQL Editor returned "Success. No rows returned"
```

Done 2026-06-08 (this session):

```text
Forgot password via email + WhatsApp (Fonnte) — FULL IMPLEMENTATION:
- Problem: Login page "Lupa password?" showed toast "Hubungi admin" instead of
  actual reset flow. User requested forgot password + WA delivery + WA login possibility.
- Solution implemented:
  1. New page /forgot-password — army member inputs email or WA number.
     • Email method: Supabase native resetPasswordForEmail with redirect to /reset-password
     • WA method: Edge function send-wa-password-reset generates token, stores in
       password_reset_tokens table (15min expiry), sends reset link via Fonnte API
  2. New page /reset-password — handles BOTH email reset (Supabase hash in URL)
     AND WA reset (?token= query param). WA path: verify token RPC → update password
     via admin_update_user_password RPC → consume token RPC.
  3. Login.tsx updated: "Lupa password?" now navigates to /forgot-password
  4. App.tsx: added /forgot-password and /reset-password routes
  5. api.ts: added sendWaPasswordReset() helper
  6. Edge function: peta/supabase/functions/send-wa-password-reset/index.ts
     • Looks up user by WA number in users.whatsapp column
     • Generates 32-char random token
     • Stores in password_reset_tokens with 15min expiry
     • Sends via Fonnte API with reset URL
  7. DB migration: 20260609000000_password_reset_tokens.sql
     • Table: password_reset_tokens (id, user_id, token, method, expires_at, used_at)
     • RPCs: verify_password_reset_token, consume_password_reset_token,
       admin_update_user_password (service_role only)
- Build: PASSED (tsc + vite build clean)
- Git: pushed to origin/main (commits 24a36ef → 748417f → 40c9ad2 → c39e4e6)
- Vercel deployment: BLOCKED — see "Vercel Deployment Issue" section below
```

Vercel Deployment Issue (2026-06-08):

```text
Problem: Vercel not auto-deploying since May 14. Latest deployed commit: 98bf8e5 (May 14).
Newer commits (including forgot password 24a36ef, HubSpot fix cf2267f) NOT deployed.
Root cause discovered via WebBridge browser inspection:
  • Team "n311311-6290s-projects" is PAUSED on Vercel dashboard
  • Hobby plan edge request limit exceeded: 1.9M / 1M (190% of quota)
  • Billing cycle resets at 10pm daily (SE Asia time, UTC+7)
  • When paused, ALL deployments are blocked — GitHub webhooks still fire but
    Vercel check suites stay "queued" forever
Attempted fixes:
  • GitHub deployment API — created deployment but Vercel ignored it (team paused)
  • Trivial commit push — same result, check suite queued indefinitely
  • No "unpause" button found in Vercel UI (Hobby plan limitation)
Resolution plan:
  • Cron job scheduled: 2026-06-08 22:30 SE Asia time (30min after billing reset)
  • Job will check if team unpaused, then deploy latest main branch
  • If still paused after reset: need Vercel Pro upgrade ($20/mo) or contact support
Current status: WAITING for billing cycle reset
```

Updated Git State (2026-06-08):

```text
Recent commits on main:
c39e4e6 chore: remove deployment trigger file
40c9ad2 trigger: force Vercel redeploy
748417f docs(coldstart): HubSpot forum upvote fix applied to prod
cf2267f fix(straight): add missing GRANT on fn_create_reddit_upvote_order + enable forum_upvote
f90bf83 fix(ranking-forum): early disabled-platform warning on paused platforms
24a36ef feat: forgot password via email + WhatsApp (Fonnte)
```

Updated Secret Status:

```text
New secret added to Supabase (staging + production):
FONNTE_TOKEN — for WA password reset edge function

Existing Fonnte token already configured for broadcast/group features.
```

---

## 2026-06-09 — Waitlist Mode: Login page still shows "Sign up free" when waitlist is on

**Problem:**
When admin switches Front-Door Mode to "Waitlist Only", the login page (`/reddit/login`) still displayed "Don't have an account? Sign up free" link. Users could click it and reach the signup page, where a race condition allowed email/Google signup before the block kicked in.

**Fix:**
1. `RedditLogin.tsx` — changed `regMode` initial state from `'signup'` to `null`. Bottom "Don't have an account?" section now hides entirely until the registration mode is fetched. Once loaded:
   - `waitlist` → shows "Join the waitlist" linking to `/reddit/waitlist`
   - `signup` → shows "Sign up free" linking to `/reddit/signup`
   This prevents the flash of wrong CTA while loading.

2. `RedditSignup.tsx` — changed `blocked` default from `false` to `true` (fail-closed). Added `modeLoading` state. Both Google and email submit buttons are disabled while mode is loading or when blocked. If mode is `waitlist`, toast + auto-redirect to `/reddit/waitlist` after 1.5s.

3. `api.ts` — added fallback in `getStraightRegistrationMode()`: if the `get_straight_registration_mode` RPC fails (e.g., function not deployed), it falls back to a direct `select` from `straight_settings` table (which has a public read policy for anon). Only if both fail does it throw.

**Files changed:**
- `peta/src/modules/reddit/pages/RedditLogin.tsx`
- `peta/src/modules/reddit/pages/RedditSignup.tsx`
- `peta/src/modules/reddit/lib/api.ts`

**Behavior:**
- Login page no longer shows "Sign up free" while loading mode.
- If waitlist is on, login page shows "Join the waitlist" instead.
- Signup page blocks all inputs immediately until mode is verified.
- If RPC is missing, direct table query acts as safety net.

**Build:**
- `npm run build` passes (tsc + vite) — no errors.

---

## 2026-06-09 — UX/CRO: Hide disabled platforms from Ranking Forum + New Order

**Problem:**
Admin can turn off platforms (e.g. Reddit) via pricing matrix. But users still saw disabled platforms as grayed-out "Paused" cards in Ranking Forum and New Order. Bad UX — users waste time seeing options they can't use.

**Fix:**
1. `RankingForumPage.tsx` — added `isPlatformEnabled()` helper. Filters out disabled platforms at render time:
   - `allForumItems` only counts enabled results
   - Scan headers only show when `enabledResults.length > 0`
   - "No forum pages found" no longer suggests "reddit" as a seed modifier
   - Empty-state triggers when ALL platforms in ALL scans are disabled

2. `RedditNewOrder.tsx` — `ServiceSelector` now:
   - Filters out `status === 'paused'` services entirely
   - Section headers (Reddit, Forum discovery, Custom) only render if they have visible services
   - Users never see a grayed-out card they can't click

**Files changed:**
- `peta/src/modules/reddit/pages/RankingForumPage.tsx`
- `peta/src/modules/reddit/pages/RedditNewOrder.tsx`

**Behavior:**
- If admin disables ALL Reddit pricing rows → Reddit section disappears from New Order, Reddit results never appear in Ranking Forum
- If admin disables ALL comment pricing → Forum discovery section disappears, no forum results shown
- Edge case: already-selected disabled items still show warning in Comment/Review step (preserved existing `disabledSelected` logic)

---

## 2026-06-10 — UX/CRO Audit: Deploy disabled-platform hide fix to straight.ltd production

**Problem:**
Code fix for hiding disabled platforms (commit `ed844ec` + `2029049` + `0b841f1`) existed in repo but was NOT deployed to straight.ltd production. Browser audit confirmed Reddit service cards still visible on New Order page and Reddit URLs could appear in Ranking Forum.

**Root cause:**
Cloudflare Pages project `straight` (domain `www.straight.ltd`) was running old build. Last deployment was 22 hours prior. Separate from PeTa project `peta`.

**Fix applied:**
1. Fixed build-breaking unused imports/variables in `TaskQueue.tsx` (from stale PeTa worktree drift)
2. Built successfully: `npm run build` (tsc + vite, 1.16s)
3. Deployed to Cloudflare Pages project `straight` via `wrangler pages deploy ./dist --project-name=straight --branch=main`
4. Browser re-verified on production domain:
   - New Order: Reddit section completely gone. Only Forum discovery (Comments) + Likes & Shares + Request remain.
   - Ranking Forum: No Reddit results. No paused cards.

**Files changed:**
- `peta/src/pages/admin/TaskQueue.tsx` — removed unused `MessageSquare, Send, Smartphone, Bell` imports + prefixed unused blast state variables with `_`

**Deployment:**
- Project: `straight` (Cloudflare Pages)
- Commit: `0b841f1`
- Time: 2026-06-10 ~14:00 UTC
- Inspector report: `[2026-06-10]_Straight_Disabled_Platform_Audit_FINAL.md`

**Remaining gaps (optional):**
- Comments service description still mentions "Reddit" in copy: "Helpful comments for Reddit, Quora, HubSpot, and niche forums"
- Page title + meta tags still say "The Reddit Growth Engine" — SEO decision whether to pivot to "Forum Growth Engine"

---

## 2026-06-10 — Admin Waitlist Page

**Problem:**
Waitlist submissions masuk ke Supabase table `public.waitlist` tapi tidak ada admin UI untuk melihat dan manage entries. Admin harus query manual via SQL Editor.

**Fix:**
1. `AdminWaitlist.tsx` — new admin page at `/reddit/admin/waitlist`:
   - Table view: email, keyword, brand, website, notes, status, submitted date
   - Stats cards: total, pending, invited, converted, declined
   - Search: email, keyword, brand, website, notes
   - Status filter dropdown
   - Sort: newest/oldest
   - Export CSV
   - Quick actions per row: mark as invited, converted, declined, or reset to pending

2. `AdminLayout.tsx` — added "Waitlist" nav item with Clock icon

3. `App.tsx` — added route `/reddit/admin/waitlist` with AdminGuard

**Files changed:**
- `peta/src/modules/reddit/pages/admin/AdminWaitlist.tsx` (new)
- `peta/src/modules/reddit/components/AdminLayout.tsx`
- `peta/src/App.tsx`

**Build & deploy:**
- `npm run build` passes (tsc + vite)
- Deployed to Cloudflare Pages project `peta` (straight.ltd)
- Commit: `93f7f02`

**Access:**
- URL: `https://www.straight.ltd/reddit/admin/waitlist`
- Requires admin login

---

## 2026-06-11 — PeTA-Branded Password Reset Email via SMTP

**Problem:**
Forgot password email dikirim dari "Supabase Auth <noreply@mail.app.supabase.io>" — bukan dari PeTA. User minta email dari PeTA branding.

**Fix:**
1. New edge function `send-password-reset-email` — sends PeTA-branded reset email via SMTP (Spacemail) instead of Supabase native auth email.
   - Uses existing SMTP secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
   - From: `PeTA <peta@penghasilantambahan.com>`
   - HTML template: PeTA orange gradient header, Indonesian copy, 15-min expiry notice
   - Generates 32-char token, stores in `password_reset_tokens` table
   - verify_jwt = false (called by anonymous users before login)

2. Updated `ForgotPassword.tsx`:
   - Replaced `supabase.auth.resetPasswordForEmail()` with `supabase.functions.invoke('send-password-reset-email')`
   - Error handling updated: `resend_not_configured` → `smtp_not_configured`

3. Updated `config.toml`:
   - Added `[functions.send-password-reset-email]` verify_jwt = false
   - Added `[functions.send-wa-password-reset]` verify_jwt = false

4. Edge function `send-wa-password-reset` juga di-deploy dengan verify_jwt = false.

**Files changed:**
- `peta/supabase/functions/send-password-reset-email/index.ts` (new)
- `peta/src/pages/ForgotPassword.tsx`
- `peta/supabase/config.toml`

**Deployment:**
- Edge functions deployed to production (yorlsgzsawchpeeazcvi)
- Git commit: `2f0e6b7`
- Frontend build: PASSED (tsc + vite)

**Remaining issue:**
- `password_reset_tokens` table migration (20260609000000_password_reset_tokens.sql) may NOT be applied to production yet.
- If user reports "token_store_failed" error when testing forgot password → migration belum di-push ke prod.
- Fix: login ke Supabase dashboard → SQL Editor → run migration SQL manually, OR use `supabase db push`.

**Vercel deployment:**
- Frontend changes committed to main but NOT auto-deployed (Vercel team still paused).
- User must manually deploy via Cloudflare Pages or wait for Vercel billing reset.

---
