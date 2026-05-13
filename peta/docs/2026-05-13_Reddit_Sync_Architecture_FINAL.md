# Reddit Sync Architecture — Implementation Summary

**Status**: ✅ **FULLY IMPLEMENTED** (auto-sync on signup + admin trigger). Pending: OAuth credential setup.

---

## What's Implemented

### 1. Auto-Sync on Signup (Onboarding Step 5)

**Flow:**
```
User enters Reddit URL in Onboarding Step 5
  ↓ [handleStep4 called]
  ↓ addRedditAccount(userId, username)
    ↓ syncRedditKarma(username)
      ↓ calls edge function 'sync-reddit-karma'
      ↓ returns { karma, accountAgeDays, fallback }
    ↓ INSERT into reddit_accounts with karma + age
    ↓ DB trigger computes level from karma + age
  ↓ Toast "✅ Simpan & Lanjut"
  ↓ User proceeds to Onboarding Step 6
```

**File:** `peta/src/pages/Onboarding.tsx` lines 200–231

**Key property:** `await addRedditAccount(user.id, username);`

---

### 2. Admin Manual Sync Trigger

**Flow:**
```
Admin opens /admin/reddit-accounts
  ↓ Sees list of all users + their karma
  ↓ Clicks 🔄 (refresh icon) next to a user
  ↓ updateRedditAccountKarma(id, username)
    ↓ syncRedditKarma(username)
    ↓ if fallback: returns stored values (no overwrite)
    ↓ if success: UPDATE reddit_accounts, trigger recomputes level
  ↓ Toast: "Karma disync dari Reddit" or "Reddit blokir..."
  ↓ Table refreshes with new values
```

**File:** `peta/src/pages/admin/RedditAccounts.tsx` lines 51–63

**Key buttons:**
- Mobile (line 265): `syncMutation.mutate({ id, username })`
- Desktop (line 347): same

---

### 3. Edge Function (No Polling)

**Location:** `peta/supabase/functions/sync-reddit-karma/index.ts`

**Logic:**
1. Try OAuth (if `REDDIT_CLIENT_ID` secret set):
   - POST `/api/v1/access_token` with Basic auth (client_id + empty secret)
   - GET `/user/<u>/about` with bearer token
2. Fallback to public endpoints (if OAuth fails):
   - Try `old.reddit.com/user/<u>/about.json`
   - Try `api.reddit.com/user/<u>/about`
   - Try `www.reddit.com/user/<u>/about.json`
3. If all fail:
   - Return `fallback: true`, `karma: 0`, `accountAgeDays: 0`
   - Include `reason` (for debugging)

**Response:**
```json
{
  "success": true,
  "username": "reddit",
  "karma": 123456,
  "accountAgeDays": 5000,
  "via": "oauth"  // or "public"
}
```

---

## Critical: Fallback Safety

**If Reddit blocks (no OAuth):**

```typescript
// updateRedditAccountKarma (api.ts lines 64–93)
if (karmaData.fallback) {
  // DO NOT overwrite stored karma with 0
  // Just return current stored values
  return { account: data, fallback: true };
}
```

This prevents clobbering admin-set karma when API fails.

---

## What's NOT Implemented

❌ **Regular polling** — Not needed. Sync only on:
- Signup (Step 5)
- Admin manual trigger (🔄 button)

❌ **Background job** — No cron. Single-point-in-time sync only.

---

## Testing Scenarios

### ✅ Path 1: Fresh signup with working OAuth

1. Set `REDDIT_CLIENT_ID` in Supabase secrets
2. Register new user
3. Reach Onboarding step 5, enter real username (`reddit`, `AutoModerator`, etc.)
4. Auto-populate: karma = real value, age = real days
5. Expected DB entry: `level` computed by trigger

### ✅ Path 2: Fresh signup with no OAuth (fallback)

1. **Don't** set `REDDIT_CLIENT_ID` (or keep empty)
2. Register new user
3. Reach Onboarding step 5, enter username
4. Auto-populate: karma = 0, age = 0 (fallback)
5. Toast shows error (fallback reached)
6. User can still use app (honor system available later)

### ✅ Path 3: Admin manual sync (working OAuth)

1. Login as admin
2. Go `/admin/reddit-accounts`
3. Click 🔄 on user with karma=0
4. Sync fetches real data from Reddit
5. Karma updates, level recomputed
6. Toast: "Karma disync dari Reddit"

### ✅ Path 4: Admin manual sync (fallback)

1. Same as Path 3, but OAuth fails
2. Synced values unchanged (fallback safety)
3. Toast: "Reddit blokir / akun tidak ditemukan — set manual"
4. Admin can use ✏️ to manually set karma instead

### ⚠️ Path 5: Duplicate username (already in DB)

- Onboarding step 5 catches unique constraint violation
- Toast: "Username Reddit ini sudah terdaftar. Pakai username lain atau hubungi admin."
- User prompted to add a different account

---

## Implementation Notes

### Why no polling?

- Reddit rate-limits even OAuth
- No real-time updates needed (karma updates when user completes tasks, not in real-time)
- On-demand sync is cheaper & faster
- Respects user's intent ("admin, check this user now")

### Why OAuth instead of public endpoints?

- Public endpoints return 403 from data-center IPs (Supabase egress blocked)
- OAuth uses app-level auth (IP-agnostic)
- OAuth tokens cached in module scope (~50 min)
- Installed-app flow requires no user authorization

### Why fallback to public endpoints?

- In case OAuth misconfigured or Reddit breaks OAuth
- Best-effort approach
- Graceful degradation to honor system

### Why DB trigger computes level?

- Trigger `tg_set_reddit_level` fires on INSERT/UPDATE
- Ensures level always consistent with karma + age
- No UI-level math needed (single source of truth)

---

## Setup Checklist

- [ ] Reddit OAuth app registered (get CLIENT_ID)
- [ ] REDDIT_CLIENT_ID set in Supabase staging secrets
- [ ] REDDIT_USER_AGENT set in Supabase staging secrets
- [ ] Test Onboarding step 5 with real username
- [ ] Verify edge function logs show OAuth success
- [ ] Test admin sync button
- [ ] Replicate secrets to prod Supabase
- [ ] Final smoke test on production

See `2026-05-13_Reddit_OAuth_Setup_FINAL.md` for step-by-step Reddit OAuth setup.

---

## Files & Line References

| File | Lines | What |
|---|---|---|
| `api.ts` | 8–29 | `syncRedditKarma()` |
| `api.ts` | 41–62 | `addRedditAccount()` (auto-sync) |
| `api.ts` | 64–93 | `updateRedditAccountKarma()` (admin trigger) |
| `Onboarding.tsx` | 200–231 | Step 5 call to `addRedditAccount()` |
| `RedditAccounts.tsx` | 51–63 | `syncMutation` + modal |
| `RedditAccounts.tsx` | 265, 347 | Sync button click handlers |
| `sync-reddit-karma/index.ts` | 1–170 | Edge function implementation |

---

## Deployment Path

1. **Staging** — Set secrets, test all paths (see "Testing Scenarios" above)
2. **Verification** — Admin checks `/admin/reddit-accounts` sync success
3. **Production** — Set same secrets in prod Supabase
4. **Smoke test** — Register user, reach step 5, verify auto-sync

No code changes needed. OAuth setup is config-only.
