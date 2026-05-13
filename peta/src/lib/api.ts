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

type RedditAbout = { link_karma?: number; comment_karma?: number; created_utc?: number };

function parseAbout(raw: any): { karma: number; accountAgeDays: number } | null {
  const d: RedditAbout | undefined = raw?.data ?? raw;
  if (!d || typeof d.created_utc !== 'number') return null;
  const karma = (d.link_karma || 0) + (d.comment_karma || 0);
  const accountAgeDays = Math.floor((Date.now() - d.created_utc * 1000) / 86_400_000);
  if (!Number.isFinite(accountAgeDays) || accountAgeDays < 0) return null;
  return { karma, accountAgeDays };
}

async function fetchViaProxy(proxyUrl: string, timeoutMs = 6000): Promise<{ karma: number; accountAgeDays: number } | null> {
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
    const j = await r.json().catch(() => null);
    if (!j) return null;
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

export async function syncRedditKarma(username: string) {
  // Sanitize: strip URL prefix, slashes, whitespace; keep only username chars.
  const clean = String(username || '')
    .replace(/^.*?(?:reddit\.com\/)?(?:u\/|user\/)?/i, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 32);
  if (!clean) {
    return { karma: 0, accountAgeDays: 0, level: 0, success: true, fallback: true };
  }

  const aboutUrl = `https://www.reddit.com/user/${clean}/about.json`;
  const aboutUrlEnc = encodeURIComponent(aboutUrl);

  // Tier 1 — codetabs CORS proxy. User's residential IP fetches from Reddit
  // (not blocked, unlike Supabase data-center egress). Verified 2026-05-13.
  // Returns raw Reddit JSON. Free, no API key, ~300ms median.
  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${aboutUrlEnc}`,
  ];

  for (const proxy of proxies) {
    const result = await fetchViaProxy(proxy);
    if (result) {
      return {
        ...result,
        level: calculateLevel(result.karma, result.accountAgeDays),
        success: true,
        fallback: false,
      };
    }
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
      };
    }
  } catch (error) {
    console.warn('edge-function fallback also failed:', error);
  }

  // Tier 3 — all paths failed. Return zeros so user can still proceed.
  return { karma: 0, accountAgeDays: 0, level: 0, success: true, fallback: true };
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
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateRedditAccountKarma(accountId: string, username: string) {
  const karmaData = await syncRedditKarma(username);
  if (!karmaData.success) throw new Error('Failed to sync Reddit data');

  // CRITICAL: When Reddit blocks the edge function (karmaData.fallback=true),
  // we MUST NOT overwrite stored karma with 0 — that would clobber any value
  // an admin set manually via admin_set_karma. Only write when we got real data.
  if (karmaData.fallback) {
    const { data } = await supabase
      .from('reddit_accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    return { account: data, fallback: true };
  }

  // DB trigger recomputes level + last_sync from karma + account_age_days.
  const { data, error } = await supabase
    .from('reddit_accounts')
    .update({
      karma: karmaData.karma,
      account_age_days: karmaData.accountAgeDays,
    })
    .eq('id', accountId)
    .select()
    .single();

  if (error) throw error;
  return { account: data, fallback: false };
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

// Has the user already claimed the karma_10 milestone? (For UI state)
export async function hasClaimedKarmaMilestone(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'karma_milestone')
    .eq('description', 'karma_10')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Highest karma across all reddit accounts for a user. Used by Karma Mission
// progress bar without re-hitting reddit.com.
export async function getMaxRedditKarma(userId: string): Promise<{
  karma: number;
  level: number;
  accountAgeDays: number;
  username: string | null;
  accountId: string | null;
  pendingKarma: number | null;
  pendingSubmittedAt: string | null;
}> {
  const { data, error } = await supabase
    .from('reddit_accounts')
    .select('id, username, karma, level, account_age_days, pending_karma, pending_karma_submitted_at')
    .eq('user_id', userId)
    .order('karma', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      karma: 0, level: 0, accountAgeDays: 0,
      username: null, accountId: null,
      pendingKarma: null, pendingSubmittedAt: null,
    };
  }
  return {
    karma: data.karma || 0,
    level: data.level || 0,
    accountAgeDays: data.account_age_days || 0,
    username: data.username,
    accountId: data.id,
    pendingKarma: data.pending_karma ?? null,
    pendingSubmittedAt: data.pending_karma_submitted_at ?? null,
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
