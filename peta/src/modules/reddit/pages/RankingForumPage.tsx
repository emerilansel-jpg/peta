import type { ElementType } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { RedditLayout } from '../components/RedditLayout';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { formatUSD, getRankingForumResults, getRankingKeywordIdeas } from '../lib/api';
import type { RankingForumResult, RankingKeywordIdea } from '../lib/api';

type KeywordIdea = RankingKeywordIdea;
type ForumResult = RankingForumResult;

type SelectedForumUrl = {
  keyword: string;
  title: string;
  url: string;
  platform: string;
};

type KeywordForumScan = {
  keyword: string;
  provider: string;
  results: ForumResult[];
};

type RankingDraft = {
  seed: string;
  hasAnalyzed: boolean;
  ideas: KeywordIdea[];
  selectedKeywords: KeywordIdea[];
  forumScans: KeywordForumScan[];
  selectedForumUrls: SelectedForumUrl[];
  keywordProvider: string;
  keywordPage: number;
  step: StepId;
};

type StepId = 'seed' | 'keywords' | 'forums' | 'review';

const SEED_EXAMPLES = ['crm software', 'ai writing tool', 'email marketing', 'project management'];
const KEYWORDS_PER_PAGE = 25;
const RANKING_DRAFT_KEY = 'straight:ranking-forum:draft:v2';
const BULK_COMMENT_DRAFT_KEY = 'straight:forum-comment-bulk:v1';
const FORUM_COMMENT_PRICE_CENTS = 500;

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'seed', label: 'Seed' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'forums', label: 'Forum URLs' },
  { id: 'review', label: 'Review' },
];

export function RankingForumPage() {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const [seed, setSeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [serpLoading, setSerpLoading] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<KeywordIdea[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [ideas, setIdeas] = useState<KeywordIdea[]>([]);
  const [forumScans, setForumScans] = useState<KeywordForumScan[]>([]);
  const [selectedForumUrls, setSelectedForumUrls] = useState<SelectedForumUrl[]>([]);
  const [keywordProvider, setKeywordProvider] = useState('');
  const [notice, setNotice] = useState('');
  const [keywordPage, setKeywordPage] = useState(0);
  const [step, setStep] = useState<StepId>('seed');
  const [draftLoaded, setDraftLoaded] = useState(false);

  const pageCount = Math.max(1, Math.ceil(ideas.length / KEYWORDS_PER_PAGE));
  const visibleIdeas = ideas.slice(keywordPage * KEYWORDS_PER_PAGE, (keywordPage + 1) * KEYWORDS_PER_PAGE);
  const selectedUrlCost = selectedForumUrls.length * FORUM_COMMENT_PRICE_CENTS;
  const hasEnoughCreditForBulk = selectedForumUrls.length > 0 && balance >= selectedUrlCost;

  useEffect(() => {
    const raw = window.localStorage.getItem(RANKING_DRAFT_KEY);
    if (!raw) {
      setDraftLoaded(true);
      return;
    }
    try {
      const draft = JSON.parse(raw) as Partial<RankingDraft>;
      setSeed(draft.seed || '');
      setHasAnalyzed(!!draft.hasAnalyzed);
      setIdeas(Array.isArray(draft.ideas) ? draft.ideas : []);
      setSelectedKeywords(Array.isArray(draft.selectedKeywords) ? draft.selectedKeywords : []);
      setForumScans(Array.isArray(draft.forumScans) ? draft.forumScans : []);
      setSelectedForumUrls(Array.isArray(draft.selectedForumUrls) ? draft.selectedForumUrls : []);
      setKeywordProvider(draft.keywordProvider || '');
      setKeywordPage(Number(draft.keywordPage || 0));
      setStep(draft.step || (draft.hasAnalyzed ? 'keywords' : 'seed'));
    } catch {
      window.localStorage.removeItem(RANKING_DRAFT_KEY);
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    const draft: RankingDraft = {
      seed,
      hasAnalyzed,
      ideas,
      selectedKeywords,
      forumScans,
      selectedForumUrls,
      keywordProvider,
      keywordPage,
      step,
    };
    window.localStorage.setItem(RANKING_DRAFT_KEY, JSON.stringify(draft));
  }, [draftLoaded, seed, hasAnalyzed, ideas, selectedKeywords, forumScans, selectedForumUrls, keywordProvider, keywordPage, step]);

  const runAnalysis = async () => {
    if (!seed.trim()) return;
    setLoading(true);
    setSelectedKeywords([]);
    setForumScans([]);
    setSelectedForumUrls([]);
    setKeywordPage(0);
    setNotice('');
    try {
      const data = await getRankingKeywordIdeas(seed.trim());
      setIdeas(ensureManyKeywordIdeas(seed.trim(), data.keyword_ideas));
      setKeywordProvider(data.provider);
      setHasAnalyzed(true);
      setStep('keywords');
    } catch {
      setIdeas(buildKeywordIdeas(seed));
      setKeywordProvider('local_fallback');
      setNotice('Live keyword analysis is not deployed yet, showing a local estimate.');
      setHasAnalyzed(true);
      setStep('keywords');
    } finally {
      setLoading(false);
    }
  };

  const resetDraft = () => {
    window.localStorage.removeItem(RANKING_DRAFT_KEY);
    setSeed('');
    setHasAnalyzed(false);
    setIdeas([]);
    setSelectedKeywords([]);
    setForumScans([]);
    setSelectedForumUrls([]);
    setKeywordProvider('');
    setKeywordPage(0);
    setStep('seed');
    setNotice('');
  };

  const goBack = () => {
    if (step === 'review') return setStep('forums');
    if (step === 'forums') return setStep('keywords');
    if (step === 'keywords') return setStep('seed');
    navigate(-1);
  };

  const toggleKeyword = (idea: KeywordIdea) => {
    setSelectedKeywords((current) => {
      const exists = current.some((item) => item.keyword === idea.keyword);
      return exists
        ? current.filter((item) => item.keyword !== idea.keyword)
        : [...current, idea];
    });
    setForumScans([]);
    setSelectedForumUrls([]);
    setNotice('');
  };

  const scanSelectedKeywords = async () => {
    if (!selectedKeywords.length) return;
    setForumScans([]);
    setSelectedForumUrls([]);
    setSerpLoading(true);
    setNotice('');
    setStep('forums');
    try {
      const scans = await Promise.all(selectedKeywords.map(async (idea) => {
        const data = await getRankingForumResults(idea.keyword);
        return {
          keyword: idea.keyword,
          provider: data.provider,
          results: data.serp_results.filter((result) => result.eligible),
        };
      }));
      setForumScans(scans);
    } catch {
      setForumScans(selectedKeywords.map((idea) => ({
        keyword: idea.keyword,
        provider: 'local_fallback',
        results: buildGoogleTop10Results(idea.keyword).filter((result) => result.eligible),
      })));
      setNotice('Live SERP scan is unavailable right now, showing a local top-10 style preview.');
    } finally {
      setSerpLoading(false);
    }
  };

  const toggleForumUrl = (keyword: string, result: ForumResult) => {
    const item: SelectedForumUrl = {
      keyword,
      title: result.title,
      url: result.url,
      platform: result.platform,
    };
    setSelectedForumUrls((current) => {
      const exists = current.some((selected) => selected.url === result.url);
      return exists
        ? current.filter((selected) => selected.url !== result.url)
        : [...current, item];
    });
  };

  const continueToBulkOrder = () => {
    if (!hasEnoughCreditForBulk) return;
    window.localStorage.setItem(BULK_COMMENT_DRAFT_KEY, JSON.stringify({
      source: 'ranking-forum',
      createdAt: new Date().toISOString(),
      targets: selectedForumUrls,
    }));
    navigate('/reddit/new-order?service=comments&bulk=ranking-forum');
  };

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <button
              onClick={goBack}
              className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-100 text-xs font-bold uppercase tracking-wider mb-3">
              <Sparkles size={12} />
              Ranking Forum Page
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Find forum pages worth ordering</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Follow the steps: enter a seed, pick keyword angles page by page, scan Google top 10,
              select forum URLs, then place a bulk comment order.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={resetDraft}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-slate-300 text-slate-700 text-sm font-semibold"
            >
              Clear draft
            </button>
            <button
              onClick={() => navigate('/reddit/new-order?service=comments')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
            >
              Skip to comments
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <StepNav step={step} />

        {notice && (
          <div className="mb-5 p-3 rounded-lg bg-amber-50 ring-1 ring-amber-100 text-sm text-amber-800">
            {notice}
          </div>
        )}

        {step === 'seed' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8">
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
                  placeholder="Example: SEO content, CRM software, AI writing tool..."
                  className="w-full pl-11 pr-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                />
              </div>
              <button
                onClick={runAnalysis}
                disabled={!seed.trim() || loading}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Target size={16} />}
                Extract keyword ideas
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
            {hasAnalyzed && (
              <button
                onClick={() => setStep('keywords')}
                className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold"
              >
                Continue where I left off
                <ArrowRight size={14} />
              </button>
            )}
          </section>
        )}

        {step === 'keywords' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Choose keyword angles</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Showing 25 keywords per page. Select as many as needed.
                  {keywordProvider && <span className="block text-xs mt-1">Source: {formatProvider(keywordProvider)}</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PageButton disabled={keywordPage === 0} onClick={() => setKeywordPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft size={15} />
                  Previous
                </PageButton>
                <span className="px-3 py-2 text-sm font-bold text-slate-700">
                  Page {keywordPage + 1} / {pageCount}
                </span>
                <PageButton disabled={keywordPage >= pageCount - 1} onClick={() => setKeywordPage((p) => Math.min(pageCount - 1, p + 1))}>
                  Next
                  <ChevronRight size={15} />
                </PageButton>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleIdeas.map((idea) => {
                const selected = selectedKeywords.some((item) => item.keyword === idea.keyword);
                return (
                  <button
                    key={idea.keyword}
                    onClick={() => toggleKeyword(idea)}
                    className={`text-left p-4 rounded-xl border-2 transition ${
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

            <StickyAction>
              <div>
                <p className="font-bold text-slate-900">{selectedKeywords.length} keywords selected</p>
                <p className="text-xs text-slate-500">More selected keywords means more chances to find forum URLs.</p>
              </div>
              <button
                onClick={scanSelectedKeywords}
                disabled={!selectedKeywords.length || serpLoading}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                {serpLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Scan selected keywords
              </button>
            </StickyAction>
          </section>
        )}

        {step === 'forums' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Select forum URLs</h2>
              <p className="text-sm text-slate-500 mt-1">
                Non-forum Google results are hidden. Select multiple forum URLs to bulk order.
              </p>
            </div>

            {serpLoading ? (
              <div className="p-12 text-center">
                <Loader2 size={28} className="mx-auto text-orange-500 mb-3 animate-spin" />
                <p className="font-semibold text-slate-900">Scanning selected keywords...</p>
                <p className="text-sm text-slate-500 mt-1">Finding forum URLs in each Google top 10.</p>
              </div>
            ) : !forumScans.length ? (
              <div className="p-12 text-center">
                <Search size={28} className="mx-auto text-slate-300 mb-3" />
                <p className="font-semibold text-slate-900">No scan yet</p>
                <button
                  onClick={() => setStep('keywords')}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold"
                >
                  Back to keywords
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {forumScans.map((scan) => (
                  <div key={scan.keyword} className="p-4 rounded-xl ring-1 ring-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                      <div>
                        <h3 className="font-bold text-slate-900">{scan.keyword}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Source: {formatProvider(scan.provider)}</p>
                      </div>
                      <span className={`self-start sm:self-auto px-2.5 py-1 rounded-full text-xs font-bold ${
                        scan.results.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {scan.results.length ? `${scan.results.length} forum URL${scan.results.length === 1 ? '' : 's'}` : 'No forum'}
                      </span>
                    </div>

                    {scan.results.length ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {scan.results.map((result) => {
                          const selected = selectedForumUrls.some((item) => item.url === result.url);
                          return (
                            <button
                              key={result.url}
                              onClick={() => toggleForumUrl(scan.keyword, result)}
                              className={`text-left rounded-lg ring-1 p-3 transition ${
                                selected ? 'bg-orange-50 ring-orange-300' : 'bg-slate-50 ring-slate-100 hover:ring-slate-300'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold uppercase">
                                      {result.platform}
                                    </span>
                                  </div>
                                  <p className="text-sm font-semibold text-slate-900">{result.title}</p>
                                  <p className="text-xs text-slate-500 mt-1 break-all">{result.url}</p>
                                </div>
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                                  selected ? 'bg-orange-500 text-white' : 'bg-white text-slate-300 ring-1 ring-slate-200'
                                }`}>
                                  <Check size={14} />
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                        No forum URL found in Google top 10 for this keyword.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <StickyAction>
              <div>
                <p className="font-bold text-slate-900">{selectedForumUrls.length} forum URLs selected</p>
                <p className="text-xs text-slate-500">Estimated order cost: {formatUSD(selectedUrlCost)}</p>
              </div>
              <button
                onClick={() => setStep('review')}
                disabled={!selectedForumUrls.length}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                Review selected URLs
                <ArrowRight size={14} />
              </button>
            </StickyAction>
          </section>
        )}

        {step === 'review' && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-900">Review bulk queue</h2>
                <p className="text-sm text-slate-500 mt-1">Remove anything you do not want to order.</p>
              </div>
              <div className="p-4 space-y-2">
                {selectedForumUrls.map((item) => (
                  <div key={item.url} className="rounded-xl bg-slate-50 ring-1 ring-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold uppercase">
                            {item.platform}
                          </span>
                          <span className="text-xs font-semibold text-slate-500">{item.keyword}</span>
                        </div>
                        <p className="font-bold text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-1 break-all">{item.url}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg hover:bg-white text-slate-500"
                          aria-label="Open result"
                          title="Open result"
                        >
                          <ExternalLink size={16} />
                        </a>
                        <button
                          onClick={() => setSelectedForumUrls((current) => current.filter((selected) => selected.url !== item.url))}
                          className="p-2 rounded-lg hover:bg-white text-slate-500"
                          aria-label="Remove URL"
                          title="Remove URL"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 h-fit">
              <h3 className="font-bold text-slate-900">Credit check</h3>
              <div className="mt-4 space-y-3">
                <SummaryRow label="Selected URLs" value={String(selectedForumUrls.length)} />
                <SummaryRow label="Price per URL" value={formatUSD(FORUM_COMMENT_PRICE_CENTS)} />
                <SummaryRow label="Estimated total" value={formatUSD(selectedUrlCost)} strong />
                <SummaryRow label="Available credit" value={formatUSD(balance)} />
              </div>
              {!hasEnoughCreditForBulk && (
                <div className="mt-4 rounded-lg bg-rose-50 ring-1 ring-rose-100 p-3 text-sm text-rose-700">
                  You need {formatUSD(Math.max(0, selectedUrlCost - balance))} more credit before ordering this bulk queue.
                </div>
              )}
              <button
                onClick={continueToBulkOrder}
                disabled={!hasEnoughCreditForBulk}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                Continue to bulk order
                <ArrowRight size={14} />
              </button>
              <button
                onClick={() => navigate('/reddit/topup')}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-orange-300 text-slate-700 text-sm font-semibold"
              >
                <Wallet size={15} />
                Top up credit
              </button>
            </aside>
          </section>
        )}
      </div>
    </RedditLayout>
  );
}

function StepNav({ step }: { step: StepId }) {
  const activeIndex = STEPS.findIndex((item) => item.id === step);
  return (
    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-2">
      {STEPS.map((item, index) => {
        const active = item.id === step;
        const done = index < activeIndex;
        return (
          <div
            key={item.id}
            className={`rounded-xl px-4 py-3 ring-1 ${
              active ? 'bg-orange-50 ring-orange-200' : done ? 'bg-emerald-50 ring-emerald-100' : 'bg-white ring-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                active ? 'bg-orange-500 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {done ? <Check size={13} /> : index + 1}
              </span>
              <span className="text-sm font-bold text-slate-900">{item.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PageButton({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-orange-300 disabled:opacity-40 text-sm font-semibold text-slate-700"
    >
      {children}
    </button>
  );
}

function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 backdrop-blur p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      {children}
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={strong ? 'text-lg font-bold text-orange-600' : 'text-sm font-bold text-slate-900'}>{value}</span>
    </div>
  );
}

function formatProvider(provider: string) {
  const map: Record<string, string> = {
    heuristic_keyword_model: 'estimated keyword model',
    dataforseo_google_ads_serp_opportunity_model: 'DataForSEO Google Ads + live keyword volume',
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

function ensureManyKeywordIdeas(seed: string, remoteIdeas: KeywordIdea[]) {
  const seen = new Set<string>();
  return [...remoteIdeas, ...buildKeywordIdeas(seed)]
    .filter((idea) => {
      const key = idea.keyword.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildKeywordIdeas(seed: string): KeywordIdea[] {
  const base = seed.trim().toLowerCase() || 'growth tool';
  const score = Array.from(base).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const volumeBase = 900 + (score % 9) * 260;
  return localKeywordTemplates(base).map((template, index) => ({
    keyword: template.keyword,
    volume: Math.max(0, volumeBase + template.volume - (index * 18)),
    competition: template.competition,
    intent: template.intent,
  }));
}

function localKeywordTemplates(base: string): Array<KeywordIdea & { volume: number }> {
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
    `${base} reddit`,
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
