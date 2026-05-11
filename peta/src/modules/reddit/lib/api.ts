import { supabase } from '../../../lib/supabase';

const PRICE_PER_UPVOTE = 10; // credits

// Get user's credit balance
export async function getCreditsBalance() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('users')
    .select('credit_balance')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data?.credit_balance || 0;
}

// Get user's credit transactions
export async function getCreditsHistory(limit = 20) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Get user's reddit upvote orders
export async function getRedditOrders() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Create reddit upvote order via RPC
export async function createRedditOrder(
  threadUrl: string,
  subreddit: string | null,
  requestedUpvotes: number,
  notes: string | null
) {
  const { data, error } = await supabase.rpc('fn_create_reddit_upvote_order', {
    p_thread_url: threadUrl,
    p_subreddit: subreddit,
    p_requested_upvotes: requestedUpvotes,
    p_notes: notes,
  });

  if (error) {
    if (error.message.includes('insufficient_credits')) {
      throw new Error('Kredit tidak cukup');
    }
    throw error;
  }

  return data;
}

// Get user's topup requests
export async function getTopupRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('reddit_topup_requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Create topup request
export async function createTopupRequest(
  amountRequested: number,
  paymentMethod: string,
  proofUrl: string | null
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('reddit_topup_requests')
    .insert({
      user_id: user.id,
      amount_requested: amountRequested,
      payment_method: paymentMethod,
      proof_url: proofUrl,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ADMIN: Get all pending topup requests
export async function getAdminPendingTopups() {
  const { data, error } = await supabase
    .from('reddit_topup_requests')
    .select('*, users:user_id(id, email, full_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ADMIN: Approve topup
export async function adminApproveTopup(topupId: number, adminId: string) {
  const { data, error } = await supabase.rpc('fn_admin_approve_topup', {
    p_topup_id: topupId,
    p_admin_id: adminId,
  });

  if (error) throw error;
  return data;
}

// ADMIN: Reject topup
export async function adminRejectTopup(topupId: number, adminNote: string) {
  const { data, error } = await supabase.rpc('fn_admin_reject_topup', {
    p_topup_id: topupId,
    p_admin_note: adminNote,
  });

  if (error) throw error;
  return data;
}

// ADMIN: Get pending reddit orders
export async function getAdminPendingOrders() {
  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .select('*, users:user_id(id, email, full_name)')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ADMIN: Update order status
export async function adminUpdateOrderStatus(orderId: number, status: string) {
  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function getPricePerUpvote() {
  return PRICE_PER_UPVOTE;
}
