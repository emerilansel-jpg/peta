-- QA4: Add "Reply to existing comment" support across the order → task flow.
-- 1. fn_create_forum_comment_order: add p_is_reply + p_reply_to params, store in notes JSONB
-- 2. forum_comment_task_brief: add p_is_reply + p_reply_to, include in brief
-- 3. auto_import_reddit_order_to_task: read is_reply/reply_to from notes, pass to brief
-- 4. admin_import_reddit_order: same

-- =====================================================================
-- 1. fn_create_forum_comment_order — add 2 params
-- =====================================================================
DROP FUNCTION IF EXISTS public.fn_create_forum_comment_order(text,text,text,boolean,text,text,text,text,text,integer,jsonb);

CREATE OR REPLACE FUNCTION public.fn_create_forum_comment_order(
  p_target_url TEXT,
  p_platform TEXT,
  p_comment_text TEXT,
  p_use_suggested_comment BOOLEAN,
  p_brand_name TEXT,
  p_brand_domain TEXT,
  p_brand_mention_mode TEXT,
  p_source_keyword TEXT,
  p_notes TEXT,
  p_quantity INTEGER DEFAULT 1,
  p_comment_drafts JSONB DEFAULT '[]'::jsonb,
  p_is_reply BOOLEAN DEFAULT false,
  p_reply_to TEXT DEFAULT NULL
)
RETURNS public.reddit_upvote_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id UUID;
  v_cost INTEGER;
  v_base INTEGER;
  v_ai BOOLEAN;
  v_user_balance INTEGER;
  v_order public.reddit_upvote_orders;
  v_notes JSONB;
  v_platform TEXT;
  v_mode TEXT;
  v_qty INTEGER;
  v_draft JSONB;
  v_draft_text TEXT;
  i INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_target_url IS NULL OR length(trim(p_target_url)) < 8 THEN RAISE EXCEPTION 'target_url required'; END IF;
  IF p_comment_text IS NULL OR length(trim(p_comment_text)) < 20 THEN RAISE EXCEPTION 'comment_text too short'; END IF;
  IF p_brand_mention_mode IS NOT NULL AND p_brand_mention_mode NOT IN ('plain', 'link') THEN
    RAISE EXCEPTION 'invalid brand mention mode';
  END IF;

  v_qty := GREATEST(1, LEAST(COALESCE(p_quantity, 1), 500));

  -- Normalize p_comment_drafts
  IF p_comment_drafts IS NOT NULL AND jsonb_typeof(p_comment_drafts) = 'string' THEN
    BEGIN
      p_comment_drafts := COALESCE((p_comment_drafts #>> '{}')::jsonb, '[]'::jsonb);
    EXCEPTION WHEN others THEN
      p_comment_drafts := '[]'::jsonb;
    END;
  END IF;
  IF jsonb_typeof(COALESCE(p_comment_drafts, '[]'::jsonb)) <> 'array' THEN
    p_comment_drafts := CASE
      WHEN jsonb_typeof(p_comment_drafts) = 'object' THEN jsonb_build_array(p_comment_drafts)
      ELSE '[]'::jsonb
    END;
  END IF;

  SELECT credit_balance INTO v_user_balance FROM public.users WHERE id = v_user_id FOR UPDATE;
  IF v_user_balance IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  v_platform := CASE
    WHEN lower(coalesce(p_platform, '')) LIKE '%reddit%'
      OR lower(coalesce(p_target_url, '')) LIKE '%reddit.com%' THEN 'reddit'
    ELSE 'forum'
  END;
  v_mode := CASE WHEN p_brand_mention_mode = 'link' THEN 'link' ELSE 'plain' END;
  v_ai := coalesce(p_use_suggested_comment, false);

  v_base := public.fn_straight_unit_price(
    v_platform || '_comment_' || v_mode,
    CASE WHEN v_mode = 'link' THEN 550 ELSE 500 END
  );
  v_cost := v_qty * CASE WHEN v_ai THEN round(v_base * 1.10) ELSE v_base END;

  IF v_user_balance < v_cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  v_notes := jsonb_build_object(
    'service', 'forum_comment',
    'platform', nullif(trim(coalesce(p_platform, '')), ''),
    'comment_text', trim(p_comment_text),
    'use_suggested_comment', v_ai,
    'brand_name', nullif(trim(coalesce(p_brand_name, '')), ''),
    'brand_domain', nullif(trim(coalesce(p_brand_domain, '')), ''),
    'brand_mention_mode', p_brand_mention_mode,
    'price_key', v_platform || '_comment_' || v_mode,
    'ai_write_premium', v_ai,
    'source_keyword', nullif(trim(coalesce(p_source_keyword, '')), ''),
    'client_notes', nullif(trim(coalesce(p_notes, '')), ''),
    'quantity', v_qty,
    'draft_count', jsonb_array_length(coalesce(p_comment_drafts, '[]'::jsonb)),
    'is_reply', coalesce(p_is_reply, false),
    'reply_to_comment', nullif(trim(coalesce(p_reply_to, '')), '')
  );

  INSERT INTO public.reddit_upvote_orders (
    user_id, thread_url, subreddit, target_type,
    requested_upvotes, cost_credits, notes
  ) VALUES (
    v_user_id,
    trim(p_target_url),
    nullif(trim(coalesce(p_platform, '')), ''),
    'comment',
    v_qty,
    v_cost,
    v_notes::text
  )
  RETURNING * INTO v_order;

  -- Store unique drafts if provided
  IF p_comment_drafts IS NOT NULL AND jsonb_array_length(p_comment_drafts) > 0 THEN
    FOR i IN 0 .. jsonb_array_length(p_comment_drafts) - 1 LOOP
      v_draft := p_comment_drafts->i;
      v_draft_text := NULLIF(trim(v_draft->>'comment_text'), '');
      IF v_draft_text IS NOT NULL THEN
        INSERT INTO public.reddit_order_comment_drafts (order_id, draft_index, comment_text)
        VALUES (v_order.id, i, v_draft_text);
      END IF;
    END LOOP;
  END IF;

  -- Deduct credits
  UPDATE public.users SET credit_balance = credit_balance - v_cost WHERE id = v_user_id;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_create_forum_comment_order(text,text,text,boolean,text,text,text,text,text,integer,jsonb,boolean,text) TO authenticated;

-- =====================================================================
-- 2. forum_comment_task_brief — add p_is_reply + p_reply_to
-- =====================================================================
DROP FUNCTION IF EXISTS public.forum_comment_task_brief(text,text,text,text);

CREATE OR REPLACE FUNCTION public.forum_comment_task_brief(
  p_url text,
  p_comment text DEFAULT NULL,
  p_brand text DEFAULT '',
  p_mention_mode text DEFAULT 'none',
  p_is_reply boolean DEFAULT false,
  p_reply_to text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_platform text := public.platform_for_url(p_url);
  v_low text := lower(v_platform);
  v_brand text := coalesce(p_brand, '');
  v_comment_block text;
  v_join_steps text;
  v_reply_block text;
BEGIN
  -- Platform-specific join steps
  IF v_low LIKE '%reddit%' THEN
    v_join_steps := '1. Nyalakan Cloudflare WARP/VPN kalau Reddit tidak bisa dibuka.
2. Buka target URL Reddit.
3. Login ke akun Reddit yang kamu pakai untuk task.
4. Baca thread dan rules subreddit.
5. Tulis komentar natural sesuai brief.
6. Submit komentar, lalu copy URL komentar dan screenshot bukti.';
  ELSIF v_low LIKE '%quora%' THEN
    v_join_steps := '1. Buka target URL Quora.
2. Login atau buat akun Quora kalau belum punya.
3. Baca pertanyaan dan jawaban yang sudah ada.
4. Tulis jawaban/reply yang natural, relevan, dan cukup lengkap.
5. Publish, lalu copy URL jawaban/reply dan screenshot bukti.';
  ELSIF v_low LIKE '%facebook%' THEN
    v_join_steps := '1. Buka target Facebook Group/post.
2. Join group dulu jika belum member dan jawab pertanyaan join secara normal.
3. PENTING: Matikan/hapus lokasi profil SEBELUM posting. Lokasi Indonesia di forum luar negeri = mencurigakan.
4. Baca rules group dan konteks post.
5. Tulis komentar yang natural, relevan, dan tidak terlihat promosi.
6. Publish, lalu copy URL post/comment jika tersedia dan screenshot bukti.';
  ELSE
    v_join_steps := '1. Buka target URL forum/community.
2. Login atau daftar akun kalau forum meminta.
3. Verifikasi email kalau diminta.
4. Baca thread, pertanyaan, dan aturan komunitas.
5. Tulis reply yang natural dan relevan.
6. Publish, lalu copy URL komentar atau URL thread dan screenshot bukti.';
  END IF;

  -- Comment block
  v_comment_block := CASE
    WHEN p_comment IS NOT NULL THEN p_comment
    ELSE 'Tulis sendiri secara natural mengikuti konteks thread. Jangan copy-paste kalau terasa tidak nyambung.'
  END;

  -- Reply-to block (NEW)
  IF coalesce(p_is_reply, false) THEN
    v_reply_block := format(
      '↩️ INI ADALAH REPLY — komentar ini harus di-post sebagai REPLY ke komentar yang sudah ada, BUKAN top-level post.
%s',
      CASE WHEN p_reply_to IS NOT NULL AND length(trim(p_reply_to)) > 0
        THEN format('Target reply: %s', trim(p_reply_to))
        ELSE 'Cari komentar yang paling relevan di thread, lalu reply ke komentar tersebut.'
      END
    );
  ELSE
    v_reply_block := NULL;
  END IF;

  RETURN concat_ws(E'\n\n',
    'COMMENT/POST YANG HARUS DIISI:',
    v_comment_block,
    v_reply_block,  -- NULL jika bukan reply → otomatis di-skip oleh concat_ws
    'DETAIL ORDER:',
    format('- Platform: %s', v_platform),
    format('- Target URL: %s', coalesce(p_url, '-')),
    format('- Brand/client mention: %s%s', v_brand, CASE WHEN p_mention_mode = 'link' THEN ' (boleh pakai link kalau natural dan platform mengizinkan)' ELSE ' (plain mention, jangan pakai link kalau tidak perlu)' END),
    'LANGKAH KERJA UNTUK NEWBIE:',
    v_join_steps,
    public.forum_standard_brief(p_url, v_platform)
  );
END;
$$;

-- =====================================================================
-- 3. auto_import_reddit_order_to_task — read reply info from notes
-- =====================================================================
-- Drop the existing trigger first to safely replace the function
DROP TRIGGER IF EXISTS trg_auto_import_reddit_order ON public.reddit_upvote_orders;

CREATE OR REPLACE FUNCTION public.auto_import_reddit_order_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_notes jsonb := CASE WHEN jsonb_typeof(NEW.notes) = 'text' THEN NEW.notes::jsonb ELSE NEW.notes END;
  v_service text := coalesce(v_notes->>'service', 'upvote');
  v_platform text;
  v_brand text;
  v_mention_mode text;
  v_comment_text text;
  v_is_reply boolean;
  v_reply_to text;
  v_category text;
  v_task_type text;
  v_brief text;
  v_desc text;
  v_reward integer;
BEGIN
  -- Only import comment-type orders
  IF NEW.target_type <> 'comment' AND v_service <> 'forum_comment' THEN
    RETURN NEW;
  END IF;

  v_platform := coalesce(v_notes->>'platform', NEW.subreddit);
  v_brand := coalesce(v_notes->>'brand_name', '');
  v_mention_mode := coalesce(v_notes->>'brand_mention_mode', 'none');
  v_comment_text := v_notes->>'comment_text';
  v_is_reply := COALESCE((v_notes->>'is_reply')::boolean, false);
  v_reply_to := v_notes->>'reply_to_comment';

  -- Detect category
  IF lower(coalesce(NEW.thread_url, '')) LIKE '%reddit.com%' THEN
    v_category := 'reddit_comment';
    v_task_type := 'comment';
  ELSE
    v_category := 'forum_comment';
    v_task_type := 'comment';
  END IF;

  -- Build brief with reply support
  v_brief := public.forum_comment_task_brief(NEW.thread_url, v_comment_text, v_brand, v_mention_mode, v_is_reply, v_reply_to);
  v_desc := format('Komen di %s sesuai brief. Tulis natural pakai bahasamu sendiri, jangan spammy, cukup 1 link aja. Habis komen tayang, screenshot bukti.', coalesce(v_platform, 'forum'));
  v_reward := 5000;

  -- Insert the task
  INSERT INTO public.tasks (
    title, description, brief, target_url,
    task_type, task_category, reward_amount,
    status, max_assignments, current_assignments,
    created_by, source_order_id
  ) VALUES (
    format('Komen di %s%s', coalesce(v_platform, 'Forum'), CASE WHEN v_brand IS NOT NULL AND length(v_brand) > 0 THEN ' - ' || v_brand ELSE '' END),
    v_desc,
    v_brief,
    NEW.thread_url,
    v_task_type,
    v_category,
    v_reward,
    'draft',
    GREATEST(1, NEW.requested_upvotes),
    0,
    (SELECT id FROM public.users WHERE role = 'admin' ORDER BY created_at LIMIT 1),
    NEW.id
  );

  RETURN NEW;
END;
$$;

-- Re-create the trigger
CREATE TRIGGER trg_auto_import_reddit_order
  AFTER INSERT ON public.reddit_upvote_orders
  FOR EACH ROW
  WHEN (NEW.target_type = 'comment')
  EXECUTE FUNCTION public.auto_import_reddit_order_to_task();

NOTIFY pgrst, 'reload schema';
