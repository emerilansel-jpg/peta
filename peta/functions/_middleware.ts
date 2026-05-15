// Cloudflare Pages Functions — host-aware HTML shell routing.
//
// Reads the Straight shell file content + returns it as a fresh Response,
// bypassing Cloudflare Pages' auto-extension-strip (which was causing
// /shell.html → /shell → middleware → /shell.html infinite redirect loops).

export const onRequest: PagesFunction = async (context) => {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const host = (request.headers.get('host') || '').toLowerCase();

  // Pass-through for static assets + any path with a file extension.
  const pass = /^\/(assets|favicon|manifest|icon-|apple-touch|logo|og\.|robots|sitemap|straight|_redirects|.*\.[a-z0-9]+$)/i;
  if (pass.test(url.pathname)) {
    return next();
  }

  // straight.ltd hosts: fetch the shell file and return its content directly
  const isStraight = /(^|\.)straight\.ltd(?::\d+)?$/i.test(host);
  if (isStraight) {
    const shellResp = await env.ASSETS.fetch(new URL('/_straight_shell.html', url));
    const body = await shellResp.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    });
  }

  return next();
};
