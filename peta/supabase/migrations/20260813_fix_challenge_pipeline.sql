-- ============================================================
-- PeTa — Fix Reddit Army Challenge pipeline (unblock progression).
--
-- Found during health check: the challenge pipeline was completely STUCK.
-- Root causes (4):
--   1. DOUBLE-CREDIT BUG: tg_on_assignment_approved credits task.reward_amount
--      as CASHABLE 'task_reward' on approval, AND award_challenge_level_reward
--      credits the SAME amount as a HELD level bonus. Spec (2026-07-29 design,
--      line 55) says the per-level bonus is a single LOCKED reward — there is
--      no separate cashable task reward for challenge tasks. task.reward_amount
--      is DISPLAY-only. Fix: exclude reddit_challenge from the cashable credit.
--   2. TASKS PAUSED: the only 2 challenge tasks (Lv1, Lv2) are status='paused',
--      and claim_task_assignment rejects non-active tasks → members can't claim.
--   3. MISSING Lv3/4/5 TASKS: only Lv1 & Lv2 have challenge tasks, so
--      check_challenge_level_complete (which counts approved tasks per level)
--      can never advance anyone past Lv2.
--   4. can_submit GATED ON DEAD DATA: list_challenge_tasks_for_user only allows
--      submit when activity_sum >= target_count, but activity_sum comes from
--      reddit_daily_activity which is never populated (Reddit auto-sync is dead,
--      verification is manual now). So the "Selesaikan Misi" button never shows.
--      Fix: allow submit whenever the task is claimed (in_progress); admin
--      verifies the incognito screenshot. Also fix null current_level_started_at
--      (was showing level-0 members as time-locked forever).
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

-- ------------------------------------------------------------
-- 1) tg_on_assignment_approved — don't cash-credit reddit_challenge tasks.
--    They earn the HELD level bonus via trg_reddit_army_check_level_after_approval.
--    Slot count + order sync still run (challenge tasks have no source_order_id,
--    so the order block is naturally skipped).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_on_assignment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_reward int;
  v_task_title text;
  v_source_order_id int;
  v_requested int;
  v_delivered int;
  v_proof_text text;
  v_task_category text;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT COALESCE(ta.user_id, ra.user_id), t.reward_amount, t.title, t.source_order_id, t.task_category
      INTO v_user_id, v_reward, v_task_title, v_source_order_id, v_task_category
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.id = NEW.id;

    -- Credit cashable task reward ONLY for regular tasks.
    -- reddit_challenge tasks earn a HELD level bonus instead (spec: per-level
    -- bonus is locked, sourced via award_challenge_level_reward) — crediting
    -- task.reward_amount here too would double-pay the member.
    IF v_task_category IS DISTINCT FROM 'reddit_challenge' THEN
      INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
      VALUES (
        v_user_id, v_reward, 'task_reward',
        format('Reward task: %s', COALESCE(v_task_title, 'tugas')),
        NEW.id
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (
        v_user_id,
        'task_reward_credited',
        jsonb_build_object(
          'assignment_id', NEW.id,
          'task_id', NEW.task_id,
          'amount', v_reward,
          'source_order_id', v_source_order_id
        )
      );
    END IF;

    NEW.balance_credited_at := NOW();
    PERFORM public.sync_task_slot_count(NEW.task_id);

    -- Straight order sync (B2B upvote orders) — challenge tasks have no source_order_id.
    IF v_source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET delivered_upvotes = COALESCE(delivered_upvotes, 0) + 1
      WHERE id = v_source_order_id;

      SELECT requested_upvotes, delivered_upvotes INTO v_requested, v_delivered
      FROM public.reddit_upvote_orders WHERE id = v_source_order_id;

      IF v_delivered >= v_requested THEN
        UPDATE public.reddit_upvote_orders
        SET status = 'completed', completed_at = NOW()
        WHERE id = v_source_order_id AND status NOT IN ('completed','refunded');
        UPDATE public.tasks SET status = 'completed'
        WHERE id = NEW.task_id AND status = 'active';
      END IF;

      v_proof_text := format(
        'Comment by %s:\n%s%s',
        COALESCE(NULLIF(trim(NEW.submitted_username), ''), 'Unknown'),
        COALESCE(NEW.draft_comment, '(no comment text)'),
        CASE WHEN NEW.user_note IS NOT NULL AND length(trim(NEW.user_note)) > 0
          THEN E'\nNote: ' || trim(NEW.user_note)
          ELSE ''
        END
      );

      UPDATE public.reddit_upvote_orders
      SET
        delivery_proof_text = CASE
          WHEN delivery_proof_text IS NULL THEN v_proof_text
          ELSE delivery_proof_text || E'\n\n---\n\n' || v_proof_text
        END,
        delivery_proof_url = COALESCE(NEW.proof_image_url, NEW.proof_url, delivery_proof_url)
      WHERE id = v_source_order_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2) Unpause the existing Lv1 & Lv2 challenge tasks.
-- ------------------------------------------------------------
UPDATE public.tasks
   SET status = 'active', updated_at = NOW()
 WHERE task_category = 'reddit_challenge'
   AND status = 'paused';

-- ------------------------------------------------------------
-- 3) Create the missing Lv3, Lv4, Lv5 challenge tasks.
--    reward_amount is DISPLAY-only (cash credit is excluded above; the real
--    reward is the HELD level bonus via award_challenge_level_reward).
-- ------------------------------------------------------------
INSERT INTO public.tasks
  (title, description, brief, challenge_level_id, task_category, task_type,
   reward_amount, min_level, max_assignments, per_account_limit, status, display_order)
SELECT 'Capai Karma ≥ 20', 'Level 3 — Penggiat. Akun Reddit kamu sudah punya karma total minimal 20.',
       'Buka profile Reddit kamu (mode Incognito), screenshot yg nunjukin karma total ≥ 20 + aktivitas terbaru. Upload sebagai bukti.',
       id, 'reddit_challenge', 'comment', 15000, 0, 100, 1, 'active', 3
  FROM public.reddit_challenge_levels WHERE level_number = 3
ON CONFLICT DO NOTHING;

INSERT INTO public.tasks
  (title, description, brief, challenge_level_id, task_category, task_type,
   reward_amount, min_level, max_assignments, per_account_limit, status, display_order)
SELECT 'Capai Karma ≥ 50 + 3 Post', 'Level 4 — Pejuang. Karma total ≥ 50 DAN minimal 3 post.',
       'Screenshot profile Reddit (Incognito) yg nunjukin karma ≥ 50 dan ≥ 3 post di history aktivitas. Upload sebagai bukti.',
       id, 'reddit_challenge', 'comment', 20000, 0, 100, 1, 'active', 4
  FROM public.reddit_challenge_levels WHERE level_number = 4
ON CONFLICT DO NOTHING;

INSERT INTO public.tasks
  (title, description, brief, challenge_level_id, task_category, task_type,
   reward_amount, min_level, max_assignments, per_account_limit, status, display_order)
SELECT 'Capai Karma ≥ 100 + 5 Post (Veteran)', 'Level 5 — Veteran. Karma total ≥ 100 DAN minimal 5 post. Menyelesaikan level ini memicu bonus Phase 1 Rp100.000.',
       'Screenshot profile Reddit (Incognito): karma ≥ 100 + ≥ 5 post. Ini level terakhir Phase 1 — setelah approve, kamu naik ke Phase 2 & dapat bonus Rp100.000.',
       id, 'reddit_challenge', 'comment', 0, 0, 100, 1, 'active', 5
  FROM public.reddit_challenge_levels WHERE level_number = 5
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 4) list_challenge_tasks_for_user — decouple submit from the dead auto-sync.
--    Verification is manual now: once a task is claimed (in_progress), the
--    member may submit proof anytime; admin verifies the screenshot. Also fix
--    null current_level_started_at (level-0 members were shown as time-locked).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_challenge_tasks_for_user()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_target_level public.reddit_challenge_levels;
  v_days_at_level int;
  v_is_time_locked boolean;
  v_activity_sum int;
  v_target_count int;
  v_username text;
  v_account_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase1_active','phase1_complete') THEN
    RETURN;
  END IF;

  SELECT * INTO v_target_level FROM public.reddit_challenge_levels
    WHERE level_number = v_profile.current_challenge_level + 1
      AND is_active = true;
  IF v_target_level IS NULL THEN RETURN; END IF;

  -- Time gate: a member who hasn't started any level yet (null started_at) is
  -- eligible for the first level (matches check_challenge_level_complete's null→999).
  v_days_at_level := CASE
    WHEN v_profile.current_level_started_at IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - v_profile.current_level_started_at))::int
    ELSE v_target_level.min_days_at_level
  END;
  v_is_time_locked := v_days_at_level < v_target_level.min_days_at_level;
  v_target_count := GREATEST(COALESCE(v_target_level.target_count, 1), 1);

  -- Informational only (Reddit auto-sync is off; verification is manual).
  SELECT COALESCE(SUM(comments_today + posts_today), 0)::int INTO v_activity_sum
    FROM public.reddit_daily_activity
   WHERE user_id = v_uid
     AND activity_date >= COALESCE(v_profile.phase1_started_at::date, CURRENT_DATE - 60);

  SELECT ra.username, ra.id INTO v_username, v_account_id
    FROM public.reddit_accounts ra WHERE ra.id = v_profile.warmed_account_id;

  RETURN QUERY
  SELECT jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'description', t.description,
    'target_url', t.target_url,
    'reward_amount', t.reward_amount,
    'level_number', rcl.level_number,
    'level_name', rcl.level_name,
    'assignment_id', ta.id,
    'assignment_status', ta.status,
    'can_retry', ta.can_retry,
    'level_locked', v_is_time_locked,
    'days_until_unlock', GREATEST(v_target_level.min_days_at_level - v_days_at_level, 0),
    'min_days_at_level', v_target_level.min_days_at_level,
    'progress_count', v_activity_sum,
    'target_count', v_target_count,
    'progress_complete', (ta.status = 'in_progress'),
    'can_submit', (ta.status = 'in_progress'),
    'reddit_username', v_username,
    'reddit_account_id', v_account_id
  )
  FROM public.tasks t
  JOIN public.reddit_challenge_levels rcl ON rcl.id = t.challenge_level_id
  LEFT JOIN public.task_assignments ta
    ON ta.task_id = t.id
   AND ta.user_id = v_uid
   AND ta.status IN ('in_progress','submitted','approved','rejected')
  WHERE t.task_category = 'reddit_challenge'
    AND t.status IN ('active','paused')
    AND t.is_hidden = false
    AND rcl.level_number = v_target_level.level_number
    AND rcl.is_active = true
  ORDER BY rcl.level_number, t.display_order;
END;
$$;

NOTIFY pgrst, 'reload schema';
