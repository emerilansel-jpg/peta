// Cloudflare Pages Functions — host-aware HTML shell routing.
// Equivalent to Vercel's middleware.ts.
export const onRequest: PagesFunction = async (context) => {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const host = (request.headers.get('host') || '').toLowerCase();

  // Pass-through for static assets + extensions
  const pass = /^\/(assets|favicon|manifest|icon-|apple-touch|logo|og\.|robots|sitemap|straight\/|_redirects|.*\.[a-z0-9]+$)/i;
  if (pass.test(url.pathname)) {
    return next();
  }

  // Host-based shell rewrite for crawlers + initial paint
  const isStraight = /(^|\.)straight\.ltd(?::\d+)?$/i.test(host);
  if (isStraight) {
    const shellUrl = new URL('/straight.html', url);
    shellUrl.search = url.search;
    return env.ASSETS.fetch(new Request(shellUrl, request));
  }

  return next();
};
