-- Avvo Review product metadata. Historical avvo_comment rows remain untouched.
BEGIN;
UPDATE public.straight_services
SET name = 'Avvo Reviews',
    badge_text = 'Verified Reviews',
    category = 'review',
    url_pattern = '^https?://(?:www\.)?avvo\.com/(?:attorneys|lawyers|profile)/[^\s?#]+',
    url_placeholder = 'https://www.avvo.com/attorneys/90014-ca-mohamad-abdallah-5316895.html',
    form_config = form_config || '{"url_label":"Avvo Profile / Review URL","url_helper":"Masukkan URL profile Avvo. Worker akan membuka profile tersebut lalu menulis review.","allows_custom_drafts":true,"requires_custom_drafts":true,"min_draft_length":30}'::jsonb,
    worker_sop = 'Wajib aktifkan Windscribe VPN sebelum membuka Avvo. Gunakan akun Avvo dengan nama Bule / English. Buka profile Avvo dari URL target, baca konteks layanan, lalu tulis review jujur dan relevan. Jangan mengaku sebagai pengacara atau memberi kepastian hukum. Upload screenshot review publik dan URL-nya.',
    worker_brief_template = 'Tulis review Avvo yang jujur dan relevan berdasarkan pengalaman nyata reviewer. Jangan mengarang pengalaman atau memberi klaim hukum yang tidak didukung.',
    updated_at = now()
WHERE slug = 'avvo_review';
COMMIT;
NOTIFY pgrst, 'reload schema';
