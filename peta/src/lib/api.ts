import { supabase } from './supabase';
import axios from 'axios';
import { calculateLevel } from './levels';

export async function syncRedditKarma(username: string) {
  try {
    const response = await axios.get(`https://www.reddit.com/user/${username}/about.json`, {
      timeout: 5000,
    });
    const data = response.data.data;

    const accountCreatedAt = new Date(data.created_utc * 1000);
    const accountAgeDays = Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24));
    const karma = data.link_karma + data.comment_karma;
    const level = calculateLevel(karma, accountAgeDays);

    return {
      karma,
      accountAgeDays,
      level,
      success: true,
    };
  } catch (error) {
    console.warn('Reddit API unreachable, using defaults:', error);
    // Fallback: assume new account when Reddit API is unreachable (CORS/timeout/blocked)
    return {
      karma: 0,
      accountAgeDays: 0,
      level: 0,
      success: true,
      fallback: true,
    };
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

  if (!karmaData.success) {
    throw new Error('Failed to sync Reddit data');
  }

  const { data, error } = await supabase
    .from('reddit_accounts')
    .update({
      karma: karmaData.karma,
      account_age_days: karmaData.accountAgeDays,
      level: karmaData.level,
      last_sync: new Date().toISOString(),
    })
    .eq('id', accountId)
    .select()
    .single();

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

export async function getTotalEarnings(userId: string) {
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
    .select('amount')
    .eq('user_id', userId);
  if (cErr) throw cErr;
  const creditTotal = (credits || []).reduce((s: number, c: any) => s + (c.amount || 0), 0);

  return taskTotal + creditTotal;
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

  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', userId);

  const { data: bonusRows } = await supabase
    .from('user_credits')
    .select('amount')
    .eq('user_id', userId)
    .in('source', ['referral_bonus_referrer']);

  const totalBonus = (bonusRows || []).reduce((s: number, r: any) => s + r.amount, 0);

  return {
    code: profile?.referral_code as string | undefined,
    invitedCount: count || 0,
    totalBonus,
  };
}
