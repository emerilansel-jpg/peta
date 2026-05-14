import { supabase } from './supabase';
import { calculateLevel } from './levels';

// Reddit blocks data-center IPs on public endpoints, so the Supabase edge
// function gets 403'd. But the USER's browser IP is residential, so a
// client-side fetch via a CORS proxy succeeds where the edge function fails.
//
// Strategy (cheapest → most reliable):
//   1. corsproxy.io   — fastest free public CORS proxy, returns raw JSON
//   2. allorigins.win — backup free public proxy
//   3. codetabs proxy — second backup
//   4. edge function  — last-resort fallback (OAuth path if REDDIT_CLIENT_ID
//                       secret is set in Supabase; otherwise falls back to 0)
//
// If all four fail we return karma=0 so the user can still proceed; admin
// can manually sync later via /admin/reddit-accounts.
//
// Level is recomputed by a BEFORE INSERT/UPDATE trigger on reddit_accounts,
// so the value here is for optimistic UI only.

type RedditAbout = { link_karma?: number; comment_karma?: number; created_utc?: number; is_suspended?: boolean };

export type RedditStatusFlag = 'ok' | 'suspended' | 'not_found' | 'unknown';

type ProxyResult =
  | { ok: true; karma: number; accountAgeDays: number; statusFlag: RedditStatusFlag }
  | { ok: false; statusFlag: RedditStatusFlag };

function parseAbout(raw: any): ProxyResult {
  // Reddit returns a few distinct shapes:
  //   active user   → { kind: "t2", data: { link_karma, comment_karma, created_utc, ... } }
  //   suspended     → { kind: "t2", data: { is_suspended: true, ... } }   (no karma fields)
  //   not found     → { error: 404, message: "Not Found" } or HTML fragment
  if (!raw) return { ok: false, statusFlag: 'unknown' };

  // Explicit "not found" shapes
  const errCode = raw?.error;
  const errMsg = (raw?.message || '').toString().toLowerCase();
  if (errCode === 404 || errMsg.includes('not found') || errMsg.includes('user not found')) {
    return { ok: false, statusFlag: 'not_found' };
  }

  const d: RedditAbout | undefined = raw?.data ?? raw;
  if (!d) return { ok: false, statusFlag: 'unknown' };

  if (d.is_suspended === true) {
    return { ok: false, statusFlag: 'suspended' };
  }

  if (typeof d.created_utc !== 'number') {
    // Some shadowbanned / private accounts return data shells without
    // created_utc. Treat as not_found for actionability.
    return { ok: false, statusFlag: 'not_found' };
  }

  const karma = (d.link_karma || 0) + (d.comment_karma || 0);
  const accountAgeDays = Math.floor((Date.now() - d.created_utc * 1000) / 86_400_000);
  if (!Number.isFinite(accountAgeDays) || accountAgeDays < 0) {
    return { ok: false, statusFlag: 'unknown' };
  }
  return { ok: true, karma, accountAgeDays, statusFlag: 'ok' };
}

async function fetchViaProxy(proxyUrl: string, timeoutMs = 6000): Promise<ProxyResult | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // cache: 'no-store' is critical — without it, a failed CORS preflight on
    // the first request gets cached as an empty 200, poisoning all retries.
    const r = await fetch(proxyUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text) return null;
    let j: any;
    try { j = JSON.parse(text); } catch { return null; }
    // allorigins.win wraps response in { contents: "<json string>" }
    if (typeof j?.contents === 'string') {
      try { return parseAbout(JSON.parse(j.contents)); } catch { return null; }
    }
    return parseAbout(j);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type SyncRedditResult = {
  karma: number;
  accountAgeDays: number;
  level: number;
  success: true;
  fallback: boolean;
  statusFlag: RedditStatusFlag;
};

export async function syncRedditKarma(username: string): Promise<SyncRedditResult> {
  // Sanitize: strip URL prefix, slashes, whitespace; keep only username chars.
  const clean = String(username || '')
    .replace(/^.*?(?:reddit\.com\/)?(?:u\/|user\/)?/i, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 32);
  if (!clean) {
    return { karma: 0, accountAgeDays: 0, level: 0, success: true, fallback: true, statusFlag: 'unknown' };
  }

  const aboutUrl = `https://www.reddit.com/user/${clean}/about.json`;
  const aboutUrlEnc = encodeURIComponent(aboutUrl);

  // Tier 1 — codetabs CORS proxy. User's residential IP fetches from Reddit.
  // Retry 3x with backoff for rate-limit flakiness. Bail early when we get
  // a *definitive* suspended/not_found verdict — no point retrying those.
  const codetabsUrl = `https://api.codetabs.com/v1/proxy?quest=${aboutUrlEnc}`;
  let lastFlag: RedditStatusFlag = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    const result = await fetchViaProxy(codetabsUrl);
    if (!result) continue; // network/proxy error — retry
    if (result.ok) {
      return {
        karma: result.karma,
        accountAgeDays: result.accountAgeDays,
        level: calculateLevel(result.karma, result.accountAgeDays),
        success: true,
        fallback: false,
        statusFlag: result.statusFlag,
      };
    }
    lastFlag = result.statusFlag;
    if (result.statusFlag === 'suspended' || result.statusFlag === 'not_found') {
      // Definitive verdict — no point retrying
      break;
    }
  }

  // If proxy gave us a definitive bad-account verdict, surface it.
  if (lastFlag === 'suspended' || lastFlag === 'not_found') {
    return { karma: 0, accountAgeDays: 0, level: 0, success: true, fallback: true, statusFlag: lastFlag };
  }

  // Tier 2 — edge function (OAuth path if REDDIT_CLIENT_ID set, else falls back).
  try {
    const { data, error } = await supabase.functions.invoke('sync-reddit-karma', {
      body: { username: clean },
    });
    if (!error && data?.success && !data.fallback) {
      const karma = data.karma ?? 0;
      const accountAgeDays = data.accountAgeDays ?? 0;
      return {
        karma,
        accountAgeDays,
        level: calculateLevel(karma, accountAgeDays),
        success: true,
        fallback: false,
        statusFlag: 'ok',
      };
    }
  } catch (error) {
    console.warn('edge-function fallback also failed:', error);
  }

  // Tier 3 — all paths failed. Return zeros with unknown flag.
  return { karma: 0, accountAgeDays: 0, level: 0, success: true, fallback: true, statusFlag: 'unknown' };
}

export async function getRedditAccounts(userId: string) {
  const { data, error } = await supabase
    .from('reddit_accounts')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return data;
}

export async function addRedditAccount(userId: string, username: string) {
  const karmaData = await syncRedditKarma(username);

  if (!karmaData.success) {
    throw new Error('Failed to sync Reddit data');
  }

  const { data, error } = await supabase
    .from('reddit_accounts')
    .insert({
      user_id: userId,
      username,
      karma: karmaData.karma,
      account_age_days: karmaData.accountAgeDays,
      level: karmaData.level,
      status_flag: karmaData.statusFlag,
      flagged_at: karmaData.statusFlag === 'suspended' || karmaData.statusFlag === 'not_found'
        ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateRedditAccountKarma(accountId: string, username: string) {
  const karmaData = await syncRedditKarma(username);
  if (!karmaData.success) throw new Error('Failed to sync Reddit data');

  const isBadAccount = karmaData.statusFlag === 'suspended' || karmaData.statusFlag === 'not_found';

  // CRITICAL: When proxy/Reddit returns "unknown" (network flake), we MUST
  // NOT overwrite stored karma with 0 — that would clobber admin-set values.
  // BUT for definitive verdicts (suspended/not_found), we DO want to flag
  // the row so admin + user see it.
  if (karmaData.fallback && !isBadAccount) {
    const { data } = await supabase
      .from('reddit_accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    return { account: data, fallback: true };
  }

  const updates: Record<string, unknown> = {
    status_flag: karmaData.statusFlag,
    flagged_at: isBadAccount ? new Date().toISOString() : null,
  };
  if (!isBadAccount) {
    // Healthy sync — persist real karma + age. DB trigger recomputes level.
    updates.karma = karmaData.karma;
    updates.account_age_days = karmaData.accountAgeDays;
  }
  // If banned/not_found, intentionally leave karma+age untouched so admin
  // can see last-good values while the flag highlights the issue.

  const { data, error } = await supabase
    .from('reddit_accounts')
    .update(updates)
    .eq('id', accountId)
    .select()
    .single();

  if (error) throw error;
  return { account: data, fallback: karmaData.fallback, statusFlag: karmaData.statusFlag };
}

// User toggle: hide the "Gabung WhatsApp" CTA on the Tasks page forever.
// Stored on `users.wa_group_dismissed` so it persists across devices.
export async function dismissWaGroup() {
  const { error } = await supabase.rpc('dismiss_wa_group');
  if (error) throw error;
}

export async function getWaDismissed(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('users')
    .select('wa_group_dismissed')
    .eq('id', userId)
    .single();
  return !!data?.wa_group_dismissed;
}

// Admin-only: manually set karma + age (level recomputes via DB trigger,
// pending claim cleared at the same time).
export async function adminSetKarma(
  accountId: string,
  karma: number,
  accountAgeDays?: number,
) {
  const { data, error } = await supabase.rpc('admin_set_karma', {
    p_account_id: accountId,
    p_karma: karma,
    p_account_age_days: accountAgeDays ?? null,
  });
  if (error) throw error;
  return data;
}

// User-callable: submit a karma value the user copied from their Reddit
// profile, queued for admin verification. Used as the fallback path when
// the auto-sync edge function gets blocked by Reddit.
export async function submitKarmaClaim(accountId: string, claimedKarma: number) {
  const { data, error } = await supabase.rpc('submit_karma_claim', {
    p_account_id: accountId,
    p_claimed_karma: claimedKarma,
  });
  if (error) throw error;
  return data;
}

// Admin-only: clear a pending claim without awarding it (e.g. user lied).
export async function adminRejectKarmaClaim(accountId: string) {
  const { data, error } = await supabase.rpc('admin_reject_karma_claim', {
    p_account_id: accountId,
  });
  if (error) throw error;
  return data;
}

export async function getActiveTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getTasksForLevel(level: number) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'active')
    .lte('min_level', level)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function createTaskAssignment(taskId: string, redditAccountId: string) {
  const { data, error } = await supabase
    .from('task_assignments')
    .insert({
      task_id: taskId,
      reddit_account_id: redditAccountId,
      status: 'in_progress',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTaskAssignment(assignmentId: string, updates: any) {
  const { data, error } = await supabase
    .from('task_assignments')
    .update(updates)
    .eq('id', assignmentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserTaskAssignments(userId: string) {
  const { data: accounts } = await supabase.from('reddit_accounts').select('id').eq('user_id', userId);
  const accountIds = (accounts || []).map(a => a.id);
  if (accountIds.length === 0) return [];

  const { data, error } = await supabase
    .from('task_assignments')
    .select(`*, tasks(*), reddit_accounts(*)`)
    .in('reddit_account_id', accountIds)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getPayoutHistory(userId: string) {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// Routes through SECURITY DEFINER RPC `request_payout` so the eligibility
// gate (7-day holding period OR 5 approved tasks, plus Rp500K weekly cap)
// runs server-side and can't be bypassed by editing client JS. The userId
// argument is kept for backwards-compat callers but the RPC reads auth.uid()
// for authorization.
export async function requestPayout(_userId: string, amount: number) {
  const { data, error } = await supabase.rpc('request_payout', { p_amount: amount });
  if (error) throw error;
  return data;
}

// Lightweight pre-check so the UI can show a friendly message
// (or hide the request button) before the user clicks. Returns the
// raw RPC payload: { eligible, reason?, message?, days_old, approved_tasks, weekly_total, weekly_cap }.
export async function checkPayoutEligibility(userId: string, amount: number) {
  const { data, error } = await supabase.rpc('validate_payout_eligibility', {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw error;
  return data as {
    eligible: boolean;
    reason?: 'holding_period' | 'earnings_floor' | 'weekly_cap';
    message?: string;
    days_old?: number;
    approved_tasks?: number;
    weekly_total?: number;
    weekly_cap?: number;
    earned_from_work?: number;
    earnings_floor?: number;
    task_earnings?: number;
    signup_bonus?: number;
  };
}

// Returns the user's saldo split four ways so the Earnings UI can
// enforce the "Rp150K dari task + signup bonus dulu, baru bisa narik
// referral" rule on the client (server still gates via RPC).
//   fromWork = approved task rewards + signup_bonus credits  (counts toward floor)
//   referral = referral_bonus_referrer + referral_bonus_referee  (locked behind floor)
//   other    = manual_adjustment (treated like fromWork — admin discretion)
//   earned   = fromWork + other  (everything that isn't referral)
//   total    = earned + referral
export async function getTotalEarnings(userId: string): Promise<{
  earned: number;
  referral: number;
  fromWork: number;
  total: number;
}> {
  // 1) Approved task earnings (across all reddit accounts)
  const { data: accounts, error: accErr } = await supabase
    .from('reddit_accounts')
    .select('id')
    .eq('user_id', userId);
  if (accErr) throw accErr;
  const accountIds = (accounts || []).map((a) => a.id);

  let taskTotal = 0;
  if (accountIds.length > 0) {
    const { data, error } = await supabase
      .from('task_assignments')
      .select('tasks(reward_amount), status')
      .in('reddit_account_id', accountIds)
      .eq('status', 'approved');
    if (error) throw error;
    taskTotal = (data || []).reduce((sum: number, a: any) => sum + (a.tasks?.reward_amount || 0), 0);
  }

  // 2) Credits — split by source
  const { data: credits, error: cErr } = await supabase
    .from('user_credits')
    .select('amount, source')
    .eq('user_id', userId);
  if (cErr) throw cErr;

  let signupBonus = 0;
  let referralCredits = 0;
  let otherCredits = 0;
  (credits || []).forEach((c: any) => {
    const amt = c.amount || 0;
    if (c.source === 'signup_bonus') {
      signupBonus += amt;
    } else if (c.source === 'referral_bonus_referrer' || c.source === 'referral_bonus_referee') {
      referralCredits += amt;
    } else {
      otherCredits += amt; // manual_adjustment, etc.
    }
  });

  const fromWork = taskTotal + signupBonus;
  const earned = fromWork + otherCredits;
  const referral = referralCredits;
  const total = earned + referral;

  return { earned, referral, fromWork, total };
}

// Mask a name for privacy: "Ahmad" -> "A****", "Ahmad Rifki" -> "A**** R."
function maskName(name?: string | null) {
  if (!name) return 'PeTa Army';
  const parts = name.trim().split(/\s+/);
  const first = parts[0] || 'PeTa Army';
  const masked = first.length <= 1 ? first : first[0] + '*'.repeat(Math.max(2, first.length - 1));
  if (parts[1]) return `${masked} ${parts[1][0].toUpperCase()}.`;
  return masked;
}

const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
};

export type CommunityEvent = {
  kind: 'signup' | 'payout' | 'referral';
  who: string;       // masked
  amount?: number;
  at: string;        // ISO
  rel: string;       // relative time string
};

// Onboarding step keys recognised by the SECURITY DEFINER RPC
export type OnboardingStep =
  | 'signup' | 'wa_group' | 'warp' | 'reddit_account' | 'reddit_url';

// Server-side credit claim. Amounts/descriptions are fixed in the RPC, so the
// client can't tamper. Idempotent on the server side too.
export async function claimOnboardingBonus(step: OnboardingStep) {
  const { error } = await supabase.rpc('claim_onboarding_bonus', { p_step: step });
  if (error) throw error;
}

// Karma milestone (post-onboarding "Misi Wajib #1"): awards Rp5K when the
// user's highest reddit_accounts.karma >= 10. Server-side check + idempotent.
export type KarmaMilestoneResult =
  | { awarded: true;  karma: number; amount: number }
  | { awarded: false; karma: number; reason: 'karma_below_threshold' | 'already_claimed' };

export async function claimKarmaMilestone(): Promise<KarmaMilestoneResult> {
  const { data, error } = await supabase.rpc('claim_karma_milestone');
  if (error) throw error;
  return data as KarmaMilestoneResult;
}

// Has the user already claimed the karma milestone? (For UI state)
// Description was 'karma_10' before 2026-05-13, then bumped to 'karma_100'.
// Unique index is now per (user_id, source='karma_milestone') so any row counts.
export async function hasClaimedKarmaMilestone(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'karma_milestone')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Highest karma across all reddit accounts for a user. Used by Karma Mission
// progress bar without re-hitting reddit.com. Also surfaces status_flag so
// Tasks/Earnings/Account pages can show a "your Reddit account got banned —
// fix it" banner without re-running the sync.
export async function getMaxRedditKarma(userId: string): Promise<{
  karma: number;
  level: number;
  accountAgeDays: number;
  username: string | null;
  accountId: string | null;
  pendingKarma: number | null;
  pendingSubmittedAt: string | null;
  statusFlag: RedditStatusFlag;
  flaggedAt: string | null;
  hasFlaggedAccount: boolean;
}> {
  const { data, error } = await supabase
    .from('reddit_accounts')
    .select('id, username, karma, level, account_age_days, pending_karma, pending_karma_submitted_at, status_flag, flagged_at')
    .eq('user_id', userId)
    .order('karma', { ascending: false });
  if (error) throw error;
  const rows = (data || []) as Array<{
    id: string; username: string; karma: number; level: number; account_age_days: number;
    pending_karma: number | null; pending_karma_submitted_at: string | null;
    status_flag: RedditStatusFlag; flagged_at: string | null;
  }>;
  if (rows.length === 0) {
    return {
      karma: 0, level: 0, accountAgeDays: 0,
      username: null, accountId: null,
      pendingKarma: null, pendingSubmittedAt: null,
      statusFlag: 'unknown', flaggedAt: null,
      hasFlaggedAccount: false,
    };
  }
  const top = rows[0];
  const hasFlaggedAccount = rows.some(
    (r) => r.status_flag === 'suspended' || r.status_flag === 'not_found'
  );
  return {
    karma: top.karma || 0,
    level: top.level || 0,
    accountAgeDays: top.account_age_days || 0,
    username: top.username,
    accountId: top.id,
    pendingKarma: top.pending_karma ?? null,
    pendingSubmittedAt: top.pending_karma_submitted_at ?? null,
    statusFlag: (top.status_flag || 'unknown') as RedditStatusFlag,
    flaggedAt: top.flagged_at,
    hasFlaggedAccount,
  };
}

export async function getCommunityStats() {
  const [armyCount, paidPayouts] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'army').eq('is_active', true),
    supabase.from('payouts').select('amount').eq('status', 'paid'),
  ]);
  const totalMembers = armyCount.count || 0;
  const totalPaid = (paidPayouts.data || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
  return { totalMembers, totalPaid };
}

// Referral analytics — clicks/signups/conversion-rate per user.
// trackReferralClick fires on Landing.tsx when ?ref=<code> is present.
// Dedup is enforced server-side per (ref_code, visitor_session) so a user
// reloading their own preview doesn't inflate the counter.
export async function trackReferralClick(refCode: string) {
  if (!refCode || refCode.length < 4) return;
  const SESSION_KEY = 'peta_visitor_session';
  let session = '';
  try {
    session = localStorage.getItem(SESSION_KEY) || '';
    if (!session) {
      session = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(SESSION_KEY, session);
    }
  } catch { /* private mode etc — fall back to noop session */ }

  // Fire and forget — don't block UI on click tracking.
  try {
    await supabase.rpc('track_referral_click', {
      p_ref_code: refCode,
      p_session: session,
      p_user_agent: navigator.userAgent.slice(0, 500),
    });
  } catch {
    // tracking failure is non-fatal
  }
}

export async function getReferralAnalytics(userId: string) {
  const { data, error } = await supabase.rpc('get_referral_analytics', { p_user_id: userId });
  if (error) throw error;
  return data as {
    totalClicks: number;
    uniqueClicks: number;
    signups: number;
    totalEarned: number;
    conversionRate: number;
  };
}

export async function adminGetReferralLeaderboard(limit = 20) {
  const { data, error } = await supabase.rpc('admin_get_referral_leaderboard', { p_limit: limit });
  if (error) throw error;
  return (data as Array<{
    user_id: string;
    email: string;
    full_name: string;
    ref_code: string;
    total_clicks: number;
    unique_clicks: number;
    signups: number;
    total_earned: number;
    conversion_rate: number;
  }>) || [];
}

// Founding-cohort scarcity: max 100 founding members. Returns real count
// from DB so the counter is honest (no inflation).
export const FOUNDING_LIMIT = 100;
export async function getFoundingMembers() {
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'army');
  const total = count || 0;
  const slotsLeft = Math.max(FOUNDING_LIMIT - total, 0);
  return {
    count: total,
    max: FOUNDING_LIMIT,
    slotsLeft,
    isFull: total >= FOUNDING_LIMIT,
    percent: Math.min((total / FOUNDING_LIMIT) * 100, 100),
  };
}

export async function getCommunityFeed(limit = 12): Promise<CommunityEvent[]> {
  const [signups, payouts, refs] = await Promise.all([
    supabase
      .from('users')
      .select('full_name, email, created_at')
      .eq('role', 'army')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('payouts')
      .select('amount, paid_at, users(full_name, email)')
      .eq('status', 'paid')
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: false })
      .limit(limit),
    supabase
      .from('user_credits')
      .select('amount, created_at, users(full_name, email)')
      .eq('source', 'referral_bonus_referrer')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const events: CommunityEvent[] = [];

  (signups.data || []).forEach((u: any) => {
    events.push({
      kind: 'signup',
      who: maskName(u.full_name || u.email?.split('@')[0]),
      at: u.created_at,
      rel: relativeTime(u.created_at),
    });
  });

  (payouts.data || []).forEach((p: any) => {
    events.push({
      kind: 'payout',
      who: maskName(p.users?.full_name || p.users?.email?.split('@')[0]),
      amount: p.amount,
      at: p.paid_at,
      rel: relativeTime(p.paid_at),
    });
  });

  (refs.data || []).forEach((c: any) => {
    events.push({
      kind: 'referral',
      who: maskName(c.users?.full_name || c.users?.email?.split('@')[0]),
      amount: c.amount,
      at: c.created_at,
      rel: relativeTime(c.created_at),
    });
  });

  // Newest first, capped to limit
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, limit);
}

export async function getReferralStats(userId: string) {
  const { data: profile } = await supabase
    .from('users')
    .select('referral_code')
    .eq('id', userId)
    .single();

  // RLS blocks SELECT on other users' rows, so we use a SECURITY DEFINER RPC.
  const { data: countData } = await supabase.rpc('get_referral_count', { p_user_id: userId });
  const count = (countData as number) ?? 0;

  const { data: bonusRows } = await supabase
    .from('user_credits')
    .select('amount')
    .eq('user_id', userId)
    .in('source', ['referral_bonus_referrer']);

  const totalBonus = (bonusRows || []).reduce((s: number, r: any) => s + r.amount, 0);

  return {
    code: profile?.referral_code as string | undefined,
    invitedCount: count,
    totalBonus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin broadcast messaging — email + WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

export type BroadcastChannel = 'email' | 'whatsapp';
export type BroadcastSummary = {
  id: string;
  subject: string;
  body: string;
  channels: BroadcastChannel[];
  created_at: string;
  total_targets: number;
  email_sent: number;
  email_failed: number;
  wa_sent: number;
  wa_failed: number;
};

export type BroadcastRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'manual_pending';
export type BroadcastRecipient = {
  id: string;
  user_id: string;
  channel: BroadcastChannel;
  email_snapshot: string | null;
  whatsapp_snapshot: string | null;
  status: BroadcastRecipientStatus;
  error: string | null;
  sent_at: string | null;
  full_name: string | null;
};

export async function createBroadcast(
  subject: string,
  body: string,
  channels: BroadcastChannel[] = ['email', 'whatsapp']
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_broadcast', {
    p_subject: subject,
    p_body: body,
    p_channels: channels,
  });
  if (error) throw error;
  return data as string;
}

export async function listBroadcasts(limit = 50): Promise<BroadcastSummary[]> {
  const { data, error } = await supabase.rpc('admin_list_broadcasts', { p_limit: limit });
  if (error) throw error;
  return (data || []) as BroadcastSummary[];
}

export async function getBroadcastRecipients(broadcastId: string): Promise<BroadcastRecipient[]> {
  const { data, error } = await supabase.rpc('admin_broadcast_recipients', { p_broadcast_id: broadcastId });
  if (error) throw error;
  return (data || []) as BroadcastRecipient[];
}

export async function markRecipientSent(recipientId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_recipient_sent', { p_recipient_id: recipientId });
  if (error) throw error;
}

// Trigger the actual email send via edge function. Returns counts + whether
// Resend is configured (so the UI can prompt admin to set it up if not).
export async function sendBroadcastEmails(broadcastId: string): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  skipped: number;
  resend_configured: boolean;
}> {
  const { data, error } = await supabase.functions.invoke('send-broadcast-emails', {
    body: { broadcast_id: broadcastId },
  });
  if (error) throw error;
  return data;
}

// Trigger WhatsApp blast via Fonnte gateway (background, no popups).
// Falls back gracefully with status='not_configured' if FONNTE_TOKEN unset.
export async function sendBroadcastWhatsapp(broadcastId: string): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  skipped: number;
  status: 'ok' | 'not_configured';
  message?: string;
}> {
  const { data, error } = await supabase.functions.invoke('send-broadcast-whatsapp', {
    body: { broadcast_id: broadcastId },
  });
  if (error) throw error;
  return data;
}

// Build a wa.me deeplink for a single recipient. Normalizes Indonesian
// numbers (08… → 628…) and URL-encodes the message body.
export function buildWhatsappLink(phone: string, message: string): string {
  let p = (phone || '').replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  // Most Indo numbers should start with 62 after normalization
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Straight Ltd order → PeTa task sync (admin-only)
// ─────────────────────────────────────────────────────────────────────────────

export type PendingRedditOrder = {
  id: number;
  status: string;
  subreddit: string | null;
  thread_url: string;
  target_type: 'upvote' | 'comment' | 'thread';
  requested_upvotes: number;
  notes: string | null;
  created_at: string;
  client_email: string | null;
};

export async function listPendingRedditOrders(): Promise<PendingRedditOrder[]> {
  const { data, error } = await supabase.rpc('admin_list_pending_reddit_orders');
  if (error) throw error;
  return (data || []) as PendingRedditOrder[];
}

export async function importRedditOrder(opts: {
  orderId: number;
  rewardAmount?: number;
  minLevel?: number;
  titleOverride?: string;
}): Promise<{ task_id: string; order_id: number; task_type: string }> {
  const { data, error } = await supabase.rpc('admin_import_reddit_order', {
    p_order_id: opts.orderId,
    p_reward_amount: opts.rewardAmount ?? null,
    p_min_level: opts.minLevel ?? 0,
    p_title_override: opts.titleOverride ?? null,
  });
  if (error) throw error;
  return data;
}

export type TaskCategory = 'reddit_upvote' | 'reddit_comment' | 'reddit_post_thread';
export type TaskStatus = 'draft' | 'active' | 'paused' | 'completed';

export type AdminTaskUpdate = {
  taskId: string;
  title?: string;
  description?: string;
  brief?: string;
  target_url?: string;
  task_category?: TaskCategory;
  reward_amount?: number;
  max_assignments?: number;
  per_account_limit?: number;
  min_karma?: number;
  min_account_age_days?: number;
  start_at?: string | null;
  end_at?: string | null;
  status?: TaskStatus;
};

export async function adminUpdateTask(u: AdminTaskUpdate): Promise<string> {
  const { data, error } = await supabase.rpc('admin_update_task', {
    p_task_id: u.taskId,
    p_title: u.title ?? null,
    p_description: u.description ?? null,
    p_brief: u.brief ?? null,
    p_target_url: u.target_url ?? null,
    p_task_category: u.task_category ?? null,
    p_reward_amount: u.reward_amount ?? null,
    p_max_assignments: u.max_assignments ?? null,
    p_per_account_limit: u.per_account_limit ?? null,
    p_min_karma: u.min_karma ?? null,
    p_min_account_age_days: u.min_account_age_days ?? null,
    p_start_at: u.start_at ?? null,
    p_end_at: u.end_at ?? null,
    p_status: u.status ?? null,
  });
  if (error) throw error;
  return data as string;
}

// Army-side: list tasks this user can actually do right now (filtered server-side).
export type EligibleTask = {
  id: string;
  title: string;
  description: string;
  brief: string | null;
  target_url: string;
  task_type: 'comment' | 'upvote';
  task_category: TaskCategory;
  reward_amount: number;
  max_assignments: number;
  current_assignments: number;
  min_karma: number;
  min_account_age_days: number;
  per_account_limit: number;
  status: string;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  can_do_with_account_id: string | null;
};

export async function listEligibleTasksForUser(): Promise<EligibleTask[]> {
  const { data, error } = await supabase.rpc('list_eligible_tasks_for_user');
  if (error) throw error;
  return (data || []) as EligibleTask[];
}

// Delete a broadcast (admin only). Cascade deletes recipients.
export async function deleteBroadcast(broadcastId: string): Promise<void> {
  const { error } = await supabase.from('broadcasts').delete().eq('id', broadcastId);
  if (error) throw error;
}

// Upload a task-proof screenshot to Supabase Storage. Returns public URL.
// File path pattern: <userId>/<taskId>-<timestamp>.<ext>
export async function uploadTaskProofImage(opts: {
  userId: string;
  taskId: string;
  file: File;
}): Promise<string> {
  const ext = (opts.file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${opts.userId}/${opts.taskId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('task-proofs').upload(path, opts.file, {
    cacheControl: '3600',
    upsert: false,
    contentType: opts.file.type || `image/${ext}`,
  });
  if (error) throw error;
  const { data: publicUrl } = supabase.storage.from('task-proofs').getPublicUrl(path);
  return publicUrl.publicUrl;
}

// Send a TEST broadcast to a single recipient (typically the admin themselves)
// before blasting to the full audience. Returns whether the email actually
// went out via Resend.
export async function sendTestBroadcast(opts: {
  subject: string;
  body: string;
  channels: BroadcastChannel[];
  testEmail?: string | null;
  testWhatsapp?: string | null;
}): Promise<{
  broadcast_id: string;
  email_test?: { sent: boolean; error?: string };
  whatsapp_test?: { sent: boolean; error?: string; link?: string };
}> {
  const { data, error } = await supabase.rpc('admin_send_test_broadcast', {
    p_subject: opts.subject,
    p_body: opts.body,
    p_channels: opts.channels,
    p_test_email: opts.testEmail ?? null,
    p_test_whatsapp: opts.testWhatsapp ?? null,
  });
  if (error) throw error;
  const broadcastId = data as string;
  const out: any = { broadcast_id: broadcastId };

  if (opts.channels.includes('email')) {
    try {
      const res = await sendBroadcastEmails(broadcastId);
      out.email_test = {
        sent: res.sent > 0,
        error: res.failed > 0 ? `${res.failed} failed` : (res.sent === 0 ? 'no_provider' : undefined),
      };
    } catch (e: any) {
      out.email_test = { sent: false, error: e.message || String(e) };
    }
  }

  if (opts.channels.includes('whatsapp')) {
    try {
      const res = await sendBroadcastWhatsapp(broadcastId);
      out.whatsapp_test = {
        sent: res.sent > 0,
        error: res.status === 'not_configured'
          ? 'FONNTE_TOKEN belum di-setup'
          : (res.failed > 0 ? `${res.failed} failed` : undefined),
      };
    } catch (e: any) {
      out.whatsapp_test = { sent: false, error: e.message || String(e) };
    }
    if (opts.testWhatsapp) {
      const message = `*${opts.subject}*\n\n${opts.body}\n\n— PeTa Team (TEST)\nhttps://www.penghasilantambahan.com`;
      out.whatsapp_test.link = buildWhatsappLink(opts.testWhatsapp, message);
    }
  }
  return out;
}
