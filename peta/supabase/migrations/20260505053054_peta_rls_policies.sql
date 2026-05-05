-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Helper function for admin check (avoids recursion)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users policies
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = id OR is_admin());

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "users_insert_self" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Reddit accounts policies
CREATE POLICY "reddit_select_own" ON reddit_accounts
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "reddit_insert_own" ON reddit_accounts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "reddit_update_own" ON reddit_accounts
  FOR UPDATE USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "reddit_delete_own" ON reddit_accounts
  FOR DELETE USING (user_id = auth.uid());

-- Tasks policies
CREATE POLICY "tasks_select_active" ON tasks
  FOR SELECT USING (status = 'active' OR is_admin());

CREATE POLICY "tasks_admin_all" ON tasks
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Task assignments policies
CREATE POLICY "assignments_select_own" ON task_assignments
  FOR SELECT USING (
    reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "assignments_insert_own" ON task_assignments
  FOR INSERT WITH CHECK (
    reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "assignments_update_own" ON task_assignments
  FOR UPDATE USING (
    reddit_account_id IN (SELECT id FROM reddit_accounts WHERE user_id = auth.uid())
    OR is_admin()
  );

-- Activity logs
CREATE POLICY "activity_select_own" ON activity_logs
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "activity_insert_any" ON activity_logs
  FOR INSERT WITH CHECK (true);

-- Payouts
CREATE POLICY "payouts_select_own" ON payouts
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "payouts_insert_own" ON payouts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "payouts_admin_update" ON payouts
  FOR UPDATE USING (is_admin());
