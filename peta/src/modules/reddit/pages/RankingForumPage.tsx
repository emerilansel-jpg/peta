import type { ElementType } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Check,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  Target,
  TrendingDown,
} from 'lucide-react';
import { RedditLayout } from '../components/RedditLayout';
import { getRankingForumResults, getRankingKeywordIdeas } from '../lib/api';
import type { RankingForumResult, RankingKeywordIdea } from '../lib/api';

type KeywordIdea = RankingKeywordIdea;
type ForumResult = RankingForumResult;

const SEED_EXAMPLES = ['crm software', 'ai writing tool', 'email marketing', 'project management'];

export function RankingForumPage() {
  const navigate = useNavigate();
  const [seed, setSeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [serpLoading, setSerpLoading] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<KeywordIdea | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [ideas, setIdeas] = useState<KeywordIdea[]>([]);
  const [forumResults, setForumResults] = useState<ForumResult[]>([]);
  const [keywordProvider, setKeywordProvider] = useState('');
  const [serpProvider, setSerpProvider] = useState('');
  const [notice, setNotice] = useState('');

  const runAnalysis = async () => {
    if (!seed.trim()) return;
    setLoading(true);
    setSelectedKeyword(null);
    setForumResults([]);
    setNotice('');
    try {
      const data = await getRankingKeywordIdeas(seed.trim());
      setIdeas(data.keyword_ideas);
      setKeywordProvider(data.provider);
      setHasAnalyzed(true);
    } catch {
      setIdeas(buildKeywordIdeas(seed));
      setKeywordProvider('local_fallback');
      setNotice('Live keyword analysis is not deployed yet, showing a local estimate.');
      setHasAnalyzed(true);
    } finally {
      setLoading(false);
    }
  };

  const selectKeyword = async (idea: KeywordIdea) => {
    setSelectedKeyword(idea);
    setForumResults([]);
    setSerpLoading(true);
    setNotice('');
    try {
      const data = await getRankingForumResults(idea.keyword);
      setForumResults(data.serp_results);
      setSerpProvider(data.provider);
    } catch {
      setForumResults(buildGoogleTop10Results(idea.keyword));
      setSerpProvider('local_fallback');
      setNotice('Live SERP scan is unavailable right now, showing a local top-10 style preview.');
    } finally {
      setSerpLoading(false);
    }
  };

  const startCommentOrder = (result: ForumResult) => {
    const params = new URLSearchParams({
      service: 'comments',
      url: result.url,
      keyword: selectedKeyword?.keyword || seed.trim(),
    });
    navigate(`/reddit/new-order?${params.toString()}`);
  };

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-100 text-xs font-bold uppercase tracking-wider mb-3">
              <Sparkles size={12} />
              Ranking Forum Page
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Find forum pages worth commenting on</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Start with a topic. We estimate keyword opportunity, help you pick one low-competition angle,
              then scan a Google top-10 style SERP for forum pages that can feed straight into a comment order.
            </p>
          </div>
          <button
            onClick={() => navigate('/reddit/new-order?service=comments')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
          >
            Skip to comments
            <ArrowRight size={14} />
          </button>
        </div>

        <section className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8 mb-8">
          <label className="block text-sm font-semibold text-slate-900 mb-2">
            Topic, product category, or seed keyword
          </label>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runAnalysis();
                }}
                placeholder="Example: CRM software, AI writing tool, email marketing..."
                className="w-full pl-11 pr-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
              />
            </div>
            <button
              onClick={runAnalysis}
              disabled={!seed.trim() || loading}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Target size={16} />}
              Find keyword opportunities
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SEED_EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => setSeed(example)}
                className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
              >
                {example}
              </button>
            ))}
          </div>
        </section>

        {hasAnalyzed && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <section className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-900">Pick one keyword</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Prioritized by volume, competition, and forum intent.
                  {keywordProvider && <span className="block text-xs mt-1">Source: {formatProvider(keywordProvider)}</span>}
                </p>
              </div>
              {notice && (
                <div className="mx-4 mt-4 p-3 rounded-lg bg-amber-50 ring-1 ring-amber-100 text-xs text-amber-800">
                  {notice}
                </div>
              )}
              <div className="p-4 space-y-3">
                {ideas.map((idea) => {
                  const selected = selectedKeyword?.keyword === idea.keyword;
                  return (
                    <button
                      key={idea.keyword}
                      onClick={() => selectKeyword(idea)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition ${
                        selected ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-slate-900">{idea.keyword}</p>
                          <p className="text-xs text-slate-500 mt-1">{idea.intent}</p>
                        </div>
                        {selected && <Check size={18} className="text-orange-600 shrink-0" />}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Metric icon={BarChart3} label="Est. volume" value={idea.volume.toLocaleString()} />
                        <Metric icon={TrendingDown} label="Competition" value={idea.competition} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="lg:col-span-3 bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-900">Google top 10 scan</h2>
                <p className="text-sm text-slate-500 mt-1">
                  We keep forum/discussion URLs and skip regular articles, homepages, and sales pages.
                  {serpProvider && <span className="block text-xs mt-1">Source: {formatProvider(serpProvider)}</span>}
                </p>
              </div>

              {serpLoading ? (
                <div className="p-12 text-center">
                  <Loader2 size={28} className="mx-auto text-orange-500 mb-3 animate-spin" />
                  <p className="font-semibold text-slate-900">Scanning Google top 10...</p>
                  <p className="text-sm text-slate-500 mt-1">Finding forum-style URLs for this keyword.</p>
                </div>
              ) : !selectedKeyword ? (
                <div className="p-12 text-center">
                  <Search size={28} className="mx-auto text-slate-300 mb-3" />
                  <p className="font-semibold text-slate-900">Select a keyword first</p>
                  <p className="text-sm text-slate-500 mt-1">We will scan a top-10 style SERP and keep forum targets.</p>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {forumResults.map((result, index) => (
                    <div
                      key={result.url}
                      className={`p-4 rounded-xl ring-1 transition ${
                        result.eligible
                          ? 'ring-slate-200 hover:ring-orange-300'
                          : 'ring-slate-100 bg-slate-50 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-orange-600">Google #{index + 1}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              result.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'
                            }`}>
                              {result.platform}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              result.eligible ? 'bg-orange-50 text-orange-700' : 'bg-slate-200 text-slate-500'
                            }`}>
                              {result.eligible ? 'Forum target' : 'Skipped'}
                            </span>
                          </div>
                          <h3 className="font-bold text-slate-900">{result.title}</h3>
                          <p className="text-xs text-slate-500 mt-1 break-all">{result.url}</p>
                          <p className="text-sm text-slate-600 mt-2">{result.reason}</p>
                        </div>
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                          aria-label="Open result"
                          title="Open result"
                        >
                          <ExternalLink size={16} />
                        </a>
                      </div>
                      {result.eligible ? (
                        <button
                          onClick={() => startCommentOrder(result)}
                          className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
                        >
                          Use this page for a comment
                          <ArrowRight size={14} />
                        </button>
                      ) : (
                        <div className="mt-4 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-500 text-sm font-semibold text-center">
                          Not a forum page
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </RedditLayout>
  );
}

function formatProvider(provider: string) {
  const map: Record<string, string> = {
    heuristic_keyword_model: 'estimated keyword model',
    dataforseo_google_ads_serp_opportunity_model: 'DataForSEO Google Ads + live SERP model',
    dataforseo_google_organic_live: 'DataForSEO Google Organic live top 10',
    google_custom_search_opportunity_model: 'Google top-10 opportunity model',
    google_custom_search: 'Google Custom Search top 10',
    fallback_top10: 'fallback top-10 preview',
    local_fallback: 'local fallback',
  };
  return map[provider] || provider;
}

function Metric({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/70 ring-1 ring-slate-200 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 font-bold">
        <Icon size={11} />
        {label}
      </div>
      <p className="text-sm font-bold text-slate-900 mt-0.5">{value}</p>
    </div>
  );
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

function buildGoogleTop10Results(keyword: string): ForumResult[] {
  const slug = encodeURIComponent(keyword.replace(/\s+/g, '-'));
  const q = encodeURIComponent(keyword);
  return [
    {
      title: `Reddit discussion: ${keyword}`,
      url: `https://www.reddit.com/search/?q=${q}`,
      platform: 'Reddit',
      reason: 'High discussion density and visible comment threads.',
      eligible: true,
    },
    {
      title: `Comparison article: ${keyword}`,
      url: `https://www.google.com/search?q=${q}+review`,
      platform: 'Article',
      reason: 'Likely editorial content, not a place to add a native comment.',
      eligible: false,
    },
    {
      title: `Quora answers around ${keyword}`,
      url: `https://www.quora.com/search?q=${q}`,
      platform: 'Quora',
      reason: 'Question-led pages usually accept helpful comparison-style answers.',
      eligible: true,
    },
    {
      title: `Vendor landing page for ${keyword}`,
      url: `https://www.google.com/search?q=${q}+official+site`,
      platform: 'Sales page',
      reason: 'Owned landing page, skipped because it is not a discussion thread.',
      eligible: false,
    },
    {
      title: `HubSpot Community thread: ${keyword}`,
      url: `https://community.hubspot.com/t5/forums/searchpage/tab/message?advanced=false&allow_punctuation=false&q=${q}`,
      platform: 'HubSpot',
      reason: 'B2B-heavy audience with practical implementation questions.',
      eligible: true,
    },
    {
      title: `Listicle result: ${keyword}`,
      url: `https://www.google.com/search?q=${q}+tools+list`,
      platform: 'Article',
      reason: 'Informational article, useful for research but not a comment target.',
      eligible: false,
    },
    {
      title: `Indie Hackers discussion: ${keyword}`,
      url: `https://www.indiehackers.com/search?q=${q}`,
      platform: 'Indie Hackers',
      reason: 'Operator-heavy audience, useful for SaaS and growth topics.',
      eligible: true,
    },
    {
      title: `Support documentation: ${keyword}`,
      url: `https://www.google.com/search?q=${q}+docs`,
      platform: 'Docs',
      reason: 'Documentation page, skipped because there is no public discussion context.',
      eligible: false,
    },
    {
      title: `Niche forum search page: ${keyword}`,
      url: `https://www.google.com/search?q=${q}+forum+discussion+${slug}`,
      platform: 'Forum SERP',
      reason: 'Use this when you want a broader Google pass for smaller forums.',
      eligible: true,
    },
    {
      title: `YouTube result: ${keyword}`,
      url: `https://www.google.com/search?q=${q}+youtube`,
      platform: 'Video',
      reason: 'Can be useful research, but skipped for this forum-comment workflow.',
      eligible: false,
    },
  ];
}
