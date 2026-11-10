const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type UrlStatus =
  | 'ok'
  | 'unverified_protected'
  | 'gone_410'
  | 'not_found_404'
  | 'closed_topic'
  | 'search_page'
  | 'invalid_url'
  | 'error';

export type VerifyResult = {
  url: string;
  ok: boolean;
  broken: boolean;
  status: UrlStatus;
  http_status: number | null;
  reason: string | null;
};

const SEARCH_URL_PATTERNS = [
  /^https?:\/\/(?:[a-z0-9-]+\.)?google\.[a-z.]+\/search(?:[/?#]|$)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?bing\.com\/search(?:[/?#]|$)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?search\.yahoo\.com(?:[/?#]|$)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?duckduckgo\.com\/(?:\?|$)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?quora\.com\/search(?:[/?#]|$)/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?indiehackers\.com\/search(?:[/?#]|$)/i,
  /^https?:\/\/community\.hubspot\.com\/t5\/forums\/searchpage(?:[/?#]|$)/i,
  /\/(?:search|searchpage)(?:\?|$)/i,
];

const ANTI_BOT_HOSTS = [
  'yelp.',
  'clutch.co',
  'trustpilot.com',
  'linkedin.com',
  'quora.com',
  'google.com',
  'goo.gl',
];

const CLOSED_THREAD_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /this topic was automatically closed/i, label: 'Topic otomatis ditutup (Discourse)' },
  { re: /this topic has been closed/i, label: 'Topic sudah ditutup' },
  { re: /this topic is closed/i, label: 'Topic sudah ditutup' },
  { re: /comments are closed/i, label: 'Kolom komentar ditutup' },
  { re: /commenting has been closed/i, label: 'Kolom komentar ditutup' },
  { re: /this thread is closed/i, label: 'Thread sudah ditutup' },
  { re: /this thread has been locked/i, label: 'Thread dikunci' },
  { re: /locked for new replies/i, label: 'Thread dikunci untuk balasan baru' },
  { re: /no longer accepting (?:new )?(?:replies|comments|answers)/i, label: 'Sudah tidak menerima komentar baru' },
  { re: /not open for further replies/i, label: 'Sudah ditutup untuk balasan' },
  { re: /this question has been closed/i, label: 'Pertanyaan sudah ditutup' },
  { re: /this post is archived/i, label: 'Post sudah diarsipkan' },
  { re: /<i[^>]*fa-lock[^>]*><\/i>\s*closed/i, label: 'Thread berstatus Closed/Locked (wpForo)' },
  { re: /class=["'][^"']*wpforo-topic-closed[^"']*["']/i, label: 'Thread berstatus Closed (wpForo)' },
  { re: /"closed"\s*:\s*true/i, label: 'Thread berstatus closed: true' },
  { re: /"archived"\s*:\s*true/i, label: 'Thread berstatus archived: true' },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function isProtectedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ANTI_BOT_HOSTS.some((h) => host.includes(h));
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 9000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkDiscourseJson(url: string): Promise<VerifyResult | null> {
  // Discourse topic URLs look like .../t/<slug>/<id> or .../t/<slug>/<id>/<post_num>
  const match = url.match(/^(https?:\/\/[^/]+\/t\/[^/?#]+\/\d+)(?:\/\d+)?(?:[?#].*)?$/i);
  if (!match) return null;
  const jsonUrl = `${match[1]}.json`;
  try {
    const r = await fetchWithTimeout(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StraightTaskHealthChecker/1.0)',
        'Accept': 'application/json',
      },
    });
    if (r.status === 410) {
      return { url, ok: false, broken: true, status: 'gone_410', http_status: 410, reason: 'HTTP 410 Gone (thread dihapus)' };
    }
    if (r.status === 404) {
      return { url, ok: false, broken: true, status: 'not_found_404', http_status: 404, reason: 'HTTP 404 Not Found' };
    }
    if (!r.ok) return null;
    const data = (await r.json().catch(() => null)) as { closed?: boolean; archived?: boolean; deleted_at?: string | null } | null;
    if (!data) return null;
    if (data.deleted_at) {
      return { url, ok: false, broken: true, status: 'gone_410', http_status: 200, reason: 'Thread sudah dihapus' };
    }
    if (data.closed || data.archived) {
      return {
        url,
        ok: false,
        broken: true,
        status: 'closed_topic',
        http_status: 200,
        reason: data.archived ? 'Thread berstatus Archived (tidak bisa dikomentari)' : 'Thread berstatus Closed (kolom komentar ditutup)',
      };
    }
    return { url, ok: true, broken: false, status: 'ok', http_status: 200, reason: null };
  } catch {
    return null;
  }
}

export async function verifySingleUrl(rawUrl: string): Promise<VerifyResult> {
  const url = String(rawUrl || '').trim();
  if (!url || !/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(url)) {
    return { url, ok: false, broken: true, status: 'invalid_url', http_status: null, reason: 'Format URL tidak valid atau kosong' };
  }

  if (SEARCH_URL_PATTERNS.some((re) => re.test(url))) {
    return {
      url,
      ok: false,
      broken: true,
      status: 'search_page',
      http_status: null,
      reason: 'URL masih berupa halaman search, bukan link post/thread langsung',
    };
  }

  // Try Discourse .json endpoint first when applicable
  const discourseResult = await checkDiscourseJson(url);
  if (discourseResult) return discourseResult;

  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (r.status === 410) {
      return { url, ok: false, broken: true, status: 'gone_410', http_status: 410, reason: 'HTTP 410 Gone — halaman sudah dihapus/tidak tersedia' };
    }
    if (r.status === 404) {
      return { url, ok: false, broken: true, status: 'not_found_404', http_status: 404, reason: 'HTTP 404 Not Found — halaman tidak ditemukan' };
    }

    if (r.status === 403 || r.status === 401 || r.status === 429) {
      // Protected sites often block bot fetch while working in user's browser;
      // probe via r.jina.ai only to detect genuine 410/404 when not on known anti-bot review host.
      if (!isProtectedHost(url)) {
        try {
          const jr = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
            headers: { 'Accept': 'text/plain, text/markdown, */*' },
          }, 9000);
          const jText = await jr.text().catch(() => '');
          if (jr.status === 410 || /returned error 410:\s*gone/i.test(jText) || /<title>410 gone<\/title>/i.test(jText)) {
            return { url, ok: false, broken: true, status: 'gone_410', http_status: 410, reason: 'HTTP 410 Gone (terverifikasi via reader)' };
          }
          if (jr.status === 404 || /returned error 404/i.test(jText)) {
            return { url, ok: false, broken: true, status: 'not_found_404', http_status: 404, reason: 'HTTP 404 Not Found (terverifikasi via reader)' };
          }
          for (const pat of CLOSED_THREAD_PATTERNS) {
            if (pat.re.test(jText)) {
              return { url, ok: false, broken: true, status: 'closed_topic', http_status: r.status, reason: pat.label };
            }
          }
        } catch {
          // ignore reader error
        }
      }
      return { url, ok: true, broken: false, status: 'unverified_protected', http_status: r.status, reason: `HTTP ${r.status} (proteksi anti-bot, cek manual di browser)` };
    }

    const html = (await r.text().catch(() => '')).slice(0, 200_000);
    for (const pat of CLOSED_THREAD_PATTERNS) {
      if (pat.re.test(html)) {
        return { url, ok: false, broken: true, status: 'closed_topic', http_status: r.status, reason: pat.label };
      }
    }

    return { url, ok: true, broken: false, status: 'ok', http_status: r.status, reason: null };
  } catch (e) {
    return {
      url,
      ok: true,
      broken: false,
      status: 'error',
      http_status: null,
      reason: e instanceof Error ? e.message : 'Timeout / gagal menghubungi target URL',
    };
  }
}

export const onRequestOptions = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (context: { request: Request }) => {
  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      url?: string;
      urls?: string[];
    };

    if (Array.isArray(body.urls)) {
      const uniqueUrls = Array.from(new Set(body.urls.map((u) => String(u || '').trim()).filter(Boolean))).slice(0, 50);
      const results = await Promise.all(uniqueUrls.map((u) => verifySingleUrl(u)));
      return json({ results });
    }

    const single = await verifySingleUrl(body.url || '');
    return json(single);
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Verify failed' }, 500);
  }
};
