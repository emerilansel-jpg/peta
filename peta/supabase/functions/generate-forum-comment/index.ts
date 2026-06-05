import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type MentionMode = 'plain' | 'link';
type DraftProvider = 'deepseek' | 'claude';

type GenerateForumCommentRequest = {
  target_url: string;
  platform?: string | null;
  brand_name?: string | null;
  brand_domain?: string | null;
  mention_mode: MentionMode;
  extra_instructions?: string | null;
};

type StraightAiSettings = {
  draft_provider: DraftProvider;
  claude_model: string;
  deepseek_model: string;
};

type PromptMessage = {
  role: 'system' | 'user';
  content: string;
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
  const fetchViaReader = async (reason: string) => {
    try {
      const readerUrl = `https://r.jina.ai/${url}`;
      const r = await fetch(readerUrl, {
        headers: {
          'User-Agent': 'StraightLtdCommentAssistant/1.0',
          'Accept': 'text/plain, text/markdown, */*',
        },
        redirect: 'follow',
      });
      if (!r.ok) return { text: BLOCKED_TEXT, fetched: false, reason: `${reason}_reader_http_${r.status}` };
      const text = cleanText(await r.text());
      if (text.length < 200) return { text: BLOCKED_TEXT, fetched: false, reason: `${reason}_reader_too_little_text` };
      return { text, fetched: true, reason: 'reader_fallback' };
    } catch (e) {
      return { text: BLOCKED_TEXT, fetched: false, reason: `${reason}_reader_${(e as Error).message}` };
    }
  };

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'StraightLtdCommentAssistant/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!r.ok) return await fetchViaReader(`http_${r.status}`);
    const text = cleanText(await r.text());
    if (text.length < 200) return await fetchViaReader('too_little_text');
    return { text, fetched: true };
  } catch (e) {
    return await fetchViaReader((e as Error).message);
  }
}

function buildPrompt(input: GenerateForumCommentRequest, threadText: string): PromptMessage[] {
  const brand = input.brand_name || input.brand_domain || '';
  const linkInstruction = input.mention_mode === 'link'
    ? 'Include the brand domain exactly once as a bare domain only (for example example.com) — do NOT add https://, http://, www, or markdown link syntax like [text](url). Just the plain domain, the way a real person types it.'
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
        'Do not claim personal experience, client results, ownership, or having used the brand unless the thread context explicitly says so.',
        'Do not write a testimonial. Frame the brand mention as an option, example, or practical resource when relevant.',
        'Prefer 2-4 sentences with a concrete caveat or decision criterion.',
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

async function getStraightAiSettings(req: Request): Promise<StraightAiSettings> {
  const fallback: StraightAiSettings = {
    draft_provider: 'deepseek',
    claude_model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514',
    deepseek_model: Deno.env.get('DEEPSEEK_MODEL') || 'deepseek-chat',
  };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  const apiKey = serviceRoleKey || anonKey;
  const authorization = serviceRoleKey ? `Bearer ${serviceRoleKey}` : authHeader;
  if (!supabaseUrl || !apiKey || !authorization) return fallback;

  const r = await fetch(`${supabaseUrl}/rest/v1/straight_ai_settings?id=eq.true&select=draft_provider,claude_model,deepseek_model`, {
    headers: {
      'apikey': apiKey,
      'Authorization': authorization,
    },
  }).catch(() => null);
  if (!r?.ok) return fallback;

  const rows = await r.json().catch(() => []) as Partial<StraightAiSettings>[];
  const row = rows[0];
  if (!row) return fallback;

  return {
    draft_provider: row.draft_provider === 'claude' ? 'claude' : 'deepseek',
    claude_model: row.claude_model || fallback.claude_model,
    deepseek_model: row.deepseek_model || fallback.deepseek_model,
  };
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
  next = next
    .replace(/\u00e2\u20ac\u201d/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/^(final comment|comment|draft|suggested comment)\s*:\s*/i, '')
    .trim();

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

  // Link mode: a bare domain woven naturally into the sentence — never https://,
  // www, markdown [text](url), or the unnatural "Brand (domain.com)" parenthetical
  // (real people don't write "plumbingforyou (plumbing.com)").
  next = next.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$2').trim();

  if (!domain) return next;

  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Full URL / www → bare domain.
  next = next.replace(new RegExp(`https?:\\/\\/(www\\.)?${escapedDomain}(\\/[^\\s)]*)?`, 'gi'), domain);
  next = next.replace(new RegExp(`\\bwww\\.${escapedDomain}\\b`, 'gi'), domain);
  // "Brand (domain.com)" → just the bare domain (kill the awkward parenthetical).
  next = next.replace(new RegExp(`\\b${escapedBrand}\\b\\s*\\(\\s*${escapedDomain}\\s*\\)`, 'gi'), domain);
  // Any leftover "(domain.com)" → bare domain.
  next = next.replace(new RegExp(`\\(\\s*${escapedDomain}\\s*\\)`, 'gi'), domain);
  next = next.replace(/\s{2,}/g, ' ').trim();

  // Domain already present → done.
  if (new RegExp(`\\b${escapedDomain}\\b`, 'i').test(next)) return next.trim();
  // Domain absent → add it as a short natural sentence (no parenthetical).
  return `${next} Their site is ${domain}.`.trim();
}

async function generateWithDeepSeek(messages: PromptMessage[], model: string) {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) return { error: 'DRAFT_PROVIDER_NOT_CONFIGURED' };

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
  if (!r.ok) return { error: 'draft_generation_failed', detail: data };

  return {
    comment: String(data?.choices?.[0]?.message?.content || '').trim(),
    provider: 'deepseek' as const,
    model,
  };
}

async function generateWithClaude(messages: PromptMessage[], model: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return { error: 'DRAFT_PROVIDER_NOT_CONFIGURED' };

  const system = messages.find((message) => message.role === 'system')?.content || '';
  const userMessages = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: 'user', content: message.content }));

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      system,
      messages: userMessages,
      temperature: 0.7,
      max_tokens: 280,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { error: 'draft_generation_failed', detail: data };

  const textBlocks = Array.isArray(data?.content)
    ? data.content.filter((part: { type?: string; text?: string }) => part.type === 'text').map((part: { text?: string }) => part.text || '')
    : [];

  return {
    comment: textBlocks.join('\n').trim(),
    provider: 'claude' as const,
    model,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const payload = await req.json() as GenerateForumCommentRequest;
    if ((payload as GenerateForumCommentRequest & { health?: string }).health === 'providers') {
      return json({
        deepseek: Deno.env.get('DEEPSEEK_API_KEY')
          ? { status: 'ok', detail: 'DEEPSEEK_API_KEY present' }
          : { status: 'missing', detail: 'DEEPSEEK_API_KEY missing' },
        claude: Deno.env.get('ANTHROPIC_API_KEY')
          ? { status: 'ok', detail: 'ANTHROPIC_API_KEY present' }
          : { status: 'missing', detail: 'ANTHROPIC_API_KEY missing' },
      });
    }
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
    const settings = await getStraightAiSettings(req);
    const model = settings.draft_provider === 'claude' ? settings.claude_model : settings.deepseek_model;
    const generation = settings.draft_provider === 'claude'
      ? await generateWithClaude(messages, model)
      : await generateWithDeepSeek(messages, model);

    if (generation.error === 'DRAFT_PROVIDER_NOT_CONFIGURED') {
      // Keep the provider name out of client-facing responses (privacy wall).
      console.error('draft_provider_not_configured', { provider: settings.draft_provider });
      return json({ error: 'DRAFT_PROVIDER_NOT_CONFIGURED' }, 500);
    }
    if (generation.error) {
      // Log provider + raw detail server-side only; never leak to the client.
      console.error('draft_generation_failed', { provider: settings.draft_provider, detail: generation.detail });
      return json({ error: 'draft_generation_failed' }, 502);
    }

    let comment = generation.comment || '';
    comment = sanitizeComment(comment, payload);
    if (!comment) return json({ error: 'empty_generation' }, 502);

    return json({
      comment,
      fetched_context: thread.fetched,
      fetch_reason: thread.reason || null,
    });
  } catch (e) {
    return json({ error: 'internal_error', detail: (e as Error).message }, 500);
  }
});
