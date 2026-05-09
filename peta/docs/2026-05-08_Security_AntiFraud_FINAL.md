# Anti-Fraud / Anti-Leak / Anti-Calculation-Error — Free & Cheap Wins

Cost guidance: each item is tagged **(free)**, **($)** = under $20/mo, **(time only)** = no $ cost but admin time.

Ranked by impact-per-effort. Do them in order.

---

## Tier 1 — Do this week (highest impact, lowest cost)

### 1. Daily payout double-check ritual (free, time only)
**Risk:** wrong payout amount → out-of-pocket leak.
**Fix:** before clicking "Approve" on any payout, calculate `total = approved_tasks * reward_per_task + bonuses` against the `payouts.amount` SQL column. If mismatch > Rp1.000, reject + investigate.

I'll add an `expected_amount` column + auto-compare. (See item 6 — system-side fix.)

### 2. Mandatory 7-day holding period before first payout (free)
**Risk:** signup → claim Rp50K bonus → instant payout → ghost. Net loss = Rp50K per fake account × N attackers.
**Fix:** RPC-level check: payout request blocked if `created_at < 7 days ago` AND `approved_task_count < 5`.
Forces attacker to actually do tasks before touching cash, breaking the easy farming loop.

### 3. Phone-number uniqueness enforcement (free)
**Risk:** one person creates 10 accounts, claims 10× Rp25K signup bonus = Rp250K loss.
**Fix:** add unique constraint on `users.whatsapp` (already partially the case — verify). RPC `admin_create_member` should reject duplicate phones with explicit error.

### 4. IP + device-fingerprint logging (free)
**Risk:** account farming via VPN, multi-account, bot signups.
**Fix:** capture `request.ip` + `user_agent` on signup → store in `activity_logs`. Spike of >3 signups from same IP/UA in 1 hour = auto-flag for admin review.

### 5. Hard-cap payout per user per week (free)
**Risk:** social engineering / panic — someone tricks admin into approving Rp10jt payout.
**Fix:** RPC enforces `weekly_payout_total <= Rp500.000` per user without explicit admin override. Anything bigger requires `admin_override_payout()` RPC with reason logged.

---

## Tier 2 — Do this month (medium effort, big peace of mind)

### 6. Server-side payout calculation RPC (free, ~1 hour to build)
**Risk:** admin types wrong amount in approval form, money flows wrong.
**Fix:** new RPC `calculate_user_balance(user_id)` returns:
```sql
{
  total_earned_from_tasks: <sum of approved task rewards>,
  total_credits: <sum of user_credits>,
  total_paid_out: <sum of paid payouts>,
  available: total_earned + total_credits - total_paid_out
}
```
Admin payout form pre-fills `available` from this RPC — admin can't manually inflate.

### 7. RLS audit + advisor scan (free, 5 min — already partial)
**Risk:** Supabase policy bug exposes other users' data / writable from client.
**Fix:** run Supabase Performance + Security advisors monthly:
```
mcp__supabase__get_advisors({type: 'security'})
mcp__supabase__get_advisors({type: 'performance'})
```
Already done once this session. Make it a monthly checkpoint.

### 8. Admin 2FA via Supabase Auth (free)
**Risk:** admin password leaked → attacker impersonates admin → drains payouts.
**Fix:** enable Supabase MFA for admin role. Settings → Authentication → MFA → require TOTP for `role='admin'` users. Setup via authenticator app (Google Authenticator / 1Password / Authy).

### 9. Sentry / Better Stack error monitoring (free tier)
**Risk:** silent JS errors causing payout calculations to misfire on admin's browser.
**Fix:** Sentry free tier gives 5K events/month. Inject SDK in `main.tsx`. Get alert on every JS exception in admin pages.

### 10. Read-only DB replica for analytics queries ($)
**Risk:** running analytics SQL on prod DB = potential data corruption if a typo'd UPDATE runs.
**Fix:** Supabase Branching ($) creates a read replica for non-production queries. Or just always run analytics via `BEGIN; ... ROLLBACK;` in a transaction.

---

## Tier 3 — Do this quarter (foundational)

### 11. Audit log on every credit + payout mutation (free)
**Risk:** "where did Rp50K go?" — no way to trace mutations.
**Fix:** trigger on `user_credits` + `payouts` writes a row to `audit_log` (table_name, row_id, action, before_json, after_json, actor_id, ts). Then any leak is forensically traceable to who, when, why.

### 12. Whitelist-only e-wallet recipients (time only)
**Risk:** attacker changes their `e-wallet account` field to admin's account → payout drains to attacker disguised as admin.
**Fix:** `users.e_wallet` becomes immutable after first verification. Changes require admin approval + 24-hour cooldown.

### 13. Daily admin dashboard email digest ($)
**Risk:** something goes wrong overnight, admin doesn't notice for 2 days.
**Fix:** daily 8am email: pending payouts, suspicious signups, unusual karma claims, total balance owed to PeTa Army. Resend (free tier) or Vercel cron + simple email template.

### 14. Penetration test of public RPCs (time only)
**Risk:** public RPC accidentally writes when it shouldn't.
**Fix:** monthly: anon login, try every RPC with malformed args. Document results. Currently RPCs use `SECURITY DEFINER` which is safe but easy to misconfigure. Test that:
- `submit_karma_claim` rejects `claimed_karma < 0`
- `dismiss_wa_group` requires auth.uid()
- `admin_set_karma` rejects non-admin callers
- `claim_onboarding_bonus` is idempotent per step

### 15. Backup + restore drill (free, 1× per quarter)
**Risk:** Supabase tier outage / accidental table drop → data gone.
**Fix:** Supabase free tier auto-backups daily for 7 days. Once a quarter: download a backup → restore to a fresh staging branch → verify integrity.

---

## Cost summary

| Tier | Monthly cost | Time cost | Risk reduction |
|---|---|---|---|
| Tier 1 (5 items) | Free | ~3 jam total dev + ongoing 5 min/day admin ritual | ~70% of fraud surface |
| Tier 2 (5 items) | $0-15 | ~6 jam dev | ~20% additional |
| Tier 3 (5 items) | $5-25 | ~10 jam dev | ~10% (foundational) |

**Recommendation:** Item #1 + #2 + #3 + #5 = 4 items, all free, ship in 2 hours of dev. Closes ~60% of fraud surface immediately.

---

## What I CAN'T fix from code (your responsibility)

- **Phishing**: never share Supabase service-role key with anyone via DM/screenshot. If accidentally shared → rotate immediately via Supabase dashboard.
- **Vercel access**: enable 2FA on Vercel account.
- **GitHub access**: enable 2FA on GitHub. Repo is private — keep it private.
- **Domain hijacking**: enable 2FA on Spaceship.com (DNS provider).
- **Admin email**: `info@jetdigitalpro.com` — change the default `peta` password to a strong one + enable 2FA.
- **Social engineering**: payout requests via WhatsApp = always verify via in-app, never via DM screenshot. Attacker scenario: "my account got banned, please pay me Rp200K via Dana to <attacker number>".
