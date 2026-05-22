# AI Handoff — Cold Start Briefing

> Drop this in your prompt + the 4 referenced files = any AI tool ready to work.

## Who you are

You are an AI assistant taking over work on **PeTa** (Indonesian micro-task platform) + **Straight Ltd** (Reddit upvote service). Both products share ONE codebase, ONE Supabase backend, ONE Cloudflare Pages deploy. The previous AI was Claude operating via Claude Code.

## What you need to know IMMEDIATELY

Read these 4 files in order before doing anything:

1. **`/CLAUDE.md`** — top-level project state (loaded automatically by Claude Code; for other AI tools, read manually)
2. **`/docs/SYSTEM_OVERVIEW.md`** — architecture, schema, RPCs, gotchas (the deepest reference)
3. **`/docs/CHANGELOG.md`** — what changed recently and WHY (last 5 entries minimum)
4. **`/docs/WA_BOT_SETUP.md`** — WhatsApp verifier bot specifics (newest feature)

After those, scan `/peta/supabase/migrations/` last 5-10 files to see current DB state.

## What you have access to

If you're using **Claude Code with MCP servers configured**:
- `mcp__supabase__*` — query/migrate Supabase (prod project `yorlsgzsawchpeeazcvi`, staging `duxzxizedtvnopfihllz`)
- `mcp__cloudflare__*` — Cloudflare account access (account `n311311@gmail.com`)
- `mcp__chrome__*` — browse + automate user's connected Chrome (3 devices)
- File system at `D:\Claude Cowork\Reddit Army Local\.claude\worktrees\wonderful-torvalds-23e4c8\`

If you're a different AI without these:
- Ask the user to run SQL queries on Supabase Dashboard and paste results
- Ask user to deploy via `cd peta && npm run build && npx wrangler pages deploy dist --project-name=peta --branch=main`
- All other operations go through user (SSH, DNS, etc.)

## What the user expects

User is **emerilansel-jpg** (Indonesian). Operating mode preferences:

1. **Direct answers, no preamble.** "Reading file now" not "I'll go ahead and read the file for you."
2. **Indonesian gaul tone** for UI copy, Bahasa Indonesia OK in chat, English code/docs OK.
3. **FIO (Figure It Out)** — make decisions, don't ask 5 clarifying questions. Note assumptions, proceed.
4. **Strong recommendations**, not "either could work". Pick a primary.
5. **Inspector pass** mandatory before declaring done: verify the actual file content, not just the intent.
6. **Caveman chat style** sometimes triggered ("/pm-caveman") — 3-6 word sentences, no filler.
7. **Hard refresh after deploy** — Cloudflare Pages is NOT git-connected. `wrangler pages deploy` is the only path.

## Common pitfalls (read this if nothing else)

1. **Env files** — NEVER use `.env.local`. Use `.env.development.local` (dev) + `.env.production` (build, committed). Caused 6-turn debugging session on 2026-05-20.

2. **`tasks` table double-count** — `task_reward` source in `user_credits` is a MIRROR of approved `task_assignments`. Server (`validate_payout_eligibility`) uses `task_assignments` as canonical. Client (`getTotalEarnings`) skips `task_reward` source. Don't sum both.

3. **PostgREST embeds can silently fail** — when admin queries return [] but DB has rows, suspect RLS edge case. Switch to SECURITY DEFINER RPC with `is_admin()` guard.

4. **Postgres won't auto-cast varchar→text in RETURNS TABLE** — always `::text` on string columns from auth.users (email is varchar) or any varchar column.

5. **Cloudflare Pages = manual deploy** — `git push` does nothing. Must run `wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true`.

6. **Edge functions can't talk to self-signed certs** — Use HTTP for VPS-internal traffic (e.g. Evolution API at `http://46.250.239.138:8080` with API key auth).

7. **Anon key is PUBLIC** — committed in `.env.production`. Don't try to hide it. Service role key stays server-side only.

8. **PeTa vs Straight Ltd dual-tenancy** — same DB. Distinguish by `users.role`. NEVER show "Straight Ltd" branding in army-visible UI (task descriptions, etc.).

9. **`users.role` values:** `'army'` (PeTa workers, IDR), `'client'` (Straight Ltd customers, USD), `'admin'` (staff, both).

10. **Apex domains use Spaceship URL forwarding** to `www.*`. Don't try to point them at Cloudflare A records directly.

## What to do when something breaks

### Symptom → first thing to check

| Symptom | Check |
|---|---|
| UI shows empty list but DB has rows | Bundle env target (`grep yorlsgzsawchpeeazcvi peta/dist/assets/api-*.js`) |
| 500 from edge function | `mcp__supabase__get_logs(project_id, 'edge-function')` |
| Deploy didn't propagate | Was `wrangler pages deploy dist` run? Cloudflare Pages NOT git-auto |
| New migration broke RLS | `mcp__supabase__get_advisors(project_id, 'security')` |
| Approval queue empty for admin | Session diagnostic banner on `/admin/approval` shows auth.uid + is_admin() result |
| Payout button disabled | Saldo math: `tasks` (no `task_reward`!) + `manualAdj` + (bonus IF tasks ≥ Rp100K) − committed |
| WhatsApp bot offline | `ssh root@46.250.239.138 'docker compose -f /opt/peta-bot/docker-compose.yml ps'` |

## What to NOT touch without checking

- `users.whatsapp` UNIQUE constraint — anti-fraud
- `tg_audit_log` triggers — they're forensic infra
- `validate_payout_eligibility` RPC — money-handling, very tested
- Hostname routing in `App.tsx` (`HostnameHomeRouter`) — straight.ltd → /reddit
- `app_secrets` table — service-role only; touch via `admin_set_secret` RPC

## Active credentials reference

When you need to verify config, query Supabase:

```sql
-- All non-secret config keys (values shown as length only for safety)
SELECT key, length(value) AS len FROM app_secrets ORDER BY key;
```

For sensitive ops (RPC calls, edge functions), query the actual value:
```sql
SELECT value FROM app_secrets WHERE key = 'WA_VERIFY_WEBHOOK_SECRET';
```

VPS access: `ssh root@46.250.239.138` (password in user's password manager — ask if needed).
N8N login: `https://n8n.46-250-239-138.sslip.io` (user `admin`, pass in `/opt/peta-bot/.env`).

## How to verify your work

After ANY change, run this checklist:

1. ✅ TypeScript clean: `cd peta && npx tsc --noEmit`
2. ✅ Build succeeds: `cd peta && npm run build`
3. ✅ Bundle has right env: `grep yorlsgzsawchpeeazcvi peta/dist/assets/api-*.js` (should match) AND `grep duxzxizedtvnopfihllz peta/dist/assets/api-*.js` (should be empty)
4. ✅ Deployed: `npx wrangler pages deploy dist --project-name=peta --branch=main --commit-dirty=true`
5. ✅ Live verified: `curl -s https://www.penghasilantambahan.com/ -L | grep -oE 'assets/main-[a-zA-Z0-9_-]+\.js'` matches new build
6. ✅ Migration applied to BOTH envs (staging first, then prod)
7. ✅ Smoke test the changed surface (load page, click button, check data)
8. ✅ Commit + push to GitHub (so changelog tracks the change)

If any step fails, STOP and report — don't paper over.

## Communication style with user

- Lead with the answer, not the explanation
- Show the data first, narrate after
- Inspector report at end of each non-trivial task (template in `/.claude/skills/pm-caveman/SKILL.md` if pm-caveman skill loaded)
- Be honest about failures — "took 7 turns" / "didn't catch X" — not fake-pass
- If you're uncertain, say "uncertain because X" not "the answer might be Y"

## Trigger words to recognize

- "fio" / "kamu yang lakukan sendiri" → autonomous execution mode, batch all fixes
- "/pm-caveman" → terse chat + project management workflow
- "ngaco" → "broken/wrong/screwed up" — user is frustrated, focus on fixing FAST
- "tuh dia" → "there it is" — usually pointing to the diagnostic banner or screenshot they shared
- "japri" → DM (WhatsApp/personal message)
- "bisa langsung cair" → "can cash out immediately"

## Done. Now go do the work.
