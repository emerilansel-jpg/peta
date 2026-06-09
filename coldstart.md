# Cold Start Handoff - Straight Ltd + PeTa

> ⚠️ LATEST (2026-06-10): read **`docs/CHECKPOINT_20260610_audit_round.md`** FIRST — it supersedes the
> git-state and paths below. Active repo is now **`G:\SF Project\peta-main`** (NOT the `D:\Claude Cowork`
> path below). Latest work is on branch **`fix/audit-2026-06-09`** — committed, NOT pushed/merged, and
> **prod is already live with it** (deployed to BOTH Pages projects `peta` + `straight`).

Last updated: 2026-06-04 (audit round 2026-06-09/10 — see checkpoint linked above)

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
284aa0e Straight Ranking Forum UX: bird-eye select, hide provider, bulk suggested
1ddf761 Improve ranking provider error details
f00cd47 Add provider dashboard links to health cards
47348be Add provider health remediation hints
8aeb0e7 Show DataForSEO balance in provider health
e87476b Add SerpAPI ranking provider fallback
3f0cc03 Show ranking provider preview notices
c9a77b8 Add Straight provider health checks
e5b1cbf Improve ranking fallback UX and comment context fetch
fe42608 Enforce task quotas and duplicate comment blocking
2291d14 Improve ranking forum persistence and DataForSEO parsing
```

Expected dirty state at handoff:

```text
 M peta/src/pages/admin/ApprovalQueue.tsx
?? coldstart.md
?? "image (1).png"
```

Notes:

```text
coldstart.md is this handoff file.
image (1).png is unrelated and must be preserved.
peta/src/pages/admin/ApprovalQueue.tsx has an uncommitted local enhancement for WhatsApp DM prompts after rejection. Review before committing or deploying.
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
cd "D:\Claude Cowork\Reddit Army Local\peta"
npm.cmd run build
```

Deploy frontend to Cloudflare Pages:

```powershell
cd "D:\Claude Cowork\Reddit Army Local\peta"
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
