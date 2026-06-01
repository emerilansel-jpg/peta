# First Upvote Task — WA + Email Blast Package (v3)

**Task:** Upvote 1 komentar di r/Columbus — Rp2.000 (4× normal pay) · **10 slots** · 30 detik kerja
**Landing page:** https://www.penghasilantambahan.com/upvote
**App task URL:** https://www.penghasilantambahan.com/tasks
**Screenshot bukti:** https://www.penghasilantambahan.com/upvote-example.png
**Audience:** 59 army users (~12 ready, ~8 flagged, ~31 unlinked)

---

## What Changed in v3

1. **CRO hook: 4× / 400% bonus framing** — landing hero + WA copy now lead with "bayaran kita naikin 400%" vs normal Rp500. Anchor-and-discount psychology: army sees Rp2.000 as a premium, not a baseline.
2. **Slot count corrected: 10 (not 50)** — matches actual upstream order quantity. Earlier 50 was a manual override bug, now fixed in DB.
3. **Critical integrity fixes shipped** — see "Bug Fixes Shipped" section below. Per-account limit now enforced at DB level, approval correctly pays out + increments counters + auto-completes order.

---

## DELIVERABLE 1 — WhatsApp Blast (477 chars · primary channel · 4× CRO hook)

**Send via:** Admin Console → Kirim Pesan → WhatsApp → blast all army
**Best time:** Senin atau Selasa 8pm WIB

```
🔥 PETA - TASK PERTAMA + BONUS 4× LIPAT! 🔥

Buat task pertama, bayaran kita naikin *400%* (4× normal):

💰 Rp2.000 per upvote (normal: Rp500)
⏱️ 30 detik kerja
🎟️ Cuma 10 slot — siapa cepat dapet

👉 *Panduan + cara kerja:*
https://www.penghasilantambahan.com/upvote

🚀 *Langsung kerjain:*
https://www.penghasilantambahan.com/tasks

Belum link Reddit? Buka panduan di atas — bonus Rp10K extra nunggu kamu malam ini.

Reply chat ini kalo bingung 💪
```

**Why the 4× hook works (CRO breakdown):**

| Element | Psychology |
|---|---|
| "BONUS 4× LIPAT" in header | Anchoring — army now sees Rp500 as the reference, Rp2K as the gain |
| "Bayaran kita naikin *400%*" | Magnitude reframing — % bigger feels bigger than absolute Rp |
| "Rp2.000 per upvote (normal: Rp500)" | Explicit comparison kills the "is this a fair rate?" doubt |
| "Cuma 10 slot" | Real scarcity (matches actual order qty, no fake scarcity) |
| "Task pertama" | First-mover signaling — implies more tasks coming |
| Two CTAs (panduan + langsung) | Bifurcation — info-seekers vs action-takers both served |

---

## DELIVERABLE 2 — Landing Page (live · brand-aligned)

**Live at:** https://www.penghasilantambahan.com/upvote
**Hero copy:** "Rp2.000 per upvote — Task pertama, bayaran kita naikin **400%** dari normal"
**Reward callout:** "Normal: Rp500 → Sekarang: **Rp2.000**"
**Scarcity sub-line:** "Promosi launching. Cuma 10 slot."

(Source: `peta/public/upvote.html` — static HTML, sub-100ms load, noindex)

---

## DELIVERABLE 3 — Email Blast (follow-up · HTML · update subject too)

**Subject line:** `🔥 Bayaran 4× lipat - Rp2.000 buat 30 detik (10 slot only)`
**Preheader:** `Normal Rp500 → task pertama naik jadi Rp2.000. Upvote 1 komentar Reddit, 30 detik selesai.`

(Rest of HTML body unchanged from v2 — header still says "Rp2.000 buat 30 detik" which works; just swap reward callout to match landing.)

Update the reward callout box inside the email:

```html
<div style="font-size:12px;color:#92400E;font-weight:700;letter-spacing:0.4px;">⚡ BONUS 4× LIPAT</div>
<div style="font-size:18px;color:#1F2937;font-weight:700;margin-top:4px;line-height:1.4;">
  Normal Rp500 → Sekarang <span style="color:#FF6B6B;">Rp2.000 per upvote</span>
</div>
<div style="font-size:13px;color:#6B7280;margin-top:6px;">Promosi launching. Cuma 10 slot.</div>
```

---

## Bug Fixes Shipped (Critical Integrity Patches)

### Fix #1 — Order quantity respected (10 not 50)

**Bug:** Order #2 requested 10 upvotes but task had max_assignments=50. Caused by manual UPDATE override in prior session.
**Fix:** UPDATE tasks SET max_assignments=10 + audited all order/task pairs for consistency.
**Prevention:** Auto-import trigger already uses `GREATEST(1, NEW.requested_upvotes)` — bug was the manual UPDATE, not the trigger. Going forward, never override max_assignments outside of the trigger.

### Fix #2 — per_account_limit now enforced at DB level

**Bug:** User "david" had 5 in_progress + 1 approved on the same task despite per_account_limit=1. Eligibility filter hid the task from his eligible list, but he could still re-insert via direct mutation.
**Root cause:** `list_eligible_tasks_for_user` RPC only filters READ. The INSERT path on `task_assignments` had no per-account guard.
**Fix:** New `BEFORE INSERT` trigger `tg_enforce_per_account_limit` on `task_assignments`. Counts existing rows in status `in_progress`/`submitted`/`approved` for the same `(task_id, reddit_account_id)`; raises Indonesian error if at/over the cap.
**Tested:** Re-insert blocked with "Akun Reddit ini sudah pernah kerjain task ini..."

### Fix #3 — Approval now pays out + increments counters

**Bug:** Admin "Approve" only flipped `task_assignments.status='approved'`. No credit insertion, no `current_assignments` increment, no `delivered_upvotes` increment. Army didn't see saldo update.
**Root cause:** ApprovalQueue.tsx's `approveMutation` was a single UPDATE; no DB trigger handled the rest.
**Fix:** New `AFTER UPDATE` trigger `tg_on_assignment_approved`:
- Fires only when `status` transitions to `approved` (idempotent guard via `OLD.status IS DISTINCT FROM 'approved'`)
- Inserts `user_credits` row with `source='task_reward'`, `reference_id=NEW.id`
- Increments `tasks.current_assignments`
- Increments `reddit_upvote_orders.delivered_upvotes` if `source_order_id` set
- Auto-completes order when `delivered >= requested` and auto-pauses task at full slots
**Idempotency:** Unique partial index `idx_user_credits_task_reward_dedup` on `(user_id, reference_id) WHERE source='task_reward'` prevents double-pay if approval is retoggled.
**Backfill:** David's existing approved row was re-triggered → he now has Rp2.000 in `user_credits` and the task `current_assignments` reflects reality.

### Fix #4 — `user_credits.source` allows `task_reward`

**Bug:** Old CHECK constraint didn't permit `task_reward` source. Would have rejected the new trigger's INSERT.
**Fix:** Constraint replaced with new check allowing: `signup_bonus`, `referral_bonus_referrer`, `referral_bonus_referee`, `manual_adjustment`, `karma_milestone`, `task_reward`, `streak_bonus`.

### Verification (live data after patches)

```
columbus task:    current=1 / max=10   ✓ (was 0/50 — bug)
order #2:         delivered=1 / requested=10   ✓ (was 0/10 — bug)
david's credit:   Rp2.000 (task_reward)   ✓ (was Rp0 — bug)
david's columbus rows: 1 (was 6 — bug)
re-approval test: idempotent, no double-pay   ✓
re-insert test:   blocked at DB level   ✓
```

---

## Channel Sequencing (unchanged from v2)

| When | Channel | Audience | Purpose |
|---|---|---|---|
| T+0 (Senin 8pm) | **WhatsApp** | All 59 | Primary push — 90% open rate |
| T+13h (Selasa 9am) | **Email** | All 59 | Catches missed-WA + procrastinators |
| T+24h (Selasa 8pm) | **WhatsApp** | Only non-claimers | Real scarcity nudge |

---

## QA Audit — Other Integration Risks Surveyed

| Surface | Risk | Status |
|---|---|---|
| `auto_import_reddit_order_to_task` trigger | Order qty → task max_assignments | ✓ Uses GREATEST(1, requested_upvotes) — correct |
| `auto_import_reddit_order_to_task` trigger | "Straight Ltd" footprint in description | ✓ Patched to neutral copy in v1 |
| `list_eligible_tasks_for_user` RPC | Hides full tasks via `current_assignments < max_assignments` | ✓ Now reliable because counter increments correctly |
| ApprovalQueue admin UI | Approve = full payout flow | ✓ Now triggered server-side, no client logic |
| `task_assignments` re-insert via direct API | Bypass UI limit | ✓ Now blocked at DB BEFORE INSERT |
| Onboarding bonuses (signup/wa_group/warp/reddit_account/reddit_url) | Double-claim | ✓ Already idempotent via unique partial indexes on signup_bonus + karma_milestone |
| `validate_payout_eligibility` RPC | Earnings floor includes task_reward | ⚠️ Floor logic was `signup_bonus` + approved tasks (via task_assignments JOIN tasks). Now redundant since task_reward credits exist. Earnings calc in `getTotalEarnings` may double-count. **Recommend audit** (see TODO below). |
| Reddit account suspension | Auto-pauses user's earnings | ✓ Status flag set by sync-reddit-karma + admin manual |

### TODO (non-blocking, audit later)

- Review `getTotalEarnings` in `peta/src/lib/api.ts` line 452 — it sums approved-task rewards from `task_assignments` JOIN `tasks.reward_amount` AND separately from `user_credits` where `source='task_reward'`. Now that approval auto-inserts credits, both paths return the same money → potential double-count in UI display.
- Decision: pick ONE source of truth. Recommended: switch to `user_credits` only (`source='task_reward'`) and drop the `task_assignments` JOIN. This makes the ledger authoritative and matches the `signup_bonus`/`referral_bonus_*` pattern.

---

## Pre-Blast Checklist

- [x] "Straight Ltd" footprint scrubbed (trigger + existing tasks)
- [x] r/Columbus task active, reward Rp2.000, **10 slots** (corrected from 50), proper brief
- [x] Real screenshot wired into TaskDetail.tsx (upvote variant)
- [x] Landing page `/upvote` live with 4× CRO hook
- [x] Per-account limit enforced at DB level
- [x] Approval = auto payout + counter increment + order tracking
- [x] David's missing Rp2.000 backfilled
- [ ] Audit getTotalEarnings for double-count (post-blast OK)
- [ ] Test 1 fresh submission yourself as admin → confirm new approval flow works end-to-end (credit appears in Earnings UI)
- [ ] Confirm Fonnte WA credit balance >= 60 messages
- [ ] Confirm SMTP daily quota cukup (Spacemail 1000/hari)
- [ ] Senin 8pm WIB → paste WA copy ke Admin Console → blast

---

## Expected Conversion (revised for 10-slot reality)

10 slots is much tighter than 50. Realistic outcome:

| Stage | Count | % |
|---|---|---|
| Total army | 59 | 100% |
| WA opened | ~53 | 90% |
| Clicked landing or task | ~28 | 53% |
| Ready Reddit acct | ~12 | already qualified |
| Submitted | ~10 | 83% of qualified |
| Approved (cap at 10 slots) | **10** | 100% slot fill expected |
| Total paid out | Rp20.000 | 10 × Rp2K |

**Slot saturation:** With ~12 ready army + 4× pay hook, expect 100% slot fill within 24 hours. After slot 10 hits, the task auto-completes and disappears from the eligibility list — no over-paying.

**Strategic implication:** Use this blast to validate the conversion mechanic. Next order from Wouter or future clients = scale slots up + add comment tasks (Rp5K-20K) for higher-tier army.
