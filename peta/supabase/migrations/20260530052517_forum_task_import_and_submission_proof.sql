ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS submitted_url TEXT,
  ADD COLUMN IF NOT EXISTS submitted_username TEXT,
  ADD COLUMN IF NOT EXISTS proof_image_url TEXT;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_category_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_category_check
  CHECK (task_category IN ('reddit_upvote', 'reddit_comment', 'reddit_post_thread', 'forum_comment'));

CREATE OR REPLACE FUNCTION public.forum_platform_label(p_url TEXT, p_platform TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_url TEXT := lower(coalesce(p_url, ''));
  v_platform TEXT := nullif(trim(coalesce(p_platform, '')), '');
BEGIN
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%hubspot%' THEN RETURN 'HubSpot Community'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%reddit%' THEN RETURN 'Reddit'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%quora%' THEN RETURN 'Quora'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%indiehackers%' THEN RETURN 'Indie Hackers'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%stack overflow%' THEN RETURN 'Stack Overflow'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%stack exchange%' THEN RETURN 'Stack Exchange'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%producthunt%' THEN RETURN 'Product Hunt'; END IF;
  IF v_platform IS NOT NULL THEN RETURN v_platform; END IF;
  IF v_url LIKE '%community.hubspot.com%' OR v_url LIKE '%hubspot.com%' THEN RETURN 'HubSpot Community'; END IF;
  IF v_url LIKE '%reddit.com%' THEN RETURN 'Reddit'; END IF;
  IF v_url LIKE '%quora.com%' THEN RETURN 'Quora'; END IF;
  IF v_url LIKE '%indiehackers.com%' THEN RETURN 'Indie Hackers'; END IF;
  IF v_url LIKE '%stackoverflow.com%' THEN RETURN 'Stack Overflow'; END IF;
  IF v_url LIKE '%stackexchange.com%' THEN RETURN 'Stack Exchange'; END IF;
  IF v_url LIKE '%producthunt.com%' THEN RETURN 'Product Hunt'; END IF;
  RETURN 'Forum';
END;
$$;

CREATE OR REPLACE FUNCTION public.forum_comment_task_brief(
  p_url TEXT,
  p_platform TEXT,
  p_comment_text TEXT,
  p_brand TEXT,
  p_mention_mode TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_platform TEXT := public.forum_platform_label(p_url, p_platform);
  v_platform_low TEXT := lower(v_platform);
  v_brand TEXT := nullif(trim(coalesce(p_brand, '')), 'brand/client');
  v_comment TEXT := nullif(trim(coalesce(p_comment_text, '')), '');
  v_join_steps TEXT;
BEGIN
  IF v_platform_low LIKE '%hubspot%' THEN
    v_join_steps := '1. Buka target URL HubSpot Community.
2. Klik Sign in / Join Community. Kalau belum punya akun HubSpot, daftar dulu pakai email aktif.
3. Verifikasi email kalau diminta, lalu lengkapi profile secara normal.
4. Balik ke target thread, baca pertanyaan dan beberapa reply sebelumnya.
5. Klik Reply, tulis komentar yang relevan, lalu submit/publish.
6. Setelah publish, copy URL komentar atau URL thread dan screenshot komentar yang sudah tampil.';
  ELSIF v_platform_low LIKE '%quora%' THEN
    v_join_steps := '1. Buka target URL Quora.
2. Login atau buat akun Quora kalau belum punya.
3. Baca pertanyaan dan jawaban yang sudah ada.
4. Tulis jawaban/reply yang natural dan relevan.
5. Publish, lalu copy URL jawaban/reply dan screenshot bukti.';
  ELSIF v_platform_low LIKE '%reddit%' THEN
    v_join_steps := '1. Buka target URL Reddit.
2. Login ke akun Reddit yang kamu pakai untuk task.
3. Baca thread dan rules subreddit.
4. Tulis komentar natural sesuai brief.
5. Submit komentar, lalu copy URL komentar dan screenshot bukti.';
  ELSE
    v_join_steps := '1. Buka target URL forum/community.
2. Login atau daftar akun kalau forum meminta.
3. Verifikasi email kalau diminta.
4. Baca thread, pertanyaan, dan aturan komunitas.
5. Tulis reply yang natural dan relevan.
6. Publish, lalu copy URL komentar atau URL thread dan screenshot bukti.';
  END IF;

  RETURN concat_ws(E'\n\n',
    format('Platform: %s', v_platform),
    format('Target URL: %s', coalesce(p_url, '-')),
    format('Brand/client mention: %s%s', v_brand, CASE WHEN p_mention_mode = 'link' THEN ' (boleh pakai link kalau natural dan platform mengizinkan)' ELSE ' (plain mention, jangan pakai link kalau tidak perlu)' END),
    'Cara mengerjakan untuk newbie:',
    v_join_steps,
    CASE WHEN v_comment IS NOT NULL THEN 'Komentar final dari client yang harus dipakai/adaptasi:
' || v_comment ELSE 'Komentar: tulis sendiri secara natural mengikuti konteks thread. Jangan copy-paste kalau terasa tidak nyambung.' END,
    'Yang harus diperhatikan supaya akun tidak kena ban:',
    '- Jangan spam dan jangan kirim komentar yang sama berkali-kali.
- Jangan terdengar seperti iklan, sales pitch, atau hard-selling.
- Baca rules komunitas sebelum komentar.
- Kalau akun baru, lengkapi profil dulu dan jangan langsung banyak link.
- Sesuaikan bahasa, panjang, dan tone dengan thread.
- Jangan klaim berlebihan. Kalau menyebut brand, jadikan side note yang membantu.
- Jangan pakai link kalau platform/thread terlihat sensitif terhadap promosi.
- Screenshot harus menunjukkan komentar sudah ter-publish dan username terlihat kalau memungkinkan.',
    'Bukti submit yang diminta:',
    '- URL komentar atau URL thread setelah komentar tampil.
- Username yang kamu pakai di platform tersebut.
- Screenshot optional untuk comment task, tapi sangat disarankan supaya approval lebih cepat.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_import_reddit_order(
  p_order_id bigint,
  p_reward_amount integer DEFAULT NULL::integer,
  p_min_level integer DEFAULT 0,
  p_title_override text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order reddit_upvote_orders%ROWTYPE;
  v_notes jsonb := '{}'::jsonb;
  v_is_forum_comment boolean := false;
  v_task_type text;
  v_task_category text;
  v_reward int;
  v_title text;
  v_description text;
  v_brief text;
  v_task_id uuid;
  v_platform text;
  v_brand text;
  v_comment_text text;
  v_mention_mode text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO v_order FROM reddit_upvote_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order not found'; END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE source_order_id = p_order_id) THEN
    RAISE EXCEPTION 'order already imported as task';
  END IF;

  BEGIN
    v_notes := COALESCE(v_order.notes, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    v_notes := '{}'::jsonb;
  END;

  v_is_forum_comment := COALESCE(v_order.target_type, 'upvote') = 'comment'
    OR v_notes->>'service' = 'forum_comment';
  v_task_type := CASE WHEN v_order.target_type = 'upvote' THEN 'upvote' ELSE 'comment' END;
  v_task_category := CASE
    WHEN v_order.target_type = 'upvote' THEN 'reddit_upvote'
    WHEN v_is_forum_comment THEN 'forum_comment'
    ELSE 'reddit_comment'
  END;

  v_platform := public.forum_platform_label(v_order.thread_url, COALESCE(v_notes->>'platform', v_order.subreddit));
  v_brand := COALESCE(NULLIF(v_notes->>'brand_name', ''), NULLIF(v_notes->>'brand_domain', ''));
  v_comment_text := NULLIF(v_notes->>'comment_text', '');
  v_mention_mode := COALESCE(NULLIF(v_notes->>'brand_mention_mode', ''), 'plain');

  v_reward := COALESCE(p_reward_amount, CASE WHEN v_task_type = 'upvote' THEN 500 ELSE 5000 END);
  v_title := COALESCE(
    NULLIF(trim(p_title_override), ''),
    CASE
      WHEN v_is_forum_comment THEN format('%s comment task%s', v_platform, CASE WHEN v_brand IS NOT NULL THEN format(' - %s', v_brand) ELSE '' END)
      WHEN v_order.subreddit IS NOT NULL THEN format('r/%s - %s', v_order.subreddit, v_task_type)
      ELSE format('Reddit %s task', v_task_type)
    END
  );

  IF v_is_forum_comment THEN
    v_description := concat_ws(' - ', 'Forum comment order', format('Platform: %s', v_platform), CASE WHEN v_brand IS NOT NULL THEN format('Brand: %s', v_brand) END);
    v_brief := public.forum_comment_task_brief(v_order.thread_url, v_platform, v_comment_text, v_brand, v_mention_mode);
  ELSE
    v_description := COALESCE(v_order.notes, 'Sourced from Straight Ltd order #' || p_order_id);
    v_brief := NULL;
  END IF;

  INSERT INTO tasks (
    title, description, brief, target_url, task_type, task_category, min_level,
    max_assignments, per_account_limit, reward_amount, status, created_by, source_order_id
  ) VALUES (
    v_title, v_description, v_brief, v_order.thread_url, v_task_type, v_task_category,
    GREATEST(0, COALESCE(p_min_level, 0)),
    GREATEST(1, v_order.requested_upvotes),
    1,
    v_reward,
    'paused',
    v_uid,
    v_order.id
  )
  RETURNING id INTO v_task_id;

  UPDATE reddit_upvote_orders SET status = 'processing', updated_at = now()
  WHERE id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object('task_id', v_task_id, 'order_id', p_order_id, 'task_type', v_task_type, 'task_category', v_task_category);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_import_reddit_order(bigint, integer, integer, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_pending_approvals();

CREATE OR REPLACE FUNCTION public.admin_pending_approvals()
RETURNS TABLE (
  id              uuid,
  status          text,
  proof_url       text,
  draft_comment   text,
  admin_notes     text,
  created_at      timestamptz,
  updated_at      timestamptz,
  submitted_at    timestamptz,
  task_id         uuid,
  task_title      text,
  task_target_url text,
  task_category   text,
  task_type       text,
  task_reward     int,
  submitted_url   text,
  submitted_username text,
  proof_image_url text,
  reddit_account_id uuid,
  reddit_username text,
  army_user_id    uuid,
  army_email      text,
  army_name       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    ta.id,
    ta.status::text,
    ta.proof_url::text,
    ta.draft_comment::text,
    ta.admin_notes::text,
    ta.created_at,
    ta.updated_at,
    COALESCE(ta.updated_at, ta.created_at) AS submitted_at,
    t.id AS task_id,
    t.title::text AS task_title,
    t.target_url::text AS task_target_url,
    t.task_category::text,
    t.task_type::text,
    t.reward_amount AS task_reward,
    ta.submitted_url::text,
    ta.submitted_username::text,
    ta.proof_image_url::text,
    ra.id AS reddit_account_id,
    ra.username::text AS reddit_username,
    u.id AS army_user_id,
    au.email::text AS army_email,
    u.full_name::text AS army_name
  FROM public.task_assignments ta
  LEFT JOIN public.tasks t ON t.id = ta.task_id
  LEFT JOIN public.reddit_accounts ra ON ra.id = ta.reddit_account_id
  LEFT JOIN public.users u ON u.id = ra.user_id
  LEFT JOIN auth.users au ON au.id = ra.user_id
  WHERE ta.status = 'submitted'
  ORDER BY ta.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_pending_approvals() TO authenticated;

WITH forum_orders AS (
  SELECT
    o.*,
    o.notes::jsonb AS notes_json
  FROM public.reddit_upvote_orders o
  WHERE o.notes IS NOT NULL
    AND o.notes ~ '^\s*\{'
)
UPDATE public.tasks t
SET
  title = public.forum_platform_label(o.thread_url, COALESCE(o.notes_json->>'platform', o.subreddit)) || ' comment task' ||
    CASE
      WHEN COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', '')) IS NOT NULL
      THEN ' - ' || COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', ''))
      ELSE ''
    END,
  description = concat_ws(
    ' - ',
    'Forum comment order',
    'Platform: ' || public.forum_platform_label(o.thread_url, COALESCE(o.notes_json->>'platform', o.subreddit)),
    CASE
      WHEN COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', '')) IS NOT NULL
      THEN 'Brand: ' || COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', ''))
    END
  ),
  brief = public.forum_comment_task_brief(
    o.thread_url,
    public.forum_platform_label(o.thread_url, COALESCE(o.notes_json->>'platform', o.subreddit)),
    o.notes_json->>'comment_text',
    COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', '')),
    COALESCE(NULLIF(o.notes_json->>'brand_mention_mode', ''), 'plain')
  ),
  task_category = 'forum_comment',
  task_type = 'comment'
FROM forum_orders o
WHERE t.source_order_id = o.id
  AND (o.target_type = 'comment' OR o.notes_json->>'service' = 'forum_comment');
