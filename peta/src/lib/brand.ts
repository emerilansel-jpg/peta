/**
 * Hostname-aware brand swap.
 *
 * The same Vite build serves two products:
 *   - penghasilantambahan.com (and localhost dev) → PeTa
 *   - straight.ltd (and www.straight.ltd) → Straight Ltd
 *
 * The HTML shell ships with PeTa branding by default. On boot we detect the
 * hostname and, for Straight Ltd hosts, swap:
 *   - <title>, <meta description>, OG tags
 *   - favicons (16, 32, apple-touch)
 *   - PWA manifest
 *   - theme-color
 *
 * Runs synchronously on module load (before React renders) so first paint
 * already shows the correct title in the tab.
 */

const STRAIGHT_HOST_RE = /(^|\.)straight\.ltd$/i;

interface BrandConfig {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  themeColor: string;
  manifestHref: string;
  favicon16: string;
  favicon32: string;
  appleTouch: string;
  canonical: string;
  ogUrl: string;
  htmlLang: string;
  ogLocale: string;
}

const STRAIGHT_BRAND: BrandConfig = {
  title: 'Straight Ltd — The Reddit Growth Engine for Serious Operators',
  description: 'High-retention Reddit upvotes from aged accounts. Built for digital agencies and growth teams who need results that hold. Pay-as-you-go credits, PayPal secured.',
  ogTitle: 'Straight Ltd — The Reddit growth engine',
  ogDescription: 'Reddit upvotes from real, aged accounts. 98%+ retention. No subscription. PayPal checkout.',
  ogImage: 'https://straight.ltd/straight/og.png',
  themeColor: '#F97316',
  manifestHref: '/manifest-straight.json',
  favicon16: '/straight/favicon-16.png',
  favicon32: '/straight/favicon-32.png',
  appleTouch: '/straight/apple-touch-icon.png',
  canonical: 'https://www.straight.ltd/',
  ogUrl: 'https://www.straight.ltd/',
  htmlLang: 'en',
  ogLocale: 'en_US',
};

function setMeta(selector: string, value: string) {
  const el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (el) el.content = value;
}

function setLink(rel: string, sizesOrType: string | null, href: string) {
  const all = Array.from(document.head.querySelectorAll(`link[rel="${rel}"]`)) as HTMLLinkElement[];
  const match = sizesOrType
    ? all.find((l) => l.sizes?.value === sizesOrType || l.type === sizesOrType) || all[0]
    : all[0];
  if (match) match.href = href;
}

function applyBrand(brand: BrandConfig) {
  document.title = brand.title;
  document.documentElement.lang = brand.htmlLang;
  setMeta('meta[name="description"]', brand.description);
  setMeta('meta[property="og:title"]', brand.ogTitle);
  setMeta('meta[property="og:description"]', brand.ogDescription);
  setMeta('meta[property="og:image"]', brand.ogImage);
  setMeta('meta[property="og:image:secure_url"]', brand.ogImage);
  setMeta('meta[property="og:url"]', brand.ogUrl);
  setMeta('meta[property="og:locale"]', brand.ogLocale);
  setMeta('meta[property="og:site_name"]', 'Straight Ltd');
  setMeta('meta[name="twitter:title"]', brand.ogTitle);
  setMeta('meta[name="twitter:description"]', brand.ogDescription);
  setMeta('meta[name="twitter:image"]', brand.ogImage);
  setMeta('meta[name="theme-color"]', brand.themeColor);

  // Canonical
  const canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (canonical) canonical.href = brand.canonical;

  // Favicons
  setLink('icon', '32x32', brand.favicon32);
  setLink('icon', '16x16', brand.favicon16);
  setLink('apple-touch-icon', '180x180', brand.appleTouch);

  // Manifest
  const manifest = document.head.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
  if (manifest) manifest.href = brand.manifestHref;

  // Remove the PeTa-only structured data — it's irrelevant for Straight Ltd
  const ld = document.head.querySelector('script[type="application/ld+json"]');
  if (ld) ld.remove();
}

if (typeof window !== 'undefined' && STRAIGHT_HOST_RE.test(window.location.hostname)) {
  applyBrand(STRAIGHT_BRAND);
}
