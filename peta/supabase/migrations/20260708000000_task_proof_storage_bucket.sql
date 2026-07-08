-- =============================================================
-- PeTa — task-proof storage bucket + RLS policies
--
-- Ensures the army-side screenshot upload in TaskDetail.tsx has a
-- predictable, reproducible home. The previous bucket was created
-- manually in the Supabase dashboard, which made it easy for RLS
-- policies to drift (e.g. casting empty/non-uuid values to uuid).
--
-- Policy model: path-based, first folder = authenticated user id.
-- We intentionally avoid owner = auth.uid() so the rules work even
-- if the storage API ever supplies a malformed/empty owner value.
-- =============================================================

-- 1. Create / refresh the public bucket
INSERT INTO storage.buckets (
  id, name, public, avif_autodetection, file_size_limit, allowed_mime_types
)
VALUES (
  'task-proofs',
  'task-proofs',
  true,
  false,
  5242880,                 -- 5 MB, matches frontend validation
  ARRAY['image/*']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Drop any existing object policies that mention this bucket so we
--    start from a clean slate and remove policies that may cast to uuid.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        policyname ILIKE '%task%proof%'
        OR qual ILIKE '%task-proofs%'
        OR with_check ILIKE '%task-proofs%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- 3. Recreate clean path-based policies
CREATE POLICY "task_proofs_public_select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'task-proofs');

CREATE POLICY "task_proofs_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "task_proofs_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "task_proofs_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
