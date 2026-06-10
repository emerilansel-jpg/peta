import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type KeywordIdea = {
  keyword: string;
  volume: number;
  competition: 'Low' | 'Medium' | 'High';
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
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
    }>;
  };
};

type SerpApiOrganicResult = {
  title?: string;
  link?: string;
  position?: number;
};

type SerpApiSearchResponse = {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
};

type DataForSeoSerpItem = {
  type?: string;
  title?: string;
  url?: string;
  rank_group?: number;
};

type DataForSeoKeywordItem = {
  keyword?: string;
  search_volume?: number | null;
  competition?: string | null;
  competition_index?: number | null;
};

type DataForSeoLabsKeywordItem = {
  keyword?: string;
  items?: DataForSeoLabsKeywordItem[];
  keyword_info?: {
    search_volume?: number | null;
    competition?: number | null;
    competition_level?: string | null;
  } | null;
  keyword_properties?: {
    keyword_difficulty?: number | null;
  } | null;
};

type DataForSeoResponse<T> = {
  status_code?: number;
  status_message?: string;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    result?: T[];
  }>;
};

type ProviderHealth = {
  status: 'ok' | 'missing' | 'error';
  detail?: string;
};

type DataForSeoUserDataResult = {
  money?: {
    balance?: number | null;
    total?: number | null;
  };
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FORUM_HOSTS = [
  'quora.com',
  'community.hubspot.com',
  'indiehackers.com',
  'blackhatworld.com',
  'warriorforum.com',
  'stackexchange.com',
  'stackoverflow.com',
  'producthunt.com',
  'news.ycombinator.com',
  'city-data.com',
  'proboards.com',
  'forumotion.',
  'tapatalk.com',
  'lemmy.',
  'discourse.',
];

// Generic forum-software URL fingerprints (phpBB / vBulletin / XenForo / SMF /
// Discourse / Vanilla etc.) — so small/niche forums are caught too, not just
// the big platforms above.
const FORUM_PATH_RE = /(\/forums?\b|\/community\b|\/communities\b|\/discussions?\b|\/questions?\b|\/threads?\b|\/topic[\/=]|\/board[\/s]|\/viewtopic|\/showthread|\/viewforum|\/forumdisplay|index\.php\?topic=|\/t\/\d|\/posts?\/\d)/i;
const FORUM_SUBDOMAIN_RE = /^(forums?|community|communities|discuss|discussion|boards?|talk|bbs|answers|ask)\./i;
const FORUM_HOST_HINT_RE = /(forum|phpbb|vbulletin|discourse|proboards|tapatalk|smf)/i;

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
  return keywordTemplates(base).map((template, index) => ({
    keyword: template.keyword,
    volume: Math.max(0, volumeBase + template.volume - (index * 35)),
    competition: template.competition,
    intent: template.intent,
  }));
}

function candidateKeywords(seed: string) {
  const base = seed.trim().toLowerCase() || 'growth tool';
  return keywordTemplates(base).map((item) => item.keyword);
}

function keywordTemplates(base: string): Array<KeywordIdea & { volume: number }> {
  const primary = [
    'best', 'top', 'cheap', 'affordable', 'recommended', 'trusted', 'easy', 'simple',
    'professional', 'white label', 'outsourced', 'managed',
  ];
  const intents = [
    { suffix: 'for small business', intent: 'Segment query with room for practical recommendations.' },
    { suffix: 'for startups', intent: 'Startup context often appears in operator forums.' },
    { suffix: 'for agencies', intent: 'Agency use case fits comparison and tool discussions.' },
    { suffix: 'for freelancers', intent: 'Solo-operator pain points often surface in public threads.' },
    { suffix: 'for ecommerce', intent: 'Vertical-specific query with practical decision intent.' },
    { suffix: 'for b2b', intent: 'B2B query helps filter generic content.' },
    { suffix: 'for marketing teams', intent: 'Team workflow questions can generate forum discussion.' },
  ];
  const questionAngles = [
    `is ${base} worth it`,
    `how to choose ${base}`,
    `${base} pros and cons`,
    `${base} problems`,
    `${base} pricing`,
    `${base} reviews`,
    `${base} alternatives`,
    `${base} comparison`,
    `${base} vs competitors`,
    `${base} recommendations`,
    `${base} tools`,
    `${base} software`,
    `${base} service`,
  ];
  const forumAngles = [
    `${base} forum`,
    `${base} discussion`,
    `${base} community`,
    `${base} quora`,
    `${base} stack exchange`,
    `${base} hubspot community`,
    `${base} product hunt`,
    `${base} indie hackers`,
  ];
  const generated: Array<KeywordIdea & { volume: number }> = [];

  for (const angle of questionAngles) {
    generated.push({
      keyword: angle,
      volume: 1900 - generated.length * 20,
      competition: angle.includes('software') || angle.includes('tools') ? 'High' : angle.includes('pricing') || angle.includes('reviews') ? 'Medium' : 'Low',
      intent: 'Decision-stage query that can support helpful non-salesy forum replies.',
    });
  }
  for (const prefix of primary) {
    for (const item of intents) {
      generated.push({
        keyword: `${prefix} ${base} ${item.suffix}`,
        volume: 1600 - generated.length * 8,
        competition: prefix === 'best' || prefix === 'top' ? 'Medium' : 'Low',
        intent: item.intent,
      });
    }
  }
  for (const angle of forumAngles) {
    generated.push({
      keyword: angle,
      volume: 900 - generated.length * 3,
      competition: 'Low',
      intent: 'Forum/community modifier increases chance of discussion pages.',
    });
  }

  return generated.map((item) => ({ ...item, volume: Math.max(20, item.volume) }));
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
  // Reddit is hard-excluded from all client-facing surfaces.
  if (low.includes('reddit.com')) return false;
  if (FORUM_HOSTS.some((host) => low.includes(host))) return true;
  if (FORUM_PATH_RE.test(low)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (FORUM_SUBDOMAIN_RE.test(host)) return true;
    if (FORUM_HOST_HINT_RE.test(host)) return true;
  } catch {
    // ignore unparseable URLs
  }
  return false;
}

function fallbackTop10(keyword: string): SerpResult[] {
  const slug = encodeURIComponent(keyword.replace(/\s+/g, '-'));
  const q = encodeURIComponent(keyword);
  return [
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

function dataForSeoAuth() {
  const login = Deno.env.get('DATAFORSEO_LOGIN');
  const password = Deno.env.get('DATAFORSEO_PASSWORD');
  if (!login || !password) return null;
  return `Basic ${btoa(`${login}:${password}`)}`;
}

async function providerHealthCheck() {
  const dataforseo: ProviderHealth = !Deno.env.get('DATAFORSEO_LOGIN') || !Deno.env.get('DATAFORSEO_PASSWORD')
    ? { status: 'missing', detail: 'DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD missing' }
    : { status: 'ok' };
  const google: ProviderHealth = !Deno.env.get('GOOGLE_SEARCH_API_KEY') || !Deno.env.get('GOOGLE_SEARCH_CX')
    ? { status: 'missing', detail: 'GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX missing' }
    : { status: 'ok' };
  const serpapi: ProviderHealth = !Deno.env.get('SERPAPI_API_KEY')
    ? { status: 'missing', detail: 'SERPAPI_API_KEY missing' }
    : { status: 'ok' };

  if (dataforseo.status === 'ok') {
    const userData = await dataForSeoGet<DataForSeoUserDataResult>('appendix/user_data')
      .catch((error) => ({ health_error: (error as Error).message }));
    const userDataError = (userData as { health_error?: string })?.health_error;
    const money = (userData as DataForSeoResponse<DataForSeoUserDataResult>)?.tasks?.[0]?.result?.[0]?.money;
    const balance = typeof money?.balance === 'number' ? money.balance : null;

    const dfs = await dataForSeoPost<DataForSeoLabsKeywordItem>(
      'dataforseo_labs/google/keyword_suggestions/live',
      [{
        keyword: 'crm software',
        location_code: 2840,
        language_code: 'en',
        include_serp_info: true,
        include_seed_keyword: true,
        limit: 1,
      }]
    ).catch((error) => ({ health_error: (error as Error).message }));
    const error = (dfs as { health_error?: string })?.health_error;
    const task = (dfs as DataForSeoResponse<DataForSeoLabsKeywordItem>)?.tasks?.[0];
    const resultCount = task?.result?.length || 0;
    if (error) {
      dataforseo.status = 'error';
      dataforseo.detail = error === 'dataforseo_http_402'
        ? `Payment required. ${balance !== null ? `Balance: $${balance.toFixed(2)}. ` : ''}Check DataForSEO balance, subscription access, or cost limits.`
        : userDataError
          ? `${error}; account check also failed: ${userDataError}`
          : error;
    } else if (resultCount < 1) {
      dataforseo.status = 'error';
      dataforseo.detail = task?.status_message || 'No keyword rows returned';
    } else if (balance !== null) {
      dataforseo.detail = `Balance: $${balance.toFixed(2)}`;
    }
  }

  if (google.status === 'ok') {
    const result = await googleSearch('crm software')
      .then((data) => ({ count: data?.items?.length || 0 }))
      .catch((error) => ({ health_error: (error as Error).message }));
    if ('health_error' in result) {
      google.status = 'error';
      google.detail = result.health_error;
    } else if (result.count < 1) {
      google.status = 'error';
      google.detail = 'No search results returned';
    }
  }

  if (serpapi.status === 'ok') {
    const result = await serpApiSearch('crm software')
      .then((data) => ({ count: data?.organic_results?.length || 0, error: data?.error }))
      .catch((error) => ({ health_error: (error as Error).message }));
    if ('health_error' in result) {
      serpapi.status = 'error';
      serpapi.detail = result.health_error;
    } else if (result.error) {
      serpapi.status = 'error';
      serpapi.detail = result.error;
    } else if (result.count < 1) {
      serpapi.status = 'error';
      serpapi.detail = 'No organic results returned';
    }
  }

  return { dataforseo, google, serpapi };
}

async function dataForSeoPost<T>(path: string, body: unknown): Promise<DataForSeoResponse<T> | null> {
  const auth = dataForSeoAuth();
  if (!auth) return null;

  const r = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`dataforseo_http_${r.status}`);
  const dfs = data as DataForSeoResponse<T>;
  if (dfs.status_code && dfs.status_code >= 40000) {
    throw new Error(`dataforseo_${dfs.status_code}_${dfs.status_message || 'error'}`);
  }
  const task = dfs.tasks?.[0];
  if (task?.status_code && task.status_code >= 40000) {
    throw new Error(`dataforseo_task_${task.status_code}_${task.status_message || 'error'}`);
  }
  return dfs;
}

async function dataForSeoGet<T>(path: string): Promise<DataForSeoResponse<T> | null> {
  const auth = dataForSeoAuth();
  if (!auth) return null;

  const r = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'GET',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`dataforseo_http_${r.status}`);
  const dfs = data as DataForSeoResponse<T>;
  if (dfs.status_code && dfs.status_code >= 40000) {
    throw new Error(`dataforseo_${dfs.status_code}_${dfs.status_message || 'error'}`);
  }
  const task = dfs.tasks?.[0];
  if (task?.status_code && task.status_code >= 40000) {
    throw new Error(`dataforseo_task_${task.status_code}_${task.status_message || 'error'}`);
  }
  return dfs;
}

function mapDataForSeoSerpItems(items: DataForSeoSerpItem[] = []): SerpResult[] {
  return items
    .filter((item) => item.url && (!item.type || item.type === 'organic'))
    .sort((a, b) => (a.rank_group || 999) - (b.rank_group || 999))
    .slice(0, 10)
    .map((item) => {
      const resultUrl = String(item.url || '');
      const eligible = isForumUrl(resultUrl);
      return {
        title: String(item.title || resultUrl),
        url: resultUrl,
        platform: platformForUrl(resultUrl),
        reason: eligible
          ? 'Forum or discussion-style result from live Google SERP data.'
          : 'Skipped because this live Google result does not look like a public discussion page.',
        eligible,
      };
    });
}

async function dataForSeoTop10(keyword: string): Promise<SerpResult[] | null> {
  const data = await dataForSeoPost<{ items?: DataForSeoSerpItem[] }>(
    'serp/google/organic/live/advanced',
    [{
      keyword,
      location_code: 2840,
      language_code: 'en',
      depth: 10,
    }]
  ).catch((error) => {
    console.error('dataforseo_top10_failed', (error as Error).message);
    return null;
  });
  const items = data?.tasks?.[0]?.result?.[0]?.items || [];
  return items.length ? mapDataForSeoSerpItems(items) : null;
}

// ---- AI / Google visibility (GEO) citation check ----
type CitationResult = {
  keyword: string;
  brand: string | null;
  domain: string | null;
  google_organic: { found: boolean; position: number | null; url: string | null };
  ai_overview: { present: boolean; brand_mentioned: boolean };
  provider: string;
  checked_at: string;
};

function normHost(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
}

// Given a keyword + brand/domain, check whether the brand is visible in Google's
// organic top 10 AND in Google's AI Overview (an LLM-generated answer) for that
// query. Uses the same DataForSEO live SERP call as dataForSeoTop10.
async function checkCitation(keyword: string, brand: string, domain: string): Promise<CitationResult> {
  const checked_at = new Date().toISOString();
  const brandNorm = brand.trim().toLowerCase();
  const brandSlug = brandNorm.replace(/\s+/g, '');
  const domainNorm = domain ? normHost(domain) : '';
  const result: CitationResult = {
    keyword,
    brand: brand || null,
    domain: domain || null,
    google_organic: { found: false, position: null, url: null },
    ai_overview: { present: false, brand_mentioned: false },
    provider: 'live_serp',
    checked_at,
  };

  const data = await dataForSeoPost<{ items?: DataForSeoSerpItem[] }>(
    'serp/google/organic/live/advanced',
    [{ keyword, location_code: 2840, language_code: 'en', depth: 10 }]
  ).catch((error) => {
    console.error('citation_check_failed', (error as Error).message);
    return null;
  });
  if (!data) return { ...result, provider: 'unavailable' };

  const items = (data?.tasks?.[0]?.result?.[0]?.items || []) as Array<DataForSeoSerpItem & { description?: string }>;

  for (const item of items) {
    if (item?.type !== 'organic') continue;
    const url = String(item.url || '');
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { host = ''; }
    const haystack = `${String(item.title || '')} ${String(item.description || '')} ${url}`.toLowerCase();
    const domainMatch = !!domainNorm && host.includes(domainNorm);
    const brandMatch = !!brandNorm && (haystack.includes(brandNorm) || (brandSlug.length > 2 && host.includes(brandSlug)));
    if (domainMatch || brandMatch) {
      result.google_organic = { found: true, position: Number(item.rank_group) || null, url };
      break;
    }
  }

  const aiItem = items.find((it) => it?.type === 'ai_overview');
  if (aiItem) {
    result.ai_overview.present = true;
    const blob = JSON.stringify(aiItem).toLowerCase();
    result.ai_overview.brand_mentioned = !!(
      (domainNorm && blob.includes(domainNorm)) ||
      (brandNorm && blob.includes(brandNorm))
    );
  }

  return result;
}

async function dataForSeoKeywordIdeas(seed: string): Promise<KeywordIdea[] | null> {
  const labsIdeas = await dataForSeoLabsKeywordIdeas(seed);
  if (labsIdeas?.length) return labsIdeas;

  const keywords = candidateKeywords(seed).slice(0, 100);
  const volumeData = await dataForSeoPost<DataForSeoKeywordItem>(
    'keywords_data/google_ads/search_volume/live',
    [{
      keywords,
      location_code: 2840,
      language_code: 'en',
    }]
  ).catch((error) => {
    console.error('dataforseo_keyword_volume_failed', (error as Error).message);
    return null;
  });
  const volumeRows = volumeData?.tasks?.[0]?.result || [];
  if (!volumeRows.length) return null;

  const rowsByKeyword = new Map(
    volumeRows.map((row) => [String(row.keyword || '').toLowerCase(), row])
  );
  const analyzed: Array<KeywordIdea & { score: number }> = [];

  for (const keyword of keywords) {
    const volumeRow = rowsByKeyword.get(keyword.toLowerCase());
    const volume = Math.max(0, Number(volumeRow?.search_volume || 0));
    const competitionIndex = Number(volumeRow?.competition_index ?? 50);
    const competition: 'Low' | 'Medium' | 'High' = competitionIndex <= 35 ? 'Low' : competitionIndex <= 70 ? 'Medium' : 'High';
    const forumModifier = /forum|reddit|quora|community|discussion/i.test(keyword) ? 900 : 0;
    const score = volume + forumModifier - (competitionIndex * 8);

    analyzed.push({
      keyword,
      volume,
      competition,
      intent: `Google Ads competition is ${String(volumeRow?.competition || 'available').toLowerCase()}. Select it to scan Google top 10 for forum URLs.`,
      score,
    });
  }

  return analyzed
    .sort((a, b) => b.score - a.score)
    .map(({ keyword, volume, competition, intent }) => ({ keyword, volume, competition, intent }));
}

async function dataForSeoLabsKeywordIdeas(seed: string): Promise<KeywordIdea[] | null> {
  const data = await dataForSeoPost<DataForSeoLabsKeywordItem>(
    'dataforseo_labs/google/keyword_suggestions/live',
    [{
      keyword: seed,
      location_code: 2840,
      language_name: 'English',
      include_seed_keyword: true,
      include_serp_info: true,
      limit: 100,
    }]
  ).catch((error) => {
    console.error('dataforseo_labs_keyword_suggestions_failed', (error as Error).message);
    return null;
  });
  const resultRows = data?.tasks?.[0]?.result || [];
  const rows = resultRows.flatMap((row) => Array.isArray(row.items) ? row.items : [row]);
  if (!rows.length) return null;

  const analyzed = rows
    .map((row) => {
      const keyword = String(row.keyword || '').trim();
      const volume = Math.max(0, Number(row.keyword_info?.search_volume || 0));
      const competitionScore = Number(row.keyword_info?.competition ?? 0.5);
      const difficulty = Number(row.keyword_properties?.keyword_difficulty ?? 50);
      const competitionLevel = String(row.keyword_info?.competition_level || '').toLowerCase();
      const competition: 'Low' | 'Medium' | 'High' = competitionLevel.includes('low') || competitionScore <= 0.35
        ? 'Low'
        : competitionLevel.includes('high') || competitionScore >= 0.7
          ? 'High'
          : 'Medium';
      const forumModifier = /forum|reddit|quora|community|discussion/i.test(keyword) ? 900 : 0;
      const score = volume + forumModifier - (competitionScore * 700) - (difficulty * 12);

      return {
        keyword,
        volume,
        competition,
        intent: `DataForSEO reports ${volume.toLocaleString()} monthly searches with ${competition.toLowerCase()} paid competition. Select it to scan Google top 10 for forum URLs.`,
        score,
      };
    })
    .filter((idea) => idea.keyword && idea.volume > 0);

  return analyzed
    .sort((a, b) => b.score - a.score)
    .map(({ keyword, volume, competition, intent }) => ({ keyword, volume, competition, intent }));
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
  if (!r.ok) {
    const googleError = (data as GoogleSearchResponse)?.error;
    const reason = googleError?.errors?.[0]?.reason || googleError?.status;
    const message = googleError?.message || googleError?.errors?.[0]?.message;
    throw new Error([
      `google_search_${r.status}`,
      reason ? `reason=${reason}` : '',
      message ? `message=${message}` : '',
    ].filter(Boolean).join('; '));
  }
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

async function serpApiSearch(keyword: string): Promise<SerpApiSearchResponse | null> {
  const apiKey = Deno.env.get('SERPAPI_API_KEY');
  if (!apiKey) return null;

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', keyword);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('num', '10');

  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const message = (data as SerpApiSearchResponse)?.error;
    throw new Error(message ? `serpapi_http_${r.status}; message=${message}` : `serpapi_http_${r.status}`);
  }
  const serp = data as SerpApiSearchResponse;
  if (serp.error) throw new Error(`serpapi_${serp.error}`);
  return serp;
}

function mapSerpApiResults(data: SerpApiSearchResponse): SerpResult[] {
  return (data.organic_results || [])
    .filter((item) => item.link)
    .sort((a, b) => (a.position || 999) - (b.position || 999))
    .slice(0, 10)
    .map((item) => {
      const resultUrl = String(item.link || '');
      const eligible = isForumUrl(resultUrl);
      return {
        title: String(item.title || resultUrl),
        url: resultUrl,
        platform: platformForUrl(resultUrl),
        reason: eligible
          ? 'Forum or discussion-style result from live Google SERP data.'
          : 'Skipped because this live Google result does not look like a public discussion page.',
        eligible,
      };
    });
}

async function serpApiTop10(keyword: string): Promise<SerpResult[] | null> {
  const data = await serpApiSearch(keyword).catch((error) => {
    console.error('serpapi_top10_failed', (error as Error).message);
    return null;
  });
  if (!data) return null;
  const results = mapSerpApiResults(data);
  return results.length ? results : null;
}

async function googleKeywordIdeas(seed: string): Promise<KeywordIdea[] | null> {
  const keywords = candidateKeywords(seed).slice(0, 30);
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
    if (body?.health === 'providers') {
      return json(await providerHealthCheck());
    }
    if (body?.citation_check) {
      const checkKeyword = String(body?.keyword || '').trim();
      if (!checkKeyword) return json({ error: 'keyword required' }, 400);
      return json(await checkCitation(
        checkKeyword,
        String(body?.brand || '').trim(),
        String(body?.domain || '').trim(),
      ));
    }
    const seed = String(body?.seed || '').trim();
    const keyword = String(body?.keyword || '').trim();
    if (!seed && !keyword) return json({ error: 'seed or keyword required' }, 400);

    if (!keyword) {
      const dataForSeoIdeas = await dataForSeoKeywordIdeas(seed);
      if (dataForSeoIdeas) {
        return json({
          keyword_ideas: dataForSeoIdeas,
          provider: 'live_keyword_data',
          provider_notice: null,
        });
      }

      const googleIdeas = await googleKeywordIdeas(seed);
      return json({
        keyword_ideas: googleIdeas || buildKeywordIdeas(seed),
        provider: googleIdeas ? 'live_keyword_data' : 'heuristic_keyword_model',
        provider_notice: googleIdeas
          ? null
          : 'Live keyword data is unavailable right now, so this is an estimated preview rather than live search volume.',
      });
    }

    const dataForSeoResults = await dataForSeoTop10(keyword);
    if (dataForSeoResults) {
      return json({
        serp_results: dataForSeoResults,
        provider: 'live_serp',
        keyword,
        provider_notice: null,
      });
    }

    const googleResults = await googleTop10(keyword);
    if (googleResults) {
      return json({
        serp_results: googleResults,
        provider: 'live_serp',
        keyword,
        provider_notice: null,
      });
    }

    const serpApiResults = await serpApiTop10(keyword);
    if (serpApiResults) {
      return json({
        serp_results: serpApiResults,
        provider: 'live_serp',
        keyword,
        provider_notice: null,
      });
    }

    return json({
      serp_results: fallbackTop10(keyword),
      provider: 'fallback_top10',
      keyword,
      provider_notice: 'Live Google top-10 access is unavailable right now, so this is a fallback preview rather than live SERP data.',
    });
  } catch (e) {
    // Log the real error server-side; return a generic message (no vendor names).
    console.error('rank_forum_pages_failed', (e as Error).message);
    return json({ error: 'rank_forum_pages_failed' }, 500);
  }
});
