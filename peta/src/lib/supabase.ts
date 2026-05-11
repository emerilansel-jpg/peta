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
          role: 'army' | 'admin';
          is_active: boolean;
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
          target_url: string | null;
          min_level: number;
          max_assignments: number;
          current_assignments: number;
          reward_amount: number;
          status: 'active' | 'paused' | 'completed';
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
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      reddit_topup_requests: {
        Row: {
          id: number;
          user_id: string;
          amount_requested: number;
          payment_method: string | null;
          proof_url: string | null;
          status: 'pending' | 'approved' | 'rejected';
          admin_note: string | null;
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
};
