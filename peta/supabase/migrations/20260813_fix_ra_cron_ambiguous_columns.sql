-- ============================================================
-- PeTa — Fix Reddit Army cron functions: ambiguous column references.
--
-- 3 of 5 ra-* cron jobs have been failing every run with
--   ERROR: column reference "user_id" is ambiguous
-- because the functions declare RETURNS TABLE(user_id, ...) (creating OUT
-- params named user_id/amount) AND then reference unqualified columns of the
-- same name in their bodies. Postgres can't tell OUT-param vs table column apart.
--
-- Affected (all failing):
--   flag_ghosting_for_review()        — ra-flag-ghosting (weekly)
--   process_resignation_complete()    — ra-resignation-process (daily)
--   release_phase1_completion_hold()  — ra-release-phase1-hold (hourly)
--
-- Fix: alias each table and qualify every column reference.
-- Bodies are otherwise unchanged (logic preserved exactly).
--
-- Apply via: supabase db query --linked --file <this file>  (NOT db push).
-- ============================================================

-- ------------------------------------------------------------
-- 1) flag_ghosting_for_review()  RETURNS TABLE(user_id uuid)
--    Ambiguity: UPDATE ... RETURNING user_id (vs OUT param user_id).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_ghosting_for_review()
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
    UPDATE public.reddit_army_profiles AS rap SET
      notes = CONCAT_WS(E'\n', rap.notes, format('[%s] GHOSTING REVIEW: inactive >7 days', NOW()::date)),
      updated_at = NOW()
    WHERE rap.program_status IN ('phase2_active','resigning')
      AND rap.last_active_date IS NOT NULL
      AND rap.last_active_date < CURRENT_DATE - INTERVAL '7 days'
    RETURNING rap.user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_ghosting_for_review() TO authenticated;

-- ------------------------------------------------------------
-- 2) process_resignation_complete()  RETURNS TABLE(user_id uuid, released_amount integer)
--    Ambiguities: bare user_id in selects/where/insert/update vs OUT param user_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_resignation_complete()
RETURNS TABLE(user_id uuid, released_amount integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user record;
  v_total int;
BEGIN
  FOR v_user IN
    SELECT rap.user_id
      FROM public.reddit_army_profiles AS rap
     WHERE rap.program_status = 'resigning'
       AND rap.resign_effective_at <= NOW()
       AND rap.resign_active_days >= 20
  LOOP
    SELECT COALESCE(SUM(bh.amount), 0) INTO v_total
      FROM public.bonus_holds AS bh
     WHERE bh.user_id = v_user.user_id
       AND bh.status IN ('held','vesting');

    IF v_total > 0 THEN
      INSERT INTO public.user_credits (user_id, amount, source, description)
      VALUES (v_user.user_id, v_total, 'hold_release',
              'Cairan Tabungan Retensi (resign complete)');
    END IF;

    UPDATE public.bonus_holds AS bh SET
      status = 'released',
      released_at = NOW()
    WHERE bh.user_id = v_user.user_id
      AND bh.status IN ('held','vesting');

    UPDATE public.reddit_army_profiles AS rap SET
      program_status = 'resigned',
      resigned_at = NOW(),
      updated_at = NOW()
    WHERE rap.user_id = v_user.user_id;

    INSERT INTO public.activity_logs (user_id, action, details)
    VALUES (v_user.user_id, 'reddit_army_resign_complete',
      jsonb_build_object('released_amount', v_total));

    RETURN QUERY SELECT v_user.user_id, v_total;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_resignation_complete() TO authenticated;

-- ------------------------------------------------------------
-- 3) release_phase1_completion_hold()  RETURNS TABLE(user_id uuid, amount integer)
--    Ambiguities: SELECT id, user_id, amount FROM bonus_holds (vs OUT params user_id, amount).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_phase1_completion_hold()
RETURNS TABLE(user_id uuid, amount integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT bh.id, bh.user_id, bh.amount
      FROM public.bonus_holds AS bh
     WHERE bh.source = 'phase1_completion'
       AND bh.status = 'held'
       AND bh.created_at + INTERVAL '30 days' <= NOW()
  LOOP
    UPDATE public.bonus_holds AS bh SET
      status = 'released',
      released_at = NOW()
    WHERE bh.id = v_row.id;

    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id)
    VALUES (v_row.user_id, v_row.amount, 'hold_release',
            'Cairan Tabungan Retensi (Phase 1, 30-day)', v_row.id);

    RETURN QUERY SELECT v_row.user_id, v_row.amount;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_phase1_completion_hold() TO authenticated;

-- ------------------------------------------------------------
-- 4) release_biweekly_cashout()  RETURNS TABLE(user_id uuid, amount integer)
--    Latent ambiguity: unqualified user_id in WHERE/SET on reddit_daily_activity
--    (vs OUT param user_id). Currently passing only by luck — fix proactively
--    before Phase 2 members accumulate pending_split bonuses.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_biweekly_cashout()
RETURNS TABLE(user_id uuid, amount integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user record;
  v_sum int;
  v_cutoff date := CURRENT_DATE - INTERVAL '14 days';
BEGIN
  FOR v_user IN
    SELECT DISTINCT rap.user_id
      FROM public.reddit_army_profiles rap
     WHERE rap.program_status IN ('phase2_active','resigning')
  LOOP
    SELECT COALESCE(SUM(rda.credited_amount / 2), 0) INTO v_sum
      FROM public.reddit_daily_activity rda
     WHERE rda.user_id = v_user.user_id
       AND rda.credited_type = 'pending_split'
       AND rda.bonus_credited = true
       AND rda.lump_credited_at IS NULL
       AND rda.activity_date <= v_cutoff;

    IF v_sum > 0 THEN
      INSERT INTO public.user_credits (user_id, amount, source, description)
      VALUES (v_user.user_id, v_sum, 'daily_bonus_cashable',
              format('Lump sum bonus harian Reddit Army 14 hari: Rp%s', v_sum));

      UPDATE public.reddit_daily_activity rda
         SET lump_credited_at = NOW()
       WHERE rda.user_id = v_user.user_id
         AND rda.credited_type = 'pending_split'
         AND rda.bonus_credited = true
         AND rda.lump_credited_at IS NULL
         AND rda.activity_date <= v_cutoff;

      RETURN QUERY SELECT v_user.user_id, v_sum;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_biweekly_cashout() TO authenticated;

NOTIFY pgrst, 'reload schema';
