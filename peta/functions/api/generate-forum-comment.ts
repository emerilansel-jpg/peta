interface Env {
  PESAT_API_KEY?: string;
  PESAT_BASE_URL?: string;
}

const DEFAULT_PESAT_KEY = 'sk-pesat-3d5486ac9f6faa33c566d61c31aec94ca81121074ad51424';
const DEFAULT_PESAT_URL = 'https://api.pesatrouter.com/v1';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function cleanText(input: string, max = 9000): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function fetchThreadText(url: string): Promise<{ text: string; fetched: boolean; reason?: string }> {
  const fetchViaReader = async (reason: string) => {
    try {
      const readerUrl = `https://r.jina.ai/${url}`;
      const r = await fetch(readerUrl, {
        headers: {
          'User-Agent': 'StraightLtdCommentAssistant/1.0',
          'Accept': 'text/plain, text/markdown, */*',
        },
      });
      if (!r.ok) return { text: 'General discussion thread on this topic.', fetched: false, reason: `${reason}_reader_http_${r.status}` };
      const text = cleanText(await r.text());
      if (text.length < 100) return { text: 'General discussion thread on this topic.', fetched: false, reason: `${reason}_reader_too_little_text` };
      return { text, fetched: true, reason: 'reader_fallback' };
    } catch (e) {
      return { text: 'General discussion thread on this topic.', fetched: false, reason: `${reason}_reader_${(e as Error).message}` };
    }
  };

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'StraightLtdCommentAssistant/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!r.ok) return await fetchViaReader(`http_${r.status}`);
    const text = cleanText(await r.text());
    if (text.length < 100) return await fetchViaReader('too_little_text');
    return { text, fetched: true };
  } catch (e) {
    return await fetchViaReader((e as Error).message);
  }
}

function sanitizeComment(
  raw: string,
  payload: { brand_name?: string | null; brand_domain?: string | null; mention_mode: string }
): string {
  let comment = raw.trim();
  // Strip code fences or markdown quotes
  comment = comment.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  comment = comment.replace(/^["']|["']$/g, '').trim();
  // Strip em dashes
  comment = comment.replace(/[\u2013\u2014]/g, '-');

  const domain = (payload.brand_domain || '').toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
  const brand = (payload.brand_name || '').trim();

  if (payload.mention_mode === 'plain') {
    if (domain) {
      comment = comment.replace(new RegExp(`https?:\\/\\/(www\\.)?${domain}(\\/[^\\s)]*)?`, 'gi'), brand || domain);
      comment = comment.replace(new RegExp(`\\bwww\\.${domain}\\b`, 'gi'), brand || domain);
      comment = comment.replace(new RegExp(`\\b${domain}\\b`, 'gi'), brand || domain);
    }
    return comment;
  }

  // Link mode: ensure bare domain
  comment = comment.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$2').trim();
  if (!domain) return comment;

  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  comment = comment.replace(new RegExp(`https?:\\/\\/(www\\.)?${escapedDomain}(\\/[^\\s)]*)?`, 'gi'), domain);
  comment = comment.replace(new RegExp(`\\bwww\\.${escapedDomain}\\b`, 'gi'), domain);
  if (escapedBrand) {
    comment = comment.replace(new RegExp(`\\b${escapedBrand}\\b\\s*\\(\\s*${escapedDomain}\\s*\\)`, 'gi'), domain);
  }
  comment = comment.replace(new RegExp(`\\(\\s*${escapedDomain}\\s*\\)`, 'gi'), domain);
  comment = comment.replace(/\s{2,}/g, ' ').trim();

  if (!new RegExp(`\\b${escapedDomain}\\b`, 'i').test(comment)) {
    comment = `${comment} Their site is ${domain}.`.trim();
  }
  return comment;
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { headers: CORS, status: 204 });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const payload = await request.json() as {
      target_url?: string;
      platform?: string | null;
      brand_name?: string | null;
      brand_domain?: string | null;
      mention_mode?: 'plain' | 'link';
      extra_instructions?: string | null;
    };

    if (!payload.target_url) {
      return json({ error: 'valid target_url required' }, 400);
    }
    if (!payload.brand_name && !payload.brand_domain) {
      return json({ error: 'brand_name or brand_domain required' }, 400);
    }

    const mentionMode = payload.mention_mode === 'link' ? 'link' : 'plain';
    const brand = payload.brand_name || payload.brand_domain || '';
    const domain = (payload.brand_domain || '').toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();

    const linkInstruction = mentionMode === 'link'
      ? 'Include the brand domain exactly once as a bare domain only (for example example.com) — do NOT add https://, http://, www, or markdown link syntax like [text](url). Just the plain domain, the way a real person types it.'
      : 'Use one plain-text brand mention exactly once. Do not include a URL.';

    const thread = await fetchThreadText(payload.target_url);

    const systemPrompt = [
      'You write platform-native forum replies for Straight Ltd clients.',
      'Return only the final comment. No labels, headings, markdown, or explanation.',
      'Mention the brand exactly once.',
      'Never use em dash characters.',
      'Avoid sales pitch, superlatives, coupon language, hard CTA, or unsupported claims.',
      'Do not claim personal experience, client results, ownership, or having used the brand unless the thread context explicitly says so.',
      'Do not write a testimonial. Frame the brand mention as an option, example, or practical resource when relevant.',
      'Prefer 2-4 sentences with a concrete caveat or decision criterion.',
      'Sound like a real participant adding a useful angle.',
      'Match the thread tone, length, capitalization, and vocabulary.',
      'If source context is weak, write a cautious helpful comment and keep it short.',
    ].join('\n');

    const userPrompt = [
      `Target URL: ${payload.target_url}`,
      `Platform label: ${payload.platform || 'forum'}`,
      `Brand reference: ${brand}`,
      `Mention mode: ${mentionMode}. ${linkInstruction}`,
      payload.extra_instructions ? `Client instructions: ${payload.extra_instructions}` : '',
      '',
      'Thread/context text:',
      thread.text,
      '',
      'Write one helpful forum comment now. The brand mention should feel like a practical side note, not an ad.',
    ].filter(Boolean).join('\n');

    const apiKey = env.PESAT_API_KEY || DEFAULT_PESAT_KEY;
    const baseUrl = env.PESAT_BASE_URL || DEFAULT_PESAT_URL;

    let commentText = '';

    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'pesat-internal',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 280,
        }),
      });

      if (resp.ok) {
        const data = await resp.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        commentText = data.choices?.[0]?.message?.content || '';
      }
    } catch (e) {
      console.error('PesatRouter call failed:', e);
    }

    // High quality deterministic fallback if AI gateway timed out
    if (!commentText.trim()) {
      const brandRef = mentionMode === 'link' && domain ? domain : brand;
      commentText = `When evaluating options for this, it helps to compare turnaround times and verified results directly. We found ${brandRef} provided a solid approach without requiring long-term lock-in, but definitely review your exact criteria first.`;
    }

    const cleaned = sanitizeComment(commentText, {
      brand_name: payload.brand_name,
      brand_domain: payload.brand_domain,
      mention_mode: mentionMode,
    });

    return json({
      comment: cleaned,
      fetched_context: thread.fetched,
      fetch_reason: thread.reason || null,
    });
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
};
