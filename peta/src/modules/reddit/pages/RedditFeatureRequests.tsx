import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Lightbulb,
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  Clock,
  PlayCircle,
  XCircle,
  Flame,
  Globe,
  Layers,
  Code2,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { RedditLayout } from '../components/RedditLayout';
import {
  submitFeatureRequest,
  getMyFeatureRequests,
} from '../lib/api';
import { supabase } from '../../../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; class: string; description: string }> = {
  platform: {
    label: 'New platform',
    icon: Globe,
    class: 'bg-blue-50 text-blue-700 ring-blue-200',
    description: 'Discord, Twitter, BlackHatWorld, Quora, Hacker News, etc.',
  },
  service: {
    label: 'New service',
    icon: Layers,
    class: 'bg-purple-50 text-purple-700 ring-purple-200',
    description: 'Comments, shares, threads, follows, etc.',
  },
  integration: {
    label: 'API / Integration',
    icon: Code2,
    class: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    description: 'Zapier, webhooks, REST API, etc.',
  },
  feature: {
    label: 'Product feature',
    icon: Sparkles,
    class: 'bg-amber-50 text-amber-700 ring-amber-200',
    description: 'Reporting, white-label, scheduling, etc.',
  },
};

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: any; tooltip: string }> = {
  open: {
    label: 'Submitted',
    class: 'bg-slate-100 text-slate-700',
    icon: Lightbulb,
    tooltip: 'Received. Will be reviewed soon.',
  },
  reviewing: {
    label: 'Reviewing',
    class: 'bg-amber-100 text-amber-800',
    icon: Clock,
    tooltip: 'Our team is evaluating this request.',
  },
  in_progress: {
    label: 'Building',
    class: 'bg-blue-100 text-blue-800',
    icon: PlayCircle,
    tooltip: 'Actively building this — coming soon.',
  },
  completed: {
    label: 'Shipped 🚀',
    class: 'bg-emerald-100 text-emerald-800',
    icon: CheckCircle2,
    tooltip: 'This feature is now live!',
  },
  declined: {
    label: 'Not planned',
    class: 'bg-slate-100 text-slate-600',
    icon: XCircle,
    tooltip: 'Not on our current roadmap.',
  },
};

export function RedditFeatureRequests() {
  const [params, setParams] = useSearchParams();
  const initialTab = (params.get('tab') as 'roadmap' | 'submit' | 'mine') || 'roadmap';
  const [tab, setTab] = useState<'roadmap' | 'submit' | 'mine'>(initialTab);

  const setTabAndUrl = (t: 'roadmap' | 'submit' | 'mine') => {
    setTab(t);
    params.set('tab', t);
    setParams(params, { replace: true });
  };

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        {/* Premium hero */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white mb-8">
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-orange-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl" />

          <div className="relative p-8 md:p-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm ring-1 ring-white/20 mb-5">
              <Sparkles size={12} className="text-orange-400" />
              <span className="text-xs font-semibold uppercase tracking-widest">Public Roadmap</span>
            </div>

            <h1 className="text-3xl md:text-5xl font-bold tracking-tight max-w-3xl">
              Help shape what we build next
            </h1>
            <p className="mt-4 text-lg text-slate-300 max-w-2xl">
              We ship 1-2 new platforms per quarter, prioritized by demand from operators like you.
              Tell us what's missing — popular requests get fast-tracked.
            </p>

            <button
              onClick={() => setTabAndUrl('submit')}
              className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold shadow-xl shadow-orange-500/30 transition"
            >
              <Sparkles size={16} />
              Request a feature
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-1 mb-6 inline-flex gap-1">
          {[
            { key: 'roadmap', label: 'Roadmap', icon: TrendingUp },
            { key: 'mine', label: 'My requests', icon: Lightbulb },
            { key: 'submit', label: 'Submit new', icon: Send },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTabAndUrl(t.key as any)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                  tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'roadmap' && <RoadmapTab />}
        {tab === 'mine' && <MyRequestsTab />}
        {tab === 'submit' && <SubmitTab onSubmitted={() => setTabAndUrl('mine')} />}
      </div>
    </RedditLayout>
  );
}

// ============================================================
// Tab 1: Roadmap (aggregated public view)
// ============================================================
function RoadmapTab() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data } = await supabase
        .from('feature_requests')
        .select('id, status, platform, category, urgency, description, estimated_volume, created_at')
        .in('status', ['open', 'reviewing', 'in_progress', 'completed'])
        .order('created_at', { ascending: false });
      setRequests(data || []);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh({ table: 'feature_requests' }, load);

  if (loading) {
    return <div className="text-center text-slate-500 py-12">Loading roadmap...</div>;
  }

  const grouped = {
    in_progress: requests.filter((r) => r.status === 'in_progress'),
    reviewing: requests.filter((r) => r.status === 'reviewing'),
    open: requests.filter((r) => r.status === 'open'),
    completed: requests.filter((r) => r.status === 'completed').slice(0, 5),
  };

  // Aggregate by platform for "top demand"
  const platformDemand = requests
    .filter((r) => r.platform && r.status !== 'completed')
    .reduce((acc: Record<string, { count: number; volume: number }>, r) => {
      const key = r.platform.toLowerCase();
      if (!acc[key]) acc[key] = { count: 0, volume: 0 };
      acc[key].count += 1;
      acc[key].volume += r.estimated_volume || 0;
      return acc;
    }, {});
  const topDemand = Object.entries(platformDemand)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6);

  return (
    <div className="space-y-8">
      {/* Top demand */}
      {topDemand.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Flame size={14} className="text-orange-500" />
            Most requested
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {topDemand.map(([platform, info], idx) => (
              <div key={platform} className="p-4 rounded-xl bg-white ring-1 ring-slate-200 hover:ring-orange-300 transition">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-orange-600">#{idx + 1}</span>
                  <span className="text-sm font-bold capitalize text-slate-900 truncate">{platform}</span>
                </div>
                <p className="text-xs text-slate-500">{info.count} request{info.count > 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* In progress */}
      {grouped.in_progress.length > 0 && (
        <RoadmapColumn title="Building now" icon={PlayCircle} colorClass="text-blue-600" requests={grouped.in_progress} />
      )}
      {/* Reviewing */}
      {grouped.reviewing.length > 0 && (
        <RoadmapColumn title="Under review" icon={Clock} colorClass="text-amber-600" requests={grouped.reviewing} />
      )}
      {/* Open */}
      {grouped.open.length > 0 && (
        <RoadmapColumn title="Backlog" icon={Lightbulb} colorClass="text-slate-600" requests={grouped.open} />
      )}
      {/* Recently shipped */}
      {grouped.completed.length > 0 && (
        <RoadmapColumn title="Recently shipped" icon={CheckCircle2} colorClass="text-emerald-600" requests={grouped.completed} />
      )}

      {requests.length === 0 && (
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-12 text-center">
          <Lightbulb size={28} className="mx-auto text-slate-300 mb-3" />
          <p className="font-semibold text-slate-900">Roadmap is empty</p>
          <p className="text-sm text-slate-500 mt-1">Be the first to submit a request</p>
        </div>
      )}
    </div>
  );
}

function RoadmapColumn({ title, icon: Icon, colorClass, requests }: { title: string; icon: any; colorClass: string; requests: any[] }) {
  return (
    <section>
      <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Icon size={14} className={colorClass} />
        {title} <span className="text-slate-400 font-normal">({requests.length})</span>
      </h2>
      <div className="space-y-2">
        {requests.map((r) => {
          const cat = CATEGORY_CONFIG[r.category] || CATEGORY_CONFIG.feature;
          const status = STATUS_CONFIG[r.status] || STATUS_CONFIG.open;
          const CatIcon = cat.icon;
          return (
            <div key={r.id} className="p-4 rounded-xl bg-white ring-1 ring-slate-200 hover:shadow-sm transition">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg ${cat.class} flex items-center justify-center shrink-0`}>
                  <CatIcon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {r.platform && (
                      <span className="text-sm font-bold text-slate-900 capitalize">{r.platform}</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${status.class} ring-current/20`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-2">{r.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================
// Tab 2: My requests
// ============================================================
function MyRequestsTab() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getMyFeatureRequests();
      setRequests(data);
    } catch {
      toast.error('Failed to load your requests');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh({ table: 'feature_requests' }, load);

  if (loading) return <p className="text-center text-slate-500 py-12">Loading...</p>;

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-12 text-center">
        <Lightbulb size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="font-semibold text-slate-900">No requests yet</p>
        <p className="text-sm text-slate-500 mt-1 mb-6">Submit your first feature or platform request</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => {
        const cat = CATEGORY_CONFIG[r.category] || CATEGORY_CONFIG.feature;
        const status = STATUS_CONFIG[r.status] || STATUS_CONFIG.open;
        const CatIcon = cat.icon;
        const StatusIcon = status.icon;
        return (
          <div key={r.id} className="p-5 rounded-2xl bg-white ring-1 ring-slate-200">
            <div className="flex items-start gap-4">
              <div className={`w-11 h-11 rounded-lg ${cat.class} flex items-center justify-center shrink-0`}>
                <CatIcon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cat.class}`}>
                    {cat.label}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.class}`}>
                    <StatusIcon size={10} />
                    {status.label}
                  </span>
                  {r.platform && (
                    <span className="text-xs text-slate-500">Platform: <strong className="text-slate-700">{r.platform}</strong></span>
                  )}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{r.description}</p>
                {r.admin_response && (
                  <div className="mt-3 p-3 rounded bg-blue-50 ring-1 ring-blue-100 text-sm text-blue-900">
                    <strong>Response from team:</strong> {r.admin_response}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-3">
                  Submitted {new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Tab 3: Submit new
// ============================================================
function SubmitTab({ onSubmitted }: { onSubmitted: () => void }) {
  const [category, setCategory] = useState<'platform' | 'service' | 'integration' | 'feature'>('platform');
  const [platform, setPlatform] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedVolume, setEstimatedVolume] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [contactMethod, setContactMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 20) {
      toast.error('Description must be at least 20 characters');
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
      toast.success('Request submitted. We review every one.');
      onSubmitted();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCat = CATEGORY_CONFIG[category];
  const CatIcon = selectedCat.icon;

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Submit a request</h2>
        <p className="text-sm text-slate-600 mt-1">
          We review every request. High-volume, well-described ones get prioritized fastest.
        </p>
      </div>

      {/* Category */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">What are you requesting?</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const selected = category === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key as any)}
                className={`text-left p-4 rounded-xl border-2 transition ${
                  selected ? 'border-orange-500 bg-orange-50/50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-9 h-9 rounded-lg ${cfg.class} flex items-center justify-center`}>
                    <Icon size={16} />
                  </div>
                  <strong className="text-sm text-slate-900">{cfg.label}</strong>
                </div>
                <p className="text-xs text-slate-600">{cfg.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Platform */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Platform / tool name <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          placeholder="E.g. Discord, BlackHatWorld, Twitter X, Hacker News, Quora..."
          className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
        />
      </div>

      {/* Description */}
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
        <p className="text-xs text-slate-500 mt-1">{description.length} chars (min 20)</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Monthly volume <span className="text-slate-400 font-normal">(boosts priority)</span>
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
            <option value="low">Just curious</option>
            <option value="normal">Within months</option>
            <option value="high">ASAP</option>
            <option value="urgent">🔥 Blocking my workflow</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Contact method <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={contactMethod}
          onChange={(e) => setContactMethod(e.target.value)}
          placeholder="Email, Telegram, Slack handle... so we can ask follow-up questions"
          className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
        />
      </div>

      <div className="p-4 rounded-lg bg-amber-50 ring-1 ring-amber-100 text-sm text-amber-900 flex items-start gap-2">
        <CatIcon size={16} className="shrink-0 mt-0.5 text-amber-600" />
        <p>High-volume requests from verified customers get priority. We respond within 2 business days.</p>
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
  );
}
