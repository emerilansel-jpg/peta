-- Keep client-specific Avvo data out of public order-form examples.
BEGIN;
UPDATE public.straight_services
SET url_placeholder = 'https://www.avvo.com/attorneys/attorney-name-city-state.html',
    updated_at = now()
WHERE slug = 'avvo_review';
COMMIT;
NOTIFY pgrst, 'reload schema';
