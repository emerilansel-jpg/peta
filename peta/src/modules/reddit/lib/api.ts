import { supabase } from '../../../lib/supabase';

// Price per upvote in cents (USD)
const PRICE_PER_UPVOTE_CENTS = 50; // $0.50

// Get user's credit balance (in cents)
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

// Get user's credit transaction history
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
      throw new Error('Insufficient credits. Please top up your account.');
    }
    throw error;
  }

  return data;
}

// Get user's topup history
export async function getTopupHistory() {
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

// Complete PayPal topup (called after successful PayPal capture)
export async function completePayPalTopup(
  amountCents: number,
  paypalOrderId: string,
  paypalCaptureId: string
) {
  const { data, error } = await supabase.rpc('fn_complete_paypal_topup', {
    p_amount_cents: amountCents,
    p_paypal_order_id: paypalOrderId,
    p_paypal_capture_id: paypalCaptureId,
  });

  if (error) throw error;
  return data;
}

// Helper: enrich rows with user data via separate fetch
async function enrichWithUsers<T extends { user_id: string }>(rows: T[]): Promise<(T & { users: any })[]> {
  if (rows.length === 0) return rows as any;
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: users } = await supabase
    .from('users')
    .select('id, email, full_name, credit_balance')
    .in('id', userIds);
  const userMap = new Map((users || []).map((u: any) => [u.id, u]));
  return rows.map((r) => ({ ...r, users: userMap.get(r.user_id) || null }));
}

// ADMIN: Get pending reddit orders
export async function getAdminPendingOrders() {
  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .select('*')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true });

  if (error) throw error;
  return await enrichWithUsers(data || []);
}

// ADMIN: Get all orders (with filters)
export async function getAdminAllOrders() {
  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return await enrichWithUsers(data || []);
}

// ADMIN: Update order status
export async function adminUpdateOrderStatus(
  orderId: number,
  status: string,
  adminNotes?: string
) {
  const updates: any = { status, updated_at: new Date().toISOString() };
  if (adminNotes !== undefined) updates.admin_notes = adminNotes;
  if (status === 'completed') updates.completed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .update(updates)
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ADMIN: Adjust credits manually
export async function adminAdjustCredits(
  userId: string,
  amountCents: number,
  reason: string
) {
  const { data, error } = await supabase.rpc('fn_admin_adjust_credits', {
    p_user_id: userId,
    p_amount_cents: amountCents,
    p_reason: reason,
  });

  if (error) throw error;
  return data;
}

// ADMIN: Update user profile (name, role, active status)
export async function adminUpdateUser(
  userId: string,
  updates: { full_name?: string; role?: 'army' | 'admin'; is_active?: boolean }
) {
  const { data, error } = await supabase.rpc('admin_update_user_extended', {
    p_user_id: userId,
    p_full_name: updates.full_name ?? null,
    p_role: updates.role ?? null,
    p_is_active: updates.is_active ?? null,
  });
  if (error) throw error;
  return data;
}

// ADMIN: Hard delete user (cascades through orders, transactions, etc.)
export async function adminDeleteUser(userId: string) {
  const { data, error } = await supabase.rpc('admin_delete_member', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

// ============ Reviews ============

export interface SubmitInternalReviewInput {
  orderId: number;
  rating: number;
  reviewerName: string;
  reviewerRole?: string;
  reviewerWebsite?: string;
  profilePicConsent?: boolean;
  profilePicFile?: File;
  dofollowLinkRequested?: boolean;
  title?: string;
  body?: string;
}

export interface SubmitProofReviewInput {
  type: 'trustpilot' | 'advise';
  orderId?: number;
  reviewerName: string;
  proofUrl?: string;
  screenshotFile?: File;
}

async function uploadReviewImage(file: File, prefix: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const ext = file.name.split('.').pop() || 'png';
  const path = `${user.id}/${prefix}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('review-screenshots')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage
    .from('review-screenshots')
    .getPublicUrl(path);
  return urlData.publicUrl;
}

export async function submitInternalReview(input: SubmitInternalReviewInput) {
  let profilePicUrl: string | null = null;
  if (input.profilePicFile) {
    profilePicUrl = await uploadReviewImage(input.profilePicFile, 'profile');
  }

  const { data, error } = await supabase.rpc('fn_submit_review', {
    p_order_id: input.orderId,
    p_type: 'internal',
    p_rating: input.rating,
    p_reviewer_name: input.reviewerName,
    p_title: input.title ?? null,
    p_body: input.body ?? null,
    p_trustpilot_url: null,
    p_trustpilot_screenshot_url: null,
    p_reviewer_role: input.reviewerRole ?? null,
    p_reviewer_website: input.reviewerWebsite ?? null,
    p_reviewer_profile_pic_url: profilePicUrl,
    p_profile_pic_consent: input.profilePicConsent ?? false,
    p_dofollow_link_requested: input.dofollowLinkRequested ?? false,
  });
  if (error) throw error;
  return data;
}

export async function submitProofReview(input: SubmitProofReviewInput) {
  let screenshotUrl: string | null = null;
  if (input.screenshotFile) {
    screenshotUrl = await uploadReviewImage(input.screenshotFile, input.type);
  }

  const { data, error } = await supabase.rpc('fn_submit_review', {
    p_order_id: input.orderId ?? null,
    p_type: input.type,
    p_rating: null,
    p_reviewer_name: input.reviewerName,
    p_title: null,
    p_body: null,
    p_trustpilot_url: input.proofUrl ?? null,
    p_trustpilot_screenshot_url: screenshotUrl,
    p_reviewer_role: null,
    p_reviewer_website: null,
    p_reviewer_profile_pic_url: null,
    p_profile_pic_consent: false,
    p_dofollow_link_requested: false,
  });
  if (error) throw error;
  return data;
}

// Backwards-compat alias for any callers still using submitTrustpilotReview
export const submitTrustpilotReview = (input: { orderId?: number; reviewerName: string; trustpilotUrl?: string; screenshotFile?: File }) =>
  submitProofReview({
    type: 'trustpilot',
    orderId: input.orderId,
    reviewerName: input.reviewerName,
    proofUrl: input.trustpilotUrl,
    screenshotFile: input.screenshotFile,
  });

export async function getMyReviews() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function hasReviewedOrder(orderId: number, type: 'internal' | 'trustpilot' = 'internal') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('reviews')
    .select('id')
    .eq('user_id', user.id)
    .eq('order_id', orderId)
    .eq('type', type)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

// ADMIN: Get all reviews
export async function getAdminReviews() {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return await enrichWithUsers(data || []);
}

// ADMIN: Approve review and award credit
export async function adminApproveReview(reviewId: number, creditCents: number) {
  const { data, error } = await supabase.rpc('fn_admin_approve_review', {
    p_review_id: reviewId,
    p_credit_cents: creditCents,
  });
  if (error) throw error;
  return data;
}

// ADMIN: Reject review
export async function adminRejectReview(reviewId: number, notes: string) {
  const { data, error } = await supabase
    .from('reviews')
    .update({ status: 'rejected', admin_notes: notes, reviewed_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============ Notifications ============

export async function getMyNotifications(targetRole: 'user' | 'admin' = 'user', limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('target_role', targetRole)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getUnreadNotificationsCount(targetRole: 'user' | 'admin' = 'user') {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('target_role', targetRole)
    .eq('is_read', false);
  if (error) return 0;
  return count || 0;
}

export async function markNotificationRead(notificationId: number) {
  const { error } = await supabase.rpc('fn_mark_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
}

export async function markAllNotificationsRead(targetRole: 'user' | 'admin' = 'user') {
  const { error } = await supabase.rpc('fn_mark_all_notifications_read', {
    p_target_role: targetRole,
  });
  if (error) throw error;
}

// Count unread order_status notifications for current user (for nav badge)
export async function getUnreadOrderNotificationsCount() {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('target_role', 'user')
    .eq('type', 'order_status')
    .eq('is_read', false);
  if (error) return 0;
  return count || 0;
}

// Count orders that are completed but user hasn't reviewed (for CRO banner)
export async function getReviewableOrders() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: orders, error } = await supabase
    .from('reddit_upvote_orders')
    .select('id, requested_upvotes, completed_at, thread_url')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });
  if (error) return [];

  const { data: reviews } = await supabase
    .from('reviews')
    .select('order_id')
    .eq('user_id', user.id)
    .eq('type', 'internal');

  const reviewedIds = new Set((reviews || []).map((r: any) => r.order_id));
  return (orders || []).filter((o: any) => !reviewedIds.has(o.id));
}

// Helper: Get price per upvote in cents
export function getPricePerUpvoteCents() {
  return PRICE_PER_UPVOTE_CENTS;
}

// Helper: Get price per upvote in USD
export function getPricePerUpvoteUSD() {
  return PRICE_PER_UPVOTE_CENTS / 100;
}

// Helper: Format cents as USD string
export function formatUSD(cents: number, opts: { compact?: boolean } = {}): string {
  const dollars = cents / 100;
  if (opts.compact && dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}K`;
  }
  return `$${dollars.toFixed(2)}`;
}

// Helper: Calculate cost in cents for given upvotes
export function calculateCost(upvotes: number): number {
  return upvotes * PRICE_PER_UPVOTE_CENTS;
}

// ============ Feature Requests ============

export interface FeatureRequestInput {
  category: 'platform' | 'service' | 'feature' | 'integration' | 'other';
  platform?: string;
  serviceType?: string;
  description: string;
  estimatedVolume?: number;
  urgency?: 'low' | 'normal' | 'high' | 'urgent';
  contactMethod?: string;
}

export async function submitFeatureRequest(input: FeatureRequestInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('feature_requests')
    .insert({
      user_id: user.id,
      category: input.category,
      platform: input.platform || null,
      service_type: input.serviceType || null,
      description: input.description,
      estimated_volume: input.estimatedVolume || null,
      urgency: input.urgency || 'normal',
      contact_method: input.contactMethod || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMyFeatureRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('feature_requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getAdminFeatureRequests() {
  const { data, error } = await supabase
    .from('feature_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return await enrichWithUsers(data || []);
}

// ============ Tickets & Messages ============

export async function getMyTickets() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('order_tickets')
    .select('*, order:order_id(*)')
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) throw error;
  return data || [];
}

export async function getTicketByOrderId(orderId: number) {
  const { data, error } = await supabase
    .from('order_tickets')
    .select('*, order:order_id(*)')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getTicketMessages(ticketId: number) {
  const { data, error } = await supabase
    .from('ticket_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function sendTicketMessage(
  ticketId: number,
  body: string,
  asAdmin: boolean = false
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');

  const { data, error } = await supabase
    .from('ticket_messages')
    .insert({
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: asAdmin ? 'admin' : 'user',
      body: body.trim(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function markTicketRead(ticketId: number, asRole: 'user' | 'admin') {
  const { error } = await supabase.rpc('fn_mark_ticket_read', {
    p_ticket_id: ticketId,
    p_as_role: asRole,
  });
  if (error) throw error;
}

export async function getAdminAllTickets() {
  const { data, error } = await supabase
    .from('order_tickets')
    .select('*, order:reddit_upvote_orders!order_id(*)')
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Fetch users separately
  const userIds = [...new Set(data.map((t: any) => t.user_id))];
  const { data: users } = await supabase
    .from('users')
    .select('id, email, full_name, credit_balance, created_at')
    .in('id', userIds);
  const userMap = new Map((users || []).map((u: any) => [u.id, u]));

  return data.map((t: any) => ({ ...t, user: userMap.get(t.user_id) || null }));
}

export async function getAdminUnreadTicketsCount() {
  const { data, error } = await supabase
    .from('order_tickets')
    .select('id, unread_admin', { count: 'exact', head: false })
    .gt('unread_admin', 0);

  if (error) throw error;
  return data?.length || 0;
}

// ============ Admin: User Management ============

export async function getAdminAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, credit_balance, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getAdminUserDetail(userId: string) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;

  const { data: orders } = await supabase
    .from('reddit_upvote_orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const { data: topups } = await supabase
    .from('reddit_topup_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const { data: transactions } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  return {
    user,
    orders: orders || [],
    topups: topups || [],
    transactions: transactions || [],
  };
}

// ============ Admin: Finance & Analytics ============

export async function getAdminFinanceStats() {
  const { data: topups } = await supabase
    .from('reddit_topup_requests')
    .select('amount_cents, created_at, payment_status')
    .eq('payment_status', 'completed');

  const { data: orders } = await supabase
    .from('reddit_upvote_orders')
    .select('cost_credits, requested_upvotes, status, created_at');

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalRevenue = (topups || []).reduce((sum, t) => sum + t.amount_cents, 0);
  const monthlyRevenue = (topups || [])
    .filter((t) => new Date(t.created_at) >= monthStart)
    .reduce((sum, t) => sum + t.amount_cents, 0);
  const todayRevenue = (topups || [])
    .filter((t) => new Date(t.created_at) >= today)
    .reduce((sum, t) => sum + t.amount_cents, 0);

  const totalOrders = (orders || []).length;
  const pendingOrders = (orders || []).filter((o) => ['pending', 'processing'].includes(o.status)).length;
  const completedOrders = (orders || []).filter((o) => o.status === 'completed').length;
  const totalUpvotesDelivered = (orders || [])
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + o.requested_upvotes, 0);

  return {
    totalRevenue,
    monthlyRevenue,
    todayRevenue,
    totalOrders,
    pendingOrders,
    completedOrders,
    totalUpvotesDelivered,
  };
}

export async function updateOrderDetail(
  orderId: number,
  updates: Partial<{
    status: string;
    delivered_upvotes: number;
    admin_notes: string;
    delivery_proof_text: string;
    delivery_proof_url: string;
  }>
) {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  if (updates.status === 'completed') {
    payload.completed_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('reddit_upvote_orders')
    .update(payload)
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ADMIN: Upload delivery proof image
export async function adminUploadDeliveryProof(orderId: number, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `${orderId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('delivery-proofs')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage
    .from('delivery-proofs')
    .getPublicUrl(path);
  return urlData.publicUrl;
}
