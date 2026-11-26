-- Rename the public Avvo product to Avvo Review.
-- Keep avvo_comment disabled for historical orders/tasks and compatibility.

BEGIN;

UPDATE public.straight_services
SET enabled = false,
    updated_at = now()
WHERE slug = 'avvo_comment';

INSERT INTO public.straight_services (
  slug, name, badge_text, platform, category, task_type,
  unit_price_cents, worker_reward_idr, min_quantity, max_quantity,
  url_pattern, url_placeholder, form_config,
  worker_sop, worker_brief_template, icon, theme_color, enabled, sort_order
)
SELECT
  'avvo_review',
  'Avvo Reviews',
  'Helpful Reviews',
  platform,
  'review',
  task_type,
  unit_price_cents,
  worker_reward_idr,
  min_quantity,
  max_quantity,
  url_pattern,
  url_placeholder,
  form_config,
  worker_sop,
  worker_brief_template,
  icon,
  theme_color,
  true,
  sort_order
FROM public.straight_services
WHERE slug = 'avvo_comment'
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  badge_text = EXCLUDED.badge_text,
  platform = EXCLUDED.platform,
  category = EXCLUDED.category,
  task_type = EXCLUDED.task_type,
  unit_price_cents = EXCLUDED.unit_price_cents,
  worker_reward_idr = EXCLUDED.worker_reward_idr,
  min_quantity = EXCLUDED.min_quantity,
  max_quantity = EXCLUDED.max_quantity,
  url_pattern = EXCLUDED.url_pattern,
  url_placeholder = EXCLUDED.url_placeholder,
  form_config = EXCLUDED.form_config,
  worker_sop = EXCLUDED.worker_sop,
  worker_brief_template = EXCLUDED.worker_brief_template,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  enabled = true,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Keep existing Avvo tasks/order rows untouched. New product slug is avvo_review.

COMMIT;
NOTIFY pgrst, 'reload schema';
