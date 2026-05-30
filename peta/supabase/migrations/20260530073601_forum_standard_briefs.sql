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
  IF v_platform IS NOT NULL AND (lower(v_platform) LIKE '%facebook%' OR lower(v_platform) LIKE '%fb group%') THEN RETURN 'Facebook Groups'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%indiehackers%' THEN RETURN 'Indie Hackers'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%stack overflow%' THEN RETURN 'Stack Overflow'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%stack exchange%' THEN RETURN 'Stack Exchange'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%producthunt%' THEN RETURN 'Product Hunt'; END IF;
  IF v_platform IS NOT NULL AND lower(v_platform) LIKE '%discord%' THEN RETURN 'Discord Community'; END IF;
  IF v_platform IS NOT NULL THEN RETURN v_platform; END IF;

  IF v_url LIKE '%community.hubspot.com%' OR v_url LIKE '%hubspot.com%' THEN RETURN 'HubSpot Community'; END IF;
  IF v_url LIKE '%reddit.com%' THEN RETURN 'Reddit'; END IF;
  IF v_url LIKE '%quora.com%' THEN RETURN 'Quora'; END IF;
  IF v_url LIKE '%facebook.com/groups/%' OR v_url LIKE '%fb.com/groups/%' THEN RETURN 'Facebook Groups'; END IF;
  IF v_url LIKE '%indiehackers.com%' THEN RETURN 'Indie Hackers'; END IF;
  IF v_url LIKE '%stackoverflow.com%' THEN RETURN 'Stack Overflow'; END IF;
  IF v_url LIKE '%stackexchange.com%' THEN RETURN 'Stack Exchange'; END IF;
  IF v_url LIKE '%producthunt.com%' THEN RETURN 'Product Hunt'; END IF;
  IF v_url LIKE '%discord.com%' OR v_url LIKE '%discord.gg%' THEN RETURN 'Discord Community'; END IF;
  RETURN 'Forum';
END;
$$;

CREATE OR REPLACE FUNCTION public.forum_standard_brief(p_url TEXT, p_platform TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_platform TEXT := public.forum_platform_label(p_url, p_platform);
  v_low TEXT := lower(v_platform);
  v_platform_specific TEXT;
BEGIN
  IF v_low LIKE '%reddit%' THEN
    v_platform_specific := 'Platform-specific Reddit:
- Wajib nyalakan Cloudflare WARP/VPN kalau Reddit terblokir dari jaringan kamu.
- Login dengan akun Reddit yang sudah siap dan tidak terlihat kosong.
- Baca rules subreddit, pinned post, dan tone komentar di thread.
- Join subreddit dulu kalau perlu sebelum comment.
- Jangan langsung drop link di akun baru. Plain mention lebih aman.
- Jangan komentar terlalu pendek seperti "nice", "thanks", atau template generik.
- Setelah publish, copy permalink komentar kalau bisa. Kalau susah, copy URL thread dan screenshot komentar.';
  ELSIF v_low LIKE '%quora%' THEN
    v_platform_specific := 'Platform-specific Quora:
- Jawaban harus berbentuk helpful answer, bukan komentar pendek.
- Mulai dengan konteks/pendapat, lalu beri alasan atau langkah praktis.
- Hindari link di awal jawaban. Kalau perlu mention brand, taruh natural di tengah/akhir.
- Pakai bahasa yang sesuai pertanyaan.
- Jangan copy-paste jawaban yang terasa promosi.
- Setelah publish, copy URL answer/reply dan screenshot nama profil + jawaban.';
  ELSIF v_low LIKE '%facebook%' THEN
    v_platform_specific := 'Platform-specific Facebook Groups:
- Join group dulu jika belum member, lalu jawab pertanyaan onboarding group dengan normal.
- Baca rules group, terutama aturan promo/link.
- Jangan posting link kecuali rules memperbolehkan.
- Komentar harus seperti member asli: singkat, relevan, dan tidak hard-selling.
- Jangan spam komentar yang sama di banyak post/group.
- Screenshot harus menunjukkan group/post, komentar, dan nama profil jika memungkinkan.';
  ELSIF v_low LIKE '%hubspot%' THEN
    v_platform_specific := 'Platform-specific HubSpot Community:
- Login / Join Community dengan email aktif.
- Lengkapi profil secukupnya supaya tidak terlihat kosong.
- Baca thread dan reply sebelumnya sebelum komentar.
- Jawab seperti praktisi: beri insight singkat, contoh, atau caveat.
- Mention brand hanya jika relevan dengan problem di thread.
- Jangan pakai link kalau thread tidak secara natural membutuhkan link.';
  ELSIF v_low LIKE '%indie hacker%' THEN
    v_platform_specific := 'Platform-specific Indie Hackers:
- Tone harus founder-to-founder, jujur, spesifik, dan tidak corporate.
- Hindari pitch panjang. Fokus ke pengalaman, lesson learned, atau practical tip.
- Mention produk/brand sebagai contoh, bukan CTA.
- Jangan buat klaim revenue/growth tanpa konteks.
- Screenshot harus menunjukkan comment dan username.';
  ELSIF v_low LIKE '%stack overflow%' OR v_low LIKE '%stack exchange%' THEN
    v_platform_specific := 'Platform-specific Stack Overflow / Stack Exchange:
- Hanya jawab kalau komentar benar-benar membantu secara teknis.
- Jangan promosi, jangan link-only answer, dan jangan jawaban opini kosong.
- Sertakan langkah, contoh, atau reasoning yang bisa diverifikasi.
- Link/brand mention hanya boleh kalau sangat relevan dan disclose secara natural.
- Kalau tidak bisa memberi jawaban teknis, jangan paksa comment karena risiko downvote/flag tinggi.';
  ELSIF v_low LIKE '%product hunt%' THEN
    v_platform_specific := 'Platform-specific Product Hunt:
- Komentar harus seperti feedback/support dari user, bukan iklan.
- Boleh sebut use case spesifik, pertanyaan, atau pengalaman singkat.
- Hindari template "Great product!" saja.
- Jangan spam banyak komentar dalam waktu dekat.
- Screenshot harus menunjukkan komentar dan profile.';
  ELSIF v_low LIKE '%discord%' THEN
    v_platform_specific := 'Platform-specific Discord Community:
- Join server dan baca channel rules terlebih dulu.
- Gunakan channel yang relevan, jangan post di general kalau ada channel khusus.
- Jangan DM member/admin untuk promosi.
- Komentar harus membantu diskusi, bukan drop link.
- Screenshot harus menunjukkan channel, pesan, dan username.';
  ELSE
    v_platform_specific := 'Platform-specific forum/community:
- Login atau daftar akun jika dibutuhkan.
- Baca rules, pinned thread, dan gaya bahasa member lain.
- Jangan drop link kalau belum jelas diperbolehkan.
- Komentar harus menjawab konteks thread, bukan promosi lepas.
- Kalau akun baru, lakukan perlahan dan lengkapi profil dasar.
- Screenshot harus menunjukkan komentar sudah tampil dan username jika memungkinkan.';
  END IF;

  RETURN concat_ws(E'\n\n',
    'STANDARD BRIEF UNIVERSAL:',
    '- Baca target page/thread sampai paham konteks sebelum komentar.
- Komentar harus natural, membantu, dan spesifik terhadap pertanyaan/thread.
- Jangan terdengar seperti iklan, sales pitch, atau copy-paste template.
- Jangan klaim berlebihan. Kalau menyebut brand, jadikan side note yang relevan.
- Sesuaikan bahasa, panjang, dan tone dengan komunitas.
- Jangan kirim komentar yang sama berkali-kali.
- Jangan menyerang kompetitor, jangan membuat klaim palsu, dan jangan pakai identitas palsu yang berisiko.
- Kalau platform terlihat sensitif terhadap link, gunakan plain mention saja.
- Submit bukti: URL komentar/thread, username platform yang dipakai, dan screenshot optional tapi disarankan.',
    v_platform_specific
  );
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
  v_comment_block TEXT;
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
4. Tulis jawaban/reply yang natural, relevan, dan cukup lengkap.
5. Publish, lalu copy URL jawaban/reply dan screenshot bukti.';
  ELSIF v_platform_low LIKE '%facebook%' THEN
    v_join_steps := '1. Buka target Facebook Group/post.
2. Join group dulu jika belum member dan jawab pertanyaan join secara normal.
3. Baca rules group dan konteks post.
4. Tulis komentar yang natural, relevan, dan tidak terlihat promosi.
5. Publish, lalu copy URL post/comment jika tersedia dan screenshot bukti.';
  ELSIF v_platform_low LIKE '%reddit%' THEN
    v_join_steps := '1. Nyalakan Cloudflare WARP/VPN kalau Reddit tidak bisa dibuka.
2. Buka target URL Reddit.
3. Login ke akun Reddit yang kamu pakai untuk task.
4. Baca thread dan rules subreddit.
5. Tulis komentar natural sesuai brief.
6. Submit komentar, lalu copy URL komentar dan screenshot bukti.';
  ELSE
    v_join_steps := '1. Buka target URL forum/community.
2. Login atau daftar akun kalau forum meminta.
3. Verifikasi email kalau diminta.
4. Baca thread, pertanyaan, dan aturan komunitas.
5. Tulis reply yang natural dan relevan.
6. Publish, lalu copy URL komentar atau URL thread dan screenshot bukti.';
  END IF;

  v_comment_block := CASE
    WHEN v_comment IS NOT NULL THEN v_comment
    ELSE 'Tulis sendiri secara natural mengikuti konteks thread. Jangan copy-paste kalau terasa tidak nyambung.'
  END;

  RETURN concat_ws(E'\n\n',
    'COMMENT/POST YANG HARUS DIISI:',
    v_comment_block,
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

WITH forum_orders AS (
  SELECT
    o.*,
    CASE WHEN o.notes IS NOT NULL AND o.notes ~ '^\s*\{' THEN o.notes::jsonb ELSE '{}'::jsonb END AS notes_json
  FROM public.reddit_upvote_orders o
)
UPDATE public.tasks t
SET
  brief = public.forum_comment_task_brief(
    o.thread_url,
    public.forum_platform_label(o.thread_url, COALESCE(o.notes_json->>'platform', o.subreddit)),
    o.notes_json->>'comment_text',
    COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', '')),
    COALESCE(NULLIF(o.notes_json->>'brand_mention_mode', ''), 'plain')
  ),
  description = concat_ws(
    ' - ',
    'Forum comment order',
    'Platform: ' || public.forum_platform_label(o.thread_url, COALESCE(o.notes_json->>'platform', o.subreddit)),
    CASE
      WHEN COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', '')) IS NOT NULL
      THEN 'Brand: ' || COALESCE(NULLIF(o.notes_json->>'brand_name', ''), NULLIF(o.notes_json->>'brand_domain', ''))
    END
  )
FROM forum_orders o
WHERE t.source_order_id = o.id
  AND t.task_category = 'forum_comment';
