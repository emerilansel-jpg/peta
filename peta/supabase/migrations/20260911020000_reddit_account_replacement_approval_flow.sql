-- Migration: 20260911020000_reddit_account_replacement_approval_flow.sql
-- Implements admin approval workflow for Reddit account replacement.
-- Member submits a replacement request -> Admin reviews & approves -> Account is replaced.

BEGIN;

-- ------------------------------------------------------------
-- 1. Create table reddit_account_replacement_requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reddit_account_replacement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  old_account_id uuid REFERENCES public.reddit_accounts(id) ON DELETE SET NULL,
  new_username text NOT NULL,
  reason text NOT NULL,
  initial_karma int DEFAULT 0,
  initial_age_days int DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_replacement_requests_user_status
  ON public.reddit_account_replacement_requests (user_id, status);

CREATE INDEX IF NOT EXISTS idx_replacement_requests_status_created
  ON public.reddit_account_replacement_requests (status, created_at);

-- RLS
ALTER TABLE public.reddit_account_replacement_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "replacement_requests_select_own" ON public.reddit_account_replacement_requests;
CREATE POLICY "replacement_requests_select_own" ON public.reddit_account_replacement_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "replacement_requests_insert_own" ON public.reddit_account_replacement_requests;
CREATE POLICY "replacement_requests_insert_own" ON public.reddit_account_replacement_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "replacement_requests_admin_all" ON public.reddit_account_replacement_requests;
CREATE POLICY "replacement_requests_admin_all" ON public.reddit_account_replacement_requests
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 2. Member RPC: request_reddit_account_replacement
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_reddit_account_replacement(
  p_new_username text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_username text;
  v_old_account public.reddit_accounts;
  v_existing_account public.reddit_accounts;
  v_pending_request public.reddit_account_replacement_requests;
  v_request_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- 1. Check if user already has a pending request
  SELECT * INTO v_pending_request
  FROM public.reddit_account_replacement_requests
  WHERE user_id = v_uid AND status = 'pending'
  LIMIT 1;

  IF v_pending_request.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Kamu sudah memiliki pengajuan ganti akun yang sedang ditinjau admin (u/' || v_pending_request.new_username || ').'
    );
  END IF;

  -- 2. Sanitize & validate username
  v_clean_username := regexp_replace(trim(COALESCE(p_new_username, '')), '^.*?(?:reddit\.com\/(?:user|u)\/|u\/|user\/)', '', 'i');
  v_clean_username := regexp_replace(v_clean_username, '[^A-Za-z0-9_-]', '', 'g');

  IF length(v_clean_username) < 3 OR length(v_clean_username) > 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit minimal 3 dan maksimal 32 karakter.');
  END IF;

  -- 3. Check if username belongs to another user
  SELECT * INTO v_existing_account
  FROM public.reddit_accounts
  WHERE lower(username) = lower(v_clean_username)
  LIMIT 1;

  IF v_existing_account.id IS NOT NULL AND v_existing_account.user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit u/' || v_clean_username || ' sudah terdaftar di akun PeTa lain.');
  END IF;

  -- 4. Find current active account
  SELECT * INTO v_old_account
  FROM public.reddit_accounts
  WHERE user_id = v_uid AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_old_account.id IS NOT NULL AND lower(v_old_account.username) = lower(v_clean_username) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Akun baru tidak boleh sama dengan akun saat ini.');
  END IF;

  -- 5. Insert request
  INSERT INTO public.reddit_account_replacement_requests (
    user_id, old_account_id, new_username, reason, status, created_at
  ) VALUES (
    v_uid, v_old_account.id, v_clean_username, COALESCE(trim(p_reason), 'Akun bermasalah / kena sanksi'), 'pending', NOW()
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Pengajuan ganti akun ke u/' || v_clean_username || ' berhasil dikirim! Menunggu persetujuan admin.',
    'request_id', v_request_id,
    'new_username', v_clean_username
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_reddit_account_replacement(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_reddit_account_replacement(text, text) TO authenticated;

-- ------------------------------------------------------------
-- 3. Member RPC: get_my_replacement_request
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_replacement_request()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT r.id, r.new_username, r.reason, r.status, r.admin_notes, r.created_at, r.reviewed_at,
         ra.username as old_username
  INTO v_req
  FROM public.reddit_account_replacement_requests r
  LEFT JOIN public.reddit_accounts ra ON ra.id = r.old_account_id
  WHERE r.user_id = v_uid
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN to_jsonb(v_req);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_replacement_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_replacement_request() TO authenticated;

-- ------------------------------------------------------------
-- 4. Admin RPC: admin_list_replacement_requests
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_replacement_requests()
RETURNS TABLE (
  request_id uuid,
  user_id uuid,
  member_email text,
  member_name text,
  member_whatsapp text,
  old_account_id uuid,
  old_username text,
  new_username text,
  reason text,
  status text,
  admin_notes text,
  created_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS request_id,
    r.user_id,
    u.email AS member_email,
    u.full_name AS member_name,
    u.whatsapp AS member_whatsapp,
    r.old_account_id,
    COALESCE(ra.username, '-') AS old_username,
    r.new_username,
    r.reason,
    r.status,
    r.admin_notes,
    r.created_at,
    r.reviewed_at
  FROM public.reddit_account_replacement_requests r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = r.old_account_id
  ORDER BY
    CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
    r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_replacement_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_replacement_requests() TO authenticated;

-- ------------------------------------------------------------
-- 5. Admin RPC: admin_review_replacement_request
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_replacement_request(
  p_request_id uuid,
  p_decision text,
  p_admin_notes text DEFAULT NULL,
  p_initial_karma int DEFAULT 0,
  p_initial_age_days int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_req public.reddit_account_replacement_requests;
  v_replace_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision: must be approved or rejected';
  END IF;

  SELECT * INTO v_req
  FROM public.reddit_account_replacement_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Permintaan tidak ditemukan.');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Permintaan sudah di-review sebelumnya (' || v_req.status || ').');
  END IF;

  IF p_decision = 'approved' THEN
    -- Execute atomic account replacement
    v_replace_res := public.replace_user_reddit_account(
      p_new_username := v_req.new_username,
      p_reason := 'Disetujui admin: ' || COALESCE(p_admin_notes, v_req.reason),
      p_initial_karma := p_initial_karma,
      p_initial_age_days := p_initial_age_days,
      p_user_id := v_req.user_id
    );

    IF NOT (v_replace_res->>'ok')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'error', v_replace_res->>'error');
    END IF;

    UPDATE public.reddit_account_replacement_requests
    SET status = 'approved',
        admin_notes = p_admin_notes,
        reviewed_at = NOW(),
        reviewed_by = auth.uid()
    WHERE id = v_req.id;

    RETURN jsonb_build_object(
      'ok', true,
      'message', 'Pengajuan disetujui. Akun member berhasil diganti ke u/' || v_req.new_username,
      'new_username', v_req.new_username
    );
  ELSE
    -- Rejected
    UPDATE public.reddit_account_replacement_requests
    SET status = 'rejected',
        admin_notes = p_admin_notes,
        reviewed_at = NOW(),
        reviewed_by = auth.uid()
    WHERE id = v_req.id;

    RETURN jsonb_build_object(
      'ok', true,
      'message', 'Pengajuan ganti akun u/' || v_req.new_username || ' ditolak.'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_replacement_request(uuid, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_replacement_request(uuid, text, text, int, int) TO authenticated;

-- ------------------------------------------------------------
-- 6. Lock replace_user_reddit_account to ADMIN ONLY
-- ------------------------------------------------------------
-- Direct replacement can only be called by an admin (either directly from admin panel or via admin_review_replacement_request)
CREATE OR REPLACE FUNCTION public.replace_user_reddit_account(
  p_new_username text,
  p_reason text,
  p_initial_karma int DEFAULT 0,
  p_initial_age_days int DEFAULT 0,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_user_id uuid;
  v_clean_username text;
  v_old_account public.reddit_accounts;
  v_existing_account public.reddit_accounts;
  v_new_account public.reddit_accounts;
  v_profile public.reddit_army_profiles;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- ENFORCE: Only admin can execute direct replacement!
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: direct replacement is admin only. Members must use request_reddit_account_replacement.' USING ERRCODE = '42501';
  END IF;

  v_target_user_id := COALESCE(p_user_id, v_caller);

  -- Validate & sanitize username
  v_clean_username := regexp_replace(trim(COALESCE(p_new_username, '')), '^.*?(?:reddit\.com\/(?:user|u)\/|u\/|user\/)', '', 'i');
  v_clean_username := regexp_replace(v_clean_username, '[^A-Za-z0-9_-]', '', 'g');

  IF length(v_clean_username) < 3 OR length(v_clean_username) > 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit minimal 3 dan maksimal 32 karakter.');
  END IF;

  -- Check if username is already used by another user
  SELECT * INTO v_existing_account
  FROM public.reddit_accounts
  WHERE lower(username) = lower(v_clean_username)
  LIMIT 1;

  IF v_existing_account.id IS NOT NULL AND v_existing_account.user_id <> v_target_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username Reddit u/' || v_clean_username || ' sudah terdaftar di akun PeTa lain.');
  END IF;

  -- Find current active account
  SELECT * INTO v_old_account
  FROM public.reddit_accounts
  WHERE user_id = v_target_user_id
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_old_account.id IS NOT NULL AND lower(v_old_account.username) = lower(v_clean_username) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Akun baru tidak boleh sama dengan akun saat ini.');
  END IF;

  -- STEP 1: Deactivate old account first
  IF v_old_account.id IS NOT NULL THEN
    UPDATE public.reddit_accounts
    SET is_active = false,
        replaced_at = NOW(),
        replacement_reason = p_reason,
        updated_at = NOW()
    WHERE id = v_old_account.id;
  END IF;

  -- STEP 2: Reactivate or insert new active account
  IF v_existing_account.id IS NOT NULL AND v_existing_account.user_id = v_target_user_id THEN
    UPDATE public.reddit_accounts
    SET is_active = true,
        karma = COALESCE(p_initial_karma, karma),
        account_age_days = COALESCE(p_initial_age_days, account_age_days),
        status_flag = 'ok',
        flagged_at = NULL,
        last_sync = NOW(),
        updated_at = NOW()
    WHERE id = v_existing_account.id
    RETURNING * INTO v_new_account;
  ELSE
    INSERT INTO public.reddit_accounts (
      user_id, username, karma, account_age_days, level, is_active, status_flag, last_sync, created_at, updated_at
    ) VALUES (
      v_target_user_id,
      v_clean_username,
      COALESCE(p_initial_karma, 0),
      COALESCE(p_initial_age_days, 0),
      0,
      true,
      'ok',
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING * INTO v_new_account;
  END IF;

  -- STEP 3: Link old account to new
  IF v_old_account.id IS NOT NULL THEN
    UPDATE public.reddit_accounts
    SET replaced_by_account_id = v_new_account.id
    WHERE id = v_old_account.id;
  END IF;

  -- STEP 4: Update reddit_army_profiles linkage
  SELECT * INTO v_profile
  FROM public.reddit_army_profiles
  WHERE user_id = v_target_user_id;

  IF v_profile.user_id IS NOT NULL THEN
    UPDATE public.reddit_army_profiles
    SET warmed_account_id = v_new_account.id,
        notes = CONCAT_WS(E'\n', notes, format('[%s] Ganti akun ke u/%s: %s', NOW()::date, v_new_account.username, COALESCE(p_reason, 'Admin approved replacement'))),
        updated_at = NOW()
    WHERE user_id = v_target_user_id;
  END IF;

  -- STEP 5: Audit log
  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (
    v_target_user_id,
    'reddit_account_replaced',
    jsonb_build_object(
      'old_account_id', v_old_account.id,
      'old_username', v_old_account.username,
      'new_account_id', v_new_account.id,
      'new_username', v_new_account.username,
      'reason', p_reason,
      'replaced_by', v_caller,
      'is_admin_action', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Akun Reddit berhasil diganti ke u/' || v_new_account.username,
    'account_id', v_new_account.id,
    'username', v_new_account.username,
    'karma', v_new_account.karma,
    'account_age_days', v_new_account.account_age_days
  );
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
