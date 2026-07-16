-- Force PostgREST to pick up the admin_approve_assignment function by
-- dropping and recreating it (with the same signature) and re-granting.
-- Also reload the schema cache.
DROP FUNCTION IF EXISTS public.admin_approve_assignment(uuid);

CREATE OR REPLACE FUNCTION public.admin_approve_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.task_assignments;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status bukan submitted' USING ERRCODE = 'P0001';
  END IF;

  IF v_assignment.status <> 'submitted' THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status bukan submitted' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.task_assignments
  SET status = 'approved',
      updated_at = NOW()
  WHERE id = p_assignment_id
    AND status = 'submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status bukan submitted' USING ERRCODE = 'P0001';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_approve_assignment(uuid) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
