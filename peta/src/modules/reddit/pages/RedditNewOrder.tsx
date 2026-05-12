import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
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
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { RedditLayout } from '../components/RedditLayout';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { calculateCost, formatUSD, getPricePerUpvoteUSD, submitFeatureRequest } from '../lib/api';

const PRESET_QUANTITIES = [25, 50, 100, 250, 500];

interface Service {
  id: string;
  platform: string;
  name: string;
  icon: any;
  description: string;
  status: 'active' | 'coming_soon' | 'request';
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
    description: 'High-retention upvotes from aged accounts',
    status: 'active',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    id: 'reddit-comment',
    platform: 'Reddit',
    name: 'Comments',
    icon: MessageSquare,
    description: 'Engaging comments with karma history',
    status: 'coming_soon',
    badge: 'Q3 2026',
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
    description: 'Forum, Twitter, Discord, custom integration?',
    status: 'request',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
];

type ViewMode = 'select' | 'reddit-upvote' | 'coming-soon' | 'feature-request';

export function RedditNewOrder() {
  const [view, setView] = useState<ViewMode>('select');
  const [activeService, setActiveService] = useState<Service | null>(null);

  const handleServiceClick = (service: Service) => {
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
      {view === 'select' && <ServiceSelector services={SERVICES} onSelect={handleServiceClick} />}
      {view === 'reddit-upvote' && <RedditUpvoteOrderForm onBack={handleBack} />}
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
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Other platforms</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

  return (
    <button
      onClick={onClick}
      className={`group text-left relative p-5 rounded-2xl border-2 transition-all ${
        featured
          ? 'border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 hover:border-orange-500 hover:shadow-lg'
          : isActive
          ? 'border-emerald-300 bg-white hover:border-emerald-500 hover:shadow-lg ring-1 ring-emerald-100'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {/* Status badge */}
      {isActive && (
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
          Active
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
        <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
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

  const [threadUrl, setThreadUrl] = useState('');
  const [upvotes, setUpvotes] = useState(50);
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const cost = calculateCost(upvotes);
  const hasEnoughCredit = balance >= cost;
  const isValidUrl = /^https?:\/\/(www\.)?reddit\.com\//.test(threadUrl.trim());
  const subredditMatch = threadUrl.match(/reddit\.com\/r\/([^/]+)/);
  const subreddit = subredditMatch?.[1] || null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!threadUrl.trim()) {
      toast.error('Please enter a Reddit URL');
      return;
    }
    if (!isValidUrl) {
      toast.error('URL must start with https://reddit.com/');
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
        onSuccess: () => {
          toast.success(`Order placed. ${formatUSD(cost)} deducted from credit.`);
          setShowConfirm(false);
          setTimeout(() => navigate('/reddit/orders'), 1200);
        },
        onError: (err: any) => {
          toast.error(err.message || 'Failed to create order');
          setShowConfirm(false);
        },
      }
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
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
            <h1 className="text-2xl font-bold text-slate-900">Reddit Upvotes</h1>
            <p className="text-sm text-slate-500">${getPricePerUpvoteUSD().toFixed(2)} per upvote · High retention guarantee</p>
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

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl ring-1 ring-slate-200 p-8 space-y-8">
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-2">
            <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">1</span>
            Reddit URL
          </label>
          <input
            type="url"
            value={threadUrl}
            onChange={(e) => setThreadUrl(e.target.value)}
            placeholder="https://reddit.com/r/example/comments/..."
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-slate-900"
            required
          />
          {threadUrl && !isValidUrl && (
            <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
              <AlertCircle size={12} />
              URL must start with https://reddit.com/
            </p>
          )}
          {isValidUrl && subreddit && (
            <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
              <Check size={12} />
              Target: r/{subreddit}
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
            ${getPricePerUpvoteUSD().toFixed(2)} per upvote · 1 to 10,000 per order
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
            <span className="text-slate-900 font-semibold">${getPricePerUpvoteUSD().toFixed(2)}</span>
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
          disabled={!isValidUrl || !hasEnoughCredit || isCreating}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold transition shadow-lg shadow-orange-500/20"
        >
          Review order
          <ArrowRight size={18} />
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
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
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
                  onClick={() => setUrgency(opt.value as any)}
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
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
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
                  onClick={() => setCategory(opt.value as any)}
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
                onChange={(e) => setUrgency(e.target.value as any)}
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
