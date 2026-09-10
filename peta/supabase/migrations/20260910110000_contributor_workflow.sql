-- Migration: 20260910110000_contributor_workflow.sql
-- Contributor workflow: task eligibility dispatch, proof submission lifecycle with 72h visibility check.

BEGIN;

-- 1. Extend tasks table with eligibility_status and eligibility_reason
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS eligibility_status text DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS eligibility_reason text;

UPDATE public.tasks
SET eligibility_status = 'legacy'
WHERE eligibility_status IS NULL;

ALTER TABLE public.tasks
  ALTER COLUMN eligibility_status SET DEFAULT 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_eligibility_status_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_eligibility_status_check
      CHECK (eligibility_status IN ('legacy', 'pending', 'approved', 'revision', 'rejected'));
  END IF;
END $$;

-- 2. Extend task_assignments table with contributor workflow columns
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS contributor_workflow boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_proof_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS visibility_check_after timestamptz,
  ADD COLUMN IF NOT EXISTS visibility_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visibility_reason text,
  ADD COLUMN IF NOT EXISTS proof_urls jsonb DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_assignments_visibility_status_check'
  ) THEN
    ALTER TABLE public.task_assignments
      ADD CONSTRAINT task_assignments_visibility_status_check
      CHECK (visibility_status IS NULL OR visibility_status IN ('visible', 'not_visible', 'unknown'));
  END IF;
END $$;

-- Auto-flag contributor workflow for Reddit / screening-gated tasks on assignment creation
CREATE OR REPLACE FUNCTION public.fn_set_assignment_contributor_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task record;
BEGIN
  SELECT eligibility_status INTO v_task FROM public.tasks WHERE id = NEW.task_id;
  NEW.contributor_workflow := FOUND AND v_task.eligibility_status IS DISTINCT FROM 'legacy';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_assignment_contributor_workflow ON public.task_assignments;
CREATE TRIGGER trg_set_assignment_contributor_workflow
BEFORE INSERT ON public.task_assignments
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_assignment_contributor_workflow();

-- 3. Update fn_ensure_order_task:
--    - Block new Reddit upvote tasks completely.
--    - For new Reddit comment/post tasks: set eligibility_status = 'pending', status = 'paused'.
--    - For other platform tasks (LinkedIn, Preferred Source, YouTube, other forums): preserve auto_activate_tasks behavior.
CREATE OR REPLACE FUNCTION public.fn_ensure_order_task(p_order public.reddit_upvote_orders)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_notes                     jsonb   := '{}'::jsonb;
  v_is_forum_comment          boolean := false;
  v_is_youtube_upload         boolean := false;
  v_is_preferred              boolean := false;
  v_is_linkedin_like          boolean := false;
  v_is_linkedin_follow        boolean := false;
  v_is_linkedin_comment       boolean := false;
  v_is_reddit_comment_or_post boolean := false;
  v_task_type                 text;
  v_task_category             text;
  v_reward                    int;
  v_title                     text;
  v_description               text;
  v_brief                     text;
  v_platform                  text;
  v_brand                     text;
  v_comment_text              text;
  v_mention_mode              text;
  v_yt_title                  text;
  v_yt_description            text;
  v_yt_tags                   text;
  v_yt_privacy                text;
  v_domain                    text;
  v_creator                   uuid;
  v_task_id                   uuid;
  v_auto_activate             boolean;
  v_initial_status            text;
  v_eligibility_status        text := 'legacy';
BEGIN
  IF p_order.status NOT IN ('pending', 'processing') THEN RETURN NULL; END IF;

  SELECT id INTO v_task_id FROM tasks WHERE source_order_id = p_order.id;
  IF v_task_id IS NOT NULL THEN RETURN v_task_id; END IF;

  BEGIN
    v_notes := COALESCE(p_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment  := COALESCE(p_order.target_type, 'upvote') = 'comment'
                         OR v_notes->>'service' = 'forum_comment';
  v_is_youtube_upload := COALESCE(p_order.target_type, 'upvote') = 'youtube_upload'
                         OR v_notes->>'service' = 'youtube_upload';
  v_is_preferred      := COALESCE(p_order.target_type, 'upvote') = 'preferred_source'
                         OR v_notes->>'service' = 'preferred_source';
  v_is_linkedin_like    := COALESCE(p_order.target_type, '') = 'linkedin_like'
                         OR v_notes->>'service' = 'linkedin_like';
  v_is_linkedin_follow  := COALESCE(p_order.target_type, '') = 'linkedin_follow'
                         OR v_notes->>'service' = 'linkedin_follow';
  v_is_linkedin_comment := COALESCE(p_order.target_type, '') = 'linkedin_comment'
                         OR v_notes->>'service' = 'linkedin_comment';

  v_is_forum_comment := COALESCE(v_is_forum_comment, false);
  v_is_youtube_upload := COALESCE(v_is_youtube_upload, false);
  v_is_preferred := COALESCE(v_is_preferred, false);
  v_is_linkedin_like := COALESCE(v_is_linkedin_like, false);
  v_is_linkedin_follow := COALESCE(v_is_linkedin_follow, false);
  v_is_linkedin_comment := COALESCE(v_is_linkedin_comment, false);

  -- Block new Reddit upvote tasks completely
  IF (COALESCE(p_order.target_type, '') = 'upvote' OR COALESCE(v_notes->>'service', '') = 'reddit_upvote')
     AND NOT v_is_preferred
     AND NOT v_is_linkedin_like
     AND NOT v_is_linkedin_follow
     AND NOT v_is_youtube_upload
     AND NOT EXISTS (SELECT 1 FROM public.legacy_paid_vote_orders WHERE order_id = p_order.id) THEN
    RAISE EXCEPTION 'paid_reddit_votes_disabled: no grandfathered paid obligation' USING ERRCODE = 'P0001';
  END IF;

  v_task_type := CASE
    WHEN p_order.target_type = 'upvote' THEN 'upvote'
    WHEN v_is_preferred      THEN 'upvote'
    WHEN v_is_linkedin_like  THEN 'upvote'
    WHEN v_is_linkedin_follow THEN 'upvote'
    WHEN v_is_youtube_upload THEN 'upload'
    ELSE 'comment'
  END;

  v_task_category := CASE
    WHEN p_order.target_type = 'upvote' THEN 'reddit_upvote'
    WHEN v_is_preferred       THEN 'preferred_source'
    WHEN v_is_linkedin_like   THEN 'linkedin_like'
    WHEN v_is_linkedin_follow THEN 'linkedin_follow'
    WHEN v_is_linkedin_comment THEN 'linkedin_comment'
    WHEN v_is_forum_comment   THEN 'forum_comment'
    WHEN v_is_youtube_upload  THEN 'youtube_upload'
    WHEN p_order.target_type = 'thread' THEN 'reddit_post_thread'
    ELSE 'reddit_comment'
  END;

  v_platform     := public.forum_platform_label(p_order.thread_url, COALESCE(v_notes->>'platform', p_order.subreddit));
  v_brand        := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_yt_title       := NULLIF(v_notes->>'title', '');
  v_yt_description := NULLIF(v_notes->>'description', '');
  v_yt_tags        := NULLIF(v_notes->>'tags', '');
  v_yt_privacy     := COALESCE(NULLIF(v_notes->>'privacy', ''), 'unlisted');

  v_domain := lower((regexp_match(p_order.thread_url, 'https?://(?:www\.)?([^/:?#]+)'))[1]);

  v_reward := CASE
    WHEN v_is_linkedin_like    THEN 1000
    WHEN v_is_linkedin_follow  THEN 1500
    WHEN v_is_linkedin_comment THEN 4000
    WHEN v_is_preferred        THEN 2500
    WHEN v_is_youtube_upload   THEN 25000
    WHEN v_task_type = 'upvote' THEN 500
    ELSE 5000
  END;

  v_title := CASE
    WHEN v_is_linkedin_like THEN
      'Beri Like postingan di LinkedIn'
    WHEN v_is_linkedin_follow THEN
      'Follow Company Page di LinkedIn'
    WHEN v_is_linkedin_comment THEN
      'Tulis komentar di post LinkedIn'
    WHEN v_is_preferred THEN
      format('Preferred Source: pilih %s di Google', COALESCE(NULLIF(v_domain, ''), 'situs klien'))
    WHEN v_is_youtube_upload THEN
      format('Upload video ke YouTube: %s', COALESCE(v_yt_title, 'tanpa judul'))
    WHEN v_is_forum_comment THEN
      format('Komen di %s%s', v_platform,
             CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
    WHEN p_order.subreddit IS NOT NULL THEN format('r/%s - %s', p_order.subreddit, v_task_type)
    ELSE format('Reddit %s task', v_task_type)
  END;

  IF v_is_linkedin_like THEN
    v_description := 'Buka posting LinkedIn di link target, berikan Like dengan akun LinkedIn pribadimu, lalu kirim screenshot dan URL profilmu.';
    v_brief := format(
      E'👍 Misi: Like postingan LinkedIn target.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link postingan target di atas\n' ||
      E'2. Klik Like pada postingan tersebut menggunakan akun LinkedIn aktifmu\n' ||
      E'3. Screenshot bukti bahwa tombol Like sudah aktif berwarna biru\n' ||
      E'4. Kirim URL profil LinkedIn publikmu dan screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.'
    );
  ELSIF v_is_linkedin_follow THEN
    v_description := 'Buka halaman Company Page LinkedIn di link target, klik Follow dengan akun LinkedIn pribadimu, lalu kirim screenshot bukti.';
    v_brief := format(
      E'🏢 Misi: Follow Company Page LinkedIn target.\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link Company Page target di atas\n' ||
      E'2. Klik tombol Follow pada halaman tersebut menggunakan akun LinkedIn pribadimu\n' ||
      E'3. Screenshot bukti bahwa status tombol sudah berubah menjadi Following\n' ||
      E'4. Kirim URL profil LinkedIn publikmu dan screenshot sebagai bukti.\n\n' ||
      E'Catatan: 1 orang/akun hanya boleh 1x untuk target ini.'
    );
  ELSIF v_is_linkedin_comment THEN
    v_description := 'Buka posting LinkedIn di link target, tulis komentar relevan dan profesional, lalu kirim screenshot bukti dan permalink komentar.';
    v_brief := format(
      E'💬 Misi: Komentar di posting LinkedIn target.\n\n' ||
      E'Instruksi khusus:\n%s\n\n' ||
      E'Langkah pengerjaan:\n' ||
      E'1. Buka link postingan target di atas\n' ||
      E'2. Jika ada draft komentar yang disediakan, gunakan draft tersebut. Jika tidak, tulis komentar yang relevan dan profesional sesuai brief di atas.\n' ||
      E'3. Screenshot komentar kamu setelah berhasil tayang\n' ||
      E'4. Salin permalink komentar dan kirim bersama URL profil LinkedIn publikmu.\n\n' ||
      E'Catatan: Dilarang spam atau komentar tidak nyambung.',
      COALESCE(NULLIF(v_notes->>'comment_brief', ''), 'Tulis komentar profesional dan relevan dengan topik postingan.')
    );
  ELSIF v_is_preferred THEN
    v_description := format(
      'Buka link tombol, klik tombol Preferred Source-nya, konfirmasi di Google, terus screenshot buktinya. 1 akun Google = 1 pilihan.',
      p_order.thread_url
    );
    v_brief := format(
      E'🎯 Misi: pilih situs %s sebagai Preferred Source di Google.\n\n' ||
      E'Langkah:\n' ||
      E'1. Buka link di atas (target URL task ini)\n' ||
      E'2. Cari dan klik tombol "Prefer us in Google" / Preferred Source di halaman itu\n' ||
      E'3. Di halaman Google yang terbuka, klik tombol konfirmasi sampai situs ini benar-benar terpilih\n' ||
      E'4. Screenshot tampilan Google yang menunjukkan situsnya sudah terpilih\n\n' ||
      E'📷 Bukti: screenshot dari langkah 4.\n' ||
      E'1 akun Google = 1 pilihan. Akun yang pernah memilih situs ini jangan dipakai lagi.\n' ||
      E'Link tombol: %s',
      COALESCE(NULLIF(v_domain, ''), p_order.thread_url),
      p_order.thread_url
    );
  ELSIF v_is_youtube_upload THEN
    v_description := format(
      'Upload video dari %s ke YouTube. Judul: %s. Setel privasi jadi %s. Setelah upload, kirim URL video YouTube sebagai bukti.',
      p_order.thread_url,
      COALESCE(v_yt_title, 'lihat brief'),
      v_yt_privacy
    );
    v_brief := format(
      E'📹 Video sumber: %s\n' ||
      E'🎬 Judul: %s\n' ||
      E'📝 Deskripsi: %s\n' ||
      E'🏷️ Tags: %s\n' ||
      E'🔒 Privasi: %s\n\n' ||
      E'Upload video ke channel YouTube-mu, lalu kirim URL video hasil upload sebagai bukti. Jangan lupa pakai metadata di atas.',
      p_order.thread_url,
      COALESCE(v_yt_title, '-'),
      COALESCE(v_yt_description, '-'),
      COALESCE(v_yt_tags, '-'),
      v_yt_privacy
    );
  ELSIF v_is_forum_comment THEN
    v_description := format(
      'Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot buat bukti.',
      v_platform);
    v_brief := public.forum_comment_task_brief(p_order.thread_url, v_comment_text, v_brand, v_mention_mode, COALESCE((v_notes->>'is_reply')::boolean, false), v_notes->>'reply_to_comment');
  ELSE
    IF p_order.notes IS NOT NULL AND btrim(p_order.notes) LIKE '{%' THEN
      v_description := 'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.';
    ELSE
      v_description := COALESCE(NULLIF(btrim(p_order.notes), ''),
                               'Tugas komen/upvote Reddit. Ikutin instruksi, kerjain rapi, terus kirim screenshot bukti.');
    END IF;
    v_brief := NULL;
  END IF;

  SELECT id INTO v_creator FROM users WHERE role = 'admin' LIMIT 1;

  -- Identify Reddit comment or post task
  v_is_reddit_comment_or_post := (
    NOT (v_is_linkedin_like OR v_is_linkedin_follow OR v_is_linkedin_comment OR v_is_preferred OR v_is_youtube_upload)
    AND (
      v_task_category IN ('reddit_comment', 'reddit_post_thread')
      OR p_order.target_type = 'thread'
      OR v_platform = 'Reddit'
      OR v_domain = 'reddit.com' OR v_domain LIKE '%.reddit.com'
    )
  );

  IF v_is_reddit_comment_or_post AND public.contributor_pilot_enabled(p_order.user_id) THEN
    v_eligibility_status := 'pending';
    v_initial_status := 'paused';
  ELSE
    SELECT COALESCE(s.auto_activate_tasks, true) INTO v_auto_activate
    FROM straight_settings s LIMIT 1;
    v_initial_status := CASE WHEN COALESCE(v_auto_activate, true) THEN 'active' ELSE 'draft' END;
    v_eligibility_status := 'legacy';
  END IF;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category,
    min_karma, min_account_age_days, per_account_limit, min_level,
    max_assignments, reward_amount, status, created_by, source_order_id,
    eligibility_status
  ) VALUES (
    v_title, v_description, v_brief,
    p_order.thread_url, v_task_type, v_task_category,
    0, 0, 1, 0,
    GREATEST(1, p_order.requested_upvotes),
    v_reward, v_initial_status, v_creator, p_order.id,
    v_eligibility_status
  )
  RETURNING id INTO v_task_id;

  IF v_initial_status = 'active' AND p_order.status = 'pending' THEN
    UPDATE reddit_upvote_orders SET status = 'processing' WHERE id = p_order.id AND status = 'pending';
  END IF;

  RETURN v_task_id;
END
$fn$;

-- 4. Admin review eligibility RPC:
--    admin_review_task_eligibility(p_task_id uuid, p_decision text, p_reason text)
CREATE OR REPLACE FUNCTION public.admin_review_task_eligibility(
  p_task_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.tasks;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'revision', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision = 'approved' THEN
    UPDATE public.tasks
    SET eligibility_status = 'approved',
        status = 'active',
        eligibility_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_task_id;

    IF v_task.source_order_id IS NOT NULL THEN
      UPDATE public.reddit_upvote_orders
      SET status = 'processing'
      WHERE id = v_task.source_order_id
        AND status = 'pending';
    END IF;
  ELSE
    UPDATE public.tasks
    SET eligibility_status = p_decision,
        status = 'paused',
        eligibility_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_task_eligibility(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_task_eligibility(uuid, text, text) TO authenticated, service_role;

-- 5. Proof submission RPC:
--    submit_assignment_proof(p_assignment_id uuid, p_proof_url text, p_submitted_url text, p_submitted_username text, p_draft_comment text, p_proof_urls jsonb DEFAULT '[]'::jsonb)
CREATE OR REPLACE FUNCTION public.submit_assignment_proof(
  p_assignment_id uuid,
  p_proof_url text,
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment public.task_assignments;
  v_task public.tasks;
  v_first_submitted timestamptz;
  v_visibility_check timestamptz;
  v_contributor boolean;
  v_proof_urls jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'P0001';
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

  -- 72h visibility check window
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
      updated_at = NOW()
  WHERE id = p_assignment_id
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_assignment_proof(uuid, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_assignment_proof(uuid, text, text, text, text, jsonb, text, text) TO authenticated, service_role;

-- 6. Admin review visibility RPC:
--    admin_review_assignment_visibility(p_assignment_id uuid, p_visibility text, p_reason text)
CREATE OR REPLACE FUNCTION public.admin_review_assignment_visibility(
  p_assignment_id uuid,
  p_visibility text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment public.task_assignments;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_visibility IS NULL OR p_visibility NOT IN ('visible', 'not_visible', 'unknown') THEN
    RAISE EXCEPTION 'Invalid visibility: %', p_visibility USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.task_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.task_assignments
  SET visibility_status = p_visibility,
      visibility_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_assignment_visibility(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_assignment_visibility(uuid, text, text) TO authenticated, service_role;

-- 7. Update admin_approve_assignment to enforce contributor workflow rules:
--    - if contributor_workflow = true, require visibility_status = 'visible'
--    - otherwise retain existing legacy approval behavior
CREATE OR REPLACE FUNCTION public.admin_approve_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Contributor workflow rule: visibility must be confirmed as 'visible' before approval
  IF COALESCE(v_assignment.contributor_workflow, false) = true THEN
    IF v_assignment.visibility_status IS DISTINCT FROM 'visible' THEN
      RAISE EXCEPTION 'contributor_workflow_requires_visible: Assignment contributor harus berstatus visible sebelum disetujui' USING ERRCODE = 'P0001';
    END IF;
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

REVOKE ALL ON FUNCTION public.admin_approve_assignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_assignment(uuid) TO authenticated, anon, service_role;

-- 8. Update admin_reject_assignment to enforce contributor workflow rules:
--    - if contributor_workflow = true and visibility_status = 'not_visible', rejection allowed only if NOW() >= visibility_check_after (after 72h).
--    - visibility_status = 'unknown' cannot auto-fail.
CREATE OR REPLACE FUNCTION public.admin_reject_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_can_retry boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    RAISE EXCEPTION 'Assignment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;

  IF v_assignment.balance_credited_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tidak bisa reject assignment yang sudah dicairkan kreditnya. Hubungi lead engineer.' USING ERRCODE = 'P0001';
  END IF;

  -- Contributor workflow rejection rules
  IF COALESCE(v_assignment.contributor_workflow, false) = true THEN
    IF v_assignment.visibility_status IS NULL OR v_assignment.visibility_status = 'unknown' THEN
      RAISE EXCEPTION 'contributor_workflow_unknown_visibility: Assignment dengan status visibility unknown tidak bisa ditolak otomatis. Harap lakukan verifikasi manual.' USING ERRCODE = 'P0001';
    ELSIF v_assignment.visibility_status = 'not_visible' THEN
      IF v_assignment.visibility_check_after IS NULL OR NOW() < v_assignment.visibility_check_after THEN
        RAISE EXCEPTION 'contributor_workflow_wait_72h: Penolakan tugas not_visible hanya diizinkan setelah 72 jam : masa tunggu belum selesai.' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  UPDATE public.task_assignments
  SET status = 'rejected',
      admin_notes = p_reason,
      can_retry = p_can_retry,
      updated_at = NOW()
  WHERE id = p_assignment_id
    AND status IN ('submitted', 'in_progress');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment tidak ditemukan atau status tidak bisa direject' USING ERRCODE = 'P0001';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_reject_assignment(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reject_assignment(uuid, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_ensure_order_task(public.reddit_upvote_orders) FROM PUBLIC, anon, authenticated;
COMMIT;

NOTIFY pgrst, 'reload schema';
