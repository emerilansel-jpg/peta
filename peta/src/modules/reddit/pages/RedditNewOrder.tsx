import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ElementType } from 'react';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  AlertCircle,
  Check,
  Info,
  Loader2,
  Wallet,
  X,
  ArrowUp,
  MessageSquare,
  Share2,
  Plus,
  Sparkles,
  ArrowLeft,
  Send,
  Search,
  RefreshCcw,
  Edit3,
  Link as LinkIcon,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { RedditLayout } from '../components/RedditLayout';
import { EmailWhitelistNotice } from '../components/EmailWhitelistNotice';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { formatUSD, generateForumComment, submitFeatureRequest, straightPrice, straightEnabled, straightPlatformKey } from '../lib/api';
import { useStraightPricing } from '../hooks/useStraightPricing';

const PRESET_QUANTITIES = [25, 50, 100, 250, 500];
// Legacy fallbacks — only used until the pricing matrix loads (or before the
// migration is applied). The matrix (straight_pricing) is the source of truth.
const FALLBACK_UPVOTE_CENTS = 50;
const FALLBACK_COMMENT_PLAIN_CENTS = 500;
const FALLBACK_COMMENT_LINK_CENTS = 550;
const BULK_COMMENT_DRAFT_KEY = 'straight:forum-comment-bulk:v1';

interface Service {
  id: string;
  platform: string;
  name: string;
  icon: ElementType;
  description: string;
  status: 'active' | 'coming_soon' | 'request' | 'paused';
  badge?: string;
  iconBg: string;
  iconColor: string;
}

const SERVICES: Service[] = [
  {
    id: 'reddit-upvote',
    platform: 'Reddit',
    name: 'Upvotes',
    icon: ArrowUp,
    description: 'High-retention upvotes for Reddit & other forums',
    status: 'active',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    id: 'reddit-comment',
    platform: 'Forums',
    name: 'Comments',
    icon: MessageSquare,
    description: 'Helpful comments for Reddit, Quora, HubSpot, and niche forums',
    status: 'active',
    badge: 'New',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    id: 'reddit-share',
    platform: 'Reddit',
    name: 'Shares',
    icon: Share2,
    description: 'Cross-post amplification to relevant subreddits',
    status: 'coming_soon',
    badge: 'Q3 2026',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  {
    id: 'reddit-thread',
    platform: 'Reddit',
    name: 'New Threads',
    icon: Plus,
    description: 'Original thread submissions to target subs',
    status: 'coming_soon',
    badge: 'Q4 2026',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    id: 'facebook',
    platform: 'Facebook',
    name: 'Likes & Shares',
    icon: Share2,
    description: 'Native Facebook engagement at scale',
    status: 'coming_soon',
    badge: 'Q4 2026',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-700',
  },
  {
    id: 'custom',
    platform: 'Custom',
    name: 'Request a service',
    icon: Sparkles,
    description: 'Twitter, Discord, custom integration?',
    status: 'request',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
];

type ViewMode = 'select' | 'reddit-upvote' | 'reddit-comment' | 'coming-soon' | 'feature-request';

type BulkForumTarget = {
  keyword: string;
  title: string;
  url: string;
  platform: string;
};

export function RedditNewOrder() {
  const [searchParams] = useSearchParams();
  const startsInComments = searchParams.get('service') === 'comments';
  const [view, setView] = useState<ViewMode>(startsInComments ? 'reddit-comment' : 'select');
  const [activeService, setActiveService] = useState<Service | null>(
    startsInComments ? (SERVICES.find((s) => s.id === 'reddit-comment') || null) : null
  );
  const sourceKeyword = searchParams.get('keyword') || '';
  const prefillUrl = searchParams.get('url') || '';
  const startsInBulk = searchParams.get('bulk') === 'ranking-forum';
  const [bulkTargets] = useState<BulkForumTarget[]>(() => {
    if (!startsInBulk) return [];
    try {
      const raw = window.localStorage.getItem(BULK_COMMENT_DRAFT_KEY);
      const parsed = raw ? JSON.parse(raw) as { targets?: BulkForumTarget[] } : null;
      return Array.isArray(parsed?.targets) ? parsed.targets : [];
    } catch {
      return [];
    }
  });

  const pricing = useStraightPricing();
  // Reflect admin on/off toggles: an "active" service whose matrix rows are all
  // OFF shows as paused (and can't be opened). The order RPCs enforce this too.
  const services = useMemo(() => SERVICES.map((s) => {
    if (s.id === 'reddit-upvote') {
      const on = straightEnabled(pricing, 'reddit_upvote', true) || straightEnabled(pricing, 'forum_upvote', true);
      return { ...s, status: on ? s.status : 'paused' as const };
    }
    if (s.id === 'reddit-comment') {
      const on = ['reddit_comment_plain', 'reddit_comment_link', 'forum_comment_plain', 'forum_comment_link']
        .some((k) => straightEnabled(pricing, k, true));
      return { ...s, status: on ? s.status : 'paused' as const };
    }
    return s;
  }), [pricing]);

  const handleServiceClick = (service: Service) => {
    if (service.status === 'paused') {
      toast('This service is paused right now. Check back soon.');
      return;
    }
    setActiveService(service);
    if (service.status === 'active') {
      setView(service.id as ViewMode);
    } else if (service.status === 'coming_soon') {
      setView('coming-soon');
    } else if (service.status === 'request') {
      setView('feature-request');
    }
  };

  const handleBack = () => {
    setView('select');
    setActiveService(null);
  };

  return (
    <RedditLayout>
      {view === 'select' && <ServiceSelector services={services} onSelect={handleServiceClick} />}
      {view === 'reddit-upvote' && <RedditUpvoteOrderForm onBack={handleBack} />}
      {view === 'reddit-comment' && (
        <ForumCommentOrderForm
          onBack={handleBack}
          prefillUrl={prefillUrl}
          sourceKeyword={sourceKeyword}
          bulkTargets={bulkTargets}
        />
      )}
      {view === 'coming-soon' && activeService && (
        <ComingSoonForm service={activeService} onBack={handleBack} />
      )}
      {view === 'feature-request' && <FeatureRequestForm onBack={handleBack} />}
    </RedditLayout>
  );
}

// ============================================================
// View 1: Service Selector
// ============================================================
function ServiceSelector({ services, onSelect }: { services: Service[]; onSelect: (s: Service) => void }) {
  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">New order</h1>
        <p className="text-slate-600 mt-1">Choose a service to start. Or request something we don't yet offer.</p>
      </div>

      {/* Platform: Reddit */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-7 h-7 rounded bg-orange-500 flex items-center justify-center text-white text-sm font-bold">R</div>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Reddit</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {services.filter((s) => s.platform === 'Reddit').map((s) => (
            <ServiceCard key={s.id} service={s} onClick={() => onSelect(s)} />
          ))}
        </div>
      </div>

      {/* Other platforms */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Forum discovery</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {services.filter((s) => s.platform === 'Forums').map((s) => (
            <ServiceCard key={s.id} service={s} onClick={() => onSelect(s)} />
          ))}
          {services.filter((s) => s.platform === 'Facebook').map((s) => (
            <ServiceCard key={s.id} service={s} onClick={() => onSelect(s)} />
          ))}
          {/* Custom request as a featured card */}
          {services.filter((s) => s.platform === 'Custom').map((s) => (
            <ServiceCard key={s.id} service={s} onClick={() => onSelect(s)} featured />
          ))}
        </div>
      </div>

      {/* Promo */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-orange-50 to-amber-50 ring-1 ring-orange-100">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-orange-500 text-white flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Need something we don't offer?</h3>
            <p className="text-sm text-slate-700 mt-1">
              We ship new platforms based on demand. Request what you need — popular requests get fast-tracked.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceCard({ service, onClick, featured }: { service: Service; onClick: () => void; featured?: boolean }) {
  const Icon = service.icon;
  const isActive = service.status === 'active';
  const isComingSoon = service.status === 'coming_soon';
  const isRequest = service.status === 'request';
  const isPaused = service.status === 'paused';

  return (
    <button
      onClick={onClick}
      className={`group text-left relative p-5 rounded-2xl border-2 transition-all ${
        featured
          ? 'border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 hover:border-orange-500 hover:shadow-lg'
          : isActive
          ? 'border-emerald-300 bg-white hover:border-emerald-500 hover:shadow-lg ring-1 ring-emerald-100'
          : isPaused
          ? 'border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {/* Status badge */}
      {isActive && (
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
          Active
        </span>
      )}
      {isPaused && (
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider">
          Paused
        </span>
      )}
      {isComingSoon && service.badge && (
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wider">
          {service.badge}
        </span>
      )}
      {isRequest && (
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wider">
          Request
        </span>
      )}

      <div className={`w-12 h-12 rounded-xl ${service.iconBg} flex items-center justify-center mb-4`}>
        <Icon size={20} className={service.iconColor} />
      </div>

      <h3 className="font-bold text-slate-900">{service.name}</h3>
      <p className="text-sm text-slate-600 mt-1 leading-snug">{service.description}</p>

      <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-slate-700 group-hover:text-orange-600 transition">
        {isActive && 'Order now'}
        {isComingSoon && 'Notify me'}
        {isRequest && 'Submit request'}
        {isPaused && 'Unavailable'}
        {!isPaused && <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />}
      </div>
    </button>
  );
}

// ============================================================
// View 2: Reddit Upvote Order Form
// ============================================================
function RedditUpvoteOrderForm({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const { createOrder, isCreating } = useRedditOrders();
  const pricing = useStraightPricing();

  const [threadUrl, setThreadUrl] = useState('');
  const [upvotes, setUpvotes] = useState(50);
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [newOrderInfo, setNewOrderInfo] = useState<{ id?: number; cost: number } | null>(null);

  // Upvotes work on any forum URL now. Reddit vs other-forum are priced
  // separately via the matrix; default to reddit before a URL is typed.
  const platform: 'reddit' | 'forum' = /reddit\.com/i.test(threadUrl) ? 'reddit' : (threadUrl.trim() ? 'forum' : 'reddit');
  const pricePerUpvote = straightPrice(pricing, `${platform}_upvote`, FALLBACK_UPVOTE_CENTS);
  const upvoteEnabled = straightEnabled(pricing, `${platform}_upvote`, true);
  const redditRate = straightPrice(pricing, 'reddit_upvote', FALLBACK_UPVOTE_CENTS);
  const forumRate = straightPrice(pricing, 'forum_upvote', FALLBACK_UPVOTE_CENTS);
  const cost = upvotes * pricePerUpvote;
  const hasEnoughCredit = balance >= cost;
  const isValidUrl = /^https?:\/\/[^\s.]+\.[^\s]+/i.test(threadUrl.trim());
  const subredditMatch = threadUrl.match(/reddit\.com\/r\/([^/]+)/);
  const subreddit = subredditMatch?.[1] || null;
  let targetHost = '';
  try { targetHost = new URL(threadUrl.trim()).hostname.replace(/^www\./, ''); } catch { targetHost = ''; }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!upvoteEnabled) {
      toast.error(`Upvotes for ${platform === 'reddit' ? 'Reddit' : 'this platform'} are paused right now.`);
      return;
    }
    if (!threadUrl.trim()) {
      toast.error('Please enter a page URL');
      return;
    }
    if (!isValidUrl) {
      toast.error('Enter a valid URL, like https://reddit.com/... or https://community.example.com/...');
      return;
    }
    if (!hasEnoughCredit) {
      toast.error('Insufficient credit. Top up to continue.');
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    createOrder(
      {
        threadUrl: threadUrl.trim(),
        subreddit,
        requestedUpvotes: upvotes,
        notes: notes.trim() || null,
      },
      {
        onSuccess: (order: { id?: number } | null) => {
          toast.success(`Order placed. ${formatUSD(cost)} deducted from credit.`);
          setShowConfirm(false);
          // Show whitelist/spam-folder education modal so order updates actually reach inbox.
          // Modal blocks navigation until dismissed (high-attention moment).
          setNewOrderInfo({ id: order?.id, cost });
          setShowSuccessModal(true);
        },
        onError: (err: Error) => {
          toast.error(err.message || 'Failed to create order');
          setShowConfirm(false);
        },
      }
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      {showSuccessModal && (
        <EmailWhitelistNotice
          variant="modal"
          headline="Order placed — now watch your inbox"
          context={newOrderInfo?.id ? `for order #${newOrderInfo.id}` : undefined}
          primaryLabel="Got it — show me my orders"
          onDismiss={() => {
            setShowSuccessModal(false);
            navigate(newOrderInfo?.id ? `/reddit/orders/${newOrderInfo.id}` : '/reddit/orders');
          }}
        />
      )}

      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4"
      >
        <ArrowLeft size={14} /> Choose different service
      </button>

      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <ArrowUp size={20} className="text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Upvotes</h1>
            <p className="text-sm text-slate-500">
              {redditRate === forumRate
                ? `${formatUSD(pricePerUpvote)} per upvote`
                : `Reddit ${formatUSD(redditRate)} · other forums ${formatUSD(forumRate)} per upvote`} · High retention guarantee
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Available credit</p>
          <p className="text-2xl font-bold mt-0.5">{formatUSD(balance)}</p>
        </div>
        <button
          onClick={() => navigate('/reddit/topup')}
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold flex items-center gap-2"
        >
          <Wallet size={14} />
          Top up
        </button>
      </div>

      {!upvoteEnabled && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
          <p><span className="font-semibold">{platform === 'reddit' ? 'Reddit' : 'Other-forum'} upvotes are paused right now.</span> This service is temporarily unavailable — please check back soon.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl ring-1 ring-slate-200 p-8 space-y-8">
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">1</span>
            Page URL <span className="text-slate-400 font-normal">(Reddit or any forum)</span>
          </label>
          <input
            type="url"
            value={threadUrl}
            onChange={(e) => setThreadUrl(e.target.value)}
            placeholder="https://reddit.com/r/... or https://community.example.com/..."
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-slate-900"
            required
          />
          {threadUrl && !isValidUrl && (
            <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
              <AlertCircle size={12} />
              Enter a valid URL (https://...)
            </p>
          )}
          {isValidUrl && (
            <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
              <Check size={12} />
              {subreddit ? `Target: r/${subreddit}` : targetHost ? `Target: ${targetHost}` : 'Valid URL'}
              {' · '}
              <span className="font-semibold">{platform === 'reddit' ? 'Reddit' : 'Other forum'} rate {formatUSD(pricePerUpvote)}/upvote</span>
            </p>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
            <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">2</span>
            Number of upvotes
          </label>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {PRESET_QUANTITIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setUpvotes(q)}
                className={`py-3 rounded-lg text-sm font-semibold border-2 transition ${
                  upvotes === q
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="1"
              max="1000"
              step="1"
              value={upvotes}
              onChange={(e) => setUpvotes(parseInt(e.target.value))}
              className="flex-1 accent-orange-500"
            />
            <input
              type="number"
              value={upvotes}
              onChange={(e) => setUpvotes(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
              min="1"
              max="10000"
              className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-center font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {formatUSD(pricePerUpvote)} per upvote · 1 to 10,000 per order
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center">3</span>
            Delivery notes <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="E.g. drip-feed over 6 hours, target specific window..."
            rows={3}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none text-slate-900"
          />
        </div>

        <div className="p-5 rounded-xl bg-slate-50 ring-1 ring-slate-200">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-600">Upvotes</span>
            <span className="text-slate-900 font-semibold">{upvotes.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-600">Price per upvote</span>
            <span className="text-slate-900 font-semibold">{formatUSD(pricePerUpvote)}</span>
          </div>
          <div className="flex justify-between pt-3 mt-3 border-t border-slate-200">
            <span className="text-slate-900 font-bold">Total</span>
            <span className="text-2xl font-bold text-orange-600">{formatUSD(cost)}</span>
          </div>
          {!hasEnoughCredit && (
            <div className="mt-3 p-3 rounded-lg bg-rose-50 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Insufficient credit</p>
                <p>You need {formatUSD(cost - balance)} more. <button type="button" onClick={() => navigate('/reddit/topup')} className="underline font-semibold">Top up now</button>.</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 rounded-lg bg-blue-50 ring-1 ring-blue-100 text-sm text-blue-900 flex items-start gap-2">
          <Info size={16} className="shrink-0 mt-0.5 text-blue-500" />
          <div>
            <p className="font-semibold">Credits deduct on confirmation, not delivery.</p>
            <p className="text-blue-700 text-xs mt-0.5">Cancelled orders are refunded automatically.</p>
          </div>
        </div>

        <button
          type="submit"
          disabled={!isValidUrl || !hasEnoughCredit || isCreating || !upvoteEnabled}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold transition shadow-lg shadow-orange-500/20"
        >
          {upvoteEnabled ? 'Review order' : 'Upvotes paused'}
          {upvoteEnabled && <ArrowRight size={18} />}
        </button>
      </form>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => !isCreating && setShowConfirm(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-6 pb-2 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Confirm order</h3>
              <button
                onClick={() => !isCreating && setShowConfirm(false)}
                className="p-1 rounded hover:bg-slate-100"
                disabled={isCreating}
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <p className="text-sm text-slate-600">
                Review your order. <span className="font-semibold text-slate-900">{formatUSD(cost)}</span> will be deducted from your credit balance on confirmation.
              </p>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 divide-y divide-slate-200">
                <div className="px-4 py-3">
                  <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Target URL</p>
                  <p className="text-sm text-slate-900 mt-1 break-all">{threadUrl}</p>
                </div>
                <div className="px-4 py-3 flex justify-between">
                  <span className="text-sm text-slate-600">Upvotes</span>
                  <span className="text-sm font-semibold text-slate-900">{upvotes.toLocaleString()}</span>
                </div>
                <div className="px-4 py-3 flex justify-between">
                  <span className="text-sm text-slate-600">Cost</span>
                  <span className="text-sm font-semibold text-slate-900">{formatUSD(cost)}</span>
                </div>
                <div className="px-4 py-3 flex justify-between bg-slate-100">
                  <span className="text-sm font-semibold text-slate-900">Balance after</span>
                  <span className="text-sm font-bold text-slate-900">{formatUSD(balance - cost)}</span>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={isCreating}
                  className="flex-1 px-4 py-3 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isCreating}
                  className="flex-1 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Placing...
                    </>
                  ) : (
                    <>
                      Confirm & deduct
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// View 2b: Forum Comment Order Form
// ============================================================
function ForumCommentOrderForm({
  onBack,
  prefillUrl,
  sourceKeyword,
  bulkTargets = [],
}: {
  onBack: () => void;
  prefillUrl?: string;
  sourceKeyword?: string;
  bulkTargets?: BulkForumTarget[];
}) {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const { createForumCommentOrder, createForumCommentOrderAsync, isCreatingForumCommentOrder } = useRedditOrders();
  const pricing = useStraightPricing();

  const [targetUrl, setTargetUrl] = useState(prefillUrl || bulkTargets[0]?.url || '');
  const [bulkQueue, setBulkQueue] = useState<BulkForumTarget[]>(() => bulkTargets);
  const [platform, setPlatform] = useState('');
  const [wantsSuggestion, setWantsSuggestion] = useState<boolean | null>(null);
  const [brandName, setBrandName] = useState('');
  const [brandDomain, setBrandDomain] = useState('');
  const [mentionMode, setMentionMode] = useState<'plain' | 'link'>('plain');
  const [notes, setNotes] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMeta, setGenerationMeta] = useState<{ fetchedContext?: boolean; reason?: string | null } | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [newOrderId, setNewOrderId] = useState<number | null>(null);
  const [bulkOrderIds, setBulkOrderIds] = useState<number[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [commentDrafts, setCommentDrafts] = useState<{ comment_text: string; targetUrl?: string }[]>([]);

  const isBulk = bulkQueue.length > 0;
  const detectedPlatform = useMemo(() => detectForumPlatform(targetUrl), [targetUrl]);
  // Price comes from the matrix: {reddit|forum}_comment_{plain|link}. Link price
  // applies only when an AI-suggested comment with a brand link is requested.
  const mode: 'plain' | 'link' = wantsSuggestion === true && mentionMode === 'link' ? 'link' : 'plain';
  // "Let AI write it" is a +10% premium over the base comment price; self-written
  // pays the base. Mirrors fn_create_forum_comment_order so display == charge.
  const AI_WRITE_MULTIPLIER = 1.1;
  const priceFor = (url: string) => {
    const base = straightPrice(
      pricing,
      `${straightPlatformKey(url)}_comment_${mode}`,
      mode === 'link' ? FALLBACK_COMMENT_LINK_CENTS : FALLBACK_COMMENT_PLAIN_CENTS
    );
    return wantsSuggestion === true ? Math.round(base * AI_WRITE_MULTIPLIER) : base;
  };
  const enabledFor = (url: string) =>
    straightEnabled(pricing, `${straightPlatformKey(url)}_comment_${mode}`, true);
  const unitCost = priceFor(targetUrl);
  const effectiveQuantity = isBulk ? 1 : Math.max(1, Math.min(quantity, 500));
  const cost = isBulk
    ? bulkQueue.reduce((sum, t) => sum + priceFor(t.url), 0)
    : unitCost * effectiveQuantity;
  const commentEnabled = isBulk ? bulkQueue.every((t) => enabledFor(t.url)) : enabledFor(targetUrl);
  // Base (plain) price for the representative target — shown on the choice cards.
  const repUrl = isBulk ? (bulkQueue[0]?.url || '') : targetUrl;
  const cardBasePrice = straightPrice(pricing, `${straightPlatformKey(repUrl)}_comment_plain`, FALLBACK_COMMENT_PLAIN_CENTS);
  const cardLinkPrice = straightPrice(pricing, `${straightPlatformKey(repUrl)}_comment_link`, FALLBACK_COMMENT_LINK_CENTS);
  const hasEnoughCredit = balance >= cost;
  const isValidUrl = isBulk || /^https?:\/\/[^\s.]+\.[^\s]+/i.test(targetUrl.trim());
  const needsBrand = wantsSuggestion === true;

  const ANGLE_PROMPTS = [
    'Write from a personal experience or practical example angle.',
    'Write as a thoughtful follow-up question that naturally leads to the brand mention.',
    'Agree with the thread and add one concise extra tip or insight.',
    'Gently correct a common misconception related to the topic, then mention the brand.',
    'Briefly compare two approaches or tools, then recommend the brand.',
  ];

  const generateAllDrafts = async () => {
    if (!brandName.trim() && !brandDomain.trim()) {
      toast.error('Add the brand or domain first');
      return;
    }

    // Bulk flow: one unique draft per selected URL.
    if (isBulk) {
      if (bulkQueue.length === 0) {
        toast.error('No URLs in the bulk queue');
        return;
      }
      setIsGenerating(true);
      setCommentDrafts([]);
      try {
        const drafts: { comment_text: string; targetUrl: string }[] = [];
        for (let i = 0; i < bulkQueue.length; i++) {
          const target = bulkQueue[i];
          const angle = ANGLE_PROMPTS[i % ANGLE_PROMPTS.length];
          const result = await generateForumComment({
            targetUrl: target.url.trim(),
            platform: target.platform || detectForumPlatform(target.url) || 'forum',
            brandName: brandName.trim() || null,
            brandDomain: brandDomain.trim() || null,
            mentionMode,
            extraInstructions: [notes.trim(), angle, `Comment text brief: ${commentText.trim() || 'natural, helpful reply'}`].filter(Boolean).join('\n') || null,
          });
          drafts.push({ comment_text: result.comment, targetUrl: target.url });
        }
        setCommentDrafts(drafts);
        setCommentText(drafts.map((d) => `• ${d.targetUrl}\n${d.comment_text}`).join('\n\n'));
        setGenerationMeta({ fetchedContext: true, reason: null });
        toast.success(`${drafts.length} unique drafts ready`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Draft assistant failed';
        toast.error(msg.toLowerCase().includes('api_key not configured')
          ? 'Draft assistant is not configured yet. Contact support before placing a suggested-comment order.'
          : msg);
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    // Single URL flow.
    if (!targetUrl.trim()) {
      toast.error('Add the forum URL first');
      return;
    }

    setIsGenerating(true);
    setCommentDrafts([]);
    try {
      const count = effectiveQuantity;
      const drafts: { comment_text: string }[] = [];
      for (let i = 0; i < count; i++) {
        const angle = count > 1 ? ANGLE_PROMPTS[i % ANGLE_PROMPTS.length] : notes.trim() || null;
        const result = await generateForumComment({
          targetUrl: targetUrl.trim(),
          platform: platform || detectedPlatform || 'forum',
          brandName: brandName.trim() || null,
          brandDomain: brandDomain.trim() || null,
          mentionMode,
          extraInstructions: angle,
        });
        drafts.push({ comment_text: result.comment });
      }
      setCommentDrafts(drafts);
      setCommentText(drafts.map((d) => d.comment_text).join('\n\n---\n\n'));
      setGenerationMeta({ fetchedContext: true, reason: null });
      toast.success(count > 1 ? `${count} unique drafts ready` : 'Draft is ready to review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Draft assistant failed';
      toast.error(msg.toLowerCase().includes('api_key not configured')
        ? 'Draft assistant is not configured yet. Contact support before placing a suggested-comment order.'
        : msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSuggestionChoice = (choice: boolean) => {
    setWantsSuggestion(choice);
    setCommentDrafts([]);
    setCommentText('');
    setGenerationMeta(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentEnabled) {
      toast.error('Comment placement is paused right now.');
      return;
    }
    if (!isValidUrl) {
      toast.error('Enter a valid URL, like https://reddit.com/... or https://community.hubspot.com/...');
      return;
    }
    if (needsBrand && !brandName.trim() && !brandDomain.trim()) {
      toast.error('Add the brand or domain for the suggested comment');
      return;
    }
    if (commentText.trim().length < 20) {
      toast.error('Comment must be at least 20 characters');
      return;
    }
    if (!hasEnoughCredit) {
      toast.error('Insufficient credit. Top up to continue.');
      return;
    }

    if (isBulk) {
      setBulkSubmitting(true);
      Promise.all(bulkQueue.map((target) => {
        const draft = commentDrafts.find((d) => d.targetUrl === target.url);
        return createForumCommentOrderAsync({
          targetUrl: target.url,
          platform: target.platform || detectForumPlatform(target.url) || null,
          commentText: draft?.comment_text || commentText.trim(),
          useSuggestedComment: !!wantsSuggestion,
          brandName: brandName.trim() || null,
          brandDomain: brandDomain.trim() || null,
          brandMentionMode: wantsSuggestion ? mentionMode : null,
          sourceKeyword: target.keyword || sourceKeyword || null,
          notes: [
            notes.trim(),
            `bulk_source=ranking_forum`,
            `bulk_target_title=${target.title}`,
            wantsSuggestion ? 'bulk_suggested=unique_per_thread_draft' : '',
          ].filter(Boolean).join('\n') || null,
          commentDrafts: draft ? [{ comment_text: draft.comment_text }] : undefined,
        });
      })).then((orders) => {
        const ids = orders.map((order: { id?: number } | null) => order?.id).filter(Boolean) as number[];
        setBulkOrderIds(ids);
        window.localStorage.removeItem(BULK_COMMENT_DRAFT_KEY);
        toast.success(`${bulkQueue.length} comment orders placed. ${formatUSD(cost)} deducted from credit.`);
        setShowSuccessModal(true);
      }).catch((err: Error) => {
        toast.error(err.message || 'Failed to create bulk comment orders');
      }).finally(() => setBulkSubmitting(false));
      return;
    }

    createForumCommentOrder(
      {
        targetUrl: targetUrl.trim(),
        platform: platform.trim() || detectedPlatform || null,
        commentText: commentText.trim(),
        useSuggestedComment: !!wantsSuggestion,
        brandName: brandName.trim() || null,
        brandDomain: brandDomain.trim() || null,
        brandMentionMode: wantsSuggestion ? mentionMode : null,
        sourceKeyword: sourceKeyword || null,
        notes: [
          notes.trim(),
          generationMeta ? `draft_context_fetched=${generationMeta.fetchedContext ? 'yes' : 'no'}` : '',
        ].filter(Boolean).join('\n') || null,
        quantity: effectiveQuantity,
        commentDrafts: wantsSuggestion
          ? (commentDrafts.length === effectiveQuantity ? commentDrafts : undefined)
          : Array.from({ length: effectiveQuantity }, () => ({ comment_text: commentText.trim() })),
      },
      {
        onSuccess: (order: { id?: number } | null) => {
          toast.success(`Comment order placed. ${formatUSD(cost)} deducted from credit.`);
          setNewOrderId(order?.id || null);
          setShowSuccessModal(true);
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to create comment order'),
      }
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      {showSuccessModal && (
        <EmailWhitelistNotice
          variant="modal"
          headline={isBulk ? 'Bulk comment orders placed' : 'Comment order placed'}
          context={isBulk ? `${bulkOrderIds.length || bulkQueue.length} orders created` : newOrderId ? `for order #${newOrderId}` : undefined}
          primaryLabel="Got it - show me my orders"
          onDismiss={() => {
            setShowSuccessModal(false);
            navigate(!isBulk && newOrderId ? `/reddit/orders/${newOrderId}` : '/reddit/orders');
          }}
        />
      )}

      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4"
      >
        <ArrowLeft size={14} /> Choose different service
      </button>

      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <MessageSquare size={20} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Forum Comments</h1>
              <p className="text-sm text-slate-500">
                Reddit, Quora, HubSpot Community, niche forums, and other public threads
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/reddit/ranking-forum')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
          >
            <Search size={15} />
            Find ranking forum pages
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 p-4 rounded-xl bg-slate-900 text-white">
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Available credit</p>
          <p className="text-2xl font-bold mt-0.5">{formatUSD(balance)}</p>
        </div>
        <button
          onClick={() => navigate('/reddit/topup')}
          className="px-4 py-3 rounded-xl bg-white ring-1 ring-slate-200 hover:ring-orange-300 text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Wallet size={15} />
          Top up
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8 space-y-7">
        {sourceKeyword && (
          <div className="p-3 rounded-lg bg-blue-50 ring-1 ring-blue-100 text-sm text-blue-900">
            Started from Ranking Forum Page keyword: <strong>{sourceKeyword}</strong>
          </div>
        )}

        {isBulk && (
          <div className="p-4 rounded-xl bg-orange-50 ring-1 ring-orange-100">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-bold text-slate-900">Bulk queue from Ranking Forum</p>
                <p className="text-sm text-slate-600">{bulkQueue.length} forum URLs selected. One comment order will be created per URL.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/reddit/ranking-forum')}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white ring-1 ring-orange-200 text-sm font-semibold text-orange-700"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-auto pr-1">
              {bulkQueue.map((target) => (
                <div key={target.url} className="rounded-lg bg-white ring-1 ring-orange-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900">{target.title}</p>
                      <p className="text-xs text-slate-500 mt-1 break-all">{target.url}</p>
                      <p className="text-xs text-orange-700 font-semibold mt-1">{target.keyword}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBulkQueue((current) => current.filter((item) => item.url !== target.url))}
                      className="p-2 rounded-lg hover:bg-orange-50 text-slate-500"
                      aria-label="Remove URL"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isBulk && (
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</span>
            Forum or discussion URL
          </label>
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://community.hubspot.com/... or https://reddit.com/r/..."
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-slate-900"
            required
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {isValidUrl && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check size={12} />
                URL accepted
              </span>
            )}
            {(platform || detectedPlatform) && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                {platform || detectedPlatform}
              </span>
            )}
          </div>
        </div>
        )}

        {!isBulk && (
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-2">
            Platform label <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="HubSpot Community, Reddit, Quora, niche forum..."
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-slate-900"
          />
        </div>
        )}

        {!isBulk && (
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">Q</span>
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={500}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                className="w-28 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-slate-900"
              />
              <span className="text-sm text-slate-500">{effectiveQuantity} comment{quantity !== 1 ? 's' : ''} will be placed on this thread.</span>
            </div>
            {!wantsSuggestion && quantity > 1 && (
              <p className="mt-2 text-xs text-amber-700">
                Self-written bulk comments will use the same text. Armies are instructed to adapt the wording naturally.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">2</span>
            Want us to suggest the comment?
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleSuggestionChoice(true)}
              className={`text-left p-5 rounded-xl border-2 transition ${
                wantsSuggestion === true ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={17} className="text-orange-600" />
                <span className="font-bold text-slate-900">Let AI write it</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {isBulk
                  ? 'AI draft included. Our editorial assistant writes a unique comment for every selected thread — adapted to each conversation, with one natural brand mention. Give us a short brief below.'
                  : quantity > 1
                  ? `AI drafts included. Our editorial assistant writes ${effectiveQuantity} unique replies for this thread — each from a different angle, with one natural brand mention. You review, edit, and approve before ordering.`
                  : "AI draft included. Our editorial assistant reviews the public conversation, adapts to the thread's tone, and drafts a useful reply with one natural brand mention. You review, edit, and approve before ordering."}
              </p>
              <p className="mt-3 text-sm font-bold text-orange-700">
                {formatUSD(Math.round(cardBasePrice * AI_WRITE_MULTIPLIER))}{cardLinkPrice !== cardBasePrice ? ` · ${formatUSD(Math.round(cardLinkPrice * AI_WRITE_MULTIPLIER))} with link` : ''}{isBulk ? ' / comment' : ''}
              </p>
              <p className="text-[11px] text-orange-600/80 mt-0.5">+10% — AI writes it, you approve</p>
            </button>
            <button
              type="button"
              onClick={() => handleSuggestionChoice(false)}
              className={`text-left p-5 rounded-xl border-2 transition ${
                wantsSuggestion === false ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Edit3 size={17} className="text-slate-700" />
                <span className="font-bold text-slate-900">I&rsquo;ll write it myself</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {isBulk
                  ? 'Paste one comment or instruction and we place it on every selected thread.'
                  : 'Paste your own final comment. We only place it on the target thread.'}
              </p>
              <p className="mt-3 text-sm font-bold text-slate-900">
                {formatUSD(cardBasePrice)}{isBulk ? ' / comment' : ''}
              </p>
            </button>
          </div>
        </div>

        {wantsSuggestion === true && (
          <div className="space-y-5 rounded-xl bg-orange-50/50 ring-1 ring-orange-100 p-5">
            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">Brand or domain</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Brand name, e.g. Jetdigitalpro"
                  className="w-full px-4 py-3 border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                />
                <input
                  type="text"
                  value={brandDomain}
                  onChange={(e) => setBrandDomain(e.target.value)}
                  placeholder="Domain, e.g. jetdigitalpro.com"
                  className="w-full px-4 py-3 border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">Mention style</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMentionMode('plain')}
                  className={`py-3 rounded-lg text-sm font-semibold border-2 transition ${
                    mentionMode === 'plain' ? 'border-orange-500 bg-white text-orange-700' : 'border-orange-100 bg-white/70 text-slate-700'
                  }`}
                >
                  Plain text mention
                </button>
                <button
                  type="button"
                  onClick={() => setMentionMode('link')}
                  className={`py-3 rounded-lg text-sm font-semibold border-2 transition inline-flex items-center justify-center gap-2 ${
                    mentionMode === 'link' ? 'border-orange-500 bg-white text-orange-700' : 'border-orange-100 bg-white/70 text-slate-700'
                  }`}
                >
                  <LinkIcon size={14} />
                  Include link
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={generateAllDrafts}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
              {isGenerating
                ? (isBulk ? `Preparing ${bulkQueue.length} drafts...` : `Preparing ${effectiveQuantity} draft${effectiveQuantity !== 1 ? 's' : ''}...`)
                : (commentDrafts.length > 0 ? 'Regenerate all drafts' : 'Create suggested comments')}
            </button>
            {generationMeta && (
              <p className="text-xs text-orange-900">
                {isBulk
                  ? `${commentDrafts.length} unique thread-aware drafts ready. Review the combined preview below before checkout.`
                  : `${commentDrafts.length} unique draft${commentDrafts.length !== 1 ? 's' : ''} prepared. Review before checkout.`}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">3</span>
            {isBulk && wantsSuggestion
              ? 'Brief for every draft'
              : isBulk
              ? 'Comment / instruction for all selected URLs'
              : wantsSuggestion && quantity > 1
              ? `${effectiveQuantity} generated drafts`
              : 'Final comment'}
          </label>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={
              isBulk && wantsSuggestion
                ? 'Describe what each comment should say — the angle, the key point, the tone. We turn this into a unique draft per thread...'
                : isBulk
                ? 'Paste the exact comment or shared instruction to apply to all selected forum URLs...'
                : wantsSuggestion
                ? 'Generate suggestions, then edit them before ordering...'
                : 'Paste the exact comment you want us to place...'
            }
            rows={wantsSuggestion && (quantity > 1 || isBulk) ? 12 : 7}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-y text-slate-900"
            required
          />
          <p className="mt-2 text-xs text-slate-500">
            {isBulk && wantsSuggestion
              ? `We turn this brief into a unique, thread-aware comment for each of the ${bulkQueue.length} selected pages. Min 20 characters.`
              : isBulk
              ? 'This same comment/instruction will be attached to every URL in the bulk queue.'
              : wantsSuggestion && quantity > 1
              ? 'Each section is one unique draft assigned to a different army member. You can edit them before checkout.'
              : 'You can edit the comment before checkout. Regenerating replaces this text.'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-2">
            Extra instructions <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Tone, angle, things to avoid, account preference, delivery timing..."
            rows={3}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none text-slate-900"
          />
        </div>

        {!commentEnabled && (
          <div className="p-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <p><span className="font-semibold">Comment placement is paused right now.</span> {mode === 'link' ? 'Comments with a link' : 'Plain comments'} for this platform are temporarily unavailable.</p>
          </div>
        )}

        <div className="p-5 rounded-xl bg-slate-50 ring-1 ring-slate-200">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-600">Comment placement{mode === 'link' ? ' · with link' : ' · plain text'}</span>
            <span className="text-slate-900 font-semibold">
              {isBulk
                ? `${bulkQueue.length} pages`
                : `${effectiveQuantity} × ${formatUSD(unitCost)}`}
            </span>
          </div>
          {wantsSuggestion && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-600">AI write</span>
              <span className="text-emerald-700 font-semibold">+10% (in price)</span>
            </div>
          )}
          <div className="flex justify-between pt-3 mt-3 border-t border-slate-200">
            <span className="text-slate-900 font-bold">Total</span>
            <span className="text-2xl font-bold text-orange-600">{formatUSD(cost)}</span>
          </div>
          {!hasEnoughCredit && (
            <div className="mt-3 p-3 rounded-lg bg-rose-50 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>You need {formatUSD(cost - balance)} more. <button type="button" onClick={() => navigate('/reddit/topup')} className="underline font-semibold">Top up now</button>.</p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!isValidUrl || wantsSuggestion === null || !hasEnoughCredit || isCreatingForumCommentOrder || bulkSubmitting || !commentEnabled}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold transition shadow-lg shadow-orange-500/20"
        >
          {isCreatingForumCommentOrder || bulkSubmitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {isBulk ? 'Placing bulk orders...' : 'Placing order...'}
            </>
          ) : (
            <>
              {isBulk ? `Place ${bulkQueue.length} comment orders` : 'Place comment order'}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}

function detectForumPlatform(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('reddit.com')) return 'Reddit';
    if (host.includes('quora.com')) return 'Quora';
    if (host.includes('hubspot.com')) return 'HubSpot Community';
    if (host.includes('blackhatworld.com')) return 'BlackHatWorld';
    return host.split('.')[0]?.replace(/-/g, ' ') || '';
  } catch {
    return '';
  }
}

// ============================================================
// View 3: Coming Soon Notify Form
// ============================================================
function ComingSoonForm({ service, onBack }: { service: Service; onBack: () => void }) {
  const [estimatedVolume, setEstimatedVolume] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'normal' | 'high'>('normal');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await submitFeatureRequest({
        category: 'service',
        platform: service.platform,
        serviceType: service.name,
        description: description.trim() || `Interested in ${service.platform} ${service.name}`,
        estimatedVolume: estimatedVolume ? parseInt(estimatedVolume) : undefined,
        urgency,
      });
      setSubmitted(true);
      toast.success("Got it. We'll email you when it ships.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = service.icon;

  if (submitted) {
    return (
      <div className="p-6 md:p-10 max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-6">
            <Check size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">You're on the list</h2>
          <p className="mt-2 text-slate-600">
            We've registered your interest in <strong>{service.platform} {service.name}</strong>. You'll get an email the moment it goes live.
          </p>
          <button
            onClick={onBack}
            className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold"
          >
            Browse services
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> Choose different service
      </button>

      <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
        <div className="px-8 pt-8 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-xl ${service.iconBg} flex items-center justify-center`}>
              <Icon size={20} className={service.iconColor} />
            </div>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wider">
              Coming {service.badge}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{service.platform} {service.name}</h1>
          <p className="text-slate-600 mt-1">{service.description}</p>
          <p className="text-sm text-slate-500 mt-3">
            Get on the early access list. Tell us your use case and we'll prioritize the build based on demand signal.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Estimated monthly volume <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="number"
              value={estimatedVolume}
              onChange={(e) => setEstimatedVolume(e.target.value)}
              placeholder="E.g. 500"
              min="1"
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
            <p className="text-xs text-slate-500 mt-1">Helps us prioritize high-demand requests</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">How soon do you need this?</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'low', label: 'Just curious' },
                { value: 'normal', label: 'Within months' },
                { value: 'high', label: 'ASAP' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setUrgency(opt.value as 'low' | 'normal' | 'high')}
                  className={`py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                    urgency === opt.value
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Use case <span className="text-slate-400 font-normal">(optional, but helps us build the right thing)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="E.g. We run campaigns in r/SaaS and need engaged comments to seed discussions..."
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold shadow-lg shadow-orange-500/20"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={14} />
                Get notified at launch
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// View 4: Custom Feature Request Form
// ============================================================
function FeatureRequestForm({ onBack }: { onBack: () => void }) {
  const [category, setCategory] = useState<'platform' | 'service' | 'integration' | 'feature'>('platform');
  const [platform, setPlatform] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedVolume, setEstimatedVolume] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'normal' | 'high'>('normal');
  const [contactMethod, setContactMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim() || description.trim().length < 20) {
      toast.error('Please describe your request in at least 20 characters');
      return;
    }

    setSubmitting(true);
    try {
      await submitFeatureRequest({
        category,
        platform: platform.trim() || undefined,
        description: description.trim(),
        estimatedVolume: estimatedVolume ? parseInt(estimatedVolume) : undefined,
        urgency,
        contactMethod: contactMethod.trim() || undefined,
      });
      setSubmitted(true);
      toast.success('Request submitted. We review every one.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="p-6 md:p-10 max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-6">
            <Sparkles size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Request received</h2>
          <p className="mt-2 text-slate-600">
            We review every request weekly. Popular ones get fast-tracked. We'll email you with progress.
          </p>
          <button
            onClick={onBack}
            className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold"
          >
            Browse services
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> Choose different service
      </button>

      <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
        <div className="px-8 pt-8 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Sparkles size={20} className="text-amber-600" />
            </div>
            <span className="px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs font-bold uppercase tracking-wider">
              Custom request
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Request a service</h1>
          <p className="text-slate-600 mt-1">
            Tell us what you need. Forums, Discord servers, custom integrations, scripts — anything.
          </p>
          <p className="text-sm text-slate-500 mt-3">
            We ship 1-2 new platforms per quarter, prioritized by request volume and customer profile.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">What kind of request?</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'platform', label: 'New platform' },
                { value: 'service', label: 'New service type' },
                { value: 'integration', label: 'API / Integration' },
                { value: 'feature', label: 'Product feature' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value as 'platform' | 'service' | 'integration' | 'feature')}
                  className={`py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                    category === opt.value
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Platform / Tool name <span className="text-slate-400 font-normal">(if relevant)</span>
            </label>
            <input
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="E.g. Discord, BlackHatWorld, Twitter X, Hacker News, Quora..."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Detailed description <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Be specific: what you want, how you'd use it, what's missing today. The more detail, the better we can scope it."
              rows={5}
              required
              minLength={20}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900"
            />
            <p className="text-xs text-slate-500 mt-1">{description.length} chars (minimum 20)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Volume estimate <span className="text-slate-400 font-normal">(monthly)</span>
              </label>
              <input
                type="number"
                value={estimatedVolume}
                onChange={(e) => setEstimatedVolume(e.target.value)}
                placeholder="E.g. 1000"
                min="1"
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Urgency</label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as 'low' | 'normal' | 'high')}
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 bg-white"
              >
                <option value="low">Low — exploratory</option>
                <option value="normal">Normal — within months</option>
                <option value="high">High — ASAP</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Best way to reach you <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={contactMethod}
              onChange={(e) => setContactMethod(e.target.value)}
              placeholder="Email, Telegram, Slack handle..."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
          </div>

          <div className="p-4 rounded-lg bg-amber-50 ring-1 ring-amber-100 text-sm text-amber-900 flex items-start gap-2">
            <Info size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <p>
              High-volume requests from verified customers get priority. We'll respond within 2 business days.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting || description.trim().length < 20}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold shadow-lg shadow-orange-500/20"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={14} />
                Submit request
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
