import { supabase } from './supabase';
import { calculateLevel } from './levels';

// Reddit API blocks browser CORS — we proxy through a Supabase Edge Function
// which fetches /user/<u>/about.json server-side with a User-Agent header.
// Level is recomputed by a BEFORE INSERT/UPDATE trigger on reddit_accounts,
// so the value here is for optimistic UI only.
export async function syncRedditKarma(username: string) {
  try {
    const { data, error } = await supabase.functions.invoke('sync-reddit-karma', {
      body: { username },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'edge_function_failure');

    const karma = data.karma ?? 0;
    const accountAgeDays = data.accountAgeDays ?? 0;
    return {
      karma,
      accountAgeDays,
      level: calculateLevel(karma, accountAgeDays),
      success: true,
      fallback: !!data.fallback,
    };
  } catch (error) {
    console.warn('sync-reddit-karma edge fn failed, using defaults:', error);
    return { karma: 0, accountAgeDays: 0, level: 0, success: true, fallback: true };
  }
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
  return { account: data, fallback: karmaData.fallback };
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

// Admin-only: manually set karma + age (level recomputes via DB trigger).
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

export async function requestPayout(userId: string, amount: number) {
  const { data, error } = await supabase
    .from('payouts')
    .insert({
      user_id: userId,
      amount,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getTotalEarnings(userId: string): Promise<{ earned: number; referral: number; total: number }> {
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

  // 2) Credits (referral bonus, signup bonus, manual adjustments)
  const { data: credits, error: cErr } = await supabase
    .from('user_credits')
    .select('amount, source')
    .eq('user_id', userId);
  if (cErr) throw cErr;

  let earnedCredits = 0;
  let referralCredits = 0;
  (credits || []).forEach((c: any) => {
    if (c.source === 'referral_bonus_referrer') {
      referralCredits += c.amount || 0;
    } else {
      earnedCredits += c.amount || 0;
    }
  });

  const earned = taskTotal + earnedCredits;
  const referral = referralCredits;
  const total = earned + referral;

  return { earned, referral, total };
}

// Mask a name for privacy: "Ahmad" -> "A****", "Ahmad Rifki" -> "A**** R."
function maskName(name?: string | null) {
  if (!name) return 'Member';
  const parts = name.trim().split(/\s+/);
  const first = parts[0] || 'Member';
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
export async function getMaxRedditKarma(userId: string): Promise<{karma: number; username: string | null; accountId: string | null}> {
  const { data, error } = await supabase
    .from('reddit_accounts')
    .select('id, username, karma')
    .eq('user_id', userId)
    .order('karma', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { karma: 0, username: null, accountId: null };
  return { karma: data.karma || 0, username: data.username, accountId: data.id };
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
