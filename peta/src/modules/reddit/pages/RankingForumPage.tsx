import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCheck,
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
import { checkAiVisibility, formatUSD, generateForumComment, getRankingForumResults, getRankingKeywordIdeas, getStraightPricing } from '../lib/api';
import type { AiVisibilityResult, RankingForumResult, RankingKeywordIdea, StraightPricingRow } from '../lib/api';

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
  volume: number;
  provider: string;
  providerNotice?: string | null;
  results: ForumResult[];
};

type StepId = 'seed' | 'forums' | 'comment' | 'review';

type RankingDraft = {
  seed: string;
  brand: string;
  domain: string;
  forumScans: KeywordForumScan[];
  selectedForumUrls: SelectedForumUrl[];
  keywordProvider: string;
  ideasCount: number;
  wantsSuggestion: boolean | null;
  mentionMode: 'plain' | 'link';
  commentText: string;
  drafts: Record<string, string>;
  step: StepId;
};

const SEED_EXAMPLES = ['crm software', 'ai writing tool', 'email marketing', 'project management'];
const RANKING_DRAFT_KEY = 'straight:ranking-forum:draft:v3';
const FORUM_COMMENT_PRICE_CENTS = 500;
const SUGGESTED_COMMENT_PRICE_CENTS = 550;
const TOP_KEYWORDS_TO_SCAN = 20;

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'seed', label: 'Seed' },
  { id: 'forums', label: 'Keywords + Forums' },
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
  const { balance, refetchBalance } = useRedditCredits();
  const { createForumCommentOrdersBulkAsync, isCreatingForumCommentOrdersBulk } = useRedditOrders();
  const [initialDraft] = useState<Partial<RankingDraft> | null>(() => readRankingDraft());
  const [seed, setSeed] = useState(initialDraft?.seed || '');
  const [brand, setBrand] = useState(initialDraft?.brand || '');
  const [domain, setDomain] = useState(initialDraft?.domain || '');
  const [loading, setLoading] = useState(false);
  const [serpLoading, setSerpLoading] = useState(false);
  const [forumScans, setForumScans] = useState<KeywordForumScan[]>(() => Array.isArray(initialDraft?.forumScans) ? initialDraft.forumScans : []);
  const [selectedForumUrls, setSelectedForumUrls] = useState<SelectedForumUrl[]>(() => Array.isArray(initialDraft?.selectedForumUrls) ? initialDraft.selectedForumUrls : []);
  const [keywordProvider, setKeywordProvider] = useState(initialDraft?.keywordProvider || '');
  const [ideasCount, setIdeasCount] = useState(initialDraft?.ideasCount || 0);
  const [notice, setNotice] = useState('');
  const [step, setStep] = useState<StepId>(initialDraft?.step || 'seed');
  const [wantsSuggestion, setWantsSuggestion] = useState<boolean | null>(initialDraft?.wantsSuggestion ?? null);
  const [mentionMode, setMentionMode] = useState<'plain' | 'link'>(initialDraft?.mentionMode || 'plain');
  const [commentText, setCommentText] = useState(initialDraft?.commentText || '');
  const [drafts, setDrafts] = useState<Record<string, string>>(() => (initialDraft?.drafts && typeof initialDraft.drafts === 'object') ? initialDraft.drafts : {});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  const [baseline, setBaseline] = useState<AiVisibilityResult | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [placedCount, setPlacedCount] = useState(0);
  const [pricing, setPricing] = useState<StraightPricingRow[]>([]);
  const [submittingOrders, setSubmittingOrders] = useState(false);

  // Comment costs come from the admin pricing matrix (per platform + plain/link),
  // with hardcoded fallbacks if the table isn't available yet.
  const commentMode: 'plain' | 'link' = (wantsSuggestion && mentionMode === 'link') ? 'link' : 'plain';
  const platformOf = (url: string) => (/(^|\.)reddit\.com/i.test(url) ? 'reddit' : 'forum');
  // Reddit is hard-excluded from all client-facing surfaces.
  // Additional platforms are hidden when the admin turns off all their pricing rows.
  const isPlatformEnabled = (url: string): boolean => {
    if (platformOf(url) === 'reddit') return false;
    const p = platformOf(url);
    const plainOn = pricing.find((r) => r.key === `${p}_comment_plain`)?.enabled ?? true;
    const linkOn = pricing.find((r) => r.key === `${p}_comment_link`)?.enabled ?? true;
    return plainOn || linkOn;
  };
  const commentPriceFor = (url: string): { cents: number; enabled: boolean } => {
    const row = pricing.find((r) => r.key === `${platformOf(url)}_comment_${commentMode}`);
    if (row) return { cents: row.price_cents, enabled: row.enabled };
    return { cents: commentMode === 'link' ? SUGGESTED_COMMENT_PRICE_CENTS : FORUM_COMMENT_PRICE_CENTS, enabled: true };
  };
  const priceCents = (key: string, fallback: number) => pricing.find((r) => r.key === key)?.price_cents ?? fallback;
  // Representative card price follows the platform of the first selected page, so
  // the "$X / comment" label matches what's actually charged (reddit vs forum).
  const repPlatform = platformOf(selectedForumUrls[0]?.url || '');
  const repPlain = priceCents(`${repPlatform}_comment_plain`, FORUM_COMMENT_PRICE_CENTS);
  const repLink = priceCents(`${repPlatform}_comment_link`, SUGGESTED_COMMENT_PRICE_CENTS);
  const selectedUrlCost = selectedForumUrls.reduce((sum, t) => sum + commentPriceFor(t.url).cents, 0);
  const disabledSelected = selectedForumUrls.filter((t) => !commentPriceFor(t.url).enabled);
  const hasEnoughCreditForBulk = selectedForumUrls.length > 0 && balance >= selectedUrlCost && disabledSelected.length === 0;
  const primaryKeyword = selectedForumUrls[0]?.keyword || forumScans[0]?.keyword || seed;

  useEffect(() => {
    const draft: RankingDraft = {
      seed, brand, domain, forumScans, selectedForumUrls, keywordProvider, ideasCount,
      wantsSuggestion, mentionMode, commentText, drafts, step,
    };
    window.localStorage.setItem(RANKING_DRAFT_KEY, JSON.stringify(draft));
  }, [seed, brand, domain, forumScans, selectedForumUrls, keywordProvider, ideasCount, wantsSuggestion, mentionMode, commentText, drafts, step]);

  // Load admin pricing once on mount (falls back to defaults if unavailable).
  useEffect(() => {
    getStraightPricing().then(setPricing).catch(() => setPricing([]));
  }, []);

  // AI-visibility baseline when entering the forums step (if brand provided).
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

  // Merged discovery: extract keyword ideas, then auto-scan the top keywords and
  // keep only the ones whose Google top-10 actually contains a forum page.
  const scanForumsForIdeas = async (ideas: KeywordIdea[]) => {
    const top = [...ideas].sort((a, b) => b.volume - a.volume).slice(0, TOP_KEYWORDS_TO_SCAN);
    setSerpLoading(true);
    try {
      const scans = await Promise.all(top.map(async (idea) => {
        try {
          const data = await getRankingForumResults(idea.keyword);
          return {
            keyword: idea.keyword,
            volume: idea.volume,
            provider: data.provider,
            providerNotice: data.provider_notice,
            results: data.serp_results.filter((r) => r.eligible),
          } as KeywordForumScan;
        } catch {
          return {
            keyword: idea.keyword,
            volume: idea.volume,
            provider: 'local_fallback',
            results: buildGoogleTop10Results(idea.keyword).filter((r) => r.eligible),
          } as KeywordForumScan;
        }
      }));
      const withForums = scans.filter((s) => s.results.length > 0);
      setForumScans(withForums);
      const providerNotice = withForums.find((s) => s.providerNotice)?.providerNotice;
      if (!withForums.length) {
        setNotice('No forum pages found in the top 10 for these keywords. Try a broader or more discussion-friendly seed topic.');
      } else if (providerNotice || withForums.some((s) => s.provider === 'fallback_top10' || s.provider === 'local_fallback')) {
        setNotice(providerNotice || 'Live Google SERP access is limited right now, so some results are clearly labeled previews. Verify before ordering.');
      }
    } finally {
      setSerpLoading(false);
    }
  };

  const runAnalysis = async () => {
    if (!seed.trim()) return;
    setLoading(true);
    setForumScans([]);
    setSelectedForumUrls([]);
    setDrafts({});
    setBaseline(null);
    setNotice('');
    let ideas: KeywordIdea[] = [];
    try {
      const data = await getRankingKeywordIdeas(seed.trim());
      ideas = ensureManyKeywordIdeas(seed.trim(), data.keyword_ideas);
      setKeywordProvider(data.provider);
      if (data.provider_notice || data.provider === 'heuristic_keyword_model') {
        setNotice(data.provider_notice || 'Live keyword data is unavailable right now, so these are estimated previews.');
      }
    } catch {
      ideas = buildKeywordIdeas(seed);
      setKeywordProvider('local_fallback');
      setNotice('Live keyword analysis is unavailable right now, showing a local estimate.');
    }
    setIdeasCount(ideas.length);
    setLoading(false);
    setStep('forums');
    await scanForumsForIdeas(ideas);
  };

  const rescan = async () => {
    if (!seed.trim()) return;
    setSelectedForumUrls([]);
    setDrafts({});
    await runAnalysis();
  };

  const resetDraft = () => {
    window.localStorage.removeItem(RANKING_DRAFT_KEY);
    setSeed(''); setBrand(''); setDomain('');
    setForumScans([]); setSelectedForumUrls([]); setKeywordProvider(''); setIdeasCount(0);
    setWantsSuggestion(null); setMentionMode('plain'); setCommentText(''); setDrafts({});
    setBaseline(null); setStep('seed'); setNotice('');
  };

  const goBack = () => {
    if (step === 'review') return setStep('comment');
    if (step === 'comment') return setStep('forums');
    if (step === 'forums') return setStep('seed');
    navigate(-1);
  };

  const toForumUrlItem = (keyword: string, result: ForumResult): SelectedForumUrl => ({
    keyword, title: result.title, url: result.url, platform: result.platform,
  });

  const toggleForumUrl = (keyword: string, result: ForumResult) => {
    const item = toForumUrlItem(keyword, result);
    setSelectedForumUrls((current) => {
      const exists = current.some((selected) => selected.url === result.url);
      return exists ? current.filter((selected) => selected.url !== result.url) : [...current, item];
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

  const allForumItems = forumScans.flatMap((scan) => scan.results.filter((r) => isPlatformEnabled(r.url)).map((result) => toForumUrlItem(scan.keyword, result)));
  const totalForumUrls = allForumItems.length;
  const allForumSelected = totalForumUrls > 0 && selectedForumUrls.length >= totalForumUrls;

  const hasBrand = !!(brand.trim() || domain.trim());
  // Each selected page must end up with its OWN comment — never the same text twice.
  const commentReady = disabledSelected.length === 0 && (wantsSuggestion === false
    ? commentText.trim().length >= 20
    : wantsSuggestion === true
      ? selectedForumUrls.length > 0 && selectedForumUrls.every((t) => (drafts[t.url] || '').trim().length >= 20)
      : false);

  const draftSingle = async (target: SelectedForumUrl) => {
    const res = await generateForumComment({
      targetUrl: target.url,
      platform: target.platform || 'forum',
      brandName: brand.trim() || null,
      brandDomain: domain.trim() || null,
      mentionMode,
      extraInstructions: null,
    });
    return res.comment;
  };

  const generateAllDrafts = async () => {
    if (!hasBrand) { toast.error('Add your brand or domain first'); return; }
    if (!selectedForumUrls.length) return;
    setGeneratingAll(true);
    try {
      const results = await Promise.all(selectedForumUrls.map(async (target) => {
        try { return { url: target.url, comment: await draftSingle(target) }; }
        catch { return { url: target.url, comment: '' }; }
      }));
      setDrafts((cur) => {
        const next = { ...cur };
        results.forEach((r) => { if (r.comment) next[r.url] = r.comment; });
        return next;
      });
      const ok = results.filter((r) => r.comment).length;
      if (ok === results.length) toast.success(`${ok} unique draft${ok === 1 ? '' : 's'} ready — review & edit each one.`);
      else if (ok > 0) toast.success(`${ok}/${results.length} drafts ready. Retry the rest or write them yourself.`);
      else toast.error('Draft assistant failed. Try again, or write the comments yourself.');
    } finally {
      setGeneratingAll(false);
    }
  };

  const regenerateOne = async (target: SelectedForumUrl) => {
    if (!hasBrand) { toast.error('Add your brand or domain first'); return; }
    setGenBusy((b) => ({ ...b, [target.url]: true }));
    try {
      const comment = await draftSingle(target);
      setDrafts((cur) => ({ ...cur, [target.url]: comment }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed for this page');
    } finally {
      setGenBusy((b) => ({ ...b, [target.url]: false }));
    }
  };

  const placeOrders = async () => {
    if (!selectedForumUrls.length || !commentReady) return;
    setSubmittingOrders(true);
    try {
      const refreshed = await refetchBalance();
      const freshBalance = refreshed.data ?? balance ?? 0;
      if (disabledSelected.length > 0) {
        toast.error('Some selected pages use a service that is currently turned off. Remove them first.');
        return;
      }
      if (freshBalance < selectedUrlCost) {
        toast.error(`You need ${formatUSD(Math.max(0, selectedUrlCost - freshBalance))} more credit before ordering this queue.`);
        return;
      }

      const inputs = selectedForumUrls.map((target) => {
        const text = wantsSuggestion ? (drafts[target.url] || '').trim() : commentText.trim();
        return {
          targetUrl: target.url,
          platform: target.platform || null,
          commentText: text,
          useSuggestedComment: !!wantsSuggestion,
          brandName: brand.trim() || null,
          brandDomain: domain.trim() || null,
          brandMentionMode: wantsSuggestion ? mentionMode : null,
          sourceKeyword: target.keyword || primaryKeyword || null,
          notes: [
            'bulk_source=ranking_forum',
            `bulk_target_title=${target.title}`,
            wantsSuggestion ? 'comment=ai_unique_per_page' : 'comment=client_guideline_unique_per_thread',
          ].join('\\n'),
        };
      });
      const orders = await createForumCommentOrdersBulkAsync(inputs);
      setPlacedCount(orders.length);
      window.localStorage.removeItem(RANKING_DRAFT_KEY);
      toast.success(`${orders.length} comment order${orders.length === 1 ? '' : 's'} placed.`);
      setShowSuccess(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create bulk comment orders');
    } finally {
      await refetchBalance();
      setSubmittingOrders(false);
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
          onDismiss={() => { setShowSuccess(false); navigate('/reddit/orders'); }}
        />
      )}
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <div className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <button onClick={goBack} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft size={15} />
              Back
            </button>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-100 text-xs font-bold uppercase tracking-wider mb-3">
              <Sparkles size={12} />
              Ranking Forum Page
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Find forum pages worth ordering</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Enter one seed. We find the keywords whose Google top 10 actually has forum pages,
              you pick the pages, choose how the comment is written, then approve.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={resetDraft} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-slate-300 text-slate-700 text-sm font-semibold">
              Clear draft
            </button>
          </div>
        </div>

        <StepNav step={step} />

        {notice && (
          <div className="mb-5 p-3 rounded-lg bg-amber-50 ring-1 ring-amber-100 text-sm text-amber-800">
            <strong className="font-bold">Heads up:</strong> {notice}
          </div>
        )}

        {baseline && baseline.provider !== 'unavailable' && hasBrand && step !== 'seed' && (
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

        {/* STEP: SEED */}
        {step === 'seed' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8">
            <label className="block text-sm font-semibold text-slate-900 mb-2">Topic, product category, or seed keyword</label>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runAnalysis(); }}
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
                Find forum opportunities
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {SEED_EXAMPLES.map((example) => (
                <button key={example} onClick={() => setSeed(example)} className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700">
                  {example}
                </button>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                  Brand <span className="text-slate-400 font-normal">(optional — for AI drafts & visibility)</span>
                </label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Your brand" className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                  Website <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourdomain.com" className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900" />
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              We scan the top {TOP_KEYWORDS_TO_SCAN} keywords by volume and only show the ones with real forum pages in Google&rsquo;s top 10.
            </p>
          </section>
        )}

        {/* STEP: FORUMS (merged keywords + forums) */}
        {step === 'forums' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Keywords with forum pages in Google&rsquo;s top 10</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {ideasCount > 0 && (
                    <><strong className="text-slate-700">{ideasCount.toLocaleString()} keywords</strong> extracted from your seed · scanned the top {TOP_KEYWORDS_TO_SCAN} by volume · </>
                  )}
                  <strong className="text-slate-700">{forumScans.length}</strong> have a real forum page. Pick the pages to comment on.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start">
                <button onClick={rescan} disabled={serpLoading || loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-orange-300 text-sm font-semibold text-slate-700 disabled:opacity-50">
                  <RefreshCcw size={14} className={serpLoading ? 'animate-spin' : ''} />
                  Rescan
                </button>
                {!serpLoading && totalForumUrls > 0 && (
                  <button onClick={() => (allForumSelected ? removeForumUrls(allForumItems) : addForumUrls(allForumItems))} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-orange-300 text-sm font-semibold text-slate-700">
                    {allForumSelected ? <XCircle size={15} /> : <CheckCheck size={15} />}
                    {allForumSelected ? 'Clear all' : `Select all ${totalForumUrls}`}
                  </button>
                )}
              </div>
            </div>

            {serpLoading || loading ? (
              <div className="p-12 text-center">
                <Loader2 size={28} className="mx-auto text-orange-500 mb-3 animate-spin" />
                <p className="font-semibold text-slate-900">Scanning Google top 10 for forum pages...</p>
                <p className="text-sm text-slate-500 mt-1">Checking the top {TOP_KEYWORDS_TO_SCAN} keywords. Takes ~15-20 seconds.</p>
              </div>
            ) : !forumScans.length || !forumScans.some((scan) => scan.results.some((r) => isPlatformEnabled(r.url))) ? (
              <div className="p-12 text-center">
                <Search size={28} className="mx-auto text-slate-300 mb-3" />
                <p className="font-semibold text-slate-900">No forum pages found for this seed</p>
                <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">Try a broader or more discussion-friendly topic (e.g. add &ldquo;forum&rdquo;, &ldquo;community&rdquo;, or a problem phrase).</p>
                <button onClick={() => setStep('seed')} className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold">
                  Try another seed
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {forumScans.filter((scan) => scan.results.some((r) => isPlatformEnabled(r.url))).map((scan) => {
                  const enabledResults = scan.results.filter((r) => isPlatformEnabled(r.url));
                  const scanItems = enabledResults.map((result) => toForumUrlItem(scan.keyword, result));
                  const scanSelectedCount = scanItems.filter((item) => selectedForumUrls.some((sel) => sel.url === item.url)).length;
                  const scanAllSelected = scanItems.length > 0 && scanSelectedCount >= scanItems.length;
                  return (
                    <div key={scan.keyword} className="px-4 sm:px-6 py-4">
                      <div className="flex items-center justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <h3 className="font-bold text-slate-900 truncate">{scan.keyword}</h3>
                          {scan.volume > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" title="Estimated monthly searches">
                              {formatVolume(scan.volume)}/mo
                            </span>
                          )}
                          <DataFreshnessBadge live={isLiveProvider(scan.provider)} />
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                            {enabledResults.length} forum page{enabledResults.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <button onClick={() => (scanAllSelected ? removeForumUrls(scanItems) : addForumUrls(scanItems))} className="shrink-0 text-xs font-semibold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1">
                          {scanAllSelected ? <XCircle size={13} /> : <CheckCheck size={13} />}
                          {scanAllSelected ? 'Clear' : 'All'}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {enabledResults.map((result) => {
                          const selected = selectedForumUrls.some((item) => item.url === result.url);
                          return (
                            <div key={result.url} className={`flex items-center gap-3 rounded-lg ring-1 pl-2.5 pr-2 py-2 transition ${selected ? 'bg-orange-50 ring-orange-300' : 'bg-white ring-slate-150 hover:ring-orange-200'}`}>
                              <button onClick={() => toggleForumUrl(scan.keyword, result)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                                <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${selected ? 'bg-orange-500 text-white' : 'bg-slate-100 text-transparent ring-1 ring-slate-200'}`}>
                                  <Check size={13} />
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold uppercase shrink-0">{result.platform}</span>
                                <span className="text-sm font-medium text-slate-900 truncate">{result.title}</span>
                              </button>
                              <a href={result.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white shrink-0" aria-label="Open page" title="Open page">
                                <ExternalLink size={14} />
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!serpLoading && !loading && forumScans.length > 0 && (
              <StickyAction>
                <div>
                  <p className="font-bold text-slate-900">{selectedForumUrls.length} forum page{selectedForumUrls.length === 1 ? '' : 's'} selected</p>
                  <p className="text-xs text-slate-500">
                    Estimated order cost: {formatUSD(selectedUrlCost)}
                    {disabledSelected.length > 0 && (
                      <span className="text-amber-600 font-semibold"> · {disabledSelected.length} paused platform{disabledSelected.length === 1 ? '' : 's'}</span>
                    )}
                  </p>
                </div>
                <button onClick={() => setStep('comment')} disabled={!selectedForumUrls.length} className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold">
                  Choose comment
                  <ArrowRight size={14} />
                </button>
              </StickyAction>
            )}
          </section>
        )}

        {/* STEP: COMMENT */}
        {step === 'comment' && (
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8 space-y-7">
            {disabledSelected.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-sm text-amber-900 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-semibold">{disabledSelected.length} selected page{disabledSelected.length === 1 ? '' : 's'} from a paused platform</p>
                  <p className="text-amber-700 text-xs mt-0.5">
                    {disabledSelected.map((t) => t.platform).join(', ')} comment placement is currently turned off in settings. Remove {disabledSelected.length === 1 ? 'it' : 'them'} to continue, or switch the mention style.
                  </p>
                </div>
              </div>
            )}

            <div>
              <h2 className="font-bold text-slate-900">How should the comments be written?</h2>
              <p className="text-sm text-slate-500 mt-1">
                Each of your {selectedForumUrls.length} page{selectedForumUrls.length === 1 ? '' : 's'} gets its <strong>own</strong> comment — we never post the same text twice.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button type="button" onClick={() => setWantsSuggestion(true)} className={`text-left p-5 rounded-xl border-2 transition ${wantsSuggestion === true ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Bot size={17} className="text-orange-600" />
                  <span className="font-bold text-slate-900">Let AI write it</span>
                  <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold uppercase">AI</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  AI writes a <strong>unique</strong> comment per page, drafted from that thread, with one natural brand mention. You review &amp; edit each before ordering.
                </p>
                <p className="mt-3 text-sm font-bold text-orange-700">{formatUSD(repPlain)} / comment · {formatUSD(repLink)} with link</p>
              </button>
              <button type="button" onClick={() => setWantsSuggestion(false)} className={`text-left p-5 rounded-xl border-2 transition ${wantsSuggestion === false ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Edit3 size={17} className="text-slate-700" />
                  <span className="font-bold text-slate-900">I&rsquo;ll give a guideline</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Give one guideline. Our writer creates a <strong>unique</strong> comment for each thread following it — never copy-pasted.
                </p>
                <p className="mt-3 text-sm font-bold text-slate-900">{formatUSD(repPlain)} / comment</p>
              </button>
            </div>

            {/* AI mode: per-page unique drafts */}
            {wantsSuggestion === true && (
              <div className="space-y-5">
                <div className="space-y-4 rounded-xl bg-orange-50/50 ring-1 ring-orange-100 p-5">
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
                    {mentionMode === 'link' && (
                      <p className="mt-2 text-xs text-orange-900">The link appears as a bare domain (e.g. yourdomain.com) — never https:// or markdown.</p>
                    )}
                  </div>
                  <button type="button" onClick={generateAllDrafts} disabled={generatingAll || !hasBrand} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold">
                    {generatingAll ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {generatingAll ? `Writing ${selectedForumUrls.length} unique drafts...` : `Generate ${selectedForumUrls.length} unique draft${selectedForumUrls.length === 1 ? '' : 's'}`}
                  </button>
                  <p className="text-xs text-orange-900 flex items-center gap-1.5">
                    <Bot size={12} /> Written by AI — please review &amp; edit each before it goes live.
                  </p>
                </div>

                {/* Per-page draft cards */}
                <div className="space-y-3">
                  {selectedForumUrls.map((target) => {
                    const isDisabledPlatform = !commentPriceFor(target.url).enabled;
                    return (
                    <div key={target.url} className={`rounded-xl ring-1 p-4 ${isDisabledPlatform ? 'ring-amber-300 bg-amber-50/30' : 'ring-slate-200'}`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold uppercase shrink-0">{target.platform}</span>
                          <span className="text-sm font-semibold text-slate-900 truncate">{target.title}</span>
                          {isDisabledPlatform && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold uppercase shrink-0">Paused</span>
                          )}
                        </div>
                        <button type="button" onClick={() => regenerateOne(target)} disabled={genBusy[target.url] || generatingAll || isDisabledPlatform} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-50">
                          {genBusy[target.url] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
                          {drafts[target.url] ? 'Regenerate' : 'Generate'}
                        </button>
                      </div>
                      <textarea
                        value={drafts[target.url] || ''}
                        onChange={(e) => setDrafts((cur) => ({ ...cur, [target.url]: e.target.value }))}
                        placeholder={isDisabledPlatform ? 'This platform is paused — remove it to continue' : 'Generate a unique draft for this page, or write it yourself...'}
                        rows={4}
                        disabled={isDisabledPlatform}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <p className="mt-1 text-[11px] text-slate-400">{(drafts[target.url] || '').trim().length} chars (min 20)</p>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Self mode: one guideline, worker writes unique per thread */}
            {wantsSuggestion === false && (
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Your guideline (applies to every page)</label>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="e.g. Mention our brand as a helpful option when people ask about X. Keep it casual, no hard sell..."
                  rows={6}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y text-slate-900"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Minimum 20 characters. {commentText.trim().length} entered. Our writer turns this into a <strong>unique</strong> comment per thread — never copy-pasted.
                </p>
              </div>
            )}

            <StickyAction>
              <div>
                <p className="font-bold text-slate-900">{selectedForumUrls.length} page{selectedForumUrls.length === 1 ? '' : 's'} · {formatUSD(selectedUrlCost)}</p>
                <p className="text-xs text-slate-500">
                  {disabledSelected.length > 0
                    ? `${disabledSelected.length} page${disabledSelected.length === 1 ? '' : 's'} from a paused platform — remove them to continue`
                    : wantsSuggestion === null
                    ? 'Choose how the comments are written'
                    : commentReady
                    ? 'Ready to review'
                    : wantsSuggestion
                    ? (selectedForumUrls.some((t) => (drafts[t.url] || '').trim().length < 20)
                      ? 'Every page needs its own draft (min 20 chars)'
                      : 'Add your brand or domain to generate drafts')
                    : 'Add your guideline (min 20 chars)'}
                </p>
              </div>
              <button onClick={() => setStep('review')} disabled={wantsSuggestion === null || !commentReady} className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold">
                Review &amp; approve
                <ArrowRight size={14} />
              </button>
            </StickyAction>
          </section>
        )}

        {/* STEP: REVIEW */}
        {step === 'review' && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-900">Review queue</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {wantsSuggestion ? 'Each page has its own unique AI draft.' : 'Each page gets a unique comment written from your guideline.'}
                </p>
              </div>
              <div className="p-4 space-y-2">
                {selectedForumUrls.map((item) => {
                  const preview = wantsSuggestion ? (drafts[item.url] || '') : commentText;
                  return (
                    <div key={item.url} className="rounded-xl bg-slate-50 ring-1 ring-slate-100 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold uppercase">{item.platform}</span>
                            <span className="text-xs font-semibold text-slate-500">{item.keyword}</span>
                          </div>
                          <p className="font-bold text-slate-900">{item.title}</p>
                          <p className="text-xs text-slate-500 mt-1 break-all">{item.url}</p>
                          {preview && (
                            <p className="mt-2 text-xs text-slate-600 bg-white ring-1 ring-slate-100 rounded-lg p-2 line-clamp-3">{preview}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-white text-slate-500" aria-label="Open result" title="Open result">
                            <ExternalLink size={16} />
                          </a>
                          <button onClick={() => removeForumUrls([item])} className="p-2 rounded-lg hover:bg-white text-slate-500" aria-label="Remove URL" title="Remove URL">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 h-fit">
              <h3 className="font-bold text-slate-900">Credit check</h3>
              <div className="mt-4 space-y-3">
                <SummaryRow label="Pages" value={String(selectedForumUrls.length)} />
                <SummaryRow label="Comment type" value={wantsSuggestion ? 'AI (unique/page)' : 'Guideline (unique/page)'} />
                <SummaryRow label="Link in comment" value={commentMode === 'link' ? 'Yes' : 'No'} />
                <SummaryRow label="Estimated total" value={formatUSD(selectedUrlCost)} strong />
                <SummaryRow label="Available credit" value={formatUSD(balance)} />
              </div>
              {disabledSelected.length > 0 && (
                <div className="mt-4 rounded-lg bg-amber-50 ring-1 ring-amber-100 p-3 text-sm text-amber-800">
                  {disabledSelected.length} selected page{disabledSelected.length === 1 ? '' : 's'} need a service that&rsquo;s currently turned off ({commentMode === 'link' ? 'comment with link' : 'comment'}). Switch the mention style or remove those pages.
                </div>
              )}
              {balance < selectedUrlCost && (
                <div className="mt-4 rounded-lg bg-rose-50 ring-1 ring-rose-100 p-3 text-sm text-rose-700">
                  You need {formatUSD(Math.max(0, selectedUrlCost - balance))} more credit before ordering this queue.
                </div>
              )}
              <button onClick={placeOrders} disabled={!hasEnoughCreditForBulk || !commentReady || isCreatingForumCommentOrdersBulk || submittingOrders} className="mt-5 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold">
                {isCreatingForumCommentOrdersBulk ? (<><Loader2 size={16} className="animate-spin" />Placing...</>) : (<>{`Place ${selectedForumUrls.length} comment order${selectedForumUrls.length === 1 ? '' : 's'}`}<ArrowRight size={14} /></>)}
              </button>
              {!commentReady && (
                <button onClick={() => setStep('comment')} className="mt-2 w-full text-xs font-semibold text-amber-700 hover:text-amber-900">
                  ← Finish the comments first
                </button>
              )}
              <button onClick={() => navigate('/reddit/topup')} className="mt-2 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-orange-300 text-slate-700 text-sm font-semibold">
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
          <div key={item.id} className={`rounded-xl px-4 py-3 ring-1 ${active ? 'bg-orange-50 ring-orange-200' : done ? 'bg-emerald-50 ring-emerald-100' : 'bg-white ring-slate-200'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? 'bg-orange-500 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
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

const PREVIEW_PROVIDERS = new Set(['heuristic_keyword_model', 'fallback_top10', 'local_fallback']);

function isLiveProvider(provider: string) {
  return !!provider && !PREVIEW_PROVIDERS.has(provider);
}

function DataFreshnessBadge({ live }: { live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${live ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {live ? 'Live data' : 'Preview estimate'}
    </span>
  );
}

function formatVolume(volume: number) {
  if (volume >= 1000) return `${(volume / 1000).toFixed(volume >= 10000 ? 0 : 1)}k`;
  return volume.toLocaleString();
}

const MAX_KEYWORD_IDEAS = 200;

function ensureManyKeywordIdeas(seed: string, remoteIdeas: KeywordIdea[]) {
  const seen = new Set<string>();
  return [...remoteIdeas, ...buildKeywordIdeas(seed)].filter((idea) => {
    const key = idea.keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_KEYWORD_IDEAS);
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
  const primary = ['best', 'top', 'cheap', 'affordable', 'recommended', 'trusted', 'easy', 'simple', 'professional', 'white label', 'outsourced', 'managed'];
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
    `is ${base} worth it`, `how to choose ${base}`, `${base} pros and cons`, `${base} problems`,
    `${base} pricing`, `${base} reviews`, `${base} alternatives`, `${base} comparison`,
    `${base} vs competitors`, `${base} recommendations`, `${base} tools`, `${base} software`, `${base} service`,
  ];
  const forumAngles = [
    `${base} forum`, `${base} discussion`, `${base} community`, `${base} quora`,
    `${base} stack exchange`, `${base} hubspot community`, `${base} product hunt`, `${base} indie hackers`,
  ];
  const generated: Array<KeywordIdea & { volume: number }> = [];
  for (const angle of questionAngles) {
    generated.push({ keyword: angle, volume: 1900 - generated.length * 20, competition: angle.includes('software') || angle.includes('tools') ? 'High' : angle.includes('pricing') || angle.includes('reviews') ? 'Medium' : 'Low', intent: 'Decision-stage query that can support helpful non-salesy forum replies.' });
  }
  for (const prefix of primary) {
    for (const item of intents) {
      generated.push({ keyword: `${prefix} ${base} ${item.suffix}`, volume: 1600 - generated.length * 8, competition: prefix === 'best' || prefix === 'top' ? 'Medium' : 'Low', intent: item.intent });
    }
  }
  for (const angle of forumAngles) {
    generated.push({ keyword: angle, volume: 900 - generated.length * 3, competition: 'Low', intent: 'Forum/community modifier increases chance of discussion pages.' });
  }
  return generated.map((item) => ({ ...item, volume: Math.max(20, item.volume) }));
}

function buildGoogleTop10Results(keyword: string): ForumResult[] {
  const slug = encodeURIComponent(keyword.replace(/\s+/g, '-'));
  const q = encodeURIComponent(keyword);
  return [
    { title: `Quora answers around ${keyword}`, url: `https://www.quora.com/search?q=${q}`, platform: 'Quora', reason: 'Question-led pages usually accept helpful comparison-style answers.', eligible: true },
    { title: `HubSpot Community thread: ${keyword}`, url: `https://community.hubspot.com/t5/forums/searchpage/tab/message?advanced=false&allow_punctuation=false&q=${q}`, platform: 'HubSpot', reason: 'B2B-heavy audience with practical implementation questions.', eligible: true },
    { title: `Indie Hackers discussion: ${keyword}`, url: `https://www.indiehackers.com/search?q=${q}`, platform: 'Indie Hackers', reason: 'Operator-heavy audience, useful for SaaS and growth topics.', eligible: true },
    { title: `Niche forum search page: ${keyword}`, url: `https://www.google.com/search?q=${q}+forum+discussion+${slug}`, platform: 'Forum SERP', reason: 'Use this when you want a broader Google pass for smaller forums.', eligible: true },
  ];
}
