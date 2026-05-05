-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'army' CHECK (role IN ('army', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Reddit accounts table
CREATE TABLE IF NOT EXISTS reddit_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  karma INTEGER DEFAULT 0,
  account_age_days INTEGER DEFAULT 0,
  level INTEGER DEFAULT 0,
  last_sync TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  target_url TEXT,
  min_level INTEGER DEFAULT 0,
  max_assignments INTEGER DEFAULT 5,
  current_assignments INTEGER DEFAULT 0,
  reward_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Task assignments table (army working on tasks)
CREATE TABLE IF NOT EXISTS task_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reddit_account_id UUID NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'approved', 'rejected')),
  draft_comment TEXT,
  proof_url TEXT,
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reddit_account_id UUID NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payouts table
CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  payment_method TEXT,
  proof_url TEXT,
  requested_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_reddit_accounts_user_id ON reddit_accounts(user_id);
CREATE INDEX idx_task_assignments_task_id ON task_assignments(task_id);
CREATE INDEX idx_task_assignments_reddit_account_id ON task_assignments(reddit_account_id);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_payouts_user_id ON payouts(user_id);

-- Row Level Security Policies

-- Users table RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own data"
  ON users FOR SELECT
  USING (auth.uid()::text = id::text OR
         EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can update their own data"
  ON users FOR UPDATE
  USING (auth.uid()::text = id::text);

-- Reddit accounts RLS
ALTER TABLE reddit_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reddit accounts"
  ON reddit_accounts FOR SELECT
  USING (user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text OR
         EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can insert reddit accounts"
  ON reddit_accounts FOR INSERT
  WITH CHECK (user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text);

CREATE POLICY "Users can update their own reddit accounts"
  ON reddit_accounts FOR UPDATE
  USING (user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text);

-- Tasks RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active tasks"
  ON tasks FOR SELECT
  USING (status = 'active');

CREATE POLICY "Admins can manage tasks"
  ON tasks FOR ALL
  USING (EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Task assignments RLS
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own assignments"
  ON task_assignments FOR SELECT
  USING (reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text) OR
         EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can insert assignments for their accounts"
  ON task_assignments FOR INSERT
  WITH CHECK (reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text));

CREATE POLICY "Users can update their assignments"
  ON task_assignments FOR UPDATE
  USING (reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text) OR
         EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Activity logs RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own activity"
  ON activity_logs FOR SELECT
  USING (user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text OR
         EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "System can insert activity logs"
  ON activity_logs FOR INSERT
  WITH CHECK (true);

-- Payouts RLS
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own payouts"
  ON payouts FOR SELECT
  USING (user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text OR
         EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can request payouts"
  ON payouts FOR INSERT
  WITH CHECK (user_id::text = (SELECT id FROM users WHERE id = auth.uid())::text);

CREATE POLICY "Admins can update payouts"
  ON payouts FOR UPDATE
  USING (EXISTS(SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
