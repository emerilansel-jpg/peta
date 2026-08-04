-- QA4 follow-up: Add Facebook location-OFF instruction to SQL brief functions
-- used by auto-import and admin-import of Straight Ltd orders.
-- Without this, imported task briefs don't warn members about hiding location.

-- 1. forum_standard_brief() — add location instruction to Facebook section
CREATE OR REPLACE FUNCTION public.forum_standard_brief(p_url text, p_platform text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_low text := lower(coalesce(p_platform, ''));
BEGIN
  IF v_low LIKE '%reddit%' THEN
    RETURN 'Platform-specific Reddit:
- Wajib nyalakan Cloudflare WARP/VPN kalau Reddit terblokir dari jaringan kamu.
- Login dengan akun Reddit yang dipakai untuk task.
- Baca rules subreddit dan tone thread sebelum comment.
- Jangan langsung drop link di akun baru. Plain mention lebih aman.
- Copy permalink komentar kalau bisa, lalu submit URL + username + screenshot optional.';
  ELSIF v_low LIKE '%quora%' THEN
    RETURN 'Platform-specific Quora:
- Jawaban harus helpful dan cukup lengkap, bukan komentar pendek.
- Mulai dengan konteks/pendapat, lalu beri alasan atau langkah praktis.
- Hindari link di awal jawaban. Kalau perlu mention brand, taruh natural di tengah/akhir.
- Pakai bahasa yang sesuai pertanyaan.
- Jangan copy-paste jawaban yang terasa promosi.
- Setelah publish, copy URL answer/reply dan screenshot nama profil + jawaban.';
  ELSIF v_low LIKE '%facebook%' THEN
    RETURN 'Platform-specific Facebook Groups:
- Join group dulu jika belum member, lalu jawab pertanyaan onboarding group dengan normal.
- Baca rules group, terutama aturan promo/link.
- PENTING: Matikan/hapus lokasi profil SEBELUM posting. Lokasi Indonesia di forum luar negeri = mencurigakan.
- Jangan posting link kecuali rules memperbolehkan.
- Komentar harus seperti member asli: singkat, relevan, dan tidak hard-selling.
- Jangan spam komentar yang sama di banyak post/group.
- Screenshot harus menunjukkan group/post, komentar, dan nama profil jika memungkinkan.';
  ELSIF v_low LIKE '%hubspot%' THEN
    RETURN 'Platform-specific HubSpot Community:
- Login / Join Community dengan email aktif.
- Lengkapi profil secukupnya supaya tidak terlihat kosong.
- Baca thread dan reply sebelumnya sebelum komentar.
- Jawab seperti praktisi: beri insight singkat, contoh, atau caveat.
- Mention brand hanya jika relevan dengan problem di thread.
- Jangan pakai link kalau thread tidak secara natural membutuhkan link.';
  ELSIF v_low LIKE '%indie hacker%' THEN
    RETURN 'Platform-specific Indie Hackers:
- Tone harus founder-to-founder, jujur, spesifik, dan tidak corporate.
- Hindari pitch panjang. Fokus ke pengalaman, lesson learned, atau practical tip.
- Mention produk/brand sebagai contoh, bukan CTA.
- Jangan buat klaim revenue/growth tanpa konteks.
- Screenshot harus menunjukkan comment dan username.';
  ELSIF v_low LIKE '%stack overflow%' OR v_low LIKE '%stack exchange%' THEN
    RETURN 'Platform-specific Stack Overflow / Stack Exchange:
- Hanya jawab kalau komentar benar-benar membantu secara teknis.
- Jangan promosi produk/brand secara langsung.
- Format jawaban dengan code block jika relevan.
- Screenshot harus menunjukkan jawaban dan nama profil.';
  ELSIF v_low LIKE '%product hunt%' THEN
    RETURN 'Platform-specific Product Hunt:
- Beri komentar genuine tentang produk yang diluncurkan.
- Jangan spam komentar yang sama di banyak launch.
- Screenshot harus menunjukkan komentar dan nama profil.';
  ELSIF v_low LIKE '%discord%' THEN
    RETURN 'Platform-specific Discord Community:
- Baca rules channel sebelum posting.
- Komentar harus relevan dengan topik channel.
- Jangan spam atau self-promote berlebihan.';
  ELSE
    RETURN 'Platform-specific forum:
- Login atau daftar akun jika dibutuhkan.
- Baca rules, pinned thread, dan gaya bahasa member lain.
- Jangan drop link kalau belum jelas diperbolehkan.
- Komentar harus menjawab konteks thread, bukan promosi lepas.
- Screenshot harus menunjukkan komentar sudah tampil dan username jika memungkinkan.';
  END IF;
END;
$$;

-- 2. forum_comment_task_brief() — add location instruction to Facebook join_steps
CREATE OR REPLACE FUNCTION public.forum_comment_task_brief(
  p_url text,
  p_comment text DEFAULT NULL,
  p_brand text DEFAULT '',
  p_mention_mode text DEFAULT 'none'
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
BEGIN
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

  v_comment_block := CASE
    WHEN p_comment IS NOT NULL THEN p_comment
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

NOTIFY pgrst, 'reload schema';
