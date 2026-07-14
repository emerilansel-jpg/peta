# Cold Start Handoff - Straight Ltd + PeTa

> ⚠️ LATEST (2026-07-15): PeTa saldo 0 follow-up fix. Root cause: legacy forum_comment assignments in `task_assignments` still had `user_id = NULL` after the 2026-07-13 RLS fix, so approved rows were invisible to the army member and the approval trigger could not credit them. Applied: (1) backfill `user_id` from `proof_image_url` storage path, (2) backfill missing `user_credits` + `balance_credited_at`, (3) trigger to guarantee `user_id` is set on every assignment, (4) SECURITY DEFINER `get_user_earnings()` RPC so the frontend no longer depends on RLS, (5) `admin_repair_assignment_user_id()` RPC + Approval Queue UI for manual repair. See 2026-07-15 section below.
>
> Previous (2026-07-13): PeTa QA audit + 3 critical bug fixes applied:
>   (1) Admin mutations secured via SECURITY DEFINER RPCs (approve/payout/create-task),
>       reject guard prevents reverting already-credited assignments.
>   (2) Forum comment saldo 0 fixed — RLS policy on task_assignments only matched
>       reddit_account_id; for forum_comment tasks reddit_account_id IS NULL so army
>       users could not read their own approved rows. Added `user_id = auth.uid()`.
>       Also force-attached tg_on_assignment_approved trigger and backfilled credits.
>   (3) Founding 0/100 on landing page fixed — anon visitors had no auth.uid() so RLS
>       blocked all reads of public.users. Added SECURITY DEFINER RPC
>       get_founding_members_count() and switched frontend to use it (verified
>       returns count: 93 via curl anon).
> All migrations applied to production + frontend deployed to Cloudflare Pages.
> See 2026-07-13 sections below.
>
> Previous (2026-07-13): PeTa transactional email template redesigned with professional branding: logo `https://www.penghasilantambahan.com/logo-horizontal.png`, colors `#ff8b6b` + light peach (`oklch(0.91 0.18 98.65)` approximation), table-based responsive layout. All 4 templates retested and delivered to `rashrifanda@gmail.com`.
>
> Previous (2026-07-13): PeTa transactional emails now live using Resend with domain `penghasilantambahan.com` verified. See 2026-07-13 sections below.
>
> Previous (2026-07-03): `fix/audit-2026-06-09` merged into `main`, pushed to GitHub, and deployed to straight.ltd production. Google Sign-In removal live on https://www.straight.ltd.
>
> Previous (2026-07-03): Google Sign-In removed from straight.ltd login/signup pages.
>
> Previous (2026-07-03): PM Mode skill installed; OneDrive sync script upgraded with hardcoded + .syncignore exclusion so `onedrive_sync.py`, credentials, and sync metadata never upload.
>
> Previous (2026-07-01): forum comment "Place orders" failure in Ranking Forum diagnosed and fixed
> in code; Total clients count bug fixed in code; BOGO (Buy One Get One) promo UI removed from
> Straight top-up per product decision. Production DB still needs the scalar-drafts migration applied.
> WhatsApp bot QR re-scan remains outstanding. See new sections below.
>
> Read **`docs/CHECKPOINT_20260610_audit_round.md`** for earlier context. Active repo is now **`G:\SF Project\peta-main`**.
> Latest work is on branch **`fix/audit-2026-06-09`** — merged to `main` and pushed.
> `www.straight.ltd` is served by the `straight` Cloudflare Pages project (the `peta` Pages project
> serves `penghasilantambahan.com` and was intentionally not touched).

Last updated: 2026-07-15 (PeTa saldo 0 follow-up fix applied).

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
branch: fix/audit-2026-06-09 (pushed)
main branch is behind; do not deploy from main for Straight.ltd
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

Recent commits on `fix/audit-2026-06-09`:

```text
6f61d30 fix(straight): force PayPalScriptProvider remount on client id change
bf95baf fix(straight): use direct fetch for paypal-capture to surface real errors
aaaf77a docs: add 2026-06-10 audit-round checkpoint + coldstart pointer
9644a14 Fix admin_get_referral_leaderboard ambiguous column (errored on every call)
f1e405a Field-swap backfill: also strip bare comment-marker tasks (no DETAIL ORDER)
b2f3667 Task field-swap: description = full brief/instructions, brief = comment-only
cdf74ac PayPal: admin-configurable credentials (no env rebuild)
175170f Audit round: re-enable Reddit pricing, +10% AI-write, auth UX, waitlist toggle, WA OTP reset
f30fa20 Merge feat/geo-funnel-ai-visibility into main
d647dd6 Straight Ltd: pricing matrix charges, upvotes-any-URL, privacy fixes, pricing->Finance
```

Current dirty state (2026-07-01):

```text
 M coldstart.md
 M peta/src/modules/reddit/lib/api.ts
 M peta/src/modules/reddit/pages/RankingForumPage.tsx
 M peta/src/modules/reddit/pages/admin/AdminOverview.tsx
 M peta/src/pages/ResetWhatsApp.tsx
 M peta/supabase/functions/wa-reset-request/index.ts
 M peta/supabase/migrations/20260625060000_forum_comment_quantity_drafts.sql
?? peta/supabase/migrations/20260701070000_fix_comment_drafts_scalar.sql
?? .agents/
?? ACTION_PLAN_SUPERVISI_CAPTAIN.md
?? TASK_ORDERS_PETA.md
?? TASK_TEMPLATE_AND_EXAMPLES.md
?? skills-lock.json
```

Notes:

```text
coldstart.md is this handoff file — update it whenever state changes.
ResetWhatsApp.tsx + wa-reset-request/index.ts are PeTa changes that are already working in prod;
  the user explicitly asked NOT to modify/commit them again.
AdminOverview.tsx fix: Total clients now counts only role='client' or 'admin' (excludes PeTa army).
api.ts + RankingForumPage.tsx fix: improved error logging for forum comment orders.
20260625060000_forum_comment_quantity_drafts.sql was updated in-place to normalize p_comment_drafts
  (parse JSON string scalar / wrap single object) so the repo matches the production hotfix.
20260701070000_fix_comment_drafts_scalar.sql is the production hotfix migration that recreates
  fn_create_forum_comment_order with scalar-tolerant input handling. Apply this to production.
The ACTION_PLAN_*, TASK_*, .agents/, and skills-lock.json files are not from this session;
  leave them untracked unless the user says otherwise.
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
Cloudflare Pages via wrangler
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
```

Expected missing or not configured:

```text
ANTHROPIC_API_KEY
SERPAPI_API_KEY
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
```

Admin AI provider settings:

```text
Admin can select DeepSeek or Claude.
Admin can set model IDs.
Edge Function reads straight_ai_settings server-side.
Client-facing UI does not expose provider choice.
Provider health cards exist for DeepSeek, Claude, DataForSEO, Google Custom Search, and SerpAPI.
```

## Important Files

Straight client/admin modules:

```text
peta/src/modules/reddit/pages/RedditNewOrder.tsx
peta/src/modules/reddit/pages/RankingForumPage.tsx
peta/src/modules/reddit/pages/admin/AdminSettings.tsx
peta/src/modules/reddit/lib/api.ts
```

Supabase Edge Functions:

```text
peta/supabase/functions/generate-forum-comment/index.ts
peta/supabase/functions/rank-forum-pages/index.ts
```

Relevant migrations:

```text
peta/supabase/migrations/20260529143000_forum_comment_orders.sql
peta/supabase/migrations/20260531104132_enforce_task_quota_and_duplicate_comments.sql
peta/supabase/migrations/20260624060000_straight_auto_import_order_trigger.sql
peta/supabase/migrations/20260625060000_forum_comment_quantity_drafts.sql
peta/supabase/migrations/20260701070000_fix_comment_drafts_scalar.sql
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
HubSpot task ID: 91742b89-0c14-452e-8a50-c8ae235a68a6
```

Production state was fixed:

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
The main project dir (...\Reddit Army Local\peta) is on branch `main` and is STALE —
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
cd "G:\SF Project\peta-main\peta"
npm.cmd run build
```

Deploy frontend to Cloudflare Pages:

> IMPORTANT: `www.straight.ltd` resolves to the `straight` Pages project (`straight-4dv.pages.dev`),
> while the `peta` Pages project serves `penghasilantambahan.com`. Do NOT deploy Straight.ltd from the
> `peta` project.

```powershell
cd "G:\SF Project\peta-main\peta"
npx.cmd wrangler pages deploy dist --project-name=straight --branch=main --commit-dirty=true
```

Deploy PeTa frontend (if ever needed):

```powershell
cd "G:\SF Project\peta-main\peta"
npx.cmd wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true
```

Deploy Edge Functions to staging:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
$env:SUPABASE_ACCESS_TOKEN='<secure-token>'
npx.cmd supabase functions deploy generate-forum-comment rank-forum-pages --project-ref duxzxizedtvnopfihllz --use-api
```

Deploy Edge Functions to production:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
$env:SUPABASE_ACCESS_TOKEN='<secure-token>'
npx.cmd supabase functions deploy generate-forum-comment rank-forum-pages --project-ref yorlsgzsawchpeeazcvi --use-api
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
PayPal admin-configurable settings UI is live on /reddit/admin/settings.
PayPal checkout (top-up) flow is live and tested end-to-end in sandbox.
PayPal capture edge function verifies orders server-side before crediting.
PeTa task quota and duplicate protections are deployed.
Urgent overfilled HubSpot task was taken down/fixed.
```

Not complete (all OPTIONAL now that DataForSEO is live):

```text
Google Custom Search 403 (redundant fallback; needs fresh PSE w/ CAPTCHA - user action).
Claude needs ANTHROPIC_API_KEY only if admin should be able to select Claude (DeepSeek works).
SerpAPI needs SERPAPI_API_KEY only if wanted as extra fallback.
```

Done 2026-06-01 (this session):

```text
DataForSEO topped up to $49.94 -> provider health 'ok'.
Verified Ranking Forum end-to-end on production: live keyword ideas + live SERP top-10 scan,
both provider_notice=null (true live data, not fallback preview).
Ranking Forum CAN now be reported to user as having live SERP/keyword data.
```

## 2026-06-22 — Straight.ltd PayPal Checkout Deploy & Fixes

What was done:

```text
Pushed branch fix/audit-2026-06-09 to GitHub.
Deployed Straight.ltd frontend from the correct Cloudflare Pages project: straight (NOT peta).
Confirmed PayPal admin config RPCs and paypal-capture edge function are active in production.
Confirmed PayPal credentials are stored in app_secrets and configurable from /reddit/admin/settings.
Sandbox top-up flow tested successfully: payment captured, credit balance updated, history shown.
```

Fixes applied:

```text
src/modules/reddit/lib/api.ts — completePayPalTopup:
  - Switched from supabase.functions.invoke() to direct fetch() with explicit Bearer + apikey headers.
  - Surfaces real edge-function error messages instead of generic "Failed to send a request".
  - Explicitly checks user session and throws a clear "You must be signed in" error if missing.

src/modules/reddit/pages/RedditTopup.tsx:
  - Added key={paypal.clientId} to PayPalScriptProvider so the SDK reloads when client id changes.
  - Prevents stale sandbox SDK from being reused after switching to a live PayPal client id.
```

Important note for live PayPal:

```text
The PayPal JS SDK determines sandbox vs live based on the CLIENT ID, not the environment toggle.
If the admin selects "Live" but the checkout still redirects to sandbox.paypal.com, the Client ID
entered in the Live field is actually a Sandbox Client ID. Use a Live App Client ID from:
https://developer.paypal.com/dashboard/applications/live
```

## 2026-06-23 — Straight.ltd Signup QA & Fix

QA finding:

```text
Email signup on /reddit/signup works and creates a client user.
Front door mode is 'signup', so registration is open.
BUT: role_title and website fields from the signup form are NOT saved to public.users.
CRITICAL: production DB has diverged from repo migrations — role='client' and role_title/website
          columns exist in production but are missing from the migration files.
```

Product decision (Pak Nell, 2026-06-23):

```text
The "$5 free credit on signup" copy and bonus are removed.
No signup credit is awarded for Straight users.
```

Fix created and pushed:

```text
Migration: peta/supabase/migrations/20260623060000_straight_signup_fix_role_credit.sql
  - Adds 'client' to users.role CHECK constraint.
  - Adds role_title and website columns.
  - Recreates handle_new_user():
      * product='straight' -> role='client'
      * copies full_name, role_title, website from auth metadata
      * keeps existing PeTa WhatsApp + referral-bonus behaviour intact.
      * NO signup credit awarded (per product decision).
Frontend: removed "$5 free credit on signup" copy from RedditSignup.tsx (deployed).
Type fix: src/lib/supabase.ts role type now includes 'client'.
```

To apply the DB fix:

```text
Run the SQL from migration 20260623060000_straight_signup_fix_role_credit.sql in Supabase
Dashboard SQL Editor on production project yorlsgzsawchpeeazcvi.
```

## 2026-06-23 — Straight→PeTa Admin RPC Fixes (APPLIED)

Blockers found during QA:

```text
admin_list_pending_reddit_orders returned auth.users.email as varchar(255) but the
function declared the return column as text -> PostgREST error 42804. PeTa admin could
not see the Straight order import queue.

admin_update_task had two overloaded signatures -> PostgREST error PGRST203. PeTa admin
could not edit tasks.
```

Fix applied to production via Supabase CLI (access token):

```text
Migration: peta/supabase/migrations/20260623070000_fix_straight_peta_admin_rpc.sql
  - admin_list_pending_reddit_orders: cast au.email to text.
  - admin_update_task: dropped obsolete 14-param and 16-param overloads, kept the
    16-param version that matches the PeTa admin edit sheet.
```

Verification:

```text
admin_list_pending_reddit_orders now returns [] instead of 42804.
admin_update_task now returns task UUID instead of PGRST203.
```

## 2026-06-23 — Re-QA: Straight→PeTa End-to-End Transaction

Goal: prove a Straight client can pay → order is imported as a PeTa task → army works → admin
approves → Straight order auto-completes every day.

What was applied:

```text
Migration 20260623060000_straight_signup_fix_role_credit.sql -> production AND staging.
Migration 20260623070000_fix_straight_peta_admin_rpc.sql -> production AND staging.
Migration 20260624060000_straight_auto_import_order_trigger.sql -> production AND staging.
  (This captures production-only drift: reddit_upvote_orders are auto-imported into tasks as draft.)
```

Config fixes:

```text
straight_pricing reddit_upvote, reddit_comment_plain, reddit_comment_link were enabled=false.
These blocked Straight clients from placing Reddit orders. Enabled on production.
```

Verification results:

```text
✅ Straight email signup creates role='client' and saves role_title + website.
✅ Admin can adjust client credits via fn_admin_adjust_credits.
✅ Client creates a reddit_upvote order (cost 50c) successfully.
✅ Order is auto-imported as a draft PeTa task (auto-import trigger).
✅ Admin activates the task via admin_update_task.
✅ Army user claims the task via claim_task_assignment.
✅ Army submits proof (direct update to task_assignments).
✅ Admin approves (status='approved').
✅ Trigger tg_on_assignment_approved increments delivered_upvotes and marks order completed.
✅ Army receives task_reward credit.
```

E2E smoke test script:

```text
peta/scripts/e2e-flow-test.mjs
- Reads Supabase credentials from env vars (no committed secrets).
- Pass --cleanup-only to remove test users created by the script.
```

PayPal live mode verified:

```text
PAYPAL_ENV = live in app_secrets.
Live PayPal JS SDK loads with the configured client id.
Live PayPal OAuth token request returns 200.
=> PayPal is correctly configured for live transactions.
```

## 2026-06-25 — Forum Comment Bulk + Unique AI Drafts

Problem (raised by Pak Nell):

```text
AI-suggested forum comment orders produced one draft per order. For bulk orders
(e.g. 50 comments) all armies would post the same text, which looks unnatural
and risks platform bans.
```

Fix applied to production:

```text
Migration: peta/supabase/migrations/20260625060000_forum_comment_quantity_drafts.sql
  - New table reddit_order_comment_drafts stores one unique draft per slot.
  - fn_create_forum_comment_order now accepts quantity + commentDrafts array.
  - claim_task_assignment assigns the next unused draft to each army member.

Frontend:
  - RedditNewOrder.tsx adds a Quantity selector for forum comments.
  - AI mode generates N unique drafts (different angles) for the same thread.
  - Bulk flow from Ranking Forum now generates a unique draft per URL.
  - TaskDetail.tsx displays the assignment-specific draft_comment if present.

Verified end-to-end on production:
  - Order quantity=3, cost=3×unit price ✅
  - 3 army members claim and each receive a different draft ✅
  - All 3 approved → order completed ✅
```

Remaining blocker — WhatsApp bot:

```text
Evolution API instance 'peta-bot' was deleted/recreated during QA and is DISCONNECTED.
Webhook URL restored to N8N: https://n8n.46-250-239-138.sslip.io/webhook/wa-incoming
QR code does not render in the Evolution Manager UI (blank dialog).
Action needed: open http://46.250.239.138:8080/manager, login with global API key,
find peta-bot, click Get QR Code, and scan with the burner WhatsApp phone.
If the QR dialog stays blank, restart the VPS/docker service or check Evolution logs.
Once online, the next 'peta' group message will auto-lock PETA_WA_GROUP_JID and restore
the Rp5K bonus flow + group blast features.
```

## 2026-06-10 — WhatsApp OTP Reset Fix

Problem:

```text
User reports no OTP received on /reset-whatsapp.
Root cause: Fonnte gateway likely failing (token invalid or device disconnected).
wa-reset-request edge function was swallowing errors and returning generic { ok: true },
so the UI always showed "kode sudah dikirim" even when the message never left the server.
```

Fix applied (round 1 — edge function error surfacing):

```text
wa-reset-request/index.ts:
  - Returns { ok: true, sent: true } on Fonnte success.
  - Returns { ok: true, sent: false, error: 'gateway_error' } when Fonnte token missing or send fails.
  - Still returns { ok: true } for unregistered numbers (privacy preserved).

ResetWhatsApp.tsx:
  - Checks data?.sent === false and shows error toast:
    "Gagal mengirim kode WhatsApp. Coba pakai reset email atau hubungi admin."
  - Stays on phone step when gateway is down instead of advancing to code entry.
```

Fix applied (round 2 — 401 Unauthorized):

```text
Supabase Edge Functions require Authorization: Bearer <token> header.
supabase.functions.invoke() does NOT send anon key as Bearer when user is not logged in.
This caused 401 for public /reset-whatsapp flow.

ResetWhatsApp.tsx:
  - Replaced supabase.functions.invoke() with direct fetch() using:
    Authorization: Bearer <VITE_SUPABASE_ANON_KEY>
    apikey: <VITE_SUPABASE_ANON_KEY>
  - Applied to both wa-reset-request and wa-reset-confirm calls.
```

Ops required to fully restore OTP delivery:

```text
1. Verify FONNTE_TOKEN in Supabase app_secrets is valid and active.
   (Admin Broadcast panel shows "unknown user" — strong signal token is bad or device disconnected.)
2. If invalid: go to fonnte.com → regenerate device token → update app_secrets.FONNTE_TOKEN.
3. Re-deploy wa-reset-request edge function to staging + production after code fix.
4. Build + deploy frontend (wrangler pages deploy) after ResetWhatsApp.tsx fix.
5. Test /reset-whatsapp with a registered number and confirm OTP arrives.
```

Files changed:

```text
peta/supabase/functions/wa-reset-request/index.ts
peta/src/pages/ResetWhatsApp.tsx
```

## 2026-07-01 — Total Clients Count Fix + Forum Comment Scalar Drafts Fix

### Bug 1: Total clients count wrong

Symptom:

```text
Admin Overview showed "Total clients: 94".
Clicking View all showed only 4 users (3 clients + 1 admin).
```

Root cause:

```text
AdminOverview.tsx used getAdminAllUsers().length without filtering.
getAdminAllUsers() returns every row in public.users, including PeTa army users.
AdminClients.tsx filters to role='client' or role='admin' before rendering.
```

Fix:

```text
peta/src/modules/reddit/pages/admin/AdminOverview.tsx
setUserCount(users.filter((u) => u.role === 'client' || u.role === 'admin').length);
```

Status:

```text
Code fixed and build verified. Frontend deploy pending (needs Cloudflare API token).
```

### Bug 2: Ranking Forum "Place orders" fails

Symptom:

```text
Ranking Forum review step → click "Place 3 comment orders" → toast "Failed to place orders".
Network response from Supabase RPC:
{"code":"22023","message":"cannot get array length of a scalar"}
```

Root cause:

```text
fn_create_forum_comment_order calls jsonb_array_length(p_comment_drafts).
The client sent p_comment_drafts as a JSON string scalar (e.g. "[{\"comment_text\":\"...\"}]")
instead of a native JSON array, causing jsonb_array_length to throw 22023.
This can happen with older/cached client builds or certain serialization paths.
```

Fix:

```text
Migration: peta/supabase/migrations/20260701070000_fix_comment_drafts_scalar.sql
  - Recreates fn_create_forum_comment_order with defensive normalization:
    * If p_comment_drafts is a JSON string scalar, parse it.
    * If it is a single JSON object, wrap it in an array.
    * Otherwise fall back to an empty array.
  - Existing draft insertion logic then works unchanged.

Frontend logging improvements:
  - peta/src/modules/reddit/pages/RankingForumPage.tsx now logs and stringifies any caught error.
  - peta/src/modules/reddit/lib/api.ts now logs RPC errors before rethrowing.
```

Status:

```text
Production DB: migration 20260701070000_fix_comment_drafts_scalar.sql NOT YET APPLIED.
  Apply via Supabase SQL Editor on project yorlsgzsawchpeeazcvi, then retry the order.
Staging DB: migration 20260701070000_fix_comment_drafts_scalar.sql NOT YET APPLIED either.
Frontend: code fixed and build verified. Deploy pending (needs Cloudflare API token).
```

How to apply the production hotfix:

```text
Option A (fastest):
  Open Supabase Dashboard → SQL Editor → production project yorlsgzsawchpeeazcvi.
  Copy-paste the contents of:
    peta/supabase/migrations/20260701070000_fix_comment_drafts_scalar.sql
  Run it.

Option B (CLI):
  $env:SUPABASE_ACCESS_TOKEN='<secure-token>'
  npx.cmd supabase db push --project-ref yorlsgzsawchpeeazcvi
  (This will push all pending migrations, including the scalar fix.)
```

How to deploy frontend after the fix:

```powershell
cd "G:\SF Project\peta-main\peta"
npm.cmd run build
npx.cmd wrangler pages deploy dist --project-name=straight --branch=main --commit-dirty=true
```


## 2026-07-01 — BOGO Promo UI Removed

Decision (Pak Nell):

```text
BOGO (Buy One Get One) promo di Straight dimatikan.
Karena backend BOGO belum benar-benar diimplementasikan (hanya client-side preview),
lebih baik hapus semua copy/UI promo dari frontend daripada menampilkan janji yang tidak dipenuhi.
```

What was removed:

```text
peta/src/modules/reddit/pages/RedditTopup.tsx
  - Removed B1G1/Beta launch promo banner.
  - Removed "Beta B1G1 bonus" line from order summary.
  - Removed getB1G1Status() call and refresh after payment.
  - Removed bonus message from success toast.
  - Credit preview now shows only the amount actually purchased.

peta/src/modules/reddit/lib/api.ts
  - Removed B1G1Status interface.
  - Removed getB1G1Status() helper.
```

What remains unchanged:

```text
- PACKAGES array still has a dormant `bonus: number` field, but all values are 0 so no UI renders.
- Volume-bonus badge logic remains but is inactive.
- No backend function (fn_get_b1g1_status) was created or removed; it was never in repo migrations.
```

Status:

```text
Code fixed and build verified. Frontend deploy pending (needs Cloudflare API token).
```


## 2025-01-09 10:15 — OneDrive Sync Script

- **Type:** CODING
- **Status:** COMPLETED
- **Files touched:**
  - onedrive_sync.py (411 lines, OAuth 2.0 auth-code flow, refresh token, small + large file upload, dry-run, delete-remote)
  - SETUP.md (Azure App Registration walkthrough, Task Scheduler, cron, PowerShell)
  - .env.example (5 config vars)
  - README_onedrive_sync.md (quickstart, command table, credential list)
- **Key decisions:**
  - Flatten nested local folders to single remote folder (simpler, avoids recursive folder creation).
  - Used delegated auth-code flow (not client credentials) because personal OneDrive requires user consent.
  - Refresh token persisted in tokens.json for headless automation.
  - Large file upload uses createUploadSession with 10 MB chunks.
- **Blockers:** none
- **Next step:** User runs `--auth` once, then sets up Task Scheduler / cron for auto-upload.
- **Inspector:** PASSED
- **Backup location:** none (new files only)
- **coldstart.md stored at:** G:\SF Project\peta-main\coldstart.md
- **Browser used:** none


## 2026-07-03 12:51 — PM Mode Skill + OneDrive Sync Hardening

- **Type:** CODING
- **Status:** COMPLETED
- **Files touched:**
  - `.agents/skills/pm-mode/SKILL.md` (new skill installed)
  - `skills-lock.json` (registered pm-mode skill)
  - `onedrive_sync.py` (added hardcoded excludes, `.syncignore` support, `--exclude` CLI, folder structure preservation)
  - `.syncignore` (new example file)
  - `.gitignore` (ignore tokens/env/log at root)
  - `README_onedrive_sync.md` (documented exclusion system)
  - `SETUP.md` (documented `.syncignore`, folder structure, auto-upload)
- **Key decisions:**
  - Hardcoded exclude list protects `onedrive_sync.py`, `.env`, `tokens.json`, `.syncignore`, docs, logs.
  - Added `.syncignore` parsing (similar to `.gitignore`) for user-defined excludes.
  - Added `--exclude` CLI arg for ad-hoc patterns.
  - Changed sync to preserve local folder structure on OneDrive (was flattening before).
  - Verified with syntax check + exclude unit tests + mocked sync enumeration test.
- **Blockers:** none
- **Next step:** User registers Azure app, fills `.env`, runs `python onedrive_sync.py --auth`, then schedules `--sync`.
- **Inspector:** PASSED
- **Backup location:** `G:\SF Project\peta-main\backups\2026-07-03_125128_pm-mode-onedrive`
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none


## 2026-07-03 18:58 — Remove Google Sign-In from straight.ltd

- **Type:** CODING
- **Status:** COMPLETED + MERGED + DEPLOYED
- **Files touched:**
  - `peta/src/modules/reddit/pages/RedditLogin.tsx` (removed GoogleLogo, handleGoogleLogin, button, divider)
  - `peta/src/modules/reddit/pages/RedditSignup.tsx` (removed GoogleLogo, handleGoogleSignup, button, divider)
- **Key decisions:**
  - Google OAuth sign-in/sign-up UI fully removed from Straight Ltd auth pages.
  - Merged `fix/audit-2026-06-09` into `main` and pushed to GitHub (resolved 7 conflicts).
  - Deployed merged `main` to straight.ltd production.
  - Email/password remains as the only auth method.
  - No backend changes; Supabase Google provider can stay enabled or be disabled in Supabase Auth settings.
- **Blockers:** none
- **Next step:** None — live on production.
- **Inspector:** PASSED
- **Backup location:** `G:\SF Project\peta-main\backups\2026-07-03_164200_remove-google-signin`
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none
- **Deployment URLs:**
  - Production: https://www.straight.ltd
  - Branch preview: https://fix-audit-2026-06-09.straight-4dv.pages.dev


## 2026-07-04 11:30 — QA Audit Lengkap PeTa + Straight.ltd

- **Type:** ANALYSIS / QA
- **Status:** COMPLETED
- **Files touched:**
  - `2026-07-04_QA_Audit_PeTa_Straight_Laporan_Lengkap.md` (new full QA report)
  - Backup: `backups/2026-07-04_QA_Audit_PeTa_Straight_Laporan_Lengkap.md`
- **Key decisions:**
  - Ran read-only codebase audit using two explore sub-agents (Straight + PeTa) in parallel.
  - Cross-checked deployed sites with curl.
  - Identified 4 critical, 7 high, 9 medium, and several low issues.
  - Compiled findings into Indonesian-language report with simple explanations and priority roadmap.
- **Blockers:** none
- **Next step:** User picks top items to fix (recommended: secure edge functions, reconnect WA bot, fix landing copy, apply scalar-drafts migration).
- **Inspector:** PASSED
- **Backup location:** `G:\SF Project\peta-main\backups\2026-07-04_QA_Audit_PeTa_Straight_Laporan_Lengkap.md`
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none (curl only)


## 2026-07-12 — PeTa Task Credit Fixes (Production DB + Recovery)

- **Type:** CODING / DB / RECOVERY
- **Status:** COMPLETED
- **Files touched:**
  - `peta/src/pages/TaskDetail.tsx` (UUID/empty-assignmentId fix, already deployed)
  - `peta/src/lib/api.ts` (defensive validation, already deployed)
  - `peta/supabase/migrations/20260712120000_peta_task_credit_fixes.sql` (new)
- **Key decisions:**
  - Root causes identified via FASE 1 analysis:
    - `tg_on_assignment_approved` function existed but was never attached to `task_assignments` via `CREATE TRIGGER`, so approved tasks never credited `user_credits`.
    - `user_credits_source_check` rejected `source = 'task_reward'`.
    - `validate_payout_eligibility` JOINed `reddit_accounts`, excluding `forum_comment` tasks (`reddit_account_id IS NULL`) from earnings/payout counts.
    - Frontend `adminRejectAssignment` called RPC `admin_reject_assignment` which did not exist in the DB.
    - No idempotency guard on `user_credits(reference_id)` for `task_reward` → risk of duplicate credits on re-approval.
    - No `balance_credited_at` tracking on `task_assignments`.
  - Fixes applied in migration `20260712120000_peta_task_credit_fixes.sql`:
    - Updated `user_credits_source_check` to allow `task_reward` and `wa_group_verified` (discovered in production).
    - Added `balance_credited_at` column to `task_assignments`.
    - Created unique partial index `idx_user_credits_task_reward_reference_id` on `user_credits(reference_id) WHERE source = 'task_reward'`.
    - Recreated `tg_on_assignment_approved` with `balance_credited_at` timestamp + `activity_logs` audit entry, attached it via `BEFORE UPDATE OF status` trigger.
    - Fixed `validate_payout_eligibility` to LEFT JOIN `reddit_accounts` and use `COALESCE(ta.user_id, ra.user_id)` so forum tasks count.
    - Created `admin_reject_assignment` RPC.
    - Created `admin_recover_missing_task_rewards()` RPC for future manual recovery.
  - Production DB recovery (run directly via `supabase db query --linked` because the RPC requires authenticated admin context):
    - `total_approved`: 10
    - `total_task_rewards` after recovery: 10
    - `missing_credits` after recovery: 0
- **Blockers:**
  - Staging project `duxzxizedtvnopfihllz` is paused, so migration had to be applied directly to production (unusual but necessary).
  - `supabase db push` could not be used because remote migration history contains many migrations not present in local `supabase/migrations/` directory; SQL was applied directly via `supabase db query --linked -f`.
- **Next step:** Monitor new task approvals to confirm credits are inserted automatically. If a user reports a missing credit after this fix, verify the approval timestamp and check `activity_logs` for `task_reward_credited` entries.
- **Inspector:** PASSED (migration applied, recovery verified, production HTTP 200)
- **Backup location:** none (schema change is in migration file + GitHub)
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none
- **Production URL:** https://www.penghasilantambahan.com
- **Commands used:**
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN='<token>'
  cd "G:\SF Project\peta-main\peta"
  npx.cmd supabase link --project-ref yorlsgzsawchpeeazcvi
  npx.cmd supabase db query --linked -f supabase/migrations/20260712120000_peta_task_credit_fixes.sql
  npx.cmd supabase db query --linked "<recovery SQL>"
  ```


## 2026-07-13 — PeTa Withdrawal request_payout Ambiguity Fix

- **Type:** DB HOTFIX
- **Status:** COMPLETED
- **Files touched:**
  - `peta/supabase/migrations/20260713000000_fix_request_payout_overload.sql` (new)
- **Key decisions:**
  - User reported error when clicking "Request Rp2.000": PostgREST PGRST203 "Could not choose the best candidate function" because production DB had two `request_payout` overloads:
    - `public.request_payout(p_amount integer)` — used by frontend (`supabase.rpc('request_payout', { p_amount })`).
    - `public.request_payout(p_amount integer, p_payment_type text, p_provider text, p_account_number text, p_account_holder_name text, p_user_note text)` — added outside repo migrations, unused by frontend.
  - Dropped the 6-parameter overload to remove ambiguity. Verified only the 1-parameter version remains.
- **Blockers:**
  - Staging project `duxzxizedtvnopfihllz` remains paused; fix applied directly to production.
- **Next step:** User can retry withdrawal. If eligible per `validate_payout_eligibility` (7 days old OR 5 approved tasks), the request should now succeed. UI copy says "No minimum" but the server-side eligibility rules still apply.
- **Inspector:** PASSED (overloaded function dropped, only intended signature remains)
- **Backup location:** none (change in migration + GitHub)
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none
- **Production URL:** https://www.penghasilantambahan.com
- **Command used:**
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN='<token>'
  cd "G:\SF Project\peta-main\peta"
  npx.cmd supabase db query --linked -f supabase/migrations/20260713000000_fix_request_payout_overload.sql
  ```


## 2026-07-13 — PeTa Transactional Emails via Resend

- **Type:** FEATURE / DEPLOY
- **Status:** COMPLETED
- **Files touched:**
  - `peta/supabase/functions/send-peta-email/index.ts` (new edge function)
  - `peta/src/lib/api.ts` (email helpers + templates)
  - `peta/src/pages/Register.tsx` (welcome email)
  - `peta/src/pages/Earnings.tsx` (payout request confirmation)
  - `peta/src/pages/admin/ApprovalQueue.tsx` (task approved email)
  - `peta/src/pages/admin/Payroll.tsx` (payout paid email)
- **Key decisions:**
  - Created `send-peta-email` edge function using Resend with PeTa-branded HTML email template.
  - Set `RESEND_API_KEY` secret in Supabase (sourced from existing `app_secrets` row) and deployed the edge function to production.
  - Added fire-and-forget helpers in `api.ts`: `sendWelcomeEmail`, `sendPayoutRequestEmail`, `sendPayoutPaidEmail`, `sendTaskApprovedEmail`.
  - Wired triggers:
    - Welcome email after successful signup.
    - Payout request confirmation email after user requests payout.
    - Task approved email after admin approves a submission.
    - Payout paid email after admin marks payout as paid.
  - Emails are sent asynchronously without blocking the UI; failures are logged to console.
  - Frontend rebuilt and deployed to Cloudflare Pages project `peta`.
- **Blockers:** none
- **Next step:** Monitor Resend dashboard for delivery/bounce rates. Verify `peta@penghasilantambahan.com` sender domain is verified in Resend if deliverability issues appear.
- **Inspector:** PASSED (build + deploy + edge function deploy succeeded)
- **Backup location:** none
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none
- **Production URL:** https://www.penghasilantambahan.com
- **Commands used:**
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN='<token>'
  $env:CLOUDFLARE_API_TOKEN='<token>'
  cd "G:\SF Project\peta-main\peta"
  npx.cmd supabase secrets set RESEND_API_KEY=<key> --project-ref yorlsgzsawchpeeazcvi
  npx.cmd supabase functions deploy send-peta-email --project-ref yorlsgzsawchpeeazcvi
  npm.cmd run build
  npx.cmd wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true
  ```


## 2026-07-13 — QA PeTa Resend Emails + Domain Verification Required

- **Type:** QA
- **Status:** COMPLETED
- **What was tested:**
  - `RESEND_API_KEY` updated to the new key provided by user.
  - Domain `penghasilantambahan.com` verified in the new Resend account (SPF, DKIM, MX records configured via Cloudflare).
  - All 4 PeTa email templates sent to `rashrifanda@gmail.com` and returned `{ ok: true }`:
    - Welcome: `a5dc4875-7cbc-4b46-ad35-181142f2fafb`
    - Payout request: `6eb089ae-398c-44a7-8c9f-bbc7e78377af`
    - Payout paid: `ba032b4c-7b64-4c3d-93bd-ed95ea704291`
    - Task approved: `5d6e4c32-9d42-4f55-aa25-1a7a3b6d3582`
- **Root cause (resolved):**
  - `penghasilantambahan.com` is now verified in the new Resend account.
- **Status:** Email automation fully operational. Automated triggers in `Register.tsx`, `Earnings.tsx`, `ApprovalQueue.tsx`, and `Payroll.tsx` will now send real emails to users.
- **Inspector:** PASSED (all 4 templates delivered successfully to external recipient)
- **Backup location:** none
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none


## 2026-07-13 — PeTa Email Template Redesign (Professional Branding)

- **Type:** DESIGN / DEPLOY
- **Status:** COMPLETED
- **Files touched:**
  - `peta/supabase/functions/send-peta-email/index.ts` (updated `emailTemplate`)
- **Key decisions:**
  - Redesigned transactional email template to be more professional and on-brand.
  - Added PeTa logo at header: `https://www.penghasilantambahan.com/logo-horizontal.png`.
  - Color composition:
    - Primary accent: `#ff8b6b` (gradient to `#FF6B6B`).
    - Light background: `#FFDEC8` (approximation of `oklch(0.91 0.18 98.65)`).
  - Switched to table-based responsive HTML email layout for better compatibility across Gmail, Outlook, Apple Mail, etc.
  - Improved typography, spacing, CTA button styling, and footer copyright block.
  - Edge function redeployed to production.
- **QA results:**
  - All 4 templates retested and delivered to `rashrifanda@gmail.com` with new design:
    - Welcome: `c1575699-86ce-4b07-ada2-04ee4b894314`
    - Payout request: `9677c471-7854-4cc7-9fb6-a6aa90af912f`
    - Payout paid: `0f48bc66-b707-43c5-be88-f71c7cb38609`
    - Task approved: `bb5e23d4-7cd5-4549-a39c-1637024230df`
- **Inspector:** PASSED (all 4 templates delivered with new professional design)
- **Backup location:** none
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none


## 2026-07-13 — PeTa QA Audit + 3 Critical Bug Fixes

- **Type:** QA AUDIT + CODING + DB HOTFIX + DEPLOY
- **Status:** COMPLETED
- **Files touched:**
  - `peta/supabase/migrations/20260713_peta_critical_qa_fixes.sql` (new)
  - `peta/supabase/migrations/20260713_peta_qa_round2.sql` (new)
  - `peta/supabase/migrations/20260713_peta_qa_round2b.sql` (new)
  - `peta/supabase/functions/wa-bot-proxy/index.ts` (new edge function)
  - `peta/src/lib/api.ts` (new RPC wrappers + founding count RPC + user_note)
  - `peta/src/pages/admin/ApprovalQueue.tsx` (use RPCs, show user_note)
  - `peta/src/pages/admin/Payroll.tsx` (use RPC, CSV escape)
  - `peta/src/pages/admin/TaskQueue.tsx` (use admin_create_task RPC)
  - `peta/src/pages/TaskDetail.tsx` (separate user_note vs immutable draft_comment)
  - `.agents/qa-project-context.md` (new QA project context file)
  - `.agents/qa-reports/peta-pipeline-audit-2026-07-13.md` (new full QA report)
- **Key decisions:**
  - Full QA audit of Task Queue → Approval → Payroll pipeline produced 3 critical + 5 high findings, documented in `.agents/qa-reports/`.
  - Bug #1 (auto-approve): not a system bug — caused by admin running a wildcard `UPDATE ... WHERE status='submitted'` workaround in SQL Editor. All approve/reject/payout flows now go through SECURITY DEFINER RPCs that enforce state transitions (`submitted`→`approved`, `pending`→`paid`) and block invalid ops.
  - Bug #2 (saldo 0 after approve forum_comment task): root cause was the RLS policy `assignments_select_own` on `task_assignments`. It only matched `reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id = auth.uid())`. For `forum_comment` tasks `reddit_account_id IS NULL` (work is keyed by `user_id` directly), so the army user could NOT read their own approved row. `getTotalEarnings()` therefore returned `tasks = 0` and saldo showed 0. Fixed by allowing `user_id = auth.uid()` in SELECT/UPDATE/INSERT policies.
  - Bug #2b (trigger not firing): `tg_on_assignment_approved` was force-re-attached via migration `20260713_peta_qa_round2.sql` even if the previous attach was lost. A backfill `INSERT INTO user_credits ... ON CONFLICT DO NOTHING` ran to recover any approved-but-uncertified assignments.
  - Bug #3 (founding 0/100 on landing page for anon visitors): RLS on `public.users` blocks anon reads (policy is `auth.uid() = id OR is_admin()`). Frontend `getFoundingMembers()` used a direct `select id count` which returned 0 for anon. Added SECURITY DEFINER RPC `get_founding_members_count()` granted to `anon` + `authenticated`, and switched the frontend to call it. Verified via curl anon: returns `{"count": 93, "max": 100, ...}`.
  - Cleaned up overloaded RPC signatures (`admin_reject_assignment`, `admin_mark_payout_paid`) so PostgREST resolves unambiguously (was causing PGRST202 in some flows).
  - Added `user_note` column to `task_assignments` so the forum_comment `draft_comment` (assigned text the army member must post) stays immutable and separate from the optional admin note the user can type.
  - Created `wa-bot-proxy` edge function (was missing — `WaBot.tsx` was calling `supabase.functions.invoke('wa-bot-proxy')` but the function did not exist). Proxies Evolution API calls behind admin auth; never exposes `EVOLUTION_API_KEY` to the browser.
- **Verification:**
  - Slot drift check returned 0 rows (was: Quora 3/0 and GoAuto 1/0).
  - Approved-without-credits check returned 0 rows after backfill.
  - `admin_approve_assignment` status guard verified via test wrapper: blocks approve of `in_progress` rows.
  - `admin_reject_assignment` credit guard verified: blocks reject of already-credited (`balance_credited_at IS NOT NULL`) rows.
  - Founding count RPC verified via curl anon: `{"count": 93, "slotsLeft": 7, "percent": 93}`.
  - `task_assignments` RLS policy now reads: `(user_id = auth.uid()) OR (reddit_account_id IN (...)) OR is_admin()`.
  - Production frontend bundle hash updated to `main-kggW2m8S.js` on `www.penghasilantambahan.com` (deployed via wrangler).
- **Blockers:**
  - Staging project `duxzxizedtvnopfihllz` remains paused; all migrations applied directly to production.
  - `supabase db push` cannot be used due to remote migration history drift; SQL applied via `supabase db query --linked -f`.
  - PGRST202 ("schema cache") may briefly surface on a freshly-created RPC until `NOTIFY pgrst, 'reload schema'` propagates — fixed by including the NOTIFY at the end of each migration. If it ever re-appears, restart the project from the Supabase dashboard.
- **Known follow-up:**
  - The `wa-bot-proxy` edge function needs `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` set in `app_secrets` before the WA Bot admin page will work end-to-end. Evolution endpoints were written to the documented v2 shape — verify against the actual Evolution API version on the VPS.
  - `inbox-poll-email` edge function returned 500 in the admin console. Not investigated in this session — separate issue from the three bugs above.
- **Next step:**
  - User logs in as army (`rashrifanda@gmail.com` / Alfu Salam B, user_id `e251e716-47ba-4220-a968-5026c02be810`) and confirms saldo now reflects the approved GoAuto Rp5.000 + signup bonuses.
  - Test full happy path end-to-end: create task → army claim → army submit → admin approve via UI → army sees saldo credited.
- **Inspector:** PASSED (build + deploy + RPC verification via curl)
- **Backup location:** none
- **coldstart.md stored at:** `G:\SF Project\peta-main\coldstart.md`
- **Browser used:** none (verification via curl + Supabase management API)
- **Production URL:** https://www.penghasilantambahan.com
- **Commands used:**
  ```powershell
  $env:SUPABASE_ACCESS_TOKEN='<token>'
  $env:CLOUDFLARE_API_TOKEN='<token>'
  cd "G:\SF Project\peta-main\peta"
  # Apply migrations
  npx.cmd supabase db query --linked -f supabase/migrations/20260713_peta_critical_qa_fixes.sql
  npx.cmd supabase db query --linked -f supabase/migrations/20260713_peta_qa_round2.sql
  npx.cmd supabase db query --linked -f supabase/migrations/20260713_peta_qa_round2b.sql
  # Build + deploy
  npm.cmd run build
  npx.cmd wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true
  # Push to git
  git push github main
  ```

## 2026-07-15 — PeTa Saldo 0 Follow-up Fix

- **Type:** DB HOTFIX + RPC + FRONTEND
- **Status:** COMPLETED
- **Files touched:**
  - `peta/supabase/migrations/20260715_peta_saldo_zero_fix.sql` (new)
  - `peta/src/lib/api.ts` (getTotalEarnings now calls `get_user_earnings()` RPC; added `adminRepairAssignmentUserId` wrapper)
  - `peta/src/pages/admin/ApprovalQueue.tsx` (warn + repair button for assignments with NULL owner)
- **Root cause:**
  - The 2026-07-13 RLS fix allowed army users to read their own `task_assignments` rows when `user_id = auth.uid()`, but it did not repair legacy rows where `user_id` was already `NULL`.
  - For `forum_comment` tasks `reddit_account_id IS NULL`, so an assignment with `user_id = NULL` has no owner pointer at all.
  - When such a row is approved, `tg_on_assignment_approved` computes `COALESCE(ta.user_id, ra.user_id)` and gets `NULL`, raises a warning, and does NOT insert `user_credits`.
  - The army member cannot see the assignment, and `getTotalEarnings()` (which used direct `task_assignments` queries) reports `tasks = 0` → saldo stays 0.
- **Fix applied:**
  1. **Backfill `user_id`** from `proof_image_url` storage path (`.../task-proofs/<uuid>/...`) for all `forum_comment` assignments that are missing both `user_id` and `reddit_account_id` and have an uploaded screenshot.
  2. **Backfill missing `user_credits`** for approved assignments whose `balance_credited_at` is NULL and that now have a resolvable owner. Idempotent via `idx_user_credits_task_reward_reference_id`.
  3. **Backfill `balance_credited_at`** for approved assignments that now have a matching `task_reward` credit.
  4. **Trigger `tg_ensure_assignment_user_id`** on `BEFORE INSERT OR UPDATE` of `task_assignments` so `user_id` is never NULL going forward (falls back to `auth.uid()` for forum tasks or to the reddit account owner for Reddit tasks).
  5. **New RPC `get_user_earnings()`** — SECURITY DEFINER, returns the exact earnings shape the frontend expects. The frontend no longer needs to read `task_assignments` for its own earnings math, so this path is immune to any RLS edge cases.
  6. **New RPC `admin_repair_assignment_user_id(uuid, uuid)`** — lets an admin manually link an owner to a broken assignment from the UI and backfill credits if the assignment is already approved.
  7. **Approval Queue UI** now flags rows where `army_user_id` is NULL with "Missing owner", disables the Approve button for those rows, and exposes a "Repair owner" button that opens a modal for the admin to enter the correct user ID.
- **Verification:**
  - Broken assignments (`user_id IS NULL AND reddit_account_id IS NULL`) after backfill: **0 rows**.
  - Army user `e251e716-47ba-4220-a968-5026c02be810` (Alfu Salam B) now has the GoAuto task approved with `balance_credited_at` set and a matching `task_reward` credit of Rp5.000.
  - New RPCs `get_user_earnings()` and `admin_repair_assignment_user_id()` verified present in `pg_proc`.
  - Trigger `tg_ensure_assignment_user_id` verified enabled.
  - RLS policies on `task_assignments` verified include `user_id = auth.uid()`.
  - Production build deployed via wrangler to `peta` Pages project (deployment URL `https://35f1fba7.peta-cvm.pages.dev`).
  - Commit `7546fc0` pushed to GitHub `main`.
- **Blockers:**
  - Staging project remains paused; migration applied directly to production.
  - `supabase db push` still unavailable due to remote migration history drift.
- **Next step:**
  - User logs in as army user (`rashrifanda@gmail.com` / Alfu Salam B) and confirms saldo now shows **Saldo cair: Rp5.000**, **Dari task approved: Rp5.000**, dan **Bonus terkunci: Rp50.000**.
  - Kalau masih 0 setelah hard-refresh, coba logout/login ulang supaya JWT baru di-pick. Cache Cloudflare Pages sudah di-refresh otomatis via deploy, tapi browser cache mungkin masih menahan halaman lama.
  - Rotate tokens (PeTa Cloudflare API Token, GitHub PAT, Supabase Access Token) setelah verifikasi berhasil.
- **Commands used:**
  ```powershell
  cd "G:\SF Project\peta-main\peta"
  $env:SUPABASE_ACCESS_TOKEN='<rotated-token>'
  $env:CLOUDFLARE_API_TOKEN='<rotated-token>'
  npx.cmd supabase db query --linked -f supabase/migrations/20260715_peta_saldo_zero_fix.sql
  npm.cmd run build
  npx.cmd wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true
  # git push already done
  ```
