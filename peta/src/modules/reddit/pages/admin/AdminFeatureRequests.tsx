import { useEffect, useState } from 'react';
import {
  Lightbulb,
  Globe,
  Layers,
  Code2,
  Sparkles,
  RefreshCw,
  Flame,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Search,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import { getAdminFeatureRequests } from '../../lib/api';
import { supabase } from '../../../../lib/supabase';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; class: string }> = {
  platform: { label: 'New platform', icon: Globe, class: 'bg-blue-100 text-blue-700' },
  service: { label: 'New service', icon: Layers, class: 'bg-purple-100 text-purple-700' },
  integration: { label: 'API / Integration', icon: Code2, class: 'bg-emerald-100 text-emerald-700' },
  feature: { label: 'Feature', icon: Sparkles, class: 'bg-amber-100 text-amber-700' },
  other: { label: 'Other', icon: Lightbulb, class: 'bg-slate-100 text-slate-700' },
};

const URGENCY_CONFIG: Record<string, { label: string; class: string }> = {
  low: { label: 'Low', class: 'bg-slate-100 text-slate-600' },
  normal: { label: 'Normal', class: 'bg-blue-50 text-blue-700' },
  high: { label: 'High', class: 'bg-orange-100 text-orange-700' },
  urgent: { label: '🔥 Urgent', class: 'bg-rose-100 text-rose-700' },
};

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: any }> = {
  open: { label: 'Open', class: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: Lightbulb },
  reviewing: { label: 'Reviewing', class: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock },
  in_progress: { label: 'In Progress', class: 'bg-blue-50 text-blue-700 ring-blue-200', icon: PlayCircle },
  completed: { label: 'Completed', class: 'bg-purple-50 text-purple-700 ring-purple-200', icon: CheckCircle2 },
  declined: { label: 'Declined', class: 'bg-rose-50 text-rose-700 ring-rose-200', icon: XCircle },
};

export function AdminFeatureRequests() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'reviewing' | 'in_progress' | 'completed' | 'declined'>('open');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [editingRequest, setEditingRequest] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getAdminFeatureRequests();
      setRequests(data);
    } catch {
      toast.error('Failed to load requests');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useRealtimeRefresh({ table: 'feature_requests' }, () => load());

  const filtered = requests.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const matches =
        r.description?.toLowerCase().includes(q) ||
        r.platform?.toLowerCase().includes(q) ||
        r.users?.email?.toLowerCase().includes(q) ||
        r.users?.full_name?.toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const stats = {
    total: requests.length,
    open: requests.filter((r) => r.status === 'open').length,
    in_progress: requests.filter((r) => r.status === 'in_progress').length,
    urgent: requests.filter((r) => r.urgency === 'urgent' || r.urgency === 'high').length,
    totalVolume: requests.reduce((sum, r) => sum + (r.estimated_volume || 0), 0),
  };

  // Group by platform for "top demand" widget
  const platformGroups = requests
    .filter((r) => r.platform && r.status !== 'declined' && r.status !== 'completed')
    .reduce((acc: Record<string, { count: number; volume: number; latest: string }>, r) => {
      const key = r.platform.toLowerCase();
      if (!acc[key]) acc[key] = { count: 0, volume: 0, latest: r.created_at };
      acc[key].count += 1;
      acc[key].volume += r.estimated_volume || 0;
      if (r.created_at > acc[key].latest) acc[key].latest = r.created_at;
      return acc;
    }, {});

  const topPlatforms = Object.entries(platformGroups)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Feature Requests' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Lightbulb size={22} className="text-amber-500" />
              <h1 className="text-3xl font-bold text-slate-900">Feature Requests</h1>
            </div>
            <p className="text-slate-600">What clients want next. Prioritize what to build.</p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Hero stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <HeroStat label="Open requests" value={stats.open.toString()} accent="amber" icon={Lightbulb} />
          <HeroStat label="In progress" value={stats.in_progress.toString()} accent="blue" icon={PlayCircle} />
          <HeroStat label="High priority" value={stats.urgent.toString()} accent="rose" icon={Flame} />
          <HeroStat label="Volume demand" value={stats.totalVolume > 1000 ? `${(stats.totalVolume / 1000).toFixed(1)}K/mo` : `${stats.totalVolume}/mo`} accent="emerald" icon={TrendingUp} />
        </div>

        {/* Top demand widget */}
        {topPlatforms.length > 0 && (
          <div className="mb-6 p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white">
            <div className="flex items-center gap-2 mb-4">
              <Flame size={18} className="text-orange-400" />
              <h3 className="font-bold">Top demand · weighted by request count</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {topPlatforms.map(([platform, info], idx) => (
                <div key={platform} className="p-3 rounded-lg bg-white/5 ring-1 ring-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-orange-400">#{idx + 1}</span>
                    <span className="text-sm font-bold capitalize truncate">{platform}</span>
                  </div>
                  <div className="text-xs text-slate-300">
                    {info.count} request{info.count > 1 ? 's' : ''}
                  </div>
                  {info.volume > 0 && (
                    <div className="text-xs text-emerald-400 mt-0.5">{info.volume.toLocaleString()}/mo demand</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-6 flex flex-col md:flex-row gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { key: 'open', label: 'Open' },
              { key: 'reviewing', label: 'Reviewing' },
              { key: 'in_progress', label: 'In Progress' },
              { key: 'completed', label: 'Completed' },
              { key: 'declined', label: 'Declined' },
              { key: 'all', label: 'All' },
            ].map((f) => {
              const count = f.key === 'all' ? requests.length : requests.filter((r) => r.status === f.key).length;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key as any)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                    filter === f.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f.label} <span className="ml-1 text-xs opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="md:ml-auto flex gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg ring-1 ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-slate-700"
            >
              <option value="all">All categories</option>
              {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 rounded-lg ring-1 ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Requests list */}
        {loading ? (
          <p className="text-center text-slate-500 py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-12 text-center">
            <Lightbulb size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="font-semibold text-slate-900">No requests match this filter</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <RequestCard key={r.id} request={r} onEdit={() => setEditingRequest(r)} />
            ))}
          </div>
        )}
      </div>

      {editingRequest && (
        <EditRequestModal
          request={editingRequest}
          onClose={() => setEditingRequest(null)}
          onSaved={() => {
            setEditingRequest(null);
            load();
          }}
        />
      )}
    </AdminLayout>
  );
}

function HeroStat({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent: 'amber' | 'blue' | 'rose' | 'emerald';
  icon: any;
}) {
  const colors = {
    amber: 'from-amber-500 to-amber-600',
    blue: 'from-blue-500 to-blue-600',
    rose: 'from-rose-500 to-rose-600',
    emerald: 'from-emerald-500 to-emerald-600',
  };
  return (
    <div className="p-5 rounded-2xl bg-white ring-1 ring-slate-200 relative overflow-hidden">
      <div className={`absolute -top-6 -right-6 w-20 h-20 rounded-full bg-gradient-to-br ${colors[accent]} opacity-10`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <Icon size={18} className={accent === 'amber' ? 'text-amber-500' : accent === 'blue' ? 'text-blue-500' : accent === 'rose' ? 'text-rose-500' : 'text-emerald-500'} />
        </div>
        <p className="text-3xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function RequestCard({ request, onEdit }: { request: any; onEdit: () => void }) {
  const category = CATEGORY_CONFIG[request.category] || CATEGORY_CONFIG.other;
  const urgency = URGENCY_CONFIG[request.urgency] || URGENCY_CONFIG.normal;
  const status = STATUS_CONFIG[request.status] || STATUS_CONFIG.open;
  const CatIcon = category.icon;
  const StatusIcon = status.icon;

  return (
    <button onClick={onEdit} className="w-full text-left bg-white rounded-2xl ring-1 ring-slate-200 hover:ring-slate-300 hover:shadow-md transition p-5 block">
      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:w-14 shrink-0">
          <div className={`w-12 h-12 rounded-xl ${category.class} flex items-center justify-center`}>
            <CatIcon size={20} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${category.class}`}>
              {category.label}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${urgency.class}`}>
              {urgency.label}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
              <StatusIcon size={10} />
              {status.label}
            </span>
            {request.platform && (
              <span className="text-xs font-semibold text-slate-700">
                · Platform: <span className="text-slate-900">{request.platform}</span>
              </span>
            )}
          </div>

          <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{request.description}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
            <span>
              <span className="font-medium text-slate-700">{request.users?.full_name || request.users?.email}</span>
            </span>
            {request.estimated_volume && (
              <span>
                📊 <span className="font-semibold text-slate-700">{request.estimated_volume.toLocaleString()}</span> monthly volume
              </span>
            )}
            {request.contact_method && (
              <span>📞 {request.contact_method}</span>
            )}
            <span>
              {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>

          {request.admin_response && (
            <div className="mt-3 p-2 rounded bg-blue-50 ring-1 ring-blue-100 text-xs text-blue-900">
              <strong>Response:</strong> {request.admin_response}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function EditRequestModal({
  request,
  onClose,
  onSaved,
}: {
  request: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(request.status);
  const [adminResponse, setAdminResponse] = useState(request.admin_response || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('feature_requests')
        .update({
          status,
          admin_response: adminResponse.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      if (error) throw error;
      toast.success('Request updated');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const category = CATEGORY_CONFIG[request.category] || CATEGORY_CONFIG.other;
  const CatIcon = category.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${category.class} flex items-center justify-center`}>
              <CatIcon size={18} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Feature Request #{request.id}</h3>
              <p className="text-xs text-slate-500">{request.users?.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-slate-100">×</button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Category</p>
              <p className="font-medium mt-1">{category.label}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Platform</p>
              <p className="font-medium mt-1">{request.platform || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Urgency</p>
              <p className="font-medium mt-1">{URGENCY_CONFIG[request.urgency]?.label}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Volume estimate</p>
              <p className="font-medium mt-1">
                {request.estimated_volume ? `${request.estimated_volume.toLocaleString()}/mo` : '—'}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Client description</p>
            <p className="text-sm text-slate-900 p-4 rounded-lg bg-slate-50 ring-1 ring-slate-200 leading-relaxed whitespace-pre-wrap">
              {request.description}
            </p>
          </div>

          {request.contact_method && (
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Best way to reach</p>
              <p className="text-sm text-slate-900">{request.contact_method}</p>
            </div>
          )}

          {/* Status update */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Update status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-slate-900 font-medium"
            >
              <option value="open">Open — not yet reviewed</option>
              <option value="reviewing">Reviewing — evaluating feasibility</option>
              <option value="in_progress">In Progress — actively building</option>
              <option value="completed">Completed — shipped</option>
              <option value="declined">Declined — won't build</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Internal response / notes</label>
            <textarea
              value={adminResponse}
              onChange={(e) => setAdminResponse(e.target.value)}
              rows={4}
              placeholder="Notes about this request, timeline, why declined, etc."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900"
            />
            <p className="text-xs text-slate-500 mt-1">Internal only — not shown to client (yet)</p>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
