import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type MentionMode = 'plain' | 'link';

type GenerateForumCommentRequest = {
  target_url: string;
  platform?: string | null;
  brand_name?: string | null;
  brand_domain?: string | null;
  mention_mode: MentionMode;
  extra_instructions?: string | null;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BLOCKED_TEXT = 'THREAD_FETCH_BLOCKED';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function cleanText(input: string, max = 9000) {
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
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'StraightLtdCommentAssistant/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!r.ok) return { text: BLOCKED_TEXT, fetched: false, reason: `http_${r.status}` };
    const text = cleanText(await r.text());
    if (text.length < 200) return { text: BLOCKED_TEXT, fetched: false, reason: 'too_little_text' };
    return { text, fetched: true };
  } catch (e) {
    return { text: BLOCKED_TEXT, fetched: false, reason: (e as Error).message };
  }
}

function buildPrompt(input: GenerateForumCommentRequest, threadText: string) {
  const brand = input.brand_name || input.brand_domain || '';
  const linkInstruction = input.mention_mode === 'link'
    ? 'Use one hyperlink exactly once for the brand/domain mention.'
    : 'Use one plain-text brand mention exactly once. Do not include a URL.';

  return [
    {
      role: 'system',
      content: [
        'You write platform-native forum replies for Straight Ltd clients.',
        'Return only the final comment. No labels, headings, markdown, or explanation.',
        'Mention the brand exactly once.',
        'Never use em dash characters.',
        'Avoid sales pitch, superlatives, coupon language, hard CTA, or unsupported claims.',
        'Sound like a real participant adding a useful angle.',
        'Match the thread tone, length, capitalization, and vocabulary.',
        'If source context is weak, write a cautious helpful comment and keep it short.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Target URL: ${input.target_url}`,
        `Platform label: ${input.platform || 'forum'}`,
        `Brand reference: ${brand}`,
        `Mention mode: ${input.mention_mode}. ${linkInstruction}`,
        input.extra_instructions ? `Client instructions: ${input.extra_instructions}` : '',
        '',
        'Thread/context text:',
        threadText,
        '',
        'Write one helpful forum comment now. The brand mention should feel like a practical side note, not an ad.',
      ].filter(Boolean).join('\n'),
    },
  ];
}

function normalizeDomain(domain?: string | null) {
  if (!domain) return '';
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function displayBrand(input: GenerateForumCommentRequest) {
  return (input.brand_name || normalizeDomain(input.brand_domain) || 'the product').trim();
}

function sanitizeComment(comment: string, input: GenerateForumCommentRequest) {
  let next = comment.replace(/^["']|["']$/g, '').replace(/—/g, '-').trim();
  const domain = normalizeDomain(input.brand_domain);
  const brand = displayBrand(input);

  if (input.mention_mode === 'plain') {
    next = next.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$1');
    if (domain) {
      const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = next
        .replace(new RegExp(`https?:\\/\\/(www\\.)?${escapedDomain}(\\/\\S*)?`, 'gi'), brand)
        .replace(new RegExp(`\\b(www\\.)?${escapedDomain}\\b`, 'gi'), brand);
    }
    return next.trim();
  }

  if (!domain) return next;

  const href = `https://${domain}`;
  const markdownLink = new RegExp(`\\[([^\\]]+)\\]\\(https?:\\/\\/[^)]+\\)`, 'i');
  if (markdownLink.test(next)) {
    return next.replace(markdownLink, `[${brand}](${href})`).trim();
  }

  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const brandRegex = new RegExp(`\\b${escapedBrand}\\b`, 'i');
  if (brandRegex.test(next)) {
    return next.replace(brandRegex, `[${brand}](${href})`).trim();
  }

  return `${next} [${brand}](${href})`.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const payload = await req.json() as GenerateForumCommentRequest;
    const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
    const model = Deno.env.get('DEEPSEEK_MODEL') || 'deepseek-chat';

    if (!apiKey) return json({ error: 'DEEPSEEK_API_KEY not configured' }, 500);
    if (!payload.target_url || !/^https?:\/\//i.test(payload.target_url)) {
      return json({ error: 'valid target_url required' }, 400);
    }
    if (!payload.brand_name && !payload.brand_domain) {
      return json({ error: 'brand_name or brand_domain required' }, 400);
    }
    if (payload.mention_mode !== 'plain' && payload.mention_mode !== 'link') {
      return json({ error: 'mention_mode must be plain or link' }, 400);
    }

    const thread = await fetchThreadText(payload.target_url);
    const messages = buildPrompt(payload, thread.text);

    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 280,
        stream: false,
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: 'deepseek_failed', detail: data }, 502);

    let comment = String(data?.choices?.[0]?.message?.content || '').trim();
    comment = sanitizeComment(comment, payload);
    if (!comment) return json({ error: 'empty_generation' }, 502);

    return json({
      comment,
      provider: 'deepseek',
      model,
      fetched_context: thread.fetched,
      fetch_reason: thread.reason || null,
    });
  } catch (e) {
    return json({ error: 'internal_error', detail: (e as Error).message }, 500);
  }
});
