import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: 'army' | 'admin' | 'client';
          role_title: string | null;
          website: string | null;
          is_active: boolean;
          credit_balance: number;
          created_at: string;
          updated_at: string;
        };
      };
      reddit_accounts: {
        Row: {
          id: string;
          user_id: string;
          username: string;
          karma: number;
          account_age_days: number;
          level: number;
          last_sync: string;
          created_at: string;
          updated_at: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          brief: string | null;
          target_url: string | null;
          task_type: string | null;
          task_category: string | null;
          min_level: number;
          min_karma: number | null;
          min_account_age_days: number | null;
          max_assignments: number;
          current_assignments: number;
          per_account_limit: number | null;
          reward_amount: number;
          status: 'draft' | 'active' | 'paused' | 'completed';
          display_order: number;
          is_hidden: boolean;
          start_at: string | null;
          end_at: string | null;
          post_to_wa_group: boolean | null;
          wa_group_draft: string | null;
          source_order_id: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      task_assignments: {
        Row: {
          id: string;
          task_id: string;
          reddit_account_id: string;
          status: 'in_progress' | 'submitted' | 'approved' | 'rejected';
          draft_comment: string | null;
          proof_url: string | null;
          admin_notes: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      payouts: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          status: 'pending' | 'paid' | 'cancelled';
          payment_method: string | null;
          payment_type: 'ewallet' | 'bank' | null;
          provider: string | null;
          account_number: string | null;
          account_holder_name: string | null;
          proof_url: string | null;
          requested_at: string;
          paid_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      credit_transactions: {
        Row: {
          id: number;
          user_id: string;
          type: 'topup' | 'spend' | 'adjust' | 'refund';
          amount: number;
          balance_after: number;
          metadata: Record<string, any> | null;
          created_at: string;
        };
      };
      reddit_upvote_orders: {
        Row: {
          id: number;
          user_id: string;
          status: 'pending' | 'processing' | 'completed' | 'cancelled';
          subreddit: string | null;
          thread_url: string;
          target_type: 'upvote' | 'comment' | 'thread';
          requested_upvotes: number;
          cost_credits: number;
          delivered_upvotes: number | null;
          notes: string | null;
          admin_notes: string | null;
          delivery_proof_text: string | null;
          delivery_proof_url: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
      };
      reddit_topup_requests: {
        Row: {
          id: number;
          user_id: string;
          amount_cents: number;
          credits_purchased: number;
          payment_method: string;
          paypal_order_id: string | null;
          paypal_capture_id: string | null;
          payment_status: 'pending' | 'completed' | 'failed' | 'refunded';
          metadata: Record<string, any> | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
      };
      order_tickets: {
        Row: {
          id: number;
          order_id: number;
          user_id: string;
          subject: string | null;
          status: 'open' | 'closed' | 'pending_user' | 'pending_admin';
          last_message_at: string | null;
          unread_user: number;
          unread_admin: number;
          created_at: string;
          updated_at: string;
        };
      };
      ticket_messages: {
        Row: {
          id: number;
          ticket_id: number;
          sender_id: string;
          sender_role: 'user' | 'admin' | 'system';
          body: string;
          attachments: Record<string, any> | null;
          read_by_user: boolean;
          read_by_admin: boolean;
          created_at: string;
        };
      };
      reviews: {
        Row: {
          id: number;
          user_id: string;
          order_id: number | null;
          type: 'internal' | 'trustpilot' | 'advise';
          rating: number | null;
          reviewer_name: string | null;
          reviewer_role: string | null;
          reviewer_website: string | null;
          reviewer_profile_pic_url: string | null;
          profile_pic_consent: boolean;
          dofollow_link_requested: boolean;
          dofollow_link_granted: boolean;
          title: string | null;
          body: string | null;
          trustpilot_url: string | null;
          trustpilot_screenshot_url: string | null;
          status: 'pending' | 'approved' | 'rejected' | 'credit_awarded';
          credit_awarded_cents: number;
          admin_notes: string | null;
          created_at: string;
          reviewed_at: string | null;
        };
      };
      notifications: {
        Row: {
          id: number;
          user_id: string;
          target_role: 'user' | 'admin';
          type: 'message' | 'order_status' | 'review' | 'credit' | 'payment' | 'general';
          title: string;
          body: string | null;
          link: string | null;
          is_read: boolean;
          metadata: Record<string, any> | null;
          created_at: string;
        };
      };
    };
  };
};
