// Vercel Edge Middleware — hostname-aware HTML routing.
//
// The vercel.json `rewrites` with `has.host` matchers worked inconsistently:
// on first hit for a given path, Vercel CDN cached the response and ignored
// the host condition on subsequent requests with different hosts. Result:
// Facebook/WhatsApp/LinkedIn crawlers fetching www.straight.ltd received the
// PeTa-branded index.html, leaking PenghasilanTambahan.com to clients who
// must never see PeTa.
//
// This middleware runs at the edge for every request and rewrites the path
// based on Host header — bypassing the CDN's path-only cache key. The Edge
// runtime ALWAYS reads Host header, so the same `/` path on different hosts
// emits different responses cleanly.

import { next, rewrite } from '@vercel/edge';

export const config = {
  // Only intercept HTML page requests, NOT static assets, API routes,
  // sitemap, robots, .well-known, etc. The negative lookahead skips
  // anything with a file extension and infrastructure paths.
  matcher: ['/((?!_next|api|assets|favicon|straight|.*\\..*).*)'],
};

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || '').toLowerCase();

  // Match apex + www variants of straight.ltd (handles www.straight.ltd:443 too)
  const isStraightHost = /(^|\.)straight\.ltd(?::\d+)?$/i.test(host);

  if (isStraightHost) {
    // Rewrite any HTML page request to straight.html so the static prerender
    // ships the Straight Ltd <title>, meta, OG tags, favicons, and manifest.
    // The actual SPA hydrates after and routes to /reddit/* etc.
    const target = new URL('/straight.html', url);
    // Preserve query string so deep links keep working
    target.search = url.search;
    return rewrite(target);
  }

  // PeTa / other hosts: serve index.html (default Vite SPA behavior)
  return next();
}
