-- Migration: 20260926000000_peta_growth_phase0_security_and_payout.sql
-- Description:
--   1. Tutup legacy onboarding steps (hanya signup, wa_group, warp; max Rp50K total).
--   2. Payout tanpa minimum nominal (amount > 0, amount <= available_balance, user is_active check).
--   3. Enforce users.is_active di claim_task_assignment & submit_assignment_proof.
--   4. Validasi server-side minimal proof sesuai kategori di submit_assignment_proof.
--   5. Fix capability claim di claim_task_assignment agar draft_comment tidak ditolak zz_guard_assignment_authorization.
--   6. Exclude reddit_challenge dari canonical cashable task_earnings di get_user_earnings & validate_payout_eligibility.
--   7. Require minimal 1 proof di self_report_daily_activity.
--   8. Anonymous user return 0 task di list_eligible_tasks_for_user (cegah task scraping).
--   9. Tambah kolom attribution & reactivation consent ke users; update handle_new_user; mask email referee.
--  10. Admin targeted broadcast support (p_user_ids filter) & RPC admin_get_growth_dashboard.

BEGIN;

-- 1. Attribusi dan Consent di public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS acquisition_source text,
  ADD COLUMN IF NOT EXISTS acquisition_medium text,
  ADD COLUMN IF NOT EXISTS acquisition_campaign text,
  ADD COLUMN IF NOT EXISTS acquisition_content text,
  ADD COLUMN IF NOT EXISTS acquisition_term text,
  ADD COLUMN IF NOT EXISTS acquisition_landing_path text,
  ADD COLUMN IF NOT EXISTS reactivation_opt_in boolean NOT NULL DEFAULT false;

-- 2. Update handle_new_user untuk attributasi & privasi email referee
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_product       TEXT;
  v_role          TEXT;
  v_full_name     TEXT;
  v_role_title    TEXT;
  v_website       TEXT;
  v_referrer_code TEXT;
  v_referrer_id   UUID;
  v_whatsapp      TEXT;
  v_existing_owner UUID;
  v_masked_email  TEXT;
BEGIN
  -- Common metadata extraction
  v_product    := COALESCE(NULLIF(LOWER(NEW.raw_user_meta_data->>'product'), ''), 'peta');
  v_full_name  := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1));
  v_role_title := NULLIF(NEW.raw_user_meta_data->>'role_title', '');
  v_website    := NULLIF(NEW.raw_user_meta_data->>'website', '');
  v_referrer_code := NULLIF(LOWER(NEW.raw_user_meta_data->>'referral_code'), '');
  v_whatsapp   := NULLIF(NEW.raw_user_meta_data->>'whatsapp', '');

  -- Role: Straight clients get 'client', everyone else defaults to 'army'.
  IF v_product = 'straight' THEN
    v_role := 'client';
  ELSE
    v_role := 'army';
  END IF;

  -- Pre-check WhatsApp uniqueness so we can raise a friendly message.
  IF v_whatsapp IS NOT NULL THEN
    SELECT id INTO v_existing_owner FROM public.users WHERE whatsapp = v_whatsapp LIMIT 1;
    IF v_existing_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Nomor WhatsApp ini sudah terdaftar di akun PeTa lain. Pakai nomor lain atau login dengan akun yang sudah ada.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_referrer_code IS NOT NULL THEN
    SELECT id INTO v_referrer_id FROM public.users WHERE referral_code = v_referrer_code LIMIT 1;
  END IF;

  INSERT INTO public.users (
    id, email, full_name, whatsapp, role, referred_by,
    role_title, website,
    acquisition_source, acquisition_medium, acquisition_campaign,
    acquisition_content, acquisition_term, acquisition_landing_path,
    reactivation_opt_in
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_whatsapp,
    v_role,
    v_referrer_id,
    v_role_title,
    v_website,
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_source'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_medium'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_campaign'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_content'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_term'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'acquisition_landing_path'), ''),
    COALESCE((NEW.raw_user_meta_data->>'reactivation_opt_in')::boolean, false)
  )
  ON CONFLICT (id) DO NOTHING;

  -- Award referral bonus to BOTH sides if a valid PeTa referral code was used.
  -- Mask referee email to preserve privacy.
  IF v_referrer_id IS NOT NULL THEN
    v_masked_email := LEFT(split_part(NEW.email, '@', 1), 3) || '***@' || split_part(NEW.email, '@', 2);
    INSERT INTO public.user_credits (user_id, amount, source, description, reference_id) VALUES
      (v_referrer_id, 20000, 'referral_bonus_referrer', 'Bonus karena undang teman: ' || v_masked_email, NEW.id),
      (NEW.id,        20000, 'referral_bonus_referee',  'Bonus daftar pakai kode referral', v_referrer_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Tutup legacy onboarding steps (hanya signup=25K, wa_group=10K, warp=15K; total max 50K)
CREATE OR REPLACE FUNCTION public.claim_onboarding_bonus(p_step text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID;
  v_amount INTEGER;
  v_description TEXT;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Founding cap: hanya 100 pendaftar pertama (berdasarkan created_at) yang berhak mendapat bonus founding
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT id FROM public.users WHERE role = 'army' ORDER BY created_at ASC LIMIT 100
    ) u WHERE u.id = v_user
  ) THEN
    RAISE EXCEPTION 'Founding bonus sudah penuh (hanya untuk 100 member pertama)';
  END IF;

  CASE p_step
    WHEN 'signup'   THEN v_amount := 25000; v_description := 'Bonus pendaftaran';
    WHEN 'wa_group' THEN v_amount := 10000; v_description := 'Bonus gabung grup WhatsApp';
    WHEN 'warp'     THEN v_amount := 15000; v_description := 'Bonus setup WARP';
    ELSE RAISE EXCEPTION 'Unknown or disabled onboarding step: %', p_step;
  END CASE;

  INSERT INTO public.user_credits (user_id, amount, source, description)
  VALUES (v_user, v_amount, 'signup_bonus', v_description)
  ON CONFLICT (user_id, description) WHERE source = 'signup_bonus'
  DO NOTHING;

  -- Catat durabilitas onboarding completed saat step terakhir diklaim
  IF p_step = 'warp' THEN
    UPDATE public.users
    SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
    WHERE id = v_user;
  END IF;

  RETURN v_amount;
END;
$function$;

-- RPC eksplisit untuk menandai onboarding selesai bagi member baru (termasuk yang tidak dapat bonus founding)
CREATE OR REPLACE FUNCTION public.complete_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.users
  SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
  WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated;

-- 4. Payout tanpa minimum nominal (amount > 0, amount <= available_balance)
CREATE OR REPLACE FUNCTION public.validate_payout_eligibility(
  p_user_id uuid,
  p_amount int
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_at timestamptz;
  v_days_old int;
  v_approved_tasks int;
  v_weekly_total int;
  v_task_earnings int;
  v_signup_bonus int;
  v_referral_bonus int;
  v_other_credits int;
  v_bonus_total int;
  v_committed int;
  v_bonus_unlocked boolean;
  v_cashable_pool int;
  v_available_unlocked int;
  v_is_active boolean;
  v_weekly_cap CONSTANT int := 500000;
  v_min_account_age CONSTANT int := 7;
  v_min_approved_tasks CONSTANT int := 5;
  v_bonus_unlock_floor CONSTANT int := 100000;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF auth.uid() <> p_user_id AND NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Jumlah penarikan harus lebih dari 0'; END IF;

  SELECT created_at, is_active INTO v_created_at, v_is_active FROM public.users WHERE id = p_user_id;
  IF v_created_at IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF v_is_active IS NOT TRUE THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'account_inactive',
      'message', 'Akun kamu sedang dinonaktifkan. Hubungi admin untuk informasi lebih lanjut.'
    );
  END IF;

  v_days_old := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_created_at)) / 86400)::int;

  SELECT COUNT(*)::int INTO v_approved_tasks
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  WHERE COALESCE(ta.user_id, ra.user_id) = p_user_id AND ta.status = 'approved';

  SELECT COALESCE(SUM(amount), 0)::int INTO v_weekly_total
  FROM public.payouts
  WHERE user_id = p_user_id
    AND created_at > NOW() - INTERVAL '7 days'
    AND status IN ('pending', 'paid');

  -- Task earnings for regular tasks only (exclude reddit_challenge retention)
  SELECT COALESCE(SUM(t.reward_amount), 0)::int INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = p_user_id
    AND ta.status = 'approved'
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward','task_revert') THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_other_credits
  FROM public.user_credits
  WHERE user_id = p_user_id;

  v_bonus_total := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= v_bonus_unlock_floor;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_committed
  FROM public.payouts
  WHERE user_id = p_user_id AND status IN ('pending', 'paid');

  v_cashable_pool := v_task_earnings + v_other_credits
                   + CASE WHEN v_bonus_unlocked THEN v_bonus_total ELSE 0 END;
  v_available_unlocked := v_cashable_pool - v_committed;

  IF v_days_old < v_min_account_age AND v_approved_tasks < v_min_approved_tasks THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'holding_period',
      'message', format(
        'Payout pertama buka setelah %s hari ATAU %s task approved. Akun kamu %s hari, task approved: %s.',
        v_min_account_age, v_min_approved_tasks, v_days_old, v_approved_tasks
      ),
      'days_old', v_days_old,
      'approved_tasks', v_approved_tasks,
      'task_earnings', v_task_earnings,
      'bonus_total', v_bonus_total,
      'bonus_unlocked', v_bonus_unlocked,
      'bonus_unlock_floor', v_bonus_unlock_floor,
      'available_unlocked', v_available_unlocked,
      'min_payout', 0
    );
  END IF;

  IF p_amount > v_available_unlocked THEN
    IF NOT v_bonus_unlocked AND v_bonus_total > 0 THEN
      RETURN json_build_object(
        'eligible', false,
        'reason', 'earnings_floor',
        'message', format(
          'Saldo bonus (signup + referral) kebuka setelah kumpulin Rp%s dari task approved. Sekarang baru Rp%s dari task — kurang Rp%s lagi. Saldo dari task bisa langsung ditarik tanpa minimum.',
          to_char(v_bonus_unlock_floor, 'FM999G999G999'),
          to_char(v_task_earnings, 'FM999G999G999'),
          to_char(v_bonus_unlock_floor - v_task_earnings, 'FM999G999G999')
        ),
        'task_earnings', v_task_earnings,
        'bonus_total', v_bonus_total,
        'bonus_unlocked', false,
        'bonus_unlock_floor', v_bonus_unlock_floor,
        'available_unlocked', v_available_unlocked,
        'min_payout', 0
      );
    ELSE
      RETURN json_build_object(
        'eligible', false,
        'reason', 'insufficient_balance',
        'message', format(
          'Saldo tidak cukup. Saldo yang dapat ditarik: Rp%s.',
          to_char(GREATEST(v_available_unlocked, 0), 'FM999G999G999')
        ),
        'task_earnings', v_task_earnings,
        'bonus_total', v_bonus_total,
        'bonus_unlocked', v_bonus_unlocked,
        'bonus_unlock_floor', v_bonus_unlock_floor,
        'available_unlocked', v_available_unlocked,
        'min_payout', 0
      );
    END IF;
  END IF;

  IF (v_weekly_total + p_amount) > v_weekly_cap THEN
    RETURN json_build_object(
      'eligible', false,
      'reason', 'weekly_cap',
      'message', format(
        'Maksimal penarikan Rp%s per 7 hari. Total kamu 7 hari terakhir: Rp%s. Sisa kuota: Rp%s.',
        to_char(v_weekly_cap, 'FM999G999G999'),
        to_char(v_weekly_total, 'FM999G999G999'),
        to_char(GREATEST(v_weekly_cap - v_weekly_total, 0), 'FM999G999G999')
      ),
      'weekly_total', v_weekly_total,
      'weekly_cap', v_weekly_cap,
      'available_unlocked', v_available_unlocked,
      'min_payout', 0
    );
  END IF;

  RETURN json_build_object(
    'eligible', true,
    'message', 'Penarikan dapat diproses',
    'available_unlocked', v_available_unlocked,
    'min_payout', 0
  );
END;
$$;

-- Request payout 5-param overload (tanpa min Rp20.000, enforce is_active)
CREATE OR REPLACE FUNCTION public.request_payout(
  p_amount integer,
  p_payment_type text,
  p_provider text,
  p_account_number text,
  p_account_holder_name text
)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Jumlah penarikan harus lebih dari 0'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RAISE EXCEPTION 'Akun kamu sedang dinonaktifkan. Hubungi admin untuk bantuan.' USING ERRCODE = '42501';
  END IF;

  IF p_payment_type IS NULL OR p_payment_type NOT IN ('ewallet', 'bank') THEN
    RAISE EXCEPTION 'Pilih metode penarikan (E-wallet atau Bank)';
  END IF;
  IF NULLIF(trim(p_provider), '') IS NULL THEN
    RAISE EXCEPTION 'Pilih provider (misal Dana, BCA, dll)';
  END IF;
  IF NULLIF(trim(p_account_number), '') IS NULL THEN
    RAISE EXCEPTION 'Nomor rekening/e-wallet wajib diisi';
  END IF;
  IF NULLIF(trim(p_account_holder_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pemilik rekening/e-wallet wajib diisi';
  END IF;

  -- Acquire transaction advisory lock for this user to serialize concurrent payout attempts
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  v_eligibility := public.validate_payout_eligibility(v_uid, p_amount);
  IF NOT (v_eligibility->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_eligibility->>'message';
  END IF;

  INSERT INTO public.payouts (
    user_id,
    amount,
    status,
    payment_method,
    payment_type,
    provider,
    account_number,
    account_holder_name
  )
  VALUES (
    v_uid,
    p_amount,
    'pending',
    p_provider,
    p_payment_type,
    p_provider,
    trim(p_account_number),
    trim(p_account_holder_name)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

-- Request payout 1-param overload (legacy backward compatibility)
CREATE OR REPLACE FUNCTION public.request_payout(p_amount integer)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_eligibility json;
  v_row public.payouts;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Jumlah penarikan harus lebih dari 0'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RAISE EXCEPTION 'Akun kamu sedang dinonaktifkan. Hubungi admin untuk bantuan.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  v_eligibility := public.validate_payout_eligibility(v_uid, p_amount);
  IF NOT (v_eligibility->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_eligibility->>'message';
  END IF;

  INSERT INTO public.payouts (user_id, amount, status)
  VALUES (v_uid, p_amount, 'pending')
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

-- 5. Exclude reddit_challenge dari canonical task earnings di get_user_earnings
CREATE OR REPLACE FUNCTION public.get_user_earnings()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task_earnings int;
  v_signup_bonus int;
  v_manual_adj int;
  v_referral_bonus int;
  v_bonus int;
  v_bonus_unlocked boolean;
  v_cashable int;
  v_total int;
  v_ra_phase1 int;
  v_ra_daily_credited int;
  v_ra_hold_released int;
  v_ra_retention_held int;
  v_ra_pending_cashable int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Canonical task earnings: approved assignments (excluding reddit_challenge which is retention-held)
  SELECT COALESCE(SUM(t.reward_amount), 0)::int
  INTO v_task_earnings
  FROM public.task_assignments ta
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE COALESCE(ta.user_id, ra.user_id) = v_uid
    AND ta.status = 'approved'
    AND COALESCE(t.task_category, '') <> 'reddit_challenge';

  SELECT
    COALESCE(SUM(CASE WHEN source = 'signup_bonus' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source IN ('referral_bonus_referrer','referral_bonus_referee') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source NOT IN ('signup_bonus','referral_bonus_referrer','referral_bonus_referee','task_reward','task_revert') THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'phase1_completion' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'daily_bonus_cashable' THEN amount ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN source = 'hold_release' THEN amount ELSE 0 END), 0)::int
  INTO v_signup_bonus, v_referral_bonus, v_manual_adj,
       v_ra_phase1, v_ra_daily_credited, v_ra_hold_released
  FROM public.user_credits
  WHERE user_id = v_uid;

  SELECT COALESCE(SUM(amount), 0)::int
  INTO v_ra_retention_held
  FROM public.bonus_holds
  WHERE user_id = v_uid AND status IN ('held','vesting');

  SELECT COALESCE(SUM(credited_amount / 2), 0)::int
  INTO v_ra_pending_cashable
  FROM public.reddit_daily_activity
  WHERE user_id = v_uid
    AND credited_type = 'pending_split'
    AND bonus_credited = true
    AND lump_credited_at IS NULL;

  v_bonus := v_signup_bonus + v_referral_bonus;
  v_bonus_unlocked := v_task_earnings >= 100000;
  v_cashable := v_task_earnings + v_manual_adj + CASE WHEN v_bonus_unlocked THEN v_bonus ELSE 0 END;
  v_total := v_task_earnings + v_manual_adj + v_bonus;

  RETURN json_build_object(
    'tasks', v_task_earnings,
    'manualAdj', v_manual_adj,
    'signupBonus', v_signup_bonus,
    'referralBonus', v_referral_bonus,
    'bonus', v_bonus,
    'bonusUnlocked', v_bonus_unlocked,
    'cashable', v_cashable,
    'total', v_total,
    'earned', v_task_earnings + v_manual_adj,
    'referral', v_bonus,
    'fromWork', v_task_earnings,
    'redditArmyPhase1Instant', v_ra_phase1,
    'redditArmyDailyCredited', v_ra_daily_credited,
    'redditArmyHoldReleased', v_ra_hold_released,
    'redditArmyRetentionHeld', v_ra_retention_held,
    'redditArmyPendingCashable', v_ra_pending_cashable
  );
END;
$$;

-- 6. Enforce active check & write capability di claim_task_assignment
CREATE OR REPLACE FUNCTION public.claim_task_assignment(
  p_task_id uuid,
  p_reddit_account_id uuid DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_task record;
  v_account record;
  v_assignment public.task_assignments;
  v_live int;
  v_draft record;
  v_norm_target text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login dulu untuk ambil task.' USING ERRCODE = 'P0001';
  END IF;

  -- Enforce active user
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RAISE EXCEPTION 'Akun kamu sedang dinonaktifkan.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan.' USING ERRCODE = 'P0001';
  END IF;

  IF v_task.status <> 'active'
    OR (v_task.start_at IS NOT NULL AND now() < v_task.start_at)
    OR (v_task.end_at IS NOT NULL AND now() >= v_task.end_at)
    OR v_task.is_hidden THEN
    RAISE EXCEPTION 'Task ini sudah tidak aktif.' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.task_live_assignment_count(p_task_id) INTO v_live;
  IF v_live >= COALESCE(v_task.max_assignments, 0) THEN
    PERFORM public.sync_task_slot_count(p_task_id);
    RAISE EXCEPTION 'Quota task sudah penuh. Ambil task lain.' USING ERRCODE = 'P0001';
  END IF;

  -- Set write capability to satisfy zz_guard_assignment_authorization on draft assignment
  INSERT INTO public.assignment_write_capabilities (transaction_id, backend_id, operation, task_id)
  VALUES (txid_current(), pg_backend_pid(), 'claim', p_task_id)
  ON CONFLICT (transaction_id, backend_id, operation) DO UPDATE SET task_id = EXCLUDED.task_id;

  -- Accountless categories: no Reddit account required
  IF COALESCE(v_task.task_category, '') IN (
    'forum_comment', 'youtube_upload', 'preferred_source',
    'linkedin_like', 'linkedin_follow', 'linkedin_comment'
  ) THEN
    -- Strict cross-order target dedup for LinkedIn tasks
    IF v_task.task_category IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment') THEN
      v_norm_target := regexp_replace(lower(btrim(COALESCE(v_task.target_url, ''))), '[/?#]+$', '');
      IF EXISTS (
        SELECT 1
        FROM public.task_assignments ta2
        JOIN public.tasks t2 ON t2.id = ta2.task_id
        WHERE ta2.user_id = v_uid
          AND t2.task_category = v_task.task_category
          AND ta2.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t2.target_url, ''))), '[/?#]+$', '') = v_norm_target
      ) THEN
        DELETE FROM public.assignment_write_capabilities
        WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
        RAISE EXCEPTION 'Kamu sudah pernah mengerjakan task LinkedIn untuk target ini sebelumnya.' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, NULL, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;

    -- Assign unique draft for comments (forum_comment & linkedin_comment)
    IF v_task.task_category IN ('forum_comment', 'linkedin_comment') THEN
      SELECT d.id, d.comment_text
      INTO v_draft
      FROM public.reddit_order_comment_drafts d
      WHERE d.order_id = v_task.source_order_id
        AND d.assignment_id IS NULL
      ORDER BY d.draft_index
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

      IF v_draft.id IS NOT NULL THEN
        UPDATE public.task_assignments
        SET draft_comment = v_draft.comment_text
        WHERE id = v_assignment.id;

        UPDATE public.reddit_order_comment_drafts
        SET assignment_id = v_assignment.id
        WHERE id = v_draft.id;

        v_assignment.draft_comment := v_draft.comment_text;
      END IF;
    END IF;
  ELSE
    SELECT *
    INTO v_account
    FROM public.reddit_accounts
    WHERE id = p_reddit_account_id
      AND user_id = v_uid;

    IF v_account.id IS NULL THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit tidak valid.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_account.is_active THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu sedang tidak aktif.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.status = 'suspended' THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Akun Reddit kamu berstatus suspended.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.karma < COALESCE(v_task.min_karma, 0) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Karma akun kamu belum cukup untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    IF v_account.account_age_days < COALESCE(v_task.min_account_age_days, 0) THEN
      DELETE FROM public.assignment_write_capabilities
      WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';
      RAISE EXCEPTION 'Umur akun kamu belum cukup untuk task ini.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.task_assignments (task_id, user_id, reddit_account_id, status, expires_at)
    VALUES (p_task_id, v_uid, v_account.id, 'in_progress', NOW() + INTERVAL '24 hours')
    RETURNING * INTO v_assignment;
  END IF;

  DELETE FROM public.assignment_write_capabilities
  WHERE transaction_id = txid_current() AND backend_id = pg_backend_pid() AND operation = 'claim';

  PERFORM public.sync_task_slot_count(p_task_id);
  RETURN v_assignment;
END;
$fn$;

-- 7. Enforce active check & validasi bukti minimal di submit_assignment_proof
CREATE OR REPLACE FUNCTION public.submit_assignment_proof(
  p_assignment_id uuid,
  p_proof_url text DEFAULT NULL,
  p_submitted_url text DEFAULT NULL,
  p_submitted_username text DEFAULT NULL,
  p_draft_comment text DEFAULT NULL,
  p_proof_urls jsonb DEFAULT '[]'::jsonb,
  p_user_note text DEFAULT NULL,
  p_proof_image_url text DEFAULT NULL
)
RETURNS public.task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.task_assignments;
  v_task public.tasks;
  v_contributor boolean;
  v_first_submitted timestamptz;
  v_visibility_check timestamptz;
  v_proof_urls jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Enforce active user
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = true) THEN
    RAISE EXCEPTION 'Akun kamu sedang dinonaktifkan.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_assignment.user_id, (SELECT user_id FROM public.reddit_accounts WHERE id = v_assignment.reddit_account_id)) IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    v_assignment.status IN ('in_progress', 'submitted')
    OR (v_assignment.status = 'rejected' AND COALESCE(v_assignment.can_retry, false) = true)
  ) THEN
    RAISE EXCEPTION 'Assignment status tidak valid untuk submit bukti: %', v_assignment.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = v_assignment.task_id;

  v_proof_urls := COALESCE(p_proof_urls, '[]'::jsonb);
  IF jsonb_typeof(v_proof_urls) IS DISTINCT FROM 'array' THEN
    v_proof_urls := '[]'::jsonb;
  END IF;

  -- Validasi bukti minimal di server trust boundary
  IF COALESCE(v_task.task_category, '') IN ('preferred_source', 'linkedin_like', 'linkedin_follow') THEN
    IF NULLIF(trim(COALESCE(p_proof_image_url, v_assignment.proof_image_url, '')), '') IS NULL
       AND NULLIF(trim(COALESCE(p_proof_url, v_assignment.proof_url, '')), '') IS NULL
       AND jsonb_array_length(v_proof_urls) = 0 THEN
      RAISE EXCEPTION 'Screenshot bukti wajib disertakan.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF COALESCE(v_task.task_category, '') IN ('forum_comment', 'linkedin_comment') THEN
    IF NULLIF(trim(COALESCE(p_submitted_url, p_proof_url, v_assignment.submitted_url, v_assignment.proof_url, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Link posting / komentar wajib diisi.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF COALESCE(v_task.task_category, '') = 'youtube_upload' THEN
    IF NULLIF(trim(COALESCE(p_submitted_url, p_proof_url, v_assignment.submitted_url, v_assignment.proof_url, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Link video YouTube wajib diisi.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_first_submitted := v_assignment.first_proof_submitted_at;
  v_visibility_check := v_assignment.visibility_check_after;

  IF v_first_submitted IS NULL THEN
    v_first_submitted := NOW();
    v_visibility_check := v_first_submitted + INTERVAL '72 hours';
  END IF;

  v_contributor := COALESCE(v_assignment.contributor_workflow, false);

  UPDATE public.task_assignments
  SET status = 'submitted',
      proof_url = COALESCE(p_proof_url, proof_url),
      submitted_url = COALESCE(p_submitted_url, submitted_url),
      submitted_username = COALESCE(p_submitted_username, submitted_username),
      draft_comment = COALESCE(p_draft_comment, draft_comment),
      proof_urls = v_proof_urls,
      user_note = COALESCE(p_user_note, user_note),
      proof_image_url = COALESCE(p_proof_image_url, proof_image_url),
      first_proof_submitted_at = v_first_submitted,
      visibility_check_after = v_visibility_check,
      contributor_workflow = v_contributor,
      submitted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

-- 8. Enforce bukti minimal pada self-report check-in
CREATE OR REPLACE FUNCTION public.self_report_daily_activity(
  p_comments_today int,
  p_posts_today int,
  p_proofs jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL
)
RETURNS public.reddit_daily_activity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.reddit_army_profiles;
  v_account_id uuid;
  v_proofs jsonb;
  v_row public.reddit_daily_activity;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_profile FROM public.reddit_army_profiles WHERE user_id = v_uid;
  IF v_profile IS NULL OR v_profile.program_status NOT IN ('phase2_active','resigning') THEN
    RAISE EXCEPTION 'Check-in cuma buat member Fase 2 / sedang resign.';
  END IF;

  IF p_comments_today IS NULL OR p_posts_today IS NULL
     OR p_comments_today < 0 OR p_posts_today < 0
     OR p_comments_today + p_posts_today < 1 THEN
    RAISE EXCEPTION 'Minimal 1 aktivitas (komentar atau post) buat check-in.';
  END IF;
  IF p_comments_today > 50 OR p_posts_today > 50 THEN
    RAISE EXCEPTION 'Jumlah aktivitas nggak wajar (max 50 per jenis).';
  END IF;

  v_proofs := COALESCE(p_proofs, '[]'::jsonb);
  IF jsonb_typeof(v_proofs) <> 'array' THEN
    RAISE EXCEPTION 'proof_media harus array.';
  END IF;
  IF jsonb_array_length(v_proofs) < 1 THEN
    RAISE EXCEPTION 'Sertakan minimal 1 bukti aktivitas (screenshot atau link).' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_proofs) > 10 THEN
    RAISE EXCEPTION 'Maksimal 10 bukti per check-in.';
  END IF;

  v_account_id := v_profile.warmed_account_id;
  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
      FROM public.reddit_accounts
     WHERE user_id = v_uid
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Reddit tidak ditemukan. Hubungi admin.';
  END IF;

  v_row := public.record_reddit_daily_activity(
    v_uid, v_account_id, CURRENT_DATE,
    p_comments_today, p_posts_today,
    NULL,
    'self_report'
  );

  UPDATE public.reddit_daily_activity SET
    proof_media = v_proofs,
    note = NULLIF(trim(p_note), '')
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 9. Tutup scraping anonymous di list_eligible_tasks_for_user
CREATE OR REPLACE FUNCTION public.list_eligible_tasks_for_user()
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  brief text,
  target_url text,
  task_type text,
  task_category text,
  reward_amount integer,
  max_assignments integer,
  current_assignments integer,
  min_karma integer,
  min_account_age_days integer,
  per_account_limit integer,
  status text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  created_at timestamp with time zone,
  can_do_with_account_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean := false;
  v_invited boolean := false;
BEGIN
  -- Anonymous calls return 0 tasks (mencegah scraping target / data task internal)
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- User inactive return 0 tasks
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND u.is_active = true) THEN
    RETURN;
  END IF;

  SELECT (role = 'admin') INTO v_is_admin
  FROM public.users
  WHERE users.id = v_user;

  SELECT EXISTS (
    SELECT 1
    FROM public.reddit_army_profiles
    WHERE reddit_army_profiles.user_id = v_user
  ) INTO v_invited;

  -- 1. Non-Reddit tasks (forum_comment, youtube_upload, preferred_source, linkedin_*)
  RETURN QUERY
  SELECT DISTINCT ON (t.id)
    t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
    t.task_category, t.reward_amount, t.max_assignments,
    t.current_assignments, t.min_karma, t.min_account_age_days,
    t.per_account_limit, t.status, t.start_at, t.end_at,
    t.created_at, NULL::uuid AS can_do_with_account_id
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND COALESCE(t.task_category, '') IN (
      'forum_comment', 'youtube_upload', 'preferred_source',
      'linkedin_like', 'linkedin_follow', 'linkedin_comment'
    )
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at)
    AND t.current_assignments < t.max_assignments
    AND (
      SELECT count(*)
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = v_user
        AND ta.status IN ('in_progress','submitted','approved')
    ) < COALESCE(t.per_account_limit, 1)
    AND (
      COALESCE(t.task_category, '') NOT IN ('linkedin_like', 'linkedin_follow', 'linkedin_comment')
      OR NOT EXISTS (
        SELECT 1
        FROM public.task_assignments ta_dedup
        JOIN public.tasks t_dedup ON t_dedup.id = ta_dedup.task_id
        WHERE ta_dedup.user_id = v_user
          AND t_dedup.task_category = t.task_category
          AND ta_dedup.status IN ('in_progress', 'submitted', 'approved')
          AND regexp_replace(lower(btrim(COALESCE(t_dedup.target_url, ''))), '[/?#]+$', '') =
              regexp_replace(lower(btrim(COALESCE(t.target_url, ''))), '[/?#]+$', '')
      )
    )
  ORDER BY t.id, t.created_at DESC;

  -- 2. Reddit tasks (reddit_challenge / reddit comment/upvote)
  IF v_invited OR v_is_admin THEN
    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id, t.title, t.description, t.brief, t.target_url, t.task_type,
      t.task_category, t.reward_amount, t.max_assignments,
      t.current_assignments, t.min_karma, t.min_account_age_days,
      t.per_account_limit, t.status, t.start_at, t.end_at,
      t.created_at, ra.id AS can_do_with_account_id
    FROM public.tasks t
    CROSS JOIN LATERAL (
      SELECT a.id, a.account_age_days, a.karma
      FROM public.reddit_accounts a
      WHERE a.user_id = v_user
        AND a.is_active = true
        AND a.status <> 'suspended'
        AND a.not_found_streak < 3
        AND (
          SELECT count(*)
          FROM public.task_assignments ta
          WHERE ta.task_id = t.id
            AND ta.reddit_account_id = a.id
            AND ta.status IN ('in_progress','submitted','approved')
        ) < COALESCE(t.per_account_limit, 1)
      ORDER BY a.account_age_days DESC, a.karma DESC
      LIMIT 1
    ) ra
    WHERE t.status = 'active'
      AND t.is_hidden = false
      AND COALESCE(t.task_category, '') NOT IN (
        'forum_comment', 'youtube_upload', 'preferred_source',
        'linkedin_like', 'linkedin_follow', 'linkedin_comment'
      )
      AND (t.start_at IS NULL OR now() >= t.start_at)
      AND (t.end_at IS NULL OR now() < t.end_at)
      AND t.current_assignments < t.max_assignments
      AND ra.account_age_days >= COALESCE(t.min_account_age_days, 0)
      AND ra.karma >= COALESCE(t.min_karma, 0)
    ORDER BY t.id, t.created_at DESC;
  END IF;
END;
$fn$;

-- 10. Update admin_create_broadcast untuk filter targeted user_ids & consent
CREATE OR REPLACE FUNCTION public.admin_create_broadcast(
  p_subject  text,
  p_body     text,
  p_channels text[] DEFAULT ARRAY['email','whatsapp']::text[],
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_broadcast_id uuid;
  v_total int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'subject required';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'body required';
  END IF;

  INSERT INTO broadcasts (subject, body, channels, audience, created_by)
  VALUES (
    trim(p_subject),
    trim(p_body),
    p_channels,
    CASE WHEN p_user_ids IS NOT NULL THEN 'targeted_segment' ELSE 'all_active_army' END,
    v_uid
  )
  RETURNING id INTO v_broadcast_id;

  -- Queue email recipients (army only, is_active, optional user_ids filter)
  IF 'email' = ANY (p_channels) THEN
    INSERT INTO broadcast_recipients (broadcast_id, user_id, channel, email_snapshot, whatsapp_snapshot)
    SELECT v_broadcast_id, u.id, 'email', au.email, u.whatsapp
    FROM users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.role = 'army'
      AND u.is_active = true
      AND au.email IS NOT NULL
      AND (p_user_ids IS NULL OR u.id = ANY(p_user_ids));
  END IF;

  -- Queue WhatsApp recipients (army only, is_active, optional user_ids filter)
  IF 'whatsapp' = ANY (p_channels) THEN
    INSERT INTO broadcast_recipients (broadcast_id, user_id, channel, email_snapshot, whatsapp_snapshot)
    SELECT v_broadcast_id, u.id, 'whatsapp', au.email, u.whatsapp
    FROM users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.role = 'army'
      AND u.is_active = true
      AND u.whatsapp IS NOT NULL
      AND length(u.whatsapp) > 5
      AND (p_user_ids IS NULL OR u.id = ANY(p_user_ids));
  END IF;

  SELECT COUNT(*) INTO v_total FROM broadcast_recipients WHERE broadcast_id = v_broadcast_id;
  UPDATE broadcasts SET total_targets = v_total WHERE id = v_broadcast_id;

  RETURN v_broadcast_id;
END;
$$;

-- 11. RPC admin_get_growth_dashboard untuk dashboard PIC
CREATE OR REPLACE FUNCTION public.admin_get_growth_dashboard(p_days integer DEFAULT 14)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_res json;
  v_active_army_14d int;
  v_open_slots int;
  v_gate_status text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Hitung active army (>= 2 approved credited tasks dalam trailing 14 hari)
  WITH approved_14d AS (
    SELECT COALESCE(ta.user_id, ra.user_id) AS user_id, count(*) AS approved_count
    FROM public.task_assignments ta
    LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
    JOIN public.users u ON u.id = COALESCE(ta.user_id, ra.user_id)
    WHERE u.role = 'army'
      AND u.is_active = true
      AND ta.status = 'approved'
      AND ta.balance_credited_at >= NOW() - INTERVAL '14 days'
    GROUP BY 1
  )
  SELECT count(*)::int INTO v_active_army_14d
  FROM approved_14d
  WHERE approved_count >= 2;

  -- Hitung open slots
  SELECT COALESCE(SUM(GREATEST(t.max_assignments - public.task_live_assignment_count(t.id), 0)), 0)::int
  INTO v_open_slots
  FROM public.tasks t
  WHERE t.status = 'active'
    AND t.is_hidden = false
    AND (t.start_at IS NULL OR now() >= t.start_at)
    AND (t.end_at IS NULL OR now() < t.end_at);

  IF v_open_slots <= 0 THEN
    v_gate_status := 'STOP';
  ELSIF v_open_slots < GREATEST(v_active_army_14d, 1) THEN
    v_gate_status := 'LOW';
  ELSE
    v_gate_status := 'OPEN';
  END IF;

  SELECT json_build_object(
    'measured_at', NOW(),
    'gate', json_build_object(
      'status', v_gate_status,
      'open_slots', v_open_slots,
      'active_army_14d', v_active_army_14d,
      'claimable_tasks', (
        SELECT count(*)::int FROM public.tasks
        WHERE status = 'active' AND NOT is_hidden
          AND (start_at IS NULL OR now() >= start_at)
          AND (end_at IS NULL OR now() < end_at)
      ),
      'in_progress_slots', (
        SELECT count(*)::int FROM public.task_assignments
        WHERE status = 'in_progress' AND (expires_at IS NULL OR expires_at > now())
      ),
      'submitted_backlog', (
        SELECT count(*)::int FROM public.task_assignments WHERE status = 'submitted'
      )
    ),
    'funnel', json_build_object(
      'total_registered_army', (SELECT count(*)::int FROM public.users WHERE role = 'army'),
      'active_registered_army', (SELECT count(*)::int FROM public.users WHERE role = 'army' AND is_active = true),
      'onboarded_total', (SELECT count(*)::int FROM public.users WHERE role = 'army' AND onboarding_completed_at IS NOT NULL),
      'ever_claimed_task', (
        SELECT count(DISTINCT COALESCE(ta.user_id, ra.user_id))::int
        FROM public.task_assignments ta
        LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
      ),
      'ever_submitted_task', (
        SELECT count(DISTINCT COALESCE(ta.user_id, ra.user_id))::int
        FROM public.task_assignments ta
        LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
        WHERE ta.submitted_at IS NOT NULL OR ta.status IN ('submitted', 'approved')
      ),
      'ever_approved_task', (
        SELECT count(DISTINCT COALESCE(ta.user_id, ra.user_id))::int
        FROM public.task_assignments ta
        LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
        WHERE ta.status = 'approved' AND ta.balance_credited_at IS NOT NULL
      ),
      'active_7d', (
        SELECT count(DISTINCT COALESCE(ta.user_id, ra.user_id))::int
        FROM public.task_assignments ta
        LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
        WHERE ta.status = 'approved' AND ta.balance_credited_at >= NOW() - INTERVAL '7 days'
      ),
      'active_14d_north_star', v_active_army_14d,
      'active_30d', (
        SELECT count(DISTINCT COALESCE(ta.user_id, ra.user_id))::int
        FROM public.task_assignments ta
        LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
        WHERE ta.status = 'approved' AND ta.balance_credited_at >= NOW() - INTERVAL '30 days'
      )
    ),
    'payouts', json_build_object(
      'pending_count', (SELECT count(*)::int FROM public.payouts WHERE status = 'pending'),
      'pending_amount', (SELECT COALESCE(sum(amount), 0)::int FROM public.payouts WHERE status = 'pending'),
      'paid_count_30d', (SELECT count(*)::int FROM public.payouts WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days'),
      'paid_amount_30d', (SELECT COALESCE(sum(amount), 0)::int FROM public.payouts WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days'),
      'ever_withdrawn_users', (SELECT count(DISTINCT user_id)::int FROM public.payouts WHERE status = 'paid')
    ),
    'reactivation_segments', json_build_object(
      'stalled_claims', (
        SELECT count(*)::int FROM public.task_assignments
        WHERE status = 'in_progress' AND created_at < NOW() - INTERVAL '6 hours' AND (expires_at IS NULL OR expires_at > now())
      ),
      'submitted_awaiting_approval', (
        SELECT count(*)::int FROM public.task_assignments
        WHERE status = 'submitted'
      ),
      'opted_in_reactivation', (
        SELECT count(*)::int FROM public.users WHERE role = 'army' AND is_active = true AND reactivation_opt_in = true
      )
    ),
    'campaigns', (
      SELECT COALESCE(json_agg(c), '[]'::json)
      FROM (
        SELECT
          COALESCE(acquisition_source, 'direct/untracked') AS source,
          COALESCE(acquisition_campaign, 'none') AS campaign,
          count(*)::int AS signups,
          count(*) FILTER (WHERE onboarding_completed_at IS NOT NULL)::int AS onboarded
        FROM public.users
        WHERE role = 'army'
        GROUP BY 1, 2
        ORDER BY signups DESC
        LIMIT 10
      ) c
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_dashboard(integer) TO authenticated;

COMMIT;
