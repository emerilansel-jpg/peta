import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  Eye,
  Link as LinkIcon,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
  Target,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { RedditLayout } from '../components/RedditLayout';
import { EmailWhitelistNotice } from '../components/EmailWhitelistNotice';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { checkAiVisibility, formatUSD, generateForumComment, getRankingForumResults, getRankingKeywordIdeas } from '../lib/api';
import type { AiVisibilityResult, RankingForumResult, RankingKeywordIdea } from '../lib/api';

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
  providerNotice?: string | null;
  results: ForumResult[];
};

type RankingDraft = {
  seed: string;
  brand: string;
  domain: string;
  hasAnalyzed: boolean;
  ideas: KeywordIdea[];
  selectedKeywords: KeywordIdea[];
  forumScans: KeywordForumScan[];
  selectedForumUrls: SelectedForumUrl[];
  keywordProvider: string;
  keywordPage: number;
  wantsSuggestion: boolean | null;
  mentionMode: 'plain' | 'link';
  commentText: string;
  step: StepId;
};

type StepId = 'seed' | 'keywords' | 'forums' | 'comment' | 'review';

const SEED_EXAMPLES = ['crm software', 'ai writing tool', 'email marketing', 'project management'];
const KEYWORDS_PER_PAGE = 25;
const RANKING_DRAFT_KEY = 'straight:ranking-forum:draft:v2';
const BULK_COMMENT_DRAFT_KEY = 'straight:forum-comment-bulk:v1';
const FORUM_COMMENT_PRICE_CENTS = 500;
const SUGGESTED_COMMENT_PRICE_CENTS = 550;

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'seed', label: 'Seed' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'forums', label: 'Forum URLs' },
  { id: 'comment', label: 'Comment' },
  { id: 'review', label: 'Review' },
];

function readRankingDraft(): Partial<RankingDraft> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RANKING_DRAFT_KEY);
    return raw ? JSON.parse(raw) as Partial<RankingDraft> : null;
  } catch {
    window.localStorage.removeItem(RANKING_DRAFT_KEY);
    return null;
  }
}

export function RankingForumPage() {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const { createForumCommentOrderAsync, isCreatingForumCommentOrder } = useRedditOrders();
  const [initialDraft] = useState<Partial<RankingDraft> | null>(() => readRankingDraft());
  const [seed, setSeed] = useState(initialDraft?.seed || '');
  const [loading, setLoading] = useState(false);
  const [serpLoading, setSerpLoading] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<KeywordIdea[]>(() => Array.isArray(initialDraft?.selectedKeywords) ? initialDraft.selectedKeywords : []);
  const [hasAnalyzed, setHasAnalyzed] = useState(!!initialDraft?.hasAnalyzed);
  const [ideas, setIdeas] = useState<KeywordIdea[]>(() => Array.isArray(initialDraft?.ideas) ? initialDraft.ideas : []);
  const [forumScans, setForumScans] = useState<KeywordForumScan[]>(() => Array.isArray(initialDraft?.forumScans) ? initialDraft.forumScans : []);
  const [selectedForumUrls, setSelectedForumUrls] = useState<SelectedForumUrl[]>(() => Array.isArray(initialDraft?.selectedForumUrls) ? initialDraft.selectedForumUrls : []);
  const [keywordProvider, setKeywordProvider] = useState(initialDraft?.keywordProvider || '');
  const [notice, setNotice] = useState('');
  const [keywordPage, setKeywordPage] = useState(Number(initialDraft?.keywordPage || 0));
  const [step, setStep] = useState<StepId>(initialDraft?.step || (initialDraft?.hasAnalyzed ? 'keywords' : 'seed'));
  // GEO campaign: brand + comment + order state
  const [brand, setBrand] = useState(initialDraft?.brand || '');
  const [domain, setDomain] = useState(initialDraft?.domain || '');
  const [wantsSuggestion, setWantsSuggestion] = useState<boolean | null>(initialDraft?.wantsSuggestion ?? null);
  const [mentionMode, setMentionMode] = useState<'plain' | 'link'>(initialDraft?.mentionMode || 'plain');
  const [commentText, setCommentText] = useState(initialDraft?.commentText || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [baseline, setBaseline] = useState<AiVisibilityResult | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [placedCount, setPlacedCount] = useState(0);

  const pageCount = Math.max(1, Math.ceil(ideas.length / KEYWORDS_PER_PAGE));
  const visibleIdeas = ideas.slice(keywordPage * KEYWORDS_PER_PAGE, (keywordPage + 1) * KEYWORDS_PER_PAGE);
  const unitCost = wantsSuggestion ? SUGGESTED_COMMENT_PRICE_CENTS : FORUM_COMMENT_PRICE_CENTS;
  const selectedUrlCost = selectedForumUrls.length * unitCost;
  const hasEnoughCreditForBulk = selectedForumUrls.length > 0 && balance >= selectedUrlCost;
  const primaryKeyword = selectedKeywords[0]?.keyword || selectedForumUrls[0]?.keyword || seed;

  useEffect(() => {
    const draft: RankingDraft = {
      seed,
      brand,
      domain,
      hasAnalyzed,
      ideas,
      selectedKeywords,
      forumScans,
      selectedForumUrls,
      keywordProvider,
      keywordPage,
      wantsSuggestion,
      mentionMode,
      commentText,
      step,
    };
    window.localStorage.setItem(RANKING_DRAFT_KEY, JSON.stringify(draft));
  }, [seed, brand, domain, hasAnalyzed, ideas, selectedKeywords, forumScans, selectedForumUrls, keywordProvider, keywordPage, wantsSuggestion, mentionMode, commentText, step]);

  // Fetch AI-visibility baseline when entering the forums step (if brand provided).
  useEffect(() => {
    if (step !== 'forums' || baseline) return;
    if (!brand.trim() && !domain.trim()) return;
    if (!primaryKeyword.trim()) return;
    let cancelled = false;
    checkAiVisibility({ keyword: primaryKeyword, brand: brand || null, domain: domain || null })
      .then((res) => { if (!cancelled) setBaseline(res); })
      .catch(() => { if (!cancelled) setBaseline(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
      if (data.provider_notice || data.provider === 'heuristic_keyword_model') {
        setNotice(data.provider_notice || 'Live keyword data is unavailable right now, so these are clearly marked estimates. Use them for preview only until live access is restored.');
      }
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
    setBrand('');
    setDomain('');
    setHasAnalyzed(false);
    setIdeas([]);
    setSelectedKeywords([]);
    setForumScans([]);
    setSelectedForumUrls([]);
    setKeywordProvider('');
    setKeywordPage(0);
    setWantsSuggestion(null);
    setMentionMode('plain');
    setCommentText('');
    setBaseline(null);
    setStep('seed');
    setNotice('');
  };

  const goBack = () => {
    if (step === 'review') return setStep('comment');
    if (step === 'comment') return setStep('forums');
    if (step === 'forums') return setStep('keywords');
    if (step === 'keywords') return setStep('seed');
    navigate(-1);
  };

  const resetScansForSelectionChange = () => {
    setForumScans([]);
    setSelectedForumUrls([]);
    setNotice('');
  };

  const toggleKeyword = (idea: KeywordIdea) => {
    setSelectedKeywords((current) => {
      const exists = current.some((item) => item.keyword === idea.keyword);
      return exists
        ? current.filter((item) => item.keyword !== idea.keyword)
        : [...current, idea];
    });
    resetScansForSelectionChange();
  };

  const addKeywords = (batch: KeywordIdea[]) => {
    setSelectedKeywords((current) => {
      const seen = new Set(current.map((item) => item.keyword));
      const additions = batch.filter((idea) => !seen.has(idea.keyword));
      return additions.length ? [...current, ...additions] : current;
    });
    resetScansForSelectionChange();
  };

  const removeKeywords = (batch: KeywordIdea[]) => {
    const drop = new Set(batch.map((idea) => idea.keyword));
    setSelectedKeywords((current) => current.filter((item) => !drop.has(item.keyword)));
    resetScansForSelectionChange();
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
          providerNotice: data.provider_notice,
          results: data.serp_results.filter((result) => result.eligible),
        };
      }));
      setForumScans(scans);
      const providerNotice = scans.find((scan) => scan.providerNotice)?.providerNotice;
      if (providerNotice || scans.some((scan) => scan.provider === 'fallback_top10' || scan.provider === 'local_fallback')) {
        setNotice(providerNotice || 'Live Google SERP access is unavailable right now, so fallback previews are clearly labeled. Verify the URL before ordering.');
      }
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

  const toForumUrlItem = (keyword: string, result: ForumResult): SelectedForumUrl => ({
    keyword,
    title: result.title,
    url: result.url,
    platform: result.platform,
  });

  const toggleForumUrl = (keyword: string, result: ForumResult) => {
    const item = toForumUrlItem(keyword, result);
    setSelectedForumUrls((current) => {
      const exists = current.some((selected) => selected.url === result.url);
      return exists
        ? current.filter((selected) => selected.url !== result.url)
        : [...current, item];
    });
  };

  const addForumUrls = (items: SelectedForumUrl[]) => {
    setSelectedForumUrls((current) => {
      const seen = new Set(current.map((item) => item.url));
      const additions = items.filter((item) => !seen.has(item.url));
      return additions.length ? [...current, ...additions] : current;
    });
  };

  const removeForumUrls = (items: SelectedForumUrl[]) => {
    const drop = new Set(items.map((item) => item.url));
    setSelectedForumUrls((current) => current.filter((selected) => !drop.has(selected.url)));
  };

  const allForumItems = forumScans.flatMap((scan) => scan.results.map((result) => toForumUrlItem(scan.keyword, result)));
  const totalForumUrls = allForumItems.length;
  const allForumSelected = totalForumUrls > 0 && selectedForumUrls.length >= totalForumUrls;

  const needsBrand = wantsSuggestion === true;
  const commentReady = commentText.trim().length >= 20
    && (!needsBrand || !!(brand.trim() || domain.trim()));

  const regenerateDraft = async () => {
    const target = selectedForumUrls[0];
    if (!target) { toast.error('Select at least one forum page first'); return; }
    if (!brand.trim() && !domain.trim()) { toast.error('Add your brand or domain first'); return; }
    setIsGenerating(true);
    try {
      const res = await generateForumComment({
        targetUrl: target.url,
        platform: target.platform || 'forum',
        brandName: brand.trim() || null,
        brandDomain: domain.trim() || null,
        mentionMode,
        extraInstructions: null,
      });
      setCommentText(res.comment);
      toast.success('Draft ready — review and edit before placing the order.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Draft assistant failed';
      toast.error(msg.toLowerCase().includes('api_key not configured')
        ? 'Draft assistant is not configured yet. Write the comment yourself, or contact support.'
        : msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const placeOrders = async () => {
    if (!hasEnoughCreditForBulk || !selectedForumUrls.length) return;
    if (commentText.trim().length < 20) { toast.error('Comment / brief must be at least 20 characters'); return; }
    try {
      const orders = await Promise.all(selectedForumUrls.map((target) => createForumCommentOrderAsync({
        targetUrl: target.url,
        platform: target.platform || null,
        commentText: commentText.trim(),
        useSuggestedComment: !!wantsSuggestion,
        brandName: brand.trim() || null,
        brandDomain: domain.trim() || null,
        brandMentionMode: wantsSuggestion ? mentionMode : null,
        sourceKeyword: target.keyword || primaryKeyword || null,
        notes: [
          'bulk_source=ranking_forum',
          `bulk_target_title=${target.title}`,
          wantsSuggestion ? 'bulk_suggested=per_thread_draft_from_brief' : '',
        ].filter(Boolean).join('\n') || null,
      })));
      setPlacedCount(orders.length);
      window.localStorage.removeItem(BULK_COMMENT_DRAFT_KEY);
      window.localStorage.removeItem(RANKING_DRAFT_KEY);
      toast.success(`${orders.length} comment order${orders.length === 1 ? '' : 's'} placed.`);
      setShowSuccess(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to place orders');
    }
  };

  return (
    <RedditLayout>
      {showSuccess && (
        <EmailWhitelistNotice
          variant="modal"
          headline={placedCount > 1 ? 'Comment orders placed' : 'Comment order placed'}
          context={`${placedCount} order${placedCount === 1 ? '' : 's'} created`}
          primaryLabel="Got it — show me my orders"
          onDismiss={() => {
            setShowSuccess(false);
            navigate('/reddit/orders');
          }}
        />
      )}
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
            <strong className="font-bold">Preview mode:</strong> {notice}
          </div>
        )}

        {baseline && baseline.provider !== 'unavailable' && (brand.trim() || domain.trim()) && step !== 'seed' && step !== 'keywords' && (
          <div className={`mb-5 p-4 rounded-xl ring-1 text-sm ${
            (baseline.google_organic.found || (baseline.ai_overview.present && baseline.ai_overview.brand_mentioned))
              ? 'bg-emerald-50 ring-emerald-100 text-emerald-800'
              : 'bg-slate-900 ring-slate-800 text-white'
          }`}>
            <div className="flex items-start gap-2">
              <Eye size={16} className="shrink-0 mt-0.5" />
              <div>
                {(baseline.google_organic.found || (baseline.ai_overview.present && baseline.ai_overview.brand_mentioned)) ? (
                  <span><strong>{brand || domain}</strong> already shows up for &ldquo;{baseline.keyword}&rdquo;. More mentions reinforce it.</span>
                ) : (
                  <span>Right now <strong>{brand || domain}</strong> is <strong>not</strong> mentioned in Google&rsquo;s top 10 or AI Overview for &ldquo;{baseline.keyword}&rdquo;. Placing these comments is how you get cited.</span>
                )}
              </div>
            </div>
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

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                  Brand <span className="text-slate-400 font-normal">(optional — for AI drafts & visibility)</span>
                </label>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="Your brand"
                  className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                  Website <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="yourdomain.com"
                  className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                />
              </div>
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
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-bold text-slate-900">Tap the angles you want</h2>
                  {keywordProvider && <DataFreshnessBadge live={isLiveProvider(keywordProvider)} />}
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  Tap as many keywords as you like — each one is a separate angle we'll scan for forum pages.
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

            {/* Quick bulk-select toolbar — built for clients clicking dozens at once */}
            <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs font-semibold text-slate-500">
                Page shows {visibleIdeas.length} angles
              </span>
              <button
                onClick={() => addKeywords(visibleIdeas)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                <CheckCheck size={15} />
                Select all on page
              </button>
              <button
                onClick={() => removeKeywords(visibleIdeas)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                <XCircle size={15} />
                Clear this page
              </button>
              <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
                <LegendDot className="bg-emerald-500" label="Low" />
                <LegendDot className="bg-amber-500" label="Medium" />
                <LegendDot className="bg-rose-500" label="High" />
                <span className="hidden sm:inline">competition</span>
              </span>
            </div>

            {/* Bird-eye chip cloud: dense, scannable, one-tap select */}
            <div className="p-4 flex flex-wrap gap-2">
              {visibleIdeas.map((idea) => {
                const selected = selectedKeywords.some((item) => item.keyword === idea.keyword);
                return (
                  <button
                    key={idea.keyword}
                    onClick={() => toggleKeyword(idea)}
                    title={idea.intent}
                    className={`group inline-flex items-center gap-2 pl-3 pr-3 py-2 rounded-full border transition ${
                      selected
                        ? 'border-orange-500 bg-orange-500 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'bg-white/80' : competitionDotClass(idea.competition)}`} />
                    <span className="text-sm font-semibold">{idea.keyword}</span>
                    <span className={`text-[11px] font-medium ${selected ? 'text-white/75' : 'text-slate-400'}`}>
                      {formatVolume(idea.volume)}
                    </span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>

            <StickyAction>
              <div>
                <p className="font-bold text-slate-900">{selectedKeywords.length} angle{selectedKeywords.length === 1 ? '' : 's'} selected</p>
                <p className="text-xs text-slate-500">More angles = more forum pages to choose from.</p>
              </div>
              <button
                onClick={scanSelectedKeywords}
                disabled={!selectedKeywords.length || serpLoading}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                {serpLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Scan {selectedKeywords.length || ''} keyword{selectedKeywords.length === 1 ? '' : 's'}
              </button>
            </StickyAction>
          </section>
        )}

        {step === 'forums' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Pick the forum pages to comment on</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Only live discussion pages are shown — articles and sales pages are filtered out.
                </p>
              </div>
              {!serpLoading && totalForumUrls > 0 && (
                <button
                  onClick={() => (allForumSelected ? removeForumUrls(allForumItems) : addForumUrls(allForumItems))}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-orange-300 text-sm font-semibold text-slate-700 self-start"
                >
                  {allForumSelected ? <XCircle size={15} /> : <CheckCheck size={15} />}
                  {allForumSelected ? 'Clear all' : `Select all ${totalForumUrls}`}
                </button>
              )}
            </div>

            {serpLoading ? (
              <div className="p-12 text-center">
                <Loader2 size={28} className="mx-auto text-orange-500 mb-3 animate-spin" />
                <p className="font-semibold text-slate-900">Scanning selected keywords...</p>
                <p className="text-sm text-slate-500 mt-1">Finding live forum pages for each angle.</p>
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
              <div className="divide-y divide-slate-100">
                {forumScans.map((scan) => {
                  const scanItems = scan.results.map((result) => toForumUrlItem(scan.keyword, result));
                  const scanSelectedCount = scanItems.filter((item) => selectedForumUrls.some((sel) => sel.url === item.url)).length;
                  const scanAllSelected = scanItems.length > 0 && scanSelectedCount >= scanItems.length;
                  return (
                    <div key={scan.keyword} className="px-4 sm:px-6 py-4">
                      {/* Group header: keyword + freshness + per-group select-all */}
                      <div className="flex items-center justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <h3 className="font-bold text-slate-900 truncate">{scan.keyword}</h3>
                          <DataFreshnessBadge live={isLiveProvider(scan.provider)} />
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            scan.results.length ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'
                          }`}>
                            {scan.results.length ? `${scan.results.length} page${scan.results.length === 1 ? '' : 's'}` : 'none found'}
                          </span>
                        </div>
                        {scanItems.length > 0 && (
                          <button
                            onClick={() => (scanAllSelected ? removeForumUrls(scanItems) : addForumUrls(scanItems))}
                            className="shrink-0 text-xs font-semibold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1"
                          >
                            {scanAllSelected ? <XCircle size={13} /> : <CheckCheck size={13} />}
                            {scanAllSelected ? 'Clear' : 'All'}
                          </button>
                        )}
                      </div>
                      {scan.providerNotice && (
                        <p className="text-xs text-amber-700 mb-2">{scan.providerNotice}</p>
                      )}

                      {scan.results.length ? (
                        <div className="space-y-1.5">
                          {scan.results.map((result) => {
                            const selected = selectedForumUrls.some((item) => item.url === result.url);
                            return (
                              <div
                                key={result.url}
                                className={`flex items-center gap-3 rounded-lg ring-1 pl-2.5 pr-2 py-2 transition ${
                                  selected ? 'bg-orange-50 ring-orange-300' : 'bg-white ring-slate-150 hover:ring-orange-200'
                                }`}
                              >
                                <button
                                  onClick={() => toggleForumUrl(scan.keyword, result)}
                                  className="flex items-center gap-3 min-w-0 flex-1 text-left"
                                >
                                  <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                                    selected ? 'bg-orange-500 text-white' : 'bg-slate-100 text-transparent ring-1 ring-slate-200'
                                  }`}>
                                    <Check size={13} />
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold uppercase shrink-0">
                                    {result.platform}
                                  </span>
                                  <span className="text-sm font-medium text-slate-900 truncate">{result.title}</span>
                                </button>
                                <a
                                  href={result.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white shrink-0"
                                  aria-label="Open page in new tab"
                                  title="Open page"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">No live forum page in the top results for this angle.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <StickyAction>
              <div>
                <p className="font-bold text-slate-900">{selectedForumUrls.length} forum page{selectedForumUrls.length === 1 ? '' : 's'} selected</p>
                <p className="text-xs text-slate-500">Estimated order cost: {formatUSD(selectedUrlCost)}</p>
              </div>
              <button
                onClick={() => setStep('comment')}
                disabled={!selectedForumUrls.length}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                Choose comment
                <ArrowRight size={14} />
              </button>
            </StickyAction>
          </section>
        )}

        {step === 'comment' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8 space-y-7">
            <div>
              <h2 className="font-bold text-slate-900">How should the comment be written?</h2>
              <p className="text-sm text-slate-500 mt-1">
                One comment/brief applies to all {selectedForumUrls.length} selected page{selectedForumUrls.length === 1 ? '' : 's'}.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setWantsSuggestion(true)}
                className={`text-left p-5 rounded-xl border-2 transition ${wantsSuggestion === true ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={17} className="text-orange-600" />
                  <span className="font-bold text-slate-900">Yes, write it for me</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Our editorial assistant drafts a helpful, on-context reply with one natural brand mention. You review &amp; edit before ordering.
                </p>
                <p className="mt-3 text-sm font-bold text-orange-700">{formatUSD(SUGGESTED_COMMENT_PRICE_CENTS)} / comment</p>
              </button>
              <button
                type="button"
                onClick={() => setWantsSuggestion(false)}
                className={`text-left p-5 rounded-xl border-2 transition ${wantsSuggestion === false ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Edit3 size={17} className="text-slate-700" />
                  <span className="font-bold text-slate-900">No, I will write it</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Paste one comment or instruction and we place it on every selected page.
                </p>
                <p className="mt-3 text-sm font-bold text-slate-900">{formatUSD(FORUM_COMMENT_PRICE_CENTS)} / comment</p>
              </button>
            </div>

            {wantsSuggestion === true && (
              <div className="space-y-5 rounded-xl bg-orange-50/50 ring-1 ring-orange-100 p-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Brand or domain</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" className="w-full px-4 py-3 border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900" />
                    <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourdomain.com" className="w-full px-4 py-3 border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Mention style</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setMentionMode('plain')} className={`py-3 rounded-lg text-sm font-semibold border-2 transition ${mentionMode === 'plain' ? 'border-orange-500 bg-white text-orange-700' : 'border-orange-100 bg-white/70 text-slate-700'}`}>Plain text mention</button>
                    <button type="button" onClick={() => setMentionMode('link')} className={`py-3 rounded-lg text-sm font-semibold border-2 transition inline-flex items-center justify-center gap-2 ${mentionMode === 'link' ? 'border-orange-500 bg-white text-orange-700' : 'border-orange-100 bg-white/70 text-slate-700'}`}><LinkIcon size={14} /> Include link</button>
                  </div>
                </div>
                <button type="button" onClick={regenerateDraft} disabled={isGenerating} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-60">
                  {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                  {isGenerating ? 'Preparing draft...' : (commentText ? 'Refresh draft' : 'Create draft')}
                </button>
                <p className="text-xs text-orange-900">We draft from the first selected page as context, then reuse your brief for each page. Review before checkout.</p>
              </div>
            )}

            {wantsSuggestion !== null && (
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  {wantsSuggestion ? 'Draft / brief (applies to all pages)' : 'Comment / instruction (applies to all pages)'}
                </label>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={wantsSuggestion ? 'Generate a draft, then edit it before ordering...' : 'Paste the exact comment you want us to place...'}
                  rows={7}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y text-slate-900"
                />
                <p className="mt-2 text-xs text-slate-500">Minimum 20 characters. {commentText.trim().length} entered.</p>
              </div>
            )}

            <StickyAction>
              <div>
                <p className="font-bold text-slate-900">{selectedForumUrls.length} page{selectedForumUrls.length === 1 ? '' : 's'} · {formatUSD(selectedUrlCost)}</p>
                <p className="text-xs text-slate-500">
                  {wantsSuggestion === null ? 'Choose how the comment is written' : commentReady ? 'Ready to review' : 'Add your comment / brief (min 20 chars)'}
                </p>
              </div>
              <button
                onClick={() => setStep('review')}
                disabled={wantsSuggestion === null || !commentReady}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                Review &amp; approve
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
                <SummaryRow label="Comment type" value={wantsSuggestion ? 'AI-assisted' : 'Self-written'} />
                <SummaryRow label="Price per page" value={formatUSD(unitCost)} />
                <SummaryRow label="Estimated total" value={formatUSD(selectedUrlCost)} strong />
                <SummaryRow label="Available credit" value={formatUSD(balance)} />
              </div>
              {!hasEnoughCreditForBulk && (
                <div className="mt-4 rounded-lg bg-rose-50 ring-1 ring-rose-100 p-3 text-sm text-rose-700">
                  You need {formatUSD(Math.max(0, selectedUrlCost - balance))} more credit before ordering this queue.
                </div>
              )}
              <button
                onClick={placeOrders}
                disabled={!hasEnoughCreditForBulk || !commentReady || isCreatingForumCommentOrder}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold"
              >
                {isCreatingForumCommentOrder ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Placing...
                  </>
                ) : (
                  <>
                    {`Place ${selectedForumUrls.length} comment order${selectedForumUrls.length === 1 ? '' : 's'}`}
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
              {!commentReady && (
                <button
                  onClick={() => setStep('comment')}
                  className="mt-2 w-full text-xs font-semibold text-amber-700 hover:text-amber-900"
                >
                  ← Add your comment first
                </button>
              )}
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
    <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-2">
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

// Provider names are internal — never surfaced to clients. We only expose
// whether the data is live or an estimated preview.
const PREVIEW_PROVIDERS = new Set(['heuristic_keyword_model', 'fallback_top10', 'local_fallback']);

function isLiveProvider(provider: string) {
  return !!provider && !PREVIEW_PROVIDERS.has(provider);
}

function DataFreshnessBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
        live ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {live ? 'Live data' : 'Preview estimate'}
    </span>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function competitionDotClass(competition: string) {
  const c = (competition || '').toLowerCase();
  if (c === 'low') return 'bg-emerald-500';
  if (c === 'high') return 'bg-rose-500';
  return 'bg-amber-500';
}

function formatVolume(volume: number) {
  if (volume >= 1000) return `${(volume / 1000).toFixed(volume >= 10000 ? 0 : 1)}k`;
  return volume.toLocaleString();
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
