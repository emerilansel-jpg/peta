-- ============================================================
-- PeTa — Reddit Army: challenge task progress + proof submission
--
-- get_challenge_task_progress(p_task_id):
--   Returns per-task progress for the calling user:
--     - assignment status
--     - how many comments/posts detected since phase1 start
--     - target count from the challenge level
--     - whether progress is complete (can submit proof)
--
-- submit_challenge_task_with_proof(p_task_id, p_proof_url, p_proof_image_url):
--   Marks the in_progress assignment as 'submitted' with proof.
--   Only allowed when progress >= target.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_challenge_task_progress(
  p_task_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_assignment public.task_assignments;
  v_level public.reddit_challenge_levels;
  v_activity_sum int;
  v_target int;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  -- Get the task's level for target count
  SELECT rcl.* INTO v_level
    FROM public.tasks t
    JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
   WHERE t.id = p_task_id;
  IF v_level IS NULL THEN RAISE EXCEPTION 'Task bukan challenge task'; END IF;

  -- Profile (need phase1_started_at for baseline)
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;

  -- Existing assignment (if any)
  SELECT * INTO v_assignment FROM public.task_assignments
   WHERE task_id = p_task_id
     AND user_id = v_uid
     AND status IN ('in_progress','submitted','approved','rejected')
   ORDER BY created_at DESC LIMIT 1;

  -- Sum of comments+posts detected since phase1 started (or all time if no baseline)
  SELECT COALESCE(SUM(comments_today + posts_today), 0)::int INTO v_activity_sum
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date >= COALESCE(v_profile.phase1_started_at::date, CURRENT_DATE - 60);

  v_target := GREATEST(COALESCE(v_level.target_count, 1), 1);

  v_result := jsonb_build_object(
    'task_id', p_task_id,
    'assignment_id', v_assignment.id,
    'assignment_status', v_assignment.status,
    'progress_count', v_activity_sum,
    'target_count', v_target,
    'progress_complete', v_activity_sum >= v_target,
    'can_submit', (v_assignment.status = 'in_progress' AND v_activity_sum >= v_target)
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_challenge_task_progress(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Submit challenge task with proof (marks submitted for admin review)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_challenge_task_with_proof(
  p_task_id uuid,
  p_proof_url text DEFAULT NULL,
  p_proof_image_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_assignment public.task_assignments;
  v_level public.reddit_challenge_levels;
  v_activity_sum int;
  v_target int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_assignment FROM public.task_assignments
   WHERE task_id = p_task_id
     AND user_id = v_uid
     AND status IN ('in_progress','submitted','rejected')
   ORDER BY created_at DESC LIMIT 1;

  IF v_assignment IS NULL THEN
    RAISE EXCEPTION 'Task belum di-claim. Mulai misi dulu ya.';
  END IF;

  IF v_assignment.status = 'submitted' THEN
    RAISE EXCEPTION 'Task ini sudah di-submit. Tunggu admin review ya.';
  END IF;

  -- Check progress reached target
  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  SELECT rcl.* INTO v_level
    FROM public.tasks t
    JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
   WHERE t.id = p_task_id;

  SELECT COALESCE(SUM(comments_today + posts_today), 0)::int INTO v_activity_sum
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date >= COALESCE(v_profile.phase1_started_at::date, CURRENT_DATE - 60);

  v_target := GREATEST(COALESCE(v_level.target_count, 1), 1);

  IF v_activity_sum < v_target THEN
    RAISE EXCEPTION 'Progress belum lengkap: %/% aktivitas terdeteksi. Sync & kerjain dulu ya.', v_activity_sum, v_target;
  END IF;

  -- Proof required: screenshot profile OR URL
  IF NULLIF(trim(p_proof_url), '') IS NULL AND NULLIF(trim(p_proof_image_url), '') IS NULL THEN
    RAISE EXCEPTION 'Wajib upload screenshot profil Reddit atau link profile sebelum selesaikan misi.';
  END IF;

  -- Update assignment to submitted
  UPDATE public.task_assignments SET
    status = 'submitted',
    proof_url = COALESCE(p_proof_url, proof_url),
    proof_image_url = COALESCE(p_proof_image_url, proof_image_url),
    submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = v_assignment.id;

  INSERT INTO public.activity_logs (user_id, action, details)
  VALUES (v_uid, 'reddit_army_challenge_submitted',
    jsonb_build_object('task_id', p_task_id, 'assignment_id', v_assignment.id));

END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_challenge_task_with_proof(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
