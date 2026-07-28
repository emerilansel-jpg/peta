# Reddit Army Gamification System — Design Spec

**Status:** Approved
**Date:** 2026-07-29
**Origin:** Brainstorm session mempertemukan ide Pak Nell (chat WA 24–27 Jul 2026) dengan codebase PeTa yang sudah ada.
**Owner:** Straight Dev

---

## 1. Konteks & Tujuan

Pak Nell ingin akun Reddit yang sudah "diinvestasikan" (warmed, matured) terkunci di IP & device crew/army, sehingga tidak gampang dibawa kabur. Strateginya: pipeline 2-fase yang memberi insentif finansial bertahap sambil menahan sebagian bonus sebagai jaminan retensi.

**Goal bisnis:**
- Akun Reddit matang yang siap "dijual"/dipakai operasional setelah 30+ hari
- Army terikat (tidak ghosting) karena ada saldo tertahan yang hanya cair jika berhenti dengan sopan
- Onboarding berbayar untuk army (bukan "kerja gratis") — Rp100K saat finish challenge

**Source ide (chat WA):**
- `[23:04, 24/07/2026] Pak Nell` — ide dasar: reddit challenge game, level up, locked bonus, Rp100K lump selesai, active bonus harian, hold 30 hari.
- `[15:53, 26/07/2026] Alfu` — revisi: 50:50 split (cashable rutin + retention hold), HYBRID active+karma.
- `[21:44, 26/07/2026] Pak Nell` — minta dijelasin singkat, tanya karma per hari vs per karma, nanya angle hold 50%.
- `[11:03, 27/07/2026] Alfu` — karma bonus dihitung per karma, hold dipecah jadi 2 mingguan.
- `[12:11, 27/07/2026] Pak Nell` — "Ya coba buatkan dulu sistemnya ya" → dokumen ini.

---

## 2. Keputusan Desain (Locked)

| Aspek | Keputusan |
|---|---|
| Arsitektur | **C — Hybrid:** Challenge pakai task system, Daily Bonus pakai tabel dedicated |
| Verifikasi Bonus Harian | **Activity Proxy** — 1 comment/post per hari terdeteksi via Reddit API sync |
| Hold Logic (Fase 2) | **50:50 Split** — Rp1.250 pending (cair 2 mingguan) + Rp1.250 hold per hari aktif |
| Biweekly cashout | **Auto-credit lump sum** tiap 14 hari via pg_cron (≈Rp17.500 jika perfect aktif) |
| Bonus Besar Rp100K | **50% instant cashable + 50% lock 30 hari** |
| Sumber akun Reddit | **Army pakai akun sendiri** + warmup checklist intensive (sustainability, ghosting-proof) |
| Challenge levels | **5 level** (Tunas → Pemuda → Penggiat → Pejuang → Veteran) |
| Daily quality bar | **1 comment/post apa adanya cukup** (fase awal, bisa upgrade nanti) |
| Resignation | **Notice H-30 + aktif ≥20/30 hari + handover akun aman** |

---

## 3. User Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                    REDDIT ARMY PROGRAM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FASE 1: WARMUP CHALLENGE (sekali jalan)                       │
│  ─────────────────────────────────────                          │
│  Army daftar program → pakai akun Reddit sendiri                │
│  → Kerjakan 5 level checklist (comment N, post N, karma target) │
│  → Tiap level naik = bonus kecil (locked, source=reddit_challenge)│
│  → Semua level selesai = Rp100K                                │
│      • Rp50K → instant cashable (source=phase1_completion)      │
│      • Rp50K → bonus_holds (lock 30 hari)                       │
│  → Transisi otomatis ke Fase 2                                  │
│                                                                 │
│  FASE 2: ACTIVE INCOME (ongoing)                               │
│  ─────────────────────────────────────                          │
│  Setiap hari (pg_cron tiap jam, per user):                      │
│    • Sync Reddit API → detect comment/post baru hari itu        │
│    • Jika active: book Rp2.500 sebagai pending                  │
│        → Rp1.250 pending cashable (cair 2 mingguan)             │
│        → Rp1.250 langsung masuk bonus_holds (retention)         │
│  Setiap 14 hari (pg_cron Sabtu pagi):                           │
│    • Lump sum pending cashable → user_credits                   │
│    • ≈Rp17.500 masuk saldo jika perfect aktif 14 hari           │
│                                                                 │
│  EXIT: Resignation                                              │
│  ──────────────────                                             │
│  Army ajukan berhenti → status='resigning'                      │
│      → resign_effective_at = NOW() + 30 hari                    │
│  Selama resigning: harus aktif ≥20/30 hari + handover akun      │
│  Saat resign_effective_at ≤ today & resign_active_days ≥ 20:    │
│    • Release SEMUA bonus_holds → user_credits (source=hold_release)│
│    • status='resigned'                                          │
│  Kalau ghosting/suspended di tengah jalan:                      │
│    • admin_forfeit_holds → semua hold status='forfeited'        │
│    • status='expelled'                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Status state machine (`reddit_army_profiles.program_status`)

```
                ┌──────────────┐
                │ not_started  │
                └──────┬───────┘
                       │ join_program()
                       ▼
                ┌──────────────┐
                │ phase1_active│
                └──────┬───────┘
                       │ complete_phase1()
                       ▼
                ┌──────────────────┐
                │ phase1_complete  │──(auto same tx)──▶ phase2_active
                └──────────────────┘
                       ▼
                ┌──────────────┐
                │ phase2_active│◀──────────────┐
                └──────┬───────┘               │
                       │ request_resign()      │ cancel_resign()
                       ▼                       │
                ┌──────────────┐               │
                │  resigning   │───────────────┘
                └──────┬───────┘
                       │ process_resignation_complete()
                       ▼
                ┌──────────────┐
                │   resigned   │
                └──────────────┘

  Any active state ──admin_forfeit_holds()──▶ expelled
```

---

## 4. Skema Database

### 4.1 Tabel Baru

#### `reddit_army_profiles` — Status program per army

```sql
CREATE TABLE reddit_army_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  warmed_account_id UUID REFERENCES reddit_accounts(id),
  program_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (program_status IN (
      'not_started','phase1_active','phase1_complete',
      'phase2_active','resigning','resigned','expelled'
    )),
  phase1_started_at TIMESTAMPTZ,
  phase1_completed_at TIMESTAMPTZ,
  phase2_started_at TIMESTAMPTZ,
  resign_requested_at TIMESTAMPTZ,
  resign_effective_at TIMESTAMPTZ,
  resign_active_days INTEGER NOT NULL DEFAULT 0,
  resigned_at TIMESTAMPTZ,
  expelled_at TIMESTAMPTZ,
  expelled_reason TEXT,
  daily_bonus_rate INTEGER NOT NULL DEFAULT 2500,
  retention_hold_rate INTEGER NOT NULL DEFAULT 2500,
  last_sync_at TIMESTAMPTZ,
  last_active_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `reddit_challenge_levels` — Template checklist

```sql
CREATE TABLE reddit_challenge_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number INTEGER NOT NULL UNIQUE,
  level_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'comment_count','post_count','karma_threshold','combined'
  )),
  target_count INTEGER,
  target_subreddits TEXT[],
  reward_amount INTEGER NOT NULL CHECK (reward_amount >= 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Seed data awal (draft, dapat diedit admin via UI):**

| level | name | target | reward |
|---|---|---|---|
| 1 | Tunas | Comment 3× di r/indonesia | Rp5K |
| 2 | Pemuda | Comment 5× + 1 post | Rp10K |
| 3 | Penggiat | Karma ≥ 20 | Rp15K |
| 4 | Pejuang | Karma ≥ 50 + 3 posts | Rp20K |
| 5 | Veteran | Karma ≥ 100 + 5 posts | (trigger phase1 completion) |

#### `reddit_daily_activity` — Log harian + bonus tracking

```sql
CREATE TABLE reddit_daily_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reddit_account_id UUID NOT NULL REFERENCES reddit_accounts(id),
  activity_date DATE NOT NULL,
  posts_today INTEGER NOT NULL DEFAULT 0,
  comments_today INTEGER NOT NULL DEFAULT 0,
  karma_at_start INTEGER,
  karma_at_end INTEGER,
  karma_delta INTEGER NOT NULL DEFAULT 0,
  is_active_day BOOLEAN NOT NULL DEFAULT false,
  bonus_eligible BOOLEAN NOT NULL DEFAULT false,
  bonus_credited BOOLEAN NOT NULL DEFAULT false,
  bonus_credited_at TIMESTAMPTZ,
  credited_amount INTEGER NOT NULL DEFAULT 0,
  credited_type TEXT CHECK (credited_type IN ('cashable','hold')),
  sync_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, activity_date)
);
```

**Index:** `idx_reddit_daily_activity_user_date` on `(user_id, activity_date)`.

#### `bonus_holds` — Ledger retensi

```sql
CREATE TABLE bonus_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN (
    'challenge_level',        -- level reward dari Fase 1 challenge
    'phase1_completion',      -- Rp50K hold dari selesai Phase 1
    'daily_bonus',            -- Rp1.250/hari dari Fase 2 (retention)
    'karma_bonus'             -- (v2) bonus karma delta harian
  )),
  source_id UUID,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held','vesting','released','forfeited')),
  vested_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  forfeited_at TIMESTAMPTZ,
  release_condition TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Index:** `idx_bonus_holds_user_status` on `(user_id, status)`.

### 4.2 Tabel Existing Di-extend

**`tasks`** — nambah category + link ke challenge level:

```sql
ALTER TABLE tasks DROP CONSTRAINT tasks_task_category_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN (
    'reddit_upvote','reddit_comment','reddit_post_thread',
    'forum_comment','youtube_upload','reddit_challenge'
  ));
ALTER TABLE tasks ADD COLUMN challenge_level_id UUID REFERENCES reddit_challenge_levels(id);
```

**`user_credits`** — nambah source enum:

```sql
ALTER TABLE user_credits DROP CONSTRAINT user_credits_source_check;
ALTER TABLE user_credits ADD CONSTRAINT user_credits_source_check
  CHECK (source IN (
    'referral_bonus_referrer','referral_bonus_referee','signup_bonus',
    'manual_adjustment','karma_milestone','task_reward','task_revert',
    'wa_group_verified',
    'phase1_completion',          -- Rp50K instant dari selesai challenge
    'daily_bonus_cashable',       -- lump sum 2 mingguan dari daily activity
    'hold_release'                -- cairan dari bonus_holds (resign / 30-day vesting)
  ));
```

**Catatan:** Source `reddit_challenge` tidak ditambahkan ke enum ini. Challenge task reward (kalau ada) tetap pakai `task_reward` source (regular). Level completion bonus masuk ke `bonus_holds.source='karma_bonus'`, bukan ke user_credits.

### 4.3 RLS Policies

Mengikuti pola existing (self SELECT own + admin full):

- `reddit_army_profiles`: user lihat row sendiri, admin semua, INSERT/UPDATE hanya via SECURITY DEFINER RPC (army tidak bisa langsung UPDATE)
- `reddit_challenge_levels`: SELECT public (read-only untuk semua authenticated), admin full
- `reddit_daily_activity`: user lihat row sendiri, admin semua, INSERT/UPDATE hanya via RPC
- `bonus_holds`: user lihat row sendiri, admin semua, INSERT/UPDATE hanya via RPC

---

## 5. RPC & Business Logic

Semua logic server-side di SECURITY DEFINER functions. Client hanya trigger.

### 5.1 Onboarding & Fase 1

#### `join_reddit_army_program()`
- Army trigger dari halaman `/reddit-army`
- Validasi: user punya 1 reddit_account aktif, `program_status` harus `'not_started'` atau `'resigned'` (re-enroll)
- Jika re-enroll: reset semua field ke default (hold = 0, tanggal kosong)
- Set `program_status='phase1_active'`, `phase1_started_at=NOW()`, `warmed_account_id` = akun Reddit pertama user
- Return profile baru

#### `claim_challenge_task(p_task_id, p_reddit_account_id)`
- Wrapper di atas `claim_task_assignment` yang sudah ada
- Validasi tambahan: `program_status='phase1_active'` dan task memiliki `task_category='reddit_challenge'`
- Reuse seluruh logic assignment creation, audit log, dll

#### `check_challenge_level_complete(p_user_id)` *(dipanggil dari trigger AFTER UPDATE ON task_assignments)*
- Trigger: ketika assignment challenge di-approve, cek apakah semua task pada level user saat ini sudah approved
- Jika ya:
  - Update `current_challenge_level` di profile
  - Award level reward via `award_challenge_level_reward()`
  - Jika ini level terakhir (5/Veteran), panggil `complete_phase1()`
  - Kirim notif WA + in-app

#### `award_challenge_level_reward(p_user_id, p_level_id)`
- Idempotent (cek dengan unique reference pada `bonus_holds`)
- Insert row ke `bonus_holds`:
  - `source='challenge_level'` (level reward masuk retensi, BUKAN cashable)
  - `amount = reward_amount`
  - `status='held'`, `release_condition='resign_complete'`
- Tidak insert ke `user_credits` sama sekali → tidak muncul di saldo cashable, hanya muncul di "Tabungan Retensi"

#### `complete_phase1(p_user_id)`
- Hanya bisa dipanggil dari `check_challenge_level_complete` atau admin
- Update profile: `program_status='phase2_active'`, `phase1_completed_at=NOW()`, `phase2_started_at=NOW()`
- Credit Rp100K split:
  - Rp50K → `user_credits` dengan `source='phase1_completion'` (instant cashable)
  - Rp50K → `bonus_holds` dengan `source='phase1_completion'`, `release_condition='days_30'`
- Buat activity_log entry

### 5.2 Fase 2 — Daily Bonus

#### `sync_reddit_daily_activity(p_user_id)` *(pg_cron per user, tiap jam)*
- Hanya proses user dengan `program_status IN ('phase2_active','resigning')`
- Fetch data Reddit API untuk `warmed_account_id` (comment & post count hari ini, karma sekarang)
- UPSERT row `reddit_daily_activity` untuk hari ini:
  - `comments_today`, `posts_today`, `karma_at_end`, `karma_delta`
  - `is_active_day = (comments_today + posts_today >= 1)`
  - `bonus_eligible = is_active_day AND program_status IN ('phase2_active','resigning')`
- Jika `bonus_eligible` dan belum `bonus_credited` → panggil `credit_daily_bonus()`
- Update `last_sync_at`, `last_active_date` di profile
- Jika `program_status='resigning'` dan `is_active_day` dan `last_active_date != activity_date` (anti double-count) → increment `resign_active_days` di profile

#### `credit_daily_bonus(p_user_id, p_activity_id)`
- Idempotent: cek `bonus_credited=false` dulu, jika sudah true → return
- **Pending state:** Bonus harian TIDAK langsung masuk saldo cashable. Disimpan dulu di `reddit_daily_activity.credited_amount` untuk diakumulasi & di-credit 2 minggu sekali.
- Update activity:
  - `bonus_credited=true` (bonus sudah dihitung untuk hari ini)
  - `bonus_credited_at=NOW()`, `credited_amount=2500`, `credited_type='pending_split'`
- Split 50:50 disimpan sebagai **pending credit** (belum masuk user_credits maupun bonus_holds):
  - Rp1.250 → akan masuk user_credits via `release_biweekly_cashout`
  - Rp1.250 → langsung insert ke `bonus_holds` `source='daily_bonus'`, `release_condition='resign_complete'`

#### `release_biweekly_cashout()` *(pg_cron Sabtu 9 AM)*
- Cari semua profile WHERE `program_status IN ('phase2_active','resigning')`
- Untuk tiap profile, hitung: SUM(`credited_amount` / 2) dari `reddit_daily_activity` WHERE `bonus_credited=true` AND `credited_type='pending_split'` AND `activity_date` dalam 14 hari terakhir AND belum di-lump-credit
- Tandai row yang sudah di-lump (tambah kolom `lump_credited_at` di activity, atau track via `user_credits.reference_id`)
- Credit lump sum ke `user_credits` `source='daily_bonus_cashable'`
- Kirim WA notif "Hari ini gajian Reddit Army: RpX.XXX masuk saldo"

### 5.3 Hold Release & Vesting

#### `release_phase1_completion_hold()` *(pg_cron tiap jam)*
- Cari semua `bonus_holds` WHERE `status='held'` AND `source='phase1_completion'` AND `created_at + INTERVAL '30 days' <= NOW()`
- Untuk tiap row:
  - Update status → `'released'`, `released_at=NOW()`
  - Insert `user_credits` dengan `source='hold_release'`, amount = hold.amount

#### `process_resignation_complete()` *(pg_cron 9 AM)*
- Cari semua profile WHERE `program_status='resigning'` AND `resign_effective_at <= NOW()` AND `resign_active_days >= 20`
- Untuk tiap profile:
  - Release SEMUA `bonus_holds` WHERE `status IN ('held','vesting')` → user_credits (`source='hold_release'`)
  - Update profile: `program_status='resigned'`, `resigned_at=NOW()`

#### `request_resignation()`
- Army trigger dari halaman `/reddit-army`
- Validasi: `program_status='phase2_active'`
- Update profile: `program_status='resigning'`, `resign_requested_at=NOW()`, `resign_effective_at = NOW() + INTERVAL '30 days'`

#### `cancel_resignation()`
- Army bisa batal selama `program_status='resigning'`
- Reset: `program_status='phase2_active'`, `resign_requested_at=NULL`, `resign_effective_at=NULL`, `resign_active_days=0`

#### `admin_forfeit_holds(p_user_id, p_reason)` *(admin only)*
- Untuk ghosting/suspended account
- Update SEMUA `bonus_holds` (status `held`/`vesting`) → `forfeited`, `forfeited_at=NOW()`
- Update profile: `program_status='expelled'`, `expelled_at=NOW()`, `expelled_reason=p_reason`

#### `flag_ghosting_for_review()` *(pg_cron mingguan)*
- Cari profile WHERE `program_status IN ('phase2_active','resigning')` AND `last_active_date < NOW() - INTERVAL '7 days'`
- Set flag di profile (`notes` field append atau kolom terpisah) untuk admin review di tab Exit

### 5.4 Cron Schedule

| Job | Schedule (WIB) | Function |
|---|---|---|
| Sync daily activity (per user) | `0 * * * *` (tiap jam) | `sync_reddit_daily_activity` |
| Check challenge level complete | trigger (after assignment approve) | `check_challenge_level_complete` |
| Release phase1 hold | `0 * * * *` (tiap jam) | `release_phase1_completion_hold` |
| Biweekly cashout (notif only) | `0 9 * * 6` (Sabtu 9 AM) | `release_biweekly_cashout` |
| Process resignation complete | `0 9 * * *` (9 AM) | `process_resignation_complete` |
| Flag ghosting for review | `0 0 * * 0` (Minggu 00:00) | `flag_ghosting_for_review` |

---

## 6. Earnings & Saldo Breakdown

### 6.1 Cashable (langsung withdrawable)
- `task_reward` (semua regular task — BUKAN challenge)
- `manual_adjustment`
- `signup_bonus` + referral bonuses (unlock existing: Rp100K dari task)
- `phase1_completion` (Rp50K instant dari selesai challenge)
- `daily_bonus_cashable` (lump sum 2 mingguan, masuk saldo saat cron Sabtu)
- `hold_release` (saat hold cair karena resign/30-day vesting)

### 6.2 Locked — Tabungan Retensi
Ditampilkan di Earnings page sebagai saldo terpisah:
```
💰 Tabungan Retensi: RpXX.XXX (locked)
   Cair saat pamit berhenti H-30 + handover akun
```

Sumbernya: SUM(`bonus_holds.amount`) WHERE `status IN ('held','vesting')`:
- `source='challenge_level'` — level rewards challenge (Rp5K + Rp10K + Rp15K + Rp20K = Rp50K maks)
- `source='phase1_completion'` — Rp50K hold dari selesai challenge (cair otomatis 30 hari)
- `source='daily_bonus'` — akumulasi Rp1.250/hari aktif (cair saat resign)
- `source='karma_bonus'` — (v2) bonus karma delta harian

**Catatan:** `source='phase1_completion'` di bonus_holds (Rp50K) akan auto-vest & release setelah 30 hari via `release_phase1_completion_hold`. Setelah release, masuk ke user_credits `source='hold_release'`. Sementara `source='challenge_level'` dan `source='daily_bonus'` hanya release saat resign complete.

### 6.3 Source categories untuk breakdown UI

| Source kategori di UI | user_credits.source | bonus_holds.source | Notes |
|---|---|---|---|
| "Hasil Task" | `task_reward` | — | Regular task (BUKAN challenge task) |
| "Bonus Naik Level" | — | `challenge_level` | Locked, muncul di "Tabungan Retensi" |
| "Bonus Selesai Phase 1 (cair)" | `phase1_completion` | — | Rp50K instant cashable |
| "Bonus Selesai Phase 1 (hold)" | — | `phase1_completion` | Rp50K lock, cair 30 hari |
| "Bonus Harian (2 mingguan)" | `daily_bonus_cashable` | — | Lump sum masuk saldo tiap Sabtu |
| "Bonus Harian (hold)" | — | `daily_bonus` | Rp1.250/hari, cair saat resign |
| "Cairan Tabungan" | `hold_release` | — | Saat resign/hold release |

### 6.4 Implikasi ke `get_user_earnings` RPC

RPC yang sudah ada perlu di-extend untuk return field baru:

```typescript
// Field baru di return get_user_earnings():
{
  // ... field existing (tasks, manualAdj, signupBonus, referralBonus, bonus, cashable, total)
  
  // BARU:
  redditArmyRetentionHeld: number,      // SUM bonus_holds WHERE status IN ('held','vesting')
  redditArmyPendingCashable: number,   // SUM daily activity credited_amount/2 yang belum di-lump
  redditArmyPhase1Instant: number,     // SUM user_credits WHERE source='phase1_completion'
  redditArmyDailyCredited: number,     // SUM user_credits WHERE source='daily_bonus_cashable' (lifetime)
  redditArmyHoldReleased: number,      // SUM user_credits WHERE source='hold_release' (lifetime)
}
```

UI Earnings page pakai field ini untuk render section "Tabungan Retensi" dan baris-baris baru di breakdown.

---

## 7. UI/UX

### 7.1 Army Side — Halaman Baru `/reddit-army` (`RedditArmy.tsx`)

**4 state berdasarkan `program_status`:**

#### State 1: `not_started`
```
┌────────────────────────────────────┐
│  🎖️ Reddit Army Program            │
│  ─────────────────────             │
│  Mau dapet passive income tiap     │
│  hari cuma modal aktif di Reddit?  │
│                                    │
│  Kamu akan dapat:                  │
│  ✅ Bonus Rp100K setelah warmup    │
│  ✅ Bonus harian Rp2.500 selama    │
│     aktif (≈Rp75K/bulan)           │
│  ✅ Tabungan retensi yang cair     │
│     saat kamu pamit berhenti       │
│                                    │
│  Syarat:                           │
│  • Pakai akun Reddit kamu sendiri  │
│  • 1 device & 1 IP (jangan ganti)  │
│  • Pamit H-30 kalau mau berhenti   │
│                                    │
│  [Gabung Program →]                │
└────────────────────────────────────┘
```

#### State 2: `phase1_active`
```
┌────────────────────────────────────┐
│  🌱 Warmup Challenge               │
│  Level 1 dari 5: Tunas             │
│  ─────────────────────             │
│  Progress: 2/5 comment selesai     │
│  [▓▓▓▓░░░░░░] 40%                  │
│                                    │
│  Checklist Level 1:                │
│  ✅ Comment di r/indonesia #1      │
│  ✅ Comment di r/indonesia #2      │
│  ⬜ Comment di r/indonesia #3      │
│  ⬜ Comment di r/indonesia #4      │
│  ⬜ Comment di r/indonesia #5      │
│                                    │
│  Reward level ini: Rp5K (locked)   │
│                                    │
│  [Kerjakan Misi Selanjutnya →]     │
└────────────────────────────────────┘
```

#### State 3: `phase2_active` (paling sering dilihat)
```
┌────────────────────────────────────┐
│  🔥 Reddit Army — Fase 2 Aktif     │
│  ─────────────────────             │
│  ┌──────────────────────────────┐ │
│  │ Hari ini: +Rp2.500 ✅        │ │
│  │ Streak: 12 hari 🔥           │ │
│  │ Total bonus bulan ini: 75K   │ │
│  └──────────────────────────────┘ │
│                                    │
│  ── MISSION HARI INI ──            │
│  ┌──────────────────────────────┐ │
│  │ ✅ Aktif di Reddit           │ │
│  │    1 comment detected (12:30)│ │
│  │    Bonus +Rp2.500 credited   │ │
│  └──────────────────────────────┘ │
│                                    │
│  ── TABUNGAN RETENSI ──            │
│  ┌──────────────────────────────┐ │
│  │ 💰 Locked: Rp37.500          │ │
│  │    Cair pas kamu berhenti    │ │
│  │    (syarat: pamit H-30)      │ │
│  └──────────────────────────────┘ │
│                                    │
│  ── RIWAYAT BONUS (14 hari) ──     │
│  • 28 Jul: +Rp2.500 (aktif)       │
│  • 27 Jul: +Rp2.500 (aktif)       │
│  • 26 Jul: +Rp2.500 (aktif)       │
│  • 25 Jul: ⏸️ (belum aktif)       │
│                                    │
│  [Buka Reddit →]                   │
│  [Mau Berhenti? Lihat syarat →]    │
└────────────────────────────────────┘
```

#### State 4: `resigning`
```
┌────────────────────────────────────┐
│  ⏳ Berhenti Diproses              │
│  ─────────────────────             │
│  Kamu ajukan berhenti 28 Jul.      │
│  Effective: 27 Agt 2026.           │
│                                    │
│  Sisa waktu: 30 hari               │
│  Hari aktif: 0/20 (minimal)        │
│                                    │
│  Yang harus kamu lakuin:           │
│  ⬜ Tetap aktif tiap hari          │
│  ⬜ Handover akun Reddit aman      │
│  ⬜ Jangan ganti device/IP         │
│      → kalau ga, hold hangus       │
│                                    │
│  Yang bakal kamu dapat:            │
│  💰 Hold Rp37.500 → cair penuh     │
│                                    │
│  [Batal Berhenti]                  │
└────────────────────────────────────┘
```

### 7.2 Integrasi Tasks Page

Tambah card prominent di atas task list (di halaman Tasks "Coming Soon"):

```
┌────────────────────────────────────┐
│  🎖️ Reddit Army Program            │
│  Passive income tiap hari          │
│  ─────────────────────             │
│  Dapet Rp2.500/hari cuma modal     │
│  aktif di Reddit. Total potensi    │
│  Rp75K/bulan + tabungan retensi.   │
│                                    │
│  [Lihat Detail →]                  │
└────────────────────────────────────┘
```

### 7.3 Integrasi Earnings Page

Tambah section baru di breakdown saldo:

```
💰 Tabungan Retensi: Rp37.500 (locked)
   Cair saat berhenti H-30 + handover akun
   • Rp50K dari bonus Phase 1 (cair 28 Agt)
   • Rp37.500 dari bonus harian (cair saat resign)
```

### 7.4 Admin Side — Dashboard Baru `RedditArmy.tsx` (di admin drawer)

**5 tab:**

#### Tab 1: Members
Tabel semua army: search, filter by status, kolom: user, status, joined date, hold balance, last active, action menu (release hold, forfeit, mark active, batal resign).

#### Tab 2: Challenges
Editor untuk `reddit_challenge_levels`: edit reward, drag-reorder, toggle active. Create challenge tasks via existing task editor (`task_category='reddit_challenge'`, link ke `challenge_level_id`).

#### Tab 3: Daily Sync
Trigger manual sync (semua / per user), view sync errors, override bonus untuk kasus edge.

#### Tab 4: Holds
Semua `bonus_holds`: filter by status (held/vesting/released/forfeited), bulk release/forfeit.

#### Tab 5: Exit / Resignation
Approval flow:
```
Army ajukan resign → muncul di sini
Admin cek:
  • Reddit account masih aman (ga suspended)?
  • IP/device konsisten (last_active_date)?
  • Aktif ≥20/30 hari selama resigning?
[Approve & Release Hold] [Forfeit (Ghosting)] [Batal Resign]
```

### 7.5 Approval Queue Extension

Challenge tasks masuk approval queue biasa, tapi:
- Badge `🏆 CHALLENGE` warna kuning
- Filter toggle: `[All] [Regular] [CHALLENGE]`
- Approved → trigger `check_challenge_level_complete()` otomatis via trigger AFTER UPDATE

### 7.6 Challenge Task Visibility (Army Side)

Challenge tasks (`task_category='reddit_challenge'`) **TIDAK muncul** di task list biasa (`/tasks`) atau `listEligibleTasksForUser()`. Mereka hanya muncul & bisa di-claim dari halaman `/reddit-army` state `phase1_active`.

**Implementasi:**
- Modifikasi `list_eligible_tasks_for_user()` RPC: tambah filter `WHERE task_category != 'reddit_challenge'` (kecuali user sedang di flow challenge)
- Buat RPC baru `list_challenge_tasks_for_user()` yang return task per level dengan status (locked/active/done)
- `claim_challenge_task()` adalah satu-satunya pintu masuk untuk claim challenge task

---

## 8. Open Questions (TODO saat implementasi)

| ID | Pertanyaan | Resolusi |
|---|---|---|
| L1 | `reddit_challenge` level reward: masuk `user_credits` atau `bonus_holds`? | ✅ **Resolved:** Langsung masuk `bonus_holds.source='challenge_level'`. Source `reddit_challenge` tidak ditambahkan ke `user_credits` enum sama sekali (lihat §4.2). |
| L2 | Biweekly cashout: auto-credit atau notif? | ✅ **Resolved:** Auto-credit lump sum (cron memindahkan pending cashable ke user_credits). Lihat §5.2 `release_biweekly_cashout()`. |
| L3 | `daily_bonus_cashable` masuk kategori apa di earnings breakdown? | ✅ **Resolved:** Kategori baru "Bonus Harian (2 mingguan)". Lihat §6.3. |
| L4 | Re-enroll setelah `resigned`: reset semua data atau simpan history? | ✅ **Resolved:** Reset profile (hold=0, tanggal kosong), fase dari awal. History hold disimpan (status released/forfeited) untuk audit. |
| L5 | Reddit API sync: pakai proxy chain atau edge function? | ⚠️ **Edge function baru.** Detail kontrak di §13. |
| L6 | Apakah `karma_bonus` source (karma naik bonus) di-implement di v1 atau v2? | ⚠️ **v2.** V1 fokus ke active bonus + challenge. |
| L7 | Berapa rate limit Reddit API untuk 100+ army sync harian? | ⚠️ **TODO saat implementasi:** Pakai OAuth app credentials, rate limit Reddit ~600 req/10menit. Throttle 1 sync/3 detik. |

---

## 9. Edge Cases & Risk Handling

| # | Skenario | Handling |
|---|---|---|
| 1 | Army ghosting (>7 hari inactive saat phase2/resigning) | Auto-flag `flag_ghosting_for_review()` → admin review → opsi `admin_forfeit_holds` |
| 2 | Akun Reddit suspended saat phase2 | Edge function deteksi `status_flag='suspended'` → auto-pause daily bonus → notif army + admin |
| 3 | Army ganti device/IP (trigger Reddit shadowban) | Tidak bisa dideteksi teknis. Solusi: edukasi di onboarding + aturan "1 device, 1 IP" |
| 4 | Reddit API rate limit (sync daily semua army) | Throttle 1 sync/detik + queue. 100 army = ~2 menit. Kalau scale > 500, migrasi ke batch edge function. |
| 5 | Cron sync miss 1 hari (downtime) | Reconciliation: cek karma delta 2 hari → backfill bonus. Implementasi: detect `last_sync_at < NOW() - INTERVAL '2 hours'` di awal sync |
| 6 | Challenge task di-reject | Army bisa retry (`can_retry=true`). 3x reject berturut → admin review → opsi expel |
| 7 | Army ajukan resign lalu ghosting di periode 30 hari | Inactive >7 hari berturut selama resigning → forfeit otomatis (`process_resignation_complete` skip, status → expelled) |
| 8 | Re-enroll setelah resigned/expelled | Reset profile (hold=0, tanggal kosong), fase dari awal. History hold disimpan untuk audit. |
| 9 | Bonus hold balance negatif (logical bug) | DB constraint `amount > 0`, semua credit via RPC idempotent dengan `reference_id` unique |
| 10 | Double-credit daily bonus (race condition) | `UNIQUE(user_id, activity_date)` + `bonus_credited` flag + RPC SET LOCAL lock |

---

## 10. Scope & Estimasi Effort

| Komponen | Effort | Dependencies |
|---|---|---|
| DB migration (4 tabel baru + extend 2) | Medium | — |
| RPCs (8 functions) | Large | DB migration |
| pg_cron setup (6 jobs) | Small | RPCs |
| Army `/reddit-army` page (4 state) | Large | RPCs |
| Admin `RedditArmy.tsx` (5 tab) | Large | RPCs |
| Approval queue filter + badge + trigger | Small | DB migration |
| Earnings page retention section | Small | DB migration |
| Tasks page integration card | Small | DB migration |
| Reddit API sync edge function | Medium | Reddit API contract |
| `get_user_earnings` RPC extend | Small | DB migration |
| Testing (staging deploy + QA) | Medium | All above |

**Total estimasi: 2–3 minggu full-time** untuk 1 dev.

---

## 11. Catatan Implementasi

- **Tidak ada breaking change** ke sistem lama: semua tabel baru, kolom nullable, constraint extend (drop + recreate).
- **Semua credit via RPC idempotent** — repeatable, tidak double-credit. Gunakan `reference_id` unique constraint untuk idempotency.
- **Audit log** via `audit_log` table trigger (pattern yang sudah ada di `tg_audit_log`).
- **RLS** mengikuti pattern existing: profile/activity per-user SELECT own + admin full. INSERT/UPDATE hanya via SECURITY DEFINER RPC.
- **Bahasa UI** Bahasa Indonesia gaul (sesuai `AGENTS.md`).
- **Mobile-first** semua halaman diuji di 390px width.
- **Migrations** wajib test di staging (`duxzxizedtvnopfihllz`) dulu, baru prod (`yorlsgzsawchpeeazcvi`).

---

## 12. Next Steps

1. **Spec self-review** (placeholder/consistency/scope/ambiguity check) — selesai
2. **User review spec** ini
3. **Invoke `writing-plans` skill** untuk membuat implementation plan detail (pecah jadi phase/testable chunks):
   - Phase 1: DB migration + seed data
   - Phase 2: RPCs + cron jobs
   - Phase 3: Army `/reddit-army` page
   - Phase 4: Admin `RedditArmy.tsx` page
   - Phase 5: Integrations (approval queue, earnings page, tasks page)
   - Phase 6: Edge function Reddit API sync
   - Phase 7: Staging deploy + QA

---

## 13. Edge Function: Reddit Daily Activity Sync

**Nama:** `sync-reddit-daily-activity` (Supabase Edge Function, Deno)

**Trigger:** pg_cron panggil tiap jam via `net.http_post` atau Supabase scheduled function; atau Supabase native scheduled function (kalau udah support).

### Kontrak API

**Request:**
```json
POST /functions/v1/sync-reddit-daily-activity
Authorization: Bearer <SERVICE_ROLE_KEY>
Content-Type: application/json

{
  "user_ids": ["uuid1", "uuid2", ...],   // batch max 20 user per call
  "activity_date": "2026-07-29"           // optional, default hari ini
}
```

**Logic per user:**
1. Fetch `reddit_army_profiles.warmed_account_id` → ambil `reddit_accounts.username`
2. Hit Reddit API (OAuth client credentials, atau anonymous `.json` endpoint):
   - `GET https://www.reddit.com/user/{username}/comments.json?limit=100&t=day`
   - `GET https://www.reddit.com/user/{username}/submitted.json?limit=100&t=day`
3. Filter hanya post/comment yang `created_utc >= midnight UTC hari ini` (atau WIB — tentukan timezone)
4. Hitung: `comments_today`, `posts_today`, `karma_at_end` (fetch from `/user/{username}/about.json`)
5. Panggil RPC `sync_reddit_daily_activity(p_user_id, ...)` dengan data di atas

**Response:**
```json
{
  "synced": 18,
  "failed": 2,
  "errors": [
    {"user_id": "uuidX", "reason": "reddit_account_suspended"},
    {"user_id": "uuidY", "reason": "reddit_api_timeout"}
  ]
}
```

### Rate Limiting & Throttle
- Reddit API rate limit: ~600 req/10 menit (anonymous), lebih tinggi via OAuth
- Batch max 20 user per edge function call
- Sleep 3 detik antar user di dalam edge function
- pg_cron jalankan tiap jam, bagi user jadi batch (misal 100 user / 5 batch / 5 cron windows)

### Error Handling
- Akun suspended/not_found → set `reddit_accounts.status_flag`, skip bonus, log
- API timeout → retry exponential backoff (max 3x), kalau gagal log & lanjut user berikutnya
- Network error → log, cron jam berikutnya retry

### Catatan implementasi
- Pakai OAuth client credentials (lebih reliable daripada anonymous)
- Credential disimpan di `app_secrets` table (sudah ada), key: `reddit_client_id`, `reddit_client_secret`
- Edge function jalan server-side, lewatin RLS via service role key
- Tidak ada perubahan ke `syncRedditKarma` yang sudah ada (itu untuk flow add account, terpisah)
