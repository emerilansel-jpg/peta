-- ============================================================
-- Migration: 20261110030000_admin_broken_task_cleanup_and_guard.sql
--
-- 1. Block admin_update_task_status() from activating tasks with broken/410/404/closed/search URLs.
-- 2. Block admin_update_task() from activating a broken task unless target_url was replaced with a valid URL.
-- 3. Auto-hide historical completed/cancelled broken tasks so Admin TaskQueue stays focused on live work.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_update_task_status(p_task_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task public.tasks;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_status NOT IN ('draft', 'active', 'paused', 'completed') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan';
  END IF;

  IF p_status = 'active' AND COALESCE(v_task.task_category, '') <> 'reddit_challenge' THEN
    IF public.fn_is_invalid_task_url(v_task.target_url) THEN
      RAISE EXCEPTION 'Task tidak bisa diaktifkan: Target URL kosong atau berupa halaman search.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_task.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url') THEN
      RAISE EXCEPTION 'Task tidak bisa diaktifkan: Target URL berstatus % (%). Perbaiki link terlebih dahulu via Edit.', v_task.url_status, COALESCE(v_task.url_check_error, 'link bermasalah') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.tasks
  SET status = p_status,
      updated_at = NOW()
  WHERE id = p_task_id;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_update_task(
  p_task_id uuid,
  p_title text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text,
  p_brief text DEFAULT NULL::text,
  p_post_to_wa_group boolean DEFAULT NULL::boolean,
  p_wa_group_draft text DEFAULT NULL::text,
  p_target_url text DEFAULT NULL::text,
  p_task_category text DEFAULT NULL::text,
  p_reward_amount integer DEFAULT NULL::integer,
  p_max_assignments integer DEFAULT NULL::integer,
  p_per_account_limit integer DEFAULT NULL::integer,
  p_min_karma integer DEFAULT NULL::integer,
  p_min_account_age_days integer DEFAULT NULL::integer,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task_type text;
  v_existing public.tasks;
  v_next_url text;
  v_next_cat text;
  v_url_changed boolean := false;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT * INTO v_existing FROM public.tasks WHERE id = p_task_id FOR UPDATE;
  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  v_next_cat := COALESCE(p_task_category, v_existing.task_category);
  v_next_url := COALESCE(NULLIF(btrim(p_target_url), ''), v_existing.target_url);
  v_url_changed := (p_target_url IS NOT NULL AND btrim(p_target_url) IS DISTINCT FROM btrim(COALESCE(v_existing.target_url, '')));

  IF COALESCE(v_next_cat, '') <> 'reddit_challenge' THEN
    IF (p_target_url IS NOT NULL OR COALESCE(p_status, v_existing.status) = 'active') AND public.fn_is_invalid_task_url(v_next_url) THEN
      RAISE EXCEPTION 'Target URL wajib berupa link http(s) langsung sebelum task diaktifkan (tidak boleh kosong atau halaman search).' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(p_status, v_existing.status) = 'active'
       AND NOT v_url_changed
       AND COALESCE(v_existing.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url') THEN
      RAISE EXCEPTION 'Target URL masih berstatus % — ganti Target URL dengan link valid sebelum mengaktifkan task.', v_existing.url_status USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_task_type := CASE p_task_category
    WHEN 'reddit_upvote'      THEN 'upvote'
    WHEN 'quora_upvote'       THEN 'upvote'
    WHEN 'reddit_comment'     THEN 'comment'
    WHEN 'forum_comment'      THEN 'comment'
    WHEN 'reddit_post_thread' THEN 'comment'
    WHEN 'youtube_upload'     THEN 'upload'
    WHEN 'preferred_source'   THEN 'upvote'
    WHEN 'linkedin_like'      THEN 'upvote'
    WHEN 'linkedin_follow'    THEN 'upvote'
    WHEN 'linkedin_comment'   THEN 'comment'
    WHEN 'trustpilot_review'  THEN 'comment'
    WHEN 'google_maps_review' THEN 'comment'
    WHEN 'yelp_review'        THEN 'comment'
    WHEN 'clutch_review'      THEN 'comment'
    ELSE NULL
  END;

  UPDATE public.tasks SET
    title                 = COALESCE(p_title, title),
    description           = COALESCE(p_description, description),
    brief                 = COALESCE(p_brief, brief),
    post_to_wa_group      = COALESCE(p_post_to_wa_group, post_to_wa_group),
    wa_group_draft        = COALESCE(p_wa_group_draft, wa_group_draft),
    target_url            = v_next_url,
    task_category         = COALESCE(p_task_category, task_category),
    task_type             = COALESCE(v_task_type, task_type),
    reward_amount         = COALESCE(p_reward_amount, reward_amount),
    max_assignments       = COALESCE(p_max_assignments, max_assignments),
    per_account_limit     = COALESCE(p_per_account_limit, per_account_limit),
    min_karma             = COALESCE(p_min_karma, min_karma),
    min_account_age_days  = COALESCE(p_min_account_age_days, min_account_age_days),
    start_at              = CASE WHEN p_start_at IS NOT NULL THEN p_start_at ELSE start_at END,
    end_at                = CASE WHEN p_end_at IS NOT NULL THEN p_end_at ELSE end_at END,
    status                = COALESCE(p_status, status),
    url_status            = CASE WHEN v_url_changed AND NOT public.fn_is_invalid_task_url(v_next_url) THEN NULL ELSE url_status END,
    url_check_error       = CASE WHEN v_url_changed AND NOT public.fn_is_invalid_task_url(v_next_url) THEN NULL ELSE url_check_error END,
    updated_at            = NOW()
  WHERE id = p_task_id;

  RETURN p_task_id;
END
$function$;

-- Keep historical completed/cancelled broken tasks hidden from main admin list
UPDATE public.tasks t
SET is_hidden = true,
    updated_at = NOW()
FROM public.reddit_upvote_orders o
WHERE t.source_order_id = o.id
  AND t.is_hidden = false
  AND (t.status = 'completed' OR o.status IN ('completed', 'cancelled'))
  AND COALESCE(t.url_status, 'ok') IN ('gone_410', 'not_found_404', 'closed_topic', 'search_page', 'invalid_url');

NOTIFY pgrst, 'reload schema';
