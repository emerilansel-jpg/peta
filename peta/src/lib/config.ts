// Central place to update community/contact info
export const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/KxYmPXoo8qzJcKlhb4LX5E';

// Daily reset hour (24h, WIB) — when "task baru" appear
export const DAILY_RESET_HOUR = 9;

// Founding-cohort cap — used everywhere we surface scarcity messaging.
// Mirrored in src/lib/api.ts FOUNDING_LIMIT.
export const FOUNDING_LIMIT = 100;

// OG / share preview image. Served from /public.
// PNG used because WhatsApp/Telegram strip SVG previews. Re-render
// from public/og.svg via `npm run og` after edits.
export const OG_IMAGE_PATH = '/og.png';
