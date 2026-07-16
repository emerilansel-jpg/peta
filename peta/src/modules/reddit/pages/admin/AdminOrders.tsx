import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ExternalLink,
  RefreshCw,
  X,
  Save,
  MessageSquare,
  ChevronRight,
  Search,
  Image as ImageIcon,
  Loader2,
  Link as LinkIcon,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import {
  getAdminAllOrders,
  updateOrderDetail,
  adminUploadDeliveryProof,
  formatUSD,
  getTicketByOrderId,
} from '../../lib/api';
import { ImageUploadWithPaste } from '../../components/ImageUploadWithPaste';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { cleanInternalText } from '../../../../lib/internalText';

const STATUS_CONFIG: Record<string, { label: string; class: string; dot: string }> = {
  pending: { label: 'Pending', class: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  processing: { label: 'Processing', class: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  completed: { label: 'Completed', class: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { label: 'Cancelled', class: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
};

const SERVICE_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  upvote: { label: 'Upvotes', emoji: '⬆️', color: 'bg-orange-100 text-orange-700' },
  comment: { label: 'Comments', emoji: '💬', color: 'bg-blue-100 text-blue-700' },
  thread: { label: 'New Thread', emoji: '📌', color: 'bg-purple-100 text-purple-700' },
  youtube_upload: { label: 'YouTube Upload', emoji: '▶️', color: 'bg-red-100 text-red-700' },
};

type AdminOrderRecord = {
  id: number;
  target_type?: string | null;
  status: string;
  thread_url: string;
  subreddit?: string | null;
  requested_upvotes: number;
  delivered_upvotes: number;
  cost_credits: number;
  created_at: string;
  completed_at?: string | null;
  notes: string | null;
  admin_notes?: string | null;
  delivery_proof_text?: string | null;
  delivery_proof_url?: string | null;
  users?: {
    email?: string | null;
    full_name?: string | null;
  } | null;
};

function parseOrderNotes(raw: string | null) {
  if (!raw) return { clientNote: '', commentText: '', useSuggested: false, brand: '', mentionMode: '', keyword: '', youtubeMeta: null as { title?: string; description?: string; tags?: string; privacy?: string; video_url?: string } | null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.service === 'forum_comment') {
      return {
        clientNote: cleanInternalText(parsed.client_notes || ''),
        commentText: parsed.comment_text || '',
        useSuggested: !!parsed.use_suggested_comment,
        brand: parsed.brand_name || parsed.brand_domain || '',
        mentionMode: parsed.brand_mention_mode || '',
        keyword: parsed.source_keyword || '',
        youtubeMeta: null,
      };
    }
    if (parsed?.service === 'youtube_upload') {
      return {
        clientNote: cleanInternalText(parsed.client_notes || ''),
        commentText: '',
        useSuggested: false,
        brand: '',
        mentionMode: '',
        keyword: '',
        youtubeMeta: {
          title: parsed.title || '',
          description: parsed.description || '',
          tags: parsed.tags || '',
          privacy: parsed.privacy || 'unlisted',
          video_url: parsed.video_url || '',
        },
      };
    }
  } catch {
    return { clientNote: cleanInternalText(raw), commentText: '', useSuggested: false, brand: '', mentionMode: '', keyword: '', youtubeMeta: null };
  }
  return { clientNote: cleanInternalText(raw), commentText: '', useSuggested: false, brand: '', mentionMode: '', keyword: '', youtubeMeta: null };
}

function serviceMetric(order: AdminOrderRecord) {
  if ((order.target_type || 'upvote') === 'comment') {
    return { label: 'Comments', value: '1', deliveredLabel: 'comment' };
  }
  if ((order.target_type || 'upvote') === 'youtube_upload') {
    return { label: 'YouTube Upload', value: '1', deliveredLabel: 'uploaded' };
  }
  return {
    label: 'Upvotes',
    value: String(order.requested_upvotes || 0),
    deliveredLabel: 'delivered',
  };
}

export function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<AdminOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [editingOrder, setEditingOrder] = useState<AdminOrderRecord | null>(null);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const data = await getAdminAllOrders();
      setOrders(data as AdminOrderRecord[]);

      // If URL has ?focus=ID, open that order
      const focusId = params.get('focus');
      if (focusId) {
        const order = data.find((o) => o.id === parseInt(focusId));
        if (order) setEditingOrder(order);
        params.delete('focus');
        setParams(params, { replace: true });
      }
    } catch {
      toast.error('Failed to load orders');
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeRefresh({ table: 'reddit_upvote_orders' }, () => loadOrders());

  const filteredOrders = orders.filter((o) => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (query) {
      const q = query.toLowerCase();
      const matches =
        o.thread_url?.toLowerCase().includes(q) ||
        o.users?.email?.toLowerCase().includes(q) ||
        o.users?.full_name?.toLowerCase().includes(q) ||
        o.id.toString().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  // Group orders by service type for header stats
  const serviceStats = orders.reduce((acc: Record<string, number>, o) => {
    const t = o.target_type || 'upvote';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Orders' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Orders</h1>
            <p className="text-slate-600 mt-1">Reddit growth services · process & deliver</p>
          </div>
          <button
            onClick={loadOrders}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Service type quick stats — matches client side */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <ServiceCard label="Reddit Upvotes" emoji="⬆️" count={serviceStats.upvote || 0} active />
          <ServiceCard label="Forum Comments" emoji="💬" count={serviceStats.comment || 0} active />
          <ServiceCard label="YouTube Uploads" emoji="▶️" count={serviceStats.youtube_upload || 0} active />
          <ServiceCard label="Reddit Threads" emoji="📌" count={serviceStats.thread || 0} comingSoon="Q4 2026" />
        </div>

        {/* Filter + search */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-6 flex flex-col md:flex-row gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {['all', 'pending', 'processing', 'completed', 'cancelled'].map((f) => {
              const count = f === 'all' ? orders.length : orders.filter((o) => o.status === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                    filter === f ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f === 'all' ? 'All' : STATUS_CONFIG[f]?.label || f}
                  <span className="ml-1.5 text-xs opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="md:ml-auto relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by ID, URL, or email..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full md:w-72 pl-9 pr-3 py-1.5 rounded-lg ring-1 ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Orders table */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-12 text-center text-slate-500">Loading...</p>
          ) : filteredOrders.length === 0 ? (
            <p className="p-12 text-center text-slate-500">No orders match this filter</p>
          ) : (
            <>
              {/* Desktop table */}
              <table className="hidden md:table w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Order</th>
                    <th className="text-left text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Client</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Service</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Revenue</th>
                    <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Date</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((order) => {
                    const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                    const metric = serviceMetric(order);
                    return (
                      <tr key={order.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-slate-900">#{order.id}</p>
                            <ServiceBadge targetType={order.target_type || 'upvote'} />
                          </div>
                          <a
                            href={order.thread_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-slate-500 hover:text-orange-600 flex items-center gap-1"
                          >
                            {order.thread_url.substring(0, 40)}...
                            <ExternalLink size={10} />
                          </a>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-slate-900">{order.users?.full_name}</p>
                          <p className="text-xs text-slate-500">{order.users?.email}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="font-semibold text-slate-900">{metric.value}</p>
                          <p className="text-xs text-slate-500">{metric.label}</p>
                          {order.delivered_upvotes > 0 && (
                            <p className="text-xs text-emerald-600">{order.delivered_upvotes} {metric.deliveredLabel}</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-slate-900">
                          {formatUSD(order.cost_credits)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                              {status.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-slate-500">
                          {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setEditingOrder(order)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
                          >
                            Manage
                            <ChevronRight size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredOrders.map((order) => {
                  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                  const metric = serviceMetric(order);
                  return (
                    <button
                      key={order.id}
                      onClick={() => setEditingOrder(order)}
                      className="block w-full text-left p-4 hover:bg-slate-50"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-slate-900">#{order.id}</p>
                          <p className="text-xs text-slate-500">{order.users?.email}</p>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          {status.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-slate-500">{metric.label}</p>
                          <p className="font-semibold text-slate-900">{metric.value}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Revenue</p>
                          <p className="font-semibold text-slate-900">{formatUSD(order.cost_credits)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Date</p>
                          <p className="font-semibold text-slate-900">
                            {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingOrder && (
        <OrderEditModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => {
            setEditingOrder(null);
            loadOrders();
          }}
        />
      )}
    </AdminLayout>
  );
}

function ServiceBadge({ targetType }: { targetType: string }) {
  const cfg = SERVICE_CONFIG[targetType] || SERVICE_CONFIG.upvote;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

function ServiceCard({
  label,
  emoji,
  count,
  active,
  comingSoon,
}: {
  label: string;
  emoji: string;
  count: number;
  active?: boolean;
  comingSoon?: string;
}) {
  return (
    <div
      className={`p-4 rounded-xl ring-1 transition relative ${
        active
          ? 'bg-white ring-emerald-200'
          : 'bg-slate-50/50 ring-slate-200'
      }`}
    >
      {comingSoon && (
        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[9px] font-bold uppercase tracking-wider">
          {comingSoon}
        </span>
      )}
      {active && count > 0 && (
        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase tracking-wider">
          Active
        </span>
      )}
      <div className="text-2xl">{emoji}</div>
      <p className={`text-xl font-bold mt-1 ${active ? 'text-slate-900' : 'text-slate-400'}`}>{count}</p>
      <p className={`text-xs ${active ? 'text-slate-600' : 'text-slate-500'}`}>{label}</p>
    </div>
  );
}

function OrderEditModal({
  order,
  onClose,
  onSaved,
}: {
  order: AdminOrderRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCommentOrder = (order.target_type || 'upvote') === 'comment';
  const isYouTubeUploadOrder = (order.target_type || 'upvote') === 'youtube_upload';
  const isSingleUnitOrder = isCommentOrder || isYouTubeUploadOrder;
  const parsedNotes = parseOrderNotes(order.notes);
  const [status, setStatus] = useState(order.status);
  const [deliveredStr, setDeliveredStr] = useState(
    order.delivered_upvotes ? String(order.delivered_upvotes) : ''
  );
  const [adminNotes, setAdminNotes] = useState(order.admin_notes || '');
  const [proofText, setProofText] = useState(order.delivery_proof_text || '');
  const [proofUrl, setProofUrl] = useState(order.delivery_proof_url || '');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofMode, setProofMode] = useState<'text' | 'url' | 'image'>(
    order.delivery_proof_url && order.delivery_proof_url.match(/\.(png|jpg|jpeg|gif|webp)/i)
      ? 'image'
      : order.delivery_proof_url
      ? 'url'
      : 'text'
  );
  const [saving, setSaving] = useState(false);
  const [ticketId, setTicketId] = useState<number | null>(null);

  useEffect(() => {
    getTicketByOrderId(order.id).then((t) => {
      if (t) setTicketId(t.id);
    });
  }, [order.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const delivered = isSingleUnitOrder ? (status === 'completed' ? 1 : 0) : (parseInt(deliveredStr) || 0);
      let finalProofUrl: string | null = proofUrl.trim() || null;

      // If user selected image mode and provided new file, upload it
      if (proofMode === 'image' && proofFile) {
        finalProofUrl = await adminUploadDeliveryProof(order.id, proofFile);
      }

      // If user switched mode, clear the irrelevant fields
      const updates: Record<string, string | number | null> = {
        status,
        delivered_upvotes: delivered,
        admin_notes: adminNotes.trim(),
        delivery_proof_text: proofMode === 'text' ? proofText.trim() : null,
        delivery_proof_url: proofMode !== 'text' ? finalProofUrl : null,
      };

      await updateOrderDetail(order.id, updates);
      toast.success('Order updated' + (status === 'completed' ? ' · client will be notified' : ''));
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Order #{order.id}</h3>
            <p className="text-sm text-slate-500">{order.users?.email}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Order details (read-only) */}
          <div className="p-4 rounded-xl bg-slate-50 ring-1 ring-slate-200">
            <h4 className="font-semibold text-sm text-slate-900 mb-3">Order details</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">{isCommentOrder ? 'Target page' : isYouTubeUploadOrder ? 'Video source' : 'Thread URL'}</p>
                <a href={order.thread_url} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline break-all flex items-center gap-1">
                  {order.thread_url.substring(0, 40)}... <ExternalLink size={10} />
                </a>
              </div>
              <div>
                <p className="text-xs text-slate-500">{isCommentOrder ? 'Platform' : 'Subreddit'}</p>
                <p className="font-medium">
                  {order.subreddit ? (isCommentOrder ? order.subreddit : isYouTubeUploadOrder ? 'YouTube' : `r/${order.subreddit}`) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Requested</p>
                <p className="font-medium">{isSingleUnitOrder ? (isYouTubeUploadOrder ? '1 upload' : '1 comment') : `${order.requested_upvotes} upvotes`}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Revenue</p>
                <p className="font-medium">{formatUSD(order.cost_credits)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Created</p>
                <p className="font-medium">{new Date(order.created_at).toLocaleString('en-US')}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Completed</p>
                <p className="font-medium">{order.completed_at ? new Date(order.completed_at).toLocaleString('en-US') : '—'}</p>
              </div>
            </div>
            {parsedNotes.commentText && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">Final comment</p>
                <p className="text-sm text-slate-900 mt-1 whitespace-pre-wrap">{parsedNotes.commentText}</p>
                <p className="text-xs text-slate-500 mt-2">
                  {parsedNotes.useSuggested ? 'Suggested assistant used' : 'Client-written'}
                  {parsedNotes.brand ? ` · Brand: ${parsedNotes.brand}` : ''}
                  {parsedNotes.mentionMode ? ` · ${parsedNotes.mentionMode}` : ''}
                  {parsedNotes.keyword ? ` · Keyword: ${parsedNotes.keyword}` : ''}
                </p>
              </div>
            )}
            {parsedNotes.youtubeMeta && (
              <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                <p className="text-xs text-slate-500">YouTube upload details</p>
                <p className="text-sm text-slate-900 font-semibold">{parsedNotes.youtubeMeta.title}</p>
                {parsedNotes.youtubeMeta.description && (
                  <p className="text-sm text-slate-900 whitespace-pre-wrap">{parsedNotes.youtubeMeta.description}</p>
                )}
                {parsedNotes.youtubeMeta.tags && (
                  <p className="text-xs text-slate-500">Tags: {parsedNotes.youtubeMeta.tags}</p>
                )}
                <p className="text-xs text-slate-500 capitalize">Privacy: {parsedNotes.youtubeMeta.privacy}</p>
              </div>
            )}
            {parsedNotes.clientNote && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">Client note</p>
                <p className="text-sm text-slate-900 mt-1 italic">"{parsedNotes.clientNote}"</p>
              </div>
            )}
          </div>

          {/* Editable fields */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-slate-900 font-medium"
            >
              <option value="pending">Pending — awaiting our review</option>
              <option value="processing">Processing — delivery in progress</option>
              <option value="completed">Completed — delivery done</option>
              <option value="cancelled">Cancelled — refund manually if needed</option>
            </select>
          </div>

          {!isSingleUnitOrder && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Delivered upvotes <span className="text-slate-400 font-normal">(of {order.requested_upvotes})</span>
            </label>
            <input
              type="number"
              value={deliveredStr}
              onChange={(e) => setDeliveredStr(e.target.value)}
              onBlur={() => {
                const n = parseInt(deliveredStr) || 0;
                const clamped = Math.max(0, Math.min(order.requested_upvotes, n));
                setDeliveredStr(clamped > 0 ? String(clamped) : '');
              }}
              min="0"
              max={order.requested_upvotes}
              placeholder="0"
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
            <p className="text-xs text-slate-500 mt-1">Track partial delivery for transparency</p>
          </div>
          )}

          {/* Delivery proof (visible to client) */}
          <div className="p-4 rounded-xl bg-emerald-50/50 ring-1 ring-emerald-100">
            <label className="block text-sm font-bold text-slate-900 mb-2">
              📸 Delivery proof <span className="text-xs font-normal text-emerald-700">(visible to client)</span>
            </label>
            <p className="text-xs text-slate-600 mb-3">Show the client proof of delivery — text note, URL, or screenshot.</p>

            {/* Mode tabs */}
            <div className="inline-flex bg-white rounded-lg ring-1 ring-slate-200 p-1 mb-3">
              {([
                { key: 'text', label: 'Text', icon: MessageSquare },
                { key: 'url', label: 'URL', icon: LinkIcon },
                { key: 'image', label: 'Screenshot', icon: ImageIcon },
              ] as const).map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setProofMode(m.key)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5 ${
                      proofMode === m.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={12} />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {proofMode === 'text' && (
              <textarea
                value={proofText}
                onChange={(e) => setProofText(e.target.value)}
                rows={3}
                placeholder={isYouTubeUploadOrder
                  ? 'E.g. Video uploaded to YouTube. URL: https://youtube.com/watch?v=...'
                  : isCommentOrder
                  ? 'E.g. Comment placed and visible on the target thread. Screenshot attached.'
                  : 'E.g. Delivered 50 upvotes across 3 hours via aged accounts. All upvotes are stable.'}
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-slate-900 bg-white"
              />
            )}

            {proofMode === 'url' && (
              <input
                type="url"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder={isYouTubeUploadOrder
                  ? 'https://youtube.com/watch?v=... (link to the uploaded video)'
                  : isCommentOrder
                  ? 'https://forum.example.com/thread/... (link to the placed comment)'
                  : 'https://reddit.com/r/.../comments/... (link to the boosted thread)'}
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 bg-white"
              />
            )}

            {proofMode === 'image' && (
              <>
                {order.delivery_proof_url && !proofFile && (
                  <div className="mb-3 p-3 rounded-lg ring-1 ring-slate-200 bg-white flex items-center justify-between">
                    <a
                      href={order.delivery_proof_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-900"
                    >
                      <ImageIcon size={14} />
                      Current proof image
                      <ExternalLink size={10} />
                    </a>
                    <span className="text-xs text-slate-500">Upload below to replace</span>
                  </div>
                )}
                <ImageUploadWithPaste
                  value={proofFile}
                  onChange={setProofFile}
                  label="Upload proof screenshot"
                  helperText="Drop, click, or paste (Ctrl+V). PNG, JPG, WebP · Max 5MB"
                />
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Admin notes (internal)</label>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes — NOT visible to client. Track delivery details, issues, batch IDs..."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900"
            />
          </div>

          <div className="p-4 rounded-xl bg-blue-50 ring-1 ring-blue-100 flex items-start gap-3">
            <MessageSquare size={16} className="text-blue-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900">Need to talk to the client?</p>
              <p className="text-xs text-blue-700 mt-0.5">Every order has a built-in conversation thread.</p>
            </div>
            {ticketId && (
              <Link
                to={`/reddit/admin/tickets/${ticketId}`}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1"
              >
                Open thread
                <ChevronRight size={12} />
              </Link>
            )}
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
            className="flex-1 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
