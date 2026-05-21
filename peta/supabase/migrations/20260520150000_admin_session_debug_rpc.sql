-- Diagnostic RPC — exposes auth.uid(), role, is_admin(), and global
-- submitted_count so the admin can self-diagnose "why is my queue empty"
-- without dev intervention. Anon-callable so an expired session still
-- returns something meaningful (auth_uid will be null).
CREATE OR REPLACE FUNCTION public.admin_session_debug()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_role text; v_is_admin boolean;
BEGIN
  v_uid := auth.uid();
  SELECT role INTO v_role FROM public.users WHERE id = v_uid;
  v_is_admin := public.is_admin();
  RETURN json_build_object(
    'auth_uid', v_uid,
    'public_users_role', v_role,
    'is_admin', v_is_admin,
    'submitted_count', (SELECT COUNT(*) FROM public.task_assignments WHERE status='submitted')
  );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_session_debug() TO authenticated, anon;
