-- QA4 follow-up: Add Facebook profile photo authenticity instruction to forum_standard_brief().
-- Follows up on John Baek's feedback: hide location is not enough — profile photos must match target audience.

DROP FUNCTION IF EXISTS public.forum_standard_brief(text, text);

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
- Foto profil harus terlihat sesuai target audience (misal: Western untuk forum North America). Foto tidak matching = mencurigakan.
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

NOTIFY pgrst, 'reload schema';
