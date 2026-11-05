import { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Loader2,
  Layers,
  Star,
  MapPin,
  MessageSquare,
  ArrowUp,
  Video as Youtube,
  Bookmark,
  ThumbsUp,
  Building,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import {
  getAdminAllStraightServices,
  adminUpsertStraightService,
  adminToggleStraightService,
  adminDeleteStraightService,
  formatUSD,
  type StraightServiceRecord,
} from '../../lib/api';

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

export function AdminServices() {
  const [services, setServices] = useState<StraightServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<StraightServiceRecord | null>(null);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [badgeText, setBadgeText] = useState('');
  const [platform, setPlatform] = useState('google');
  const [category, setCategory] = useState('review');
  const [taskType, setTaskType] = useState('comment');
  const [priceUSD, setPriceUSD] = useState('5.00');
  const [rewardIDR, setRewardIDR] = useState('5000');
  const [minQty, setMinQty] = useState('1');
  const [maxQty, setMaxQty] = useState('20');
  const [urlPattern, setUrlPattern] = useState('');
  const [urlPlaceholder, setUrlPlaceholder] = useState('');
  const [icon, setIcon] = useState('Star');
  const [themeColor, setThemeColor] = useState('emerald');
  const [enabled, setEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');

  // Form config flags
  const [requiresUrl, setRequiresUrl] = useState(true);
  const [urlLabel, setUrlLabel] = useState('Target URL');
  const [allowsBrief, setAllowsBrief] = useState(true);
  const [allowsCustomDrafts, setAllowsCustomDrafts] = useState(true);
  const [minDraftLength, setMinDraftLength] = useState('15');
  const [allowsLocation, setAllowsLocation] = useState(false);
  const [allowsDripFeed, setAllowsDripFeed] = useState(true);
  const [defaultDripHours, setDefaultDripHours] = useState('24');

  // SOP & Brief
  const [workerSOP, setWorkerSOP] = useState('');
  const [workerBriefTemplate, setWorkerBriefTemplate] = useState('');

  const loadServices = async () => {
    setLoading(true);
    try {
      const data = await getAdminAllStraightServices();
      setServices(data);
    } catch {
      toast.error('Failed to load services catalog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const openNewModal = () => {
    setEditingService(null);
    setName('');
    setSlug('');
    setBadgeText('');
    setPlatform('google');
    setCategory('review');
    setTaskType('comment');
    setPriceUSD('5.00');
    setRewardIDR('5000');
    setMinQty('1');
    setMaxQty('20');
    setUrlPattern('^https?://[^\s]+');
    setUrlPlaceholder('https://...');
    setIcon('Star');
    setThemeColor('emerald');
    setEnabled(true);
    setSortOrder('10');
    setRequiresUrl(true);
    setUrlLabel('Target URL');
    setAllowsBrief(true);
    setAllowsCustomDrafts(true);
    setMinDraftLength('15');
    setAllowsLocation(false);
    setAllowsDripFeed(true);
    setDefaultDripHours('24');
    setWorkerSOP('Buka link target, kerjakan tugas sesuai instruksi brief, upload screenshot bukti publik.');
    setWorkerBriefTemplate('Tulis ulasan bintang 5 yang natural dan relevan.');
    setModalOpen(true);
  };

  const openEditModal = (s: StraightServiceRecord) => {
    setEditingService(s);
    setName(s.name);
    setSlug(s.slug);
    setBadgeText(s.badge_text || '');
    setPlatform(s.platform);
    setCategory(s.category);
    setTaskType(s.task_type);
    setPriceUSD((s.unit_price_cents / 100).toFixed(2));
    setRewardIDR(String(s.worker_reward_idr));
    setMinQty(String(s.min_quantity));
    setMaxQty(String(s.max_quantity));
    setUrlPattern(s.url_pattern || '');
    setUrlPlaceholder(s.url_placeholder || '');
    setIcon(s.icon || 'Star');
    setThemeColor(s.theme_color || 'emerald');
    setEnabled(s.enabled);
    setSortOrder(String(s.sort_order));

    const fc = s.form_config || {};
    setRequiresUrl(fc.requires_url !== false);
    setUrlLabel(fc.url_label || 'Target URL');
    setAllowsBrief(fc.allows_brief !== false);
    setAllowsCustomDrafts(!!fc.allows_custom_drafts);
    setMinDraftLength(String(fc.min_draft_length || 15));
    setAllowsLocation(!!fc.allows_location);
    setAllowsDripFeed(!!fc.allows_drip_feed);
    setDefaultDripHours(String(fc.default_drip_hours || 24));

    setWorkerSOP(s.worker_sop || '');
    setWorkerBriefTemplate(s.worker_brief_template || '');
    setModalOpen(true);
  };

  const handleToggle = async (s: StraightServiceRecord) => {
    try {
      const updated = await adminToggleStraightService(s.slug, !s.enabled);
      setServices((prev) => prev.map((item) => (item.slug === s.slug ? updated : item)));
      toast.success(`${s.name} is now ${updated.enabled ? 'Active' : 'Paused'}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update toggle');
    }
  };

  const handleDelete = async (s: StraightServiceRecord) => {
    if (!confirm(`Are you sure you want to delete service "${s.name}"? This cannot be undone.`)) return;
    try {
      await adminDeleteStraightService(s.slug);
      setServices((prev) => prev.filter((item) => item.slug !== s.slug));
      toast.success(`Service "${s.name}" deleted.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete service');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }

    const priceCents = Math.round(parseFloat(priceUSD) * 100);
    const reward = parseInt(rewardIDR) || 0;
    if (isNaN(priceCents) || priceCents < 0) {
      toast.error('Invalid price USD');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        badge_text: badgeText.trim() || null,
        platform: platform.trim().toLowerCase(),
        category,
        task_type: taskType,
        unit_price_cents: priceCents,
        worker_reward_idr: reward,
        min_quantity: parseInt(minQty) || 1,
        max_quantity: parseInt(maxQty) || 100,
        url_pattern: urlPattern.trim() || null,
        url_placeholder: urlPlaceholder.trim() || null,
        form_config: {
          requires_url: requiresUrl,
          url_label: urlLabel.trim(),
          allows_brief: allowsBrief,
          allows_custom_drafts: allowsCustomDrafts,
          min_draft_length: parseInt(minDraftLength) || 10,
          allows_location: allowsLocation,
          allows_drip_feed: allowsDripFeed,
          default_drip_hours: parseInt(defaultDripHours) || 24,
        },
        worker_sop: workerSOP.trim(),
        worker_brief_template: workerBriefTemplate.trim() || null,
        icon,
        theme_color: themeColor,
        enabled,
        sort_order: parseInt(sortOrder) || 0,
      };

      const result = await adminUpsertStraightService(payload);
      toast.success(editingService ? `Updated "${result.name}"` : `Added "${result.name}" to catalog!`);
      setModalOpen(false);
      await loadServices();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  const platforms = ['all', ...Array.from(new Set(services.map((s) => s.platform)))];

  const filtered = services.filter((s) => {
    if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.platform.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Service Catalog' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2.5">
              <Layers className="text-orange-500" size={28} />
              Dynamic Service Catalog
            </h1>
            <p className="text-slate-600 text-sm mt-1">
              Add and configure services on the fly. Services added here instantly appear in Straight orders and PeTa Army tasks.
            </p>
          </div>
          <button
            onClick={openNewModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm transition shadow-sm self-start md:self-auto"
          >
            <Plus size={16} /> Add New Service
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-4 mb-6 flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto">
            {platforms.map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition ${
                  platformFilter === p ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search services..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Services Table */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-16 text-center text-slate-500">
              <Loader2 size={24} className="animate-spin mx-auto mb-2 text-orange-500" />
              Loading service catalog...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-slate-500">No services match your search</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-semibold text-slate-500">
                  <tr>
                    <th className="px-6 py-3.5">Service</th>
                    <th className="px-6 py-3.5">Platform</th>
                    <th className="px-6 py-3.5 text-right">Client Price</th>
                    <th className="px-6 py-3.5 text-right">Worker Payout</th>
                    <th className="px-6 py-3.5 text-center">Status</th>
                    <th className="px-6 py-3.5 text-center">Features</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filtered.map((s) => {
                    const IconComponent = ICON_MAP[s.icon] || Star;
                    const margin = s.unit_price_cents - Math.round(s.worker_reward_idr / 160);
                    const marginPct = s.unit_price_cents > 0 ? Math.round((margin / s.unit_price_cents) * 100) : 0;

                    return (
                      <tr key={s.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                              <IconComponent size={18} />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 flex items-center gap-2">
                                {s.name}
                                {s.badge_text && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                                    {s.badge_text}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-400 font-mono mt-0.5">slug: {s.slug}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 capitalize">
                            {s.platform}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-slate-900">
                          {formatUSD(s.unit_price_cents)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-semibold text-slate-700">Rp {s.worker_reward_idr.toLocaleString('id-ID')}</span>
                          <p className="text-[10px] text-emerald-600 font-medium">~{marginPct}% margin</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggle(s)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 transition ${
                              s.enabled
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                                : 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            {s.enabled ? 'Active' : 'Paused'}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                            {s.form_config?.allows_drip_feed && <span title="Drip Feed enabled" className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-medium">Drip</span>}
                            {s.form_config?.allows_custom_drafts && <span title="Custom Drafts enabled" className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-medium">Drafts</span>}
                            {s.form_config?.allows_location && <span title="Location targeting" className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">Geo</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(s)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              title="Edit service"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => handleDelete(s)}
                              className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                              title="Delete service"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Service Add/Edit Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !saving && setModalOpen(false)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
                <h3 className="text-lg font-bold text-slate-900">
                  {editingService ? `Edit Service: ${editingService.name}` : 'Create New Service'}
                </h3>
                <button
                  onClick={() => !saving && setModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* 1. General Identification */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">1. Service Info</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Service Display Name *</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (!editingService) {
                            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 35));
                          }
                        }}
                        placeholder="e.g. TripAdvisor Reviews"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Unique Slug (Key) * <span className="text-slate-400 font-normal">lowercase_underscore</span>
                      </label>
                      <input
                        type="text"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        placeholder="e.g. tripadvisor_review"
                        disabled={!!editingService}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 disabled:bg-slate-100 font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Platform *</label>
                      <input
                        type="text"
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value)}
                        placeholder="e.g. tripadvisor, appstore, reddit"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 capitalize"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Category & Task Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="review">Review</option>
                          <option value="comment">Comment</option>
                          <option value="upvote">Upvote</option>
                          <option value="social">Social</option>
                          <option value="video">Video</option>
                        </select>
                        <select
                          value={taskType}
                          onChange={(e) => setTaskType(e.target.value)}
                          className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="comment">Comment Task</option>
                          <option value="upvote">Upvote Task</option>
                          <option value="upload">Upload Task</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Badge Text (Optional)</label>
                      <input
                        type="text"
                        value={badgeText}
                        onChange={(e) => setBadgeText(e.target.value)}
                        placeholder="e.g. 5-Star Rating, Local SEO"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Icon & Color</label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={icon}
                          onChange={(e) => setIcon(e.target.value)}
                          className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          {Object.keys(ICON_MAP).map((ic) => (
                            <option key={ic} value={ic}>{ic}</option>
                          ))}
                        </select>
                        <select
                          value={themeColor}
                          onChange={(e) => setThemeColor(e.target.value)}
                          className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="emerald">Emerald</option>
                          <option value="indigo">Indigo</option>
                          <option value="red">Red</option>
                          <option value="orange">Orange</option>
                          <option value="blue">Blue</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Economics */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">2. Pricing & Quantities</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Client Price ($ USD) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={priceUSD}
                        onChange={(e) => setPriceUSD(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Worker Payout (Rp IDR) *</label>
                      <input
                        type="number"
                        step="500"
                        min="0"
                        value={rewardIDR}
                        onChange={(e) => setRewardIDR(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Min Order Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={minQty}
                        onChange={(e) => setMinQty(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Max Order Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={maxQty}
                        onChange={(e) => setMaxQty(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Form Configuration */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">3. Client Order Form Options</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">URL Validation Regex</label>
                      <input
                        type="text"
                        value={urlPattern}
                        onChange={(e) => setUrlPattern(e.target.value)}
                        placeholder="^https?://..."
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">URL Placeholder Example</label>
                      <input
                        type="text"
                        value={urlPlaceholder}
                        onChange={(e) => setUrlPlaceholder(e.target.value)}
                        placeholder="https://example.com/biz/..."
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowsBrief}
                        onChange={(e) => setAllowsBrief(e.target.checked)}
                        className="rounded text-orange-600 focus:ring-orange-500"
                      />
                      <span>Allow Brief</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowsCustomDrafts}
                        onChange={(e) => setAllowsCustomDrafts(e.target.checked)}
                        className="rounded text-orange-600 focus:ring-orange-500"
                      />
                      <span>Custom Drafts</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowsDripFeed}
                        onChange={(e) => setAllowsDripFeed(e.target.checked)}
                        className="rounded text-orange-600 focus:ring-orange-500"
                      />
                      <span>Drip Feed</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowsLocation}
                        onChange={(e) => setAllowsLocation(e.target.checked)}
                        className="rounded text-orange-600 focus:ring-orange-500"
                      />
                      <span>Geo Location</span>
                    </label>
                  </div>
                </div>

                {/* 4. Worker SOP Guide (PeTa Army) */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">4. PeTa Army SOP & Task Description</h4>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Worker Step-by-Step SOP (Indonesian) *
                    </label>
                    <textarea
                      rows={3}
                      value={workerSOP}
                      onChange={(e) => setWorkerSOP(e.target.value)}
                      placeholder="Petunjuk teknis pengerjaan task untuk worker PeTa..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Default Brief Template
                    </label>
                    <input
                      type="text"
                      value={workerBriefTemplate}
                      onChange={(e) => setWorkerBriefTemplate(e.target.value)}
                      placeholder="Template brief bawaan jika klien tidak mengisi brief..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Active in Straight catalog</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setModalOpen(false)}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-sm"
                    >
                      {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                      Save Service
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
