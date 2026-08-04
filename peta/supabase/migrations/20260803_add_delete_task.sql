-- QA4: Admin can hard-delete tasks (with safety check for active assignments).
-- 1. Ensure FK CASCADE on task_assignments.task_id → tasks.id
-- 2. Create SECURITY DEFINER RPC admin_delete_task

-- 1. FK CASCADE (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_assignments_task_id_fkey'
      AND confrelid = 'public.tasks'::regclass
      AND confdeltype = 'c'  -- CASCADE
  ) THEN
    ALTER TABLE public.task_assignments
      DROP CONSTRAINT IF EXISTS task_assignments_task_id_fkey,
      ADD CONSTRAINT task_assignments_task_id_fkey
        FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. RPC: admin_delete_task
CREATE OR REPLACE FUNCTION public.admin_delete_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  -- Safety: block if active assignments exist
  SELECT count(*) INTO v_active
  FROM public.task_assignments
  WHERE task_id = p_task_id
    AND status IN ('in_progress', 'submitted');

  IF v_active > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'active_assignments',
      'message', format('Masih ada %s assignment aktif. Selesaikan atau tolak dulu sebelum menghapus.', v_active)
    );
  END IF;

  -- Hard delete (CASCADE removes related assignments)
  DELETE FROM public.tasks WHERE id = p_task_id;
  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_task(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
