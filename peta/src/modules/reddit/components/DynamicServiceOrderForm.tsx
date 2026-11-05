import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Loader2,
  Wallet,
  Star,
  MapPin,
  MessageSquare,
  ArrowUp,
  Video as Youtube,
  Bookmark,
  ThumbsUp,
  Building,
  TrendingUp,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatUSD, createGenericServiceOrder, type StraightServiceRecord } from '../lib/api';

const ICON_MAP: Record<string, React.ElementType> = {
  Star,
  MapPin,
  MessageSquare,
  ArrowUp,
  Youtube,
  Bookmark,
  ThumbsUp,
  Building,
  TrendingUp,
  Layers,
};

function DripFeedSelector({
  value,
  onChange,
  quantity,
  platform: _platform = 'reviews',
  themeColor = 'indigo',
}: {
  value: number;
  onChange: (hours: number) => void;
  quantity: number;
  platform?: string;
  themeColor?: string;
}) {
  const options = [
    {
      hours: 0,
      title: '⚡ Instant / Simultaneous',
      desc: 'All slots open at once. Fastest turnaround.',
      badge: 'Fast',
    },
    {
      hours: 24,
      title: '🛡️ 1 every 24 hours',
      desc: 'Paced daily delivery. Safest against spam detection algorithms.',
      badge: 'Recommended',
    },
    {
      hours: 48,
      title: '🐢 1 every 48 hours',
      desc: 'Ultra-safe drip feed for new, low-activity, or sensitive profiles.',
      badge: 'Maximum Safety',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <Clock size={16} className={`text-${themeColor}-600`} />
            Delivery Pacing (Drip Feed)
          </label>
          <p className="text-xs text-slate-500 mt-0.5">
            Spread assignments across real human accounts over time to prevent anti-spam drop.
          </p>
        </div>
        {value > 0 && quantity > 1 && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-${themeColor}-50 text-${themeColor}-700 ring-1 ring-${themeColor}-200`}>
            ~{Math.round(((quantity - 1) * value) / 24)} days total duration
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {options.map((opt) => {
          const selected = value === opt.hours;
          return (
            <button
              key={opt.hours}
              type="button"
              onClick={() => onChange(opt.hours)}
              className={`p-3 rounded-xl border text-left transition-all relative ${
                selected
                  ? `border-${themeColor}-500 bg-${themeColor}-50/40 ring-2 ring-${themeColor}-500/20`
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-slate-900">{opt.title}</span>
                {opt.badge && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    opt.badge === 'Recommended'
                      ? 'bg-emerald-100 text-emerald-800'
                      : opt.badge === 'Fast'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-indigo-100 text-indigo-800'
                  }`}>
                    {opt.badge}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">{opt.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface DynamicServiceOrderFormProps {
  service: StraightServiceRecord;
  onBack: () => void;
  onSuccess: (orderId: number) => void;
  credits: number;
  onTopup: () => void;
}

export function DynamicServiceOrderForm({
  service,
  onBack,
  onSuccess,
  credits,
  onTopup,
}: DynamicServiceOrderFormProps) {
  const fc = service.form_config || {};
  const [targetUrl, setTargetUrl] = useState('');
  const [quantity, setQuantity] = useState(service.min_quantity || 1);
  const [location, setLocation] = useState('');
  const [reviewMode, setReviewMode] = useState<'brief' | 'custom'>('brief');
  const [brief, setBrief] = useState('');
  const [drafts, setDrafts] = useState<string[]>(Array(quantity).fill(''));
  const [clientNotes, setClientNotes] = useState('');
  const [dripHours, setDripHours] = useState(fc.default_drip_hours || 24);
  const [submitting, setSubmitting] = useState(false);

  const IconComponent = ICON_MAP[service.icon] || Star;
  const costCents = service.unit_price_cents * quantity;
  const hasEnoughCredits = credits >= costCents;

  const handleQuantityChange = (newQty: number) => {
    const clamped = Math.min(service.max_quantity || 100, Math.max(service.min_quantity || 1, newQty));
    setQuantity(clamped);
    setDrafts((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push('');
      return next.slice(0, clamped);
    });
  };

  const isUrlValid = () => {
    if (fc.requires_url === false) return true;
    if (!targetUrl.trim() || targetUrl.trim().length < 5) return false;
    if (service.url_pattern) {
      try {
        const regex = new RegExp(service.url_pattern, 'i');
        return regex.test(targetUrl.trim());
      } catch {
        return true;
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isUrlValid()) {
      toast.error(`Please enter a valid URL. Example: ${service.url_placeholder || 'https://...'}`);
      return;
    }

    if (fc.requires_location && !location.trim()) {
      toast.error('Location is required for this targeted service');
      return;
    }

    if (!hasEnoughCredits) {
      toast.error('Insufficient credits. Please top up your balance.');
      return;
    }

    if (reviewMode === 'custom' && fc.allows_custom_drafts) {
      const minLength = fc.min_draft_length || 10;
      for (let i = 0; i < quantity; i++) {
        const d = (drafts[i] || '').trim();
        if (d.length < minLength) {
          toast.error(`Draft #${i + 1} must be at least ${minLength} characters.`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const requestId = `gen-ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const order = await createGenericServiceOrder({
        serviceSlug: service.slug,
        targetUrl: targetUrl.trim(),
        quantity,
        location: location.trim() || null,
        notes: clientNotes.trim() || null,
        reviewMode: fc.allows_custom_drafts ? reviewMode : null,
        reviewBrief: brief.trim() || null,
        reviewDrafts: reviewMode === 'custom' && fc.allows_custom_drafts
          ? drafts.map((d) => ({ comment_text: d.trim() }))
          : null,
        dripIntervalHours: fc.allows_drip_feed ? dripHours : 0,
        requestId,
      });

      toast.success('Order placed successfully! Delivery will begin shortly.');
      onSuccess(order.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-6 font-medium"
      >
        <ArrowLeft size={16} /> All Services
      </button>

      {/* Header card */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8 mb-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
              <IconComponent size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-slate-900">{service.name}</h1>
                {service.badge_text && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    {service.badge_text}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 capitalize mt-0.5 font-medium">
                Platform: {service.platform} · Verified Delivery
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-slate-900">{formatUSD(service.unit_price_cents)}</span>
            <p className="text-xs text-slate-400 font-medium">per unit</p>
          </div>
        </div>

        {/* Platform Risk Notice */}
        <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold text-amber-950">Platform Risk Notice:</span> Tasks are performed by verified human accounts. Third-party platforms filter content at their discretion. Straight Ltd uses organic delivery pacing to maintain safety.
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* URL Input */}
        {fc.requires_url !== false && (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm">
            <label className="block text-sm font-bold text-slate-900 mb-1">
              {fc.url_label || 'Target URL'} <span className="text-rose-500">*</span>
            </label>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={service.url_placeholder || 'https://...'}
              className={`w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none focus:ring-2 ${
                targetUrl && !isUrlValid()
                  ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/30'
                  : 'border-slate-300 focus:ring-orange-500'
              }`}
              required
            />
            {service.url_placeholder && (
              <p className="text-xs text-slate-400 mt-1.5">
                Example: <code className="text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{service.url_placeholder}</code>
              </p>
            )}
          </div>
        )}

        {/* Location Target (if allowed) */}
        {fc.allows_location && (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm">
            <label className="block text-sm font-bold text-slate-900 mb-1 flex items-center gap-1.5">
              <MapPin size={16} className="text-amber-600" />
              Target Geographic Location
              {fc.requires_location && <span className="text-rose-500">*</span>}
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Austin, Texas or Greater London, UK"
              className="w-full px-4 py-2.5 rounded-xl text-sm border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500"
              required={fc.requires_location}
            />
          </div>
        )}

        {/* Quantity Selection */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="text-sm font-bold text-slate-900">Quantity</label>
              <p className="text-xs text-slate-500">
                Choose between {service.min_quantity || 1} and {service.max_quantity || 100} units
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleQuantityChange(quantity - 1)}
                className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-100"
              >
                -
              </button>
              <span className="w-10 text-center font-bold text-base text-slate-900">{quantity}</span>
              <button
                type="button"
                onClick={() => handleQuantityChange(quantity + 1)}
                className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-100"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Delivery Pacing (Drip Feed) */}
        {fc.allows_drip_feed && (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm">
            <DripFeedSelector
              value={dripHours}
              onChange={setDripHours}
              quantity={quantity}
              platform={service.platform}
              themeColor="indigo"
            />
          </div>
        )}

        {/* Content Mode (Brief vs Custom Drafts) */}
        {fc.allows_custom_drafts && (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-900">Content & Instructions</label>
              <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setReviewMode('brief')}
                  className={`px-3 py-1 rounded-md transition ${
                    reviewMode === 'brief' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Write Brief
                </button>
                <button
                  type="button"
                  onClick={() => setReviewMode('custom')}
                  className={`px-3 py-1 rounded-md transition ${
                    reviewMode === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Provide Custom Texts
                </button>
              </div>
            </div>

            {reviewMode === 'brief' ? (
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  Describe key points, customer experience, or product highlights. Our verified workers will craft unique, natural responses.
                </p>
                <textarea
                  rows={4}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="e.g. Highlight quick delivery, responsive customer service, and seamless installation..."
                  className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Provide exact text for each unit. Each unit must be unique.
                </p>
                {Array.from({ length: quantity }).map((_, idx) => (
                  <div key={idx}>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Text #{idx + 1}
                    </label>
                    <textarea
                      rows={2}
                      value={drafts[idx] || ''}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[idx] = e.target.value;
                        setDrafts(next);
                      }}
                      placeholder={`Draft comment/review for unit #${idx + 1}...`}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Client General Notes */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm">
          <label className="block text-sm font-bold text-slate-900 mb-1">
            Internal Note / Campaign Tag <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={clientNotes}
            onChange={(e) => setClientNotes(e.target.value)}
            placeholder="e.g. Q4 Brand Lift / Client #89"
            className="w-full px-4 py-2 text-sm border border-slate-300 rounded-xl"
          />
        </div>

        {/* Order Summary & Submit Bar */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">Total Investment:</span>
              <span className="text-2xl font-extrabold text-slate-900">{formatUSD(costCents)}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Current balance: <strong className={hasEnoughCredits ? 'text-slate-900' : 'text-rose-600'}>{formatUSD(credits)}</strong>
              {!hasEnoughCredits && ' (Insufficient credits)'}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {!hasEnoughCredits ? (
              <button
                type="button"
                onClick={onTopup}
                className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm inline-flex items-center gap-2 transition"
              >
                <Wallet size={16} /> Top up balance
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm inline-flex items-center gap-2 transition shadow-md"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Place Order Now
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
