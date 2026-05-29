import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type KeywordIdea = {
  keyword: string;
  volume: number;
  competition: 'Low' | 'Medium';
  intent: string;
};

type SerpResult = {
  title: string;
  url: string;
  platform: string;
  reason: string;
  eligible: boolean;
};

type GoogleSearchItem = {
  title?: string;
  link?: string;
};

type GoogleSearchResponse = {
  items?: GoogleSearchItem[];
  searchInformation?: {
    totalResults?: string;
  };
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FORUM_HOSTS = [
  'reddit.com',
  'quora.com',
  'community.hubspot.com',
  'indiehackers.com',
  'blackhatworld.com',
  'warriorforum.com',
  'stackexchange.com',
  'stackoverflow.com',
  'producthunt.com',
  'discourse.',
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function buildKeywordIdeas(seed: string): KeywordIdea[] {
  const base = seed.trim().toLowerCase() || 'growth tool';
  const score = Array.from(base).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const volumeBase = 900 + (score % 9) * 260;
  return [
    {
      keyword: `best ${base} for small business`,
      volume: volumeBase + 1800,
      competition: 'Low',
      intent: 'Comparison intent with room for helpful recommendations.',
    },
    {
      keyword: `${base} alternatives`,
      volume: volumeBase + 1200,
      competition: 'Low',
      intent: 'People are actively switching or comparing options.',
    },
    {
      keyword: `${base} recommendations`,
      volume: volumeBase + 850,
      competition: 'Medium',
      intent: 'Natural fit for forum answers and product mentions.',
    },
    {
      keyword: `is ${base} worth it`,
      volume: volumeBase + 450,
      competition: 'Low',
      intent: 'Question-led query where nuance performs better than hard selling.',
    },
  ];
}

function candidateKeywords(seed: string) {
  const base = seed.trim().toLowerCase() || 'growth tool';
  return [
    `best ${base} for small business`,
    `${base} alternatives`,
    `${base} recommendations`,
    `is ${base} worth it`,
    `${base} for startups`,
    `${base} comparison`,
  ];
}

function platformForUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('reddit.com')) return 'Reddit';
    if (host.includes('quora.com')) return 'Quora';
    if (host.includes('community.hubspot.com')) return 'HubSpot';
    if (host.includes('indiehackers.com')) return 'Indie Hackers';
    if (host.includes('stack')) return 'Stack Exchange';
    if (host.includes('producthunt.com')) return 'Product Hunt';
    if (host.includes('forum')) return 'Forum';
    return host.split('.')[0] || 'Result';
  } catch {
    return 'Result';
  }
}

function isForumUrl(url: string) {
  const low = url.toLowerCase();
  return FORUM_HOSTS.some((host) => low.includes(host))
    || /\/(forum|community|questions|discussion|threads?|t)\//i.test(low);
}

function fallbackTop10(keyword: string): SerpResult[] {
  const slug = encodeURIComponent(keyword.replace(/\s+/g, '-'));
  const q = encodeURIComponent(keyword);
  return [
    ['Reddit discussion', `https://www.reddit.com/search/?q=${q}`, 'High discussion density and visible comment threads.', true],
    ['Comparison article', `https://www.google.com/search?q=${q}+review`, 'Likely editorial content, not a place to add a native comment.', false],
    ['Quora answers', `https://www.quora.com/search?q=${q}`, 'Question-led pages usually accept helpful comparison-style answers.', true],
    ['Vendor landing page', `https://www.google.com/search?q=${q}+official+site`, 'Owned landing page, skipped because it is not a discussion thread.', false],
    ['HubSpot Community thread', `https://community.hubspot.com/t5/forums/searchpage/tab/message?advanced=false&allow_punctuation=false&q=${q}`, 'B2B-heavy audience with practical implementation questions.', true],
    ['Listicle result', `https://www.google.com/search?q=${q}+tools+list`, 'Informational article, useful for research but not a comment target.', false],
    ['Indie Hackers discussion', `https://www.indiehackers.com/search?q=${q}`, 'Operator-heavy audience, useful for SaaS and growth topics.', true],
    ['Support documentation', `https://www.google.com/search?q=${q}+docs`, 'Documentation page, skipped because there is no public discussion context.', false],
    ['Niche forum search page', `https://www.google.com/search?q=${q}+forum+discussion+${slug}`, 'Use this when you want a broader Google pass for smaller forums.', true],
    ['Video result', `https://www.google.com/search?q=${q}+youtube`, 'Can be useful research, but skipped for this forum-comment workflow.', false],
  ].map(([title, url, reason, eligible]) => ({
    title: `${title}: ${keyword}`,
    url: String(url),
    platform: eligible ? platformForUrl(String(url)) : String(title).replace(/ result| page| article/i, ''),
    reason: String(reason),
    eligible: Boolean(eligible),
  }));
}

async function googleSearch(keyword: string): Promise<GoogleSearchResponse | null> {
  const key = Deno.env.get('GOOGLE_SEARCH_API_KEY');
  const cx = Deno.env.get('GOOGLE_SEARCH_CX');
  if (!key || !cx) return null;

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', keyword);
  url.searchParams.set('num', '10');

  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`google_search_${r.status}`);
  return data as GoogleSearchResponse;
}

function mapGoogleResults(data: GoogleSearchResponse): SerpResult[] {
  return (data.items || []).slice(0, 10).map((item) => {
    const resultUrl = String(item.link || '');
    const eligible = isForumUrl(resultUrl);
    return {
      title: String(item.title || resultUrl),
      url: resultUrl,
      platform: platformForUrl(resultUrl),
      reason: eligible
        ? 'Forum or discussion-style result from Google top 10.'
        : 'Skipped because this Google result does not look like a public discussion page.',
      eligible,
    };
  });
}

async function googleTop10(keyword: string): Promise<SerpResult[] | null> {
  const data = await googleSearch(keyword).catch((error) => {
    console.error('google_top10_failed', (error as Error).message);
    return null;
  });
  if (!data) return null;
  return mapGoogleResults(data);
}

async function googleKeywordIdeas(seed: string): Promise<KeywordIdea[] | null> {
  const keywords = candidateKeywords(seed);
  const analyzed: Array<KeywordIdea & { score: number }> = [];

  for (const keyword of keywords) {
    const data = await googleSearch(keyword).catch((error) => {
      console.error('google_keyword_failed', (error as Error).message);
      return null;
    });
    if (!data) return null;

    const results = mapGoogleResults(data);
    const totalResults = Number(data.searchInformation?.totalResults || 0);
    const forumCount = results.filter((result) => result.eligible).length;
    const lowCompetition = forumCount >= 2 && totalResults < 8_000_000;
    const mediumCompetition = forumCount >= 1 || totalResults < 20_000_000;
    const estimatedVolume = Math.max(
      250,
      Math.min(12_000, Math.round((Math.log10(Math.max(totalResults, 10)) * 850) + (forumCount * 420)))
    );
    const score = estimatedVolume + (forumCount * 900) - (lowCompetition ? 0 : 1200);

    analyzed.push({
      keyword,
      volume: estimatedVolume,
      competition: lowCompetition ? 'Low' : mediumCompetition ? 'Medium' : 'Medium',
      intent: forumCount > 0
        ? `${forumCount} forum-style result${forumCount === 1 ? '' : 's'} appeared in the top 10, so this has discussion-page potential.`
        : 'Search demand exists, but forum surfaces are weaker in the top 10.',
      score,
    });
  }

  return analyzed
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((idea) => ({
      keyword: idea.keyword,
      volume: idea.volume,
      competition: idea.competition,
      intent: idea.intent,
    }));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const seed = String(body?.seed || '').trim();
    const keyword = String(body?.keyword || '').trim();
    if (!seed && !keyword) return json({ error: 'seed or keyword required' }, 400);

    if (!keyword) {
      const googleIdeas = await googleKeywordIdeas(seed);
      return json({
        keyword_ideas: googleIdeas || buildKeywordIdeas(seed),
        provider: googleIdeas ? 'google_custom_search_opportunity_model' : 'heuristic_keyword_model',
      });
    }

    const googleResults = await googleTop10(keyword);
    return json({
      serp_results: googleResults || fallbackTop10(keyword),
      provider: googleResults ? 'google_custom_search' : 'fallback_top10',
      keyword,
    });
  } catch (e) {
    return json({ error: 'rank_forum_pages_failed', detail: (e as Error).message }, 500);
  }
});
