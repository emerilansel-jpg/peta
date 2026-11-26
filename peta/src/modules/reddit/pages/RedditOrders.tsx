import { spath } from '../lib/path';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  Plus,
  Search,
  ShoppingCart,
  MessageSquare,
  ChevronRight,
  AlertTriangle,
  RefreshCcw,
  Ban,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RedditLayout } from '../components/RedditLayout';
import { useRedditOrders } from '../hooks/useRedditOrders';
import {
  formatUSD,
  getClientOrdersHealth,
  clientBulkUpdateBrokenUrls,
  clientBulkCancelBrokenOrders,
  isInvalidOrSearchForumUrl,
  type ClientOrderHealth,
} from '../lib/api';
import { CardSkeleton } from '../../../components/Skeleton';

const STATUS_CONFIG: Record<string, { label: string; class: string; dot: string }> = {
  pending: {
    label: 'Pending',
    class: 'bg-amber-50 text-amber-700 ring-amber-200',
    dot: 'bg-amber-500',
  },
  processing: {
    label: 'Processing',
    class: 'bg-blue-50 text-blue-700 ring-blue-200',
    dot: 'bg-blue-500',
  },
  paused: {
    label: 'Paused',
    class: 'bg-purple-50 text-purple-700 ring-purple-200',
    dot: 'bg-purple-500',
  },
  completed: {
    label: 'Completed',
    class: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  cancelled: {
    label: 'Cancelled',
    class: 'bg-rose-50 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
  },
};

const FILTERS = ['all', 'needs_action', 'pending', 'processing', 'paused', 'completed', 'cancelled'] as const;

type RedditOrderListItem = {
  id: number;
  target_type?: string | null;
  requested_upvotes: number;
  delivered_upvotes: number;
  status: string;
  thread_url: string;
  subreddit?: string | null;
  cost_credits: number;
  created_at: string;
  drip_interval_hours?: number | null;
};

function serviceLabel(order: RedditOrderListItem) {
  const targetType = order.target_type || 'upvote';
  if (targetType === 'comment') {
    return { label: 'Comment', metric: 'Comments', value: '1', icon: '💬' };
  }
  if (targetType === 'youtube_upload') {
    return { label: 'YouTube Upload', metric: 'Uploads', value: '1', icon: '▶️' };
  }
  if (targetType === 'quora_upvote') {
    return {
      label: 'Quora Up Votes',
      metric: 'Upvotes',
      value: Number(order.requested_upvotes || 0).toLocaleString(),
      icon: '🔺',
    };
  }
  if (targetType === 'trustpilot_review') {
    return { label: 'Trustpilot Reviews', metric: 'Reviews', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '⭐' };
  }
  if (targetType === 'google_maps_review') {
    return { label: 'Google Maps Reviews', metric: 'Reviews', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '📍' };
  }
  if (targetType === 'yelp_review') {
    return { label: 'Yelp Reviews', metric: 'Reviews', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '⭐' };
  }
  if (targetType === 'clutch_review') {
    return { label: 'Clutch.co Reviews', metric: 'Reviews', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '⭐' };
  }
  if (targetType === 'facebook_group_comment') {
    return { label: 'Facebook Group Comments', metric: 'Comments', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '💬' };
  }
  if (targetType === 'avvo_review' || targetType === 'avvo_comment') {
    return { label: 'Avvo Reviews', metric: 'Reviews', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '⚖️' };
  }
  if (targetType === 'facebook_page_review') {
    return { label: 'Facebook Review (Fb page customer feedback)', metric: 'Reviews', value: Number(order.requested_upvotes || 0).toLocaleString(), icon: '⭐' };
  }
  if (targetType === 'reseller_order') {
    return {
      label: order.subreddit || 'Social Engagement',
      metric: 'Units',
      value: Number(order.requested_upvotes || 0).toLocaleString(),
      icon: '🌐',
    };
  }
  return {
    label: 'Upvotes',
    metric: 'Upvotes',
    value: Number(order.requested_upvotes || 0).toLocaleString(),
    icon: '⬆️',
  };
}

type BulkRow = {
  order: RedditOrderListItem;
  health?: ClientOrderHealth;
};

type BulkResultEntry = { ok: boolean; error?: string; refund?: number };

function blockedBulkActionReason(h?: ClientOrderHealth, o?: RedditOrderListItem): string {
  if (h && h.locked_active_units > 0) {
    return `${h.locked_active_units} worker submission(s) under review — this order unlocks once the review finishes.`;
  }
  if (o && o.delivered_upvotes > 0) {
    return 'Partially delivered — open the order to see your options.';
  }
  return 'Not eligible right now — open the order for details.';
}

export function RedditOrders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { orders, isLoading } = useRedditOrders();
  const initialFilter = searchParams.get('filter') === 'needs_action' ? 'needs_action' : 'all';
  const [filter, setFilter] = useState<typeof FILTERS[number]>(initialFilter);
  const [query, setQuery] = useState('');
  const [healthRows, setHealthRows] = useState<ClientOrderHealth[]>([]);
  const [healthVersion, setHealthVersion] = useState(0);

  // Bulk replace / cancel state
  const [showBulkReplace, setShowBulkReplace] = useState(false);
  const [showBulkCancel, setShowBulkCancel] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkUrls, setBulkUrls] = useState<Record<number, string>>({});
  const [bulkResults, setBulkResults] = useState<Record<number, BulkResultEntry>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    getClientOrdersHealth().then(setHealthRows).catch(() => {});
  }, [orders.length, healthVersion]);

  useEffect(() => {
    if (searchParams.get('filter') === 'needs_action') {
      setFilter('needs_action');
    }
  }, [searchParams]);

  const healthByOrder = useMemo(() => {
    const map = new Map<number, ClientOrderHealth>();
    for (const h of healthRows) map.set(Number(h.order_id), h);
    return map;
  }, [healthRows]);

  const isOrderActionNeeded = (o: RedditOrderListItem) => {
    const h = healthByOrder.get(Number(o.id));
    return Boolean(h?.is_broken_url && ['pending', 'processing', 'paused'].includes(o.status) && o.delivered_upvotes < o.requested_upvotes);
  };

  const typedOrders = orders as RedditOrderListItem[];
  const needsActionCount = typedOrders.filter(isOrderActionNeeded).length;
  const filteredOrders = typedOrders.filter((o) => {
    if (filter === 'needs_action') {
      if (!isOrderActionNeeded(o)) return false;
    } else if (filter !== 'all' && o.status !== filter) {
      return false;
    }
    if (query && !o.thread_url.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  // Bulk-action eligibility (mirrors fn_get_client_orders_health flags)
  const urlLooksValid = (url: string) => /^https?:\/\/[^\s.]+\.[^\s]+/i.test(url) && !isInvalidOrSearchForumUrl(url);
  const refundEstimate = (o: RedditOrderListItem, h?: ClientOrderHealth) => {
    const requested = Math.max(o.requested_upvotes, 1);
    const refundable = Math.max(requested - o.delivered_upvotes - (h?.locked_active_units ?? 0), 0);
    return Math.floor((refundable * o.cost_credits) / requested);
  };

  const openBulkReplace = () => {
    setBulkRows(
      typedOrders
        .filter(isOrderActionNeeded)
        .map((o) => ({ order: o, health: healthByOrder.get(o.id) }))
    );
    setBulkUrls({});
    setBulkResults({});
    setShowBulkCancel(false);
    setShowBulkReplace(true);
  };

  const openBulkCancel = () => {
    setBulkRows(
      typedOrders
        .filter(isOrderActionNeeded)
        .map((o) => ({ order: o, health: healthByOrder.get(o.id) }))
    );
    setBulkResults({});
    setShowBulkReplace(false);
    setShowBulkCancel(true);
  };

  const replaceableRows = bulkRows.filter((r) => r.health?.can_update_url);
  const cancelableRows = bulkRows.filter((r) => r.health?.can_refund_broken);
  const totalRefund = cancelableRows.reduce((sum, r) => sum + refundEstimate(r.order, r.health), 0);

  const refreshAfterBulk = async () => {
    await queryClient.invalidateQueries({ queryKey: ['reddit', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['reddit', 'credits'] });
    setHealthVersion((v) => v + 1);
  };

  const handleBulkReplace = async () => {
    const updates = replaceableRows
      .map((r) => ({ orderId: r.order.id, newUrl: (bulkUrls[r.order.id] || '').trim() }))
      .filter((u) => u.newUrl.length > 0);
    if (updates.length === 0) {
      toast.error('Enter at least one replacement URL first.');
      return;
    }
    if (updates.some((u) => !urlLooksValid(u.newUrl))) {
      toast.error('Some replacement URLs look invalid or are search pages. Fix the highlighted rows.');
      return;
    }
    setBulkBusy(true);
    try {
      const res = await clientBulkUpdateBrokenUrls(updates);
      const map: Record<number, BulkResultEntry> = {};
      for (const r of res.results || []) map[r.order_id] = { ok: r.ok, error: r.error || undefined };
      setBulkResults(map);
      await refreshAfterBulk();
      if (res.failed === 0) toast.success(`${res.succeeded} order${res.succeeded === 1 ? '' : 's'} resubmitted to delivery!`);
      else toast.success(`${res.succeeded} resubmitted · ${res.failed} failed — fix the highlighted URLs.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Bulk URL replacement failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkCancel = async () => {
    const ids = cancelableRows.map((r) => r.order.id);
    if (ids.length === 0) {
      toast.error('No flagged orders are refundable right now.');
      return;
    }
    setBulkBusy(true);
    try {
      const res = await clientBulkCancelBrokenOrders(ids);
      const map: Record<number, BulkResultEntry> = {};
      for (const r of res.results || []) {
        map[r.order_id] = { ok: r.ok, error: r.error || undefined, refund: r.refund_credits ?? undefined };
      }
      setBulkResults(map);
      await refreshAfterBulk();
      toast.success(
        `Cancelled ${res.succeeded} order${res.succeeded === 1 ? '' : 's'} — ${formatUSD(res.refund_credits_total || 0)} refunded to your credit balance.`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Bulk cancellation failed');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Orders</h1>
            <p className="text-slate-600 mt-1">Track upvotes, comments, and forum growth campaigns</p>
          </div>
          <button
            onClick={() => navigate(spath('/new-order'))}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold shadow-md shadow-orange-500/20"
          >
            <Plus size={16} />
            New order
          </button>
        </div>

        {/* Action-needed alert banner */}
        {needsActionCount > 0 && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-950">
                  {needsActionCount} order{needsActionCount === 1 ? '' : 's'} paused due to inaccessible target URL (410 Gone / Search Page / Closed Thread)
                </p>
                <p className="text-xs text-rose-800 mt-0.5">
                  Click any flagged order below to submit a replacement thread link or claim an instant 100% credit refund to place a new order.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {filter !== 'needs_action' && (
                <button
                  type="button"
                  onClick={() => setFilter('needs_action')}
                  className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                >
                  Show Flagged ({needsActionCount})
                </button>
              )}
              <button
                type="button"
                onClick={openBulkReplace}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
              >
                <RefreshCcw size={13} />
                Replace links in bulk
              </button>
              <button
                type="button"
                onClick={openBulkCancel}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white ring-1 ring-rose-300 text-rose-700 hover:bg-rose-100 text-xs font-bold"
              >
                <Ban size={13} />
                Cancel all &amp; refund
              </button>
            </div>
          </div>
        )}

        {/* Filters bar */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-6 flex flex-col md:flex-row gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {FILTERS.map((f) => {
              const count =
                f === 'all'
                  ? typedOrders.length
                  : f === 'needs_action'
                  ? needsActionCount
                  : typedOrders.filter((o) => o.status === f).length;
              if (f === 'needs_action' && count === 0) return null;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                    filter === f
                      ? f === 'needs_action'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-900 text-white'
                      : f === 'needs_action'
                      ? 'text-rose-700 bg-rose-50 hover:bg-rose-100'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'needs_action' ? 'Link Issue' : STATUS_CONFIG[f].label}
                  <span className="ml-1.5 text-xs opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="md:ml-auto relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by URL..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full md:w-64 pl-9 pr-3 py-1.5 rounded-lg ring-1 ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Orders list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-16 text-center">
            <div className="w-14 h-14 mx-auto rounded-xl bg-slate-100 flex items-center justify-center mb-4">
              <ShoppingCart size={22} className="text-slate-400" />
            </div>
            <p className="font-semibold text-slate-900 mb-1">
              {orders.length === 0 ? 'No orders yet' : 'No matches'}
            </p>
            <p className="text-sm text-slate-500 mb-6">
              {orders.length === 0
                ? 'Submit your first Straight Ltd order in under 2 minutes'
                : 'Try a different filter or search query'}
            </p>
            {orders.length === 0 && (
              <button
                onClick={() => navigate(spath('/new-order'))}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
              >
                <Plus size={16} />
                Create order
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Order</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Service</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Cost</th>
                    <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Created</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((order) => {
                    const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                    const service = serviceLabel(order);
                    return (
                      <tr key={order.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(spath(`/orders/${order.id}`))}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                <span className="mr-1">{service.icon}</span>#{order.id} {order.subreddit && (
                                  <span className="text-slate-500 font-normal">
                                    · {order.target_type === 'youtube_upload' ? 'YouTube' : order.target_type === 'quora_upvote' ? 'Quora' : order.target_type === 'yelp_review' ? 'Yelp' : order.target_type === 'clutch_review' ? 'Clutch' : order.target_type === 'facebook_group_comment' ? 'Facebook Group' : (order.target_type === 'avvo_review' || order.target_type === 'avvo_comment') ? 'Avvo' : order.target_type === 'facebook_page_review' ? 'Facebook Review' : order.target_type === 'reseller_order' ? (order.subreddit || 'Social') : (order.target_type || 'upvote') === 'comment' ? order.subreddit : `r/${order.subreddit}`}
                                  </span>
                                )}
                                {order.drip_interval_hours && order.drip_interval_hours > 0 ? (
                                  <span className="ml-2 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
                                    ⏱️ {order.drip_interval_hours}h drip
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-xs text-slate-500 truncate max-w-md mt-0.5">
                                {order.thread_url.substring(0, 50)}...
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-semibold text-slate-900">{service.value}</span>
                          <p className="text-xs text-slate-500 mt-0.5">{service.label}</p>
                          {order.delivered_upvotes > 0 && order.delivered_upvotes < order.requested_upvotes && (
                            <p className="text-xs text-emerald-600 mt-0.5">{order.delivered_upvotes} delivered</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-slate-900">
                          {formatUSD(order.cost_credits)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col items-center gap-1">
                            {isOrderActionNeeded(order) ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ring-1 bg-rose-50 text-rose-700 ring-rose-300">
                                <AlertTriangle size={11} />
                                Link Issue · Resubmit
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                                {status.label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-slate-500">
                          {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            to={spath(`/orders/${order.id}`)}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700"
                          >
                            <MessageSquare size={12} />
                            <ChevronRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredOrders.map((order) => {
                const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                const service = serviceLabel(order);
                return (
                  <Link
                    key={order.id}
                    to={spath(`/orders/${order.id}`)}
                    className="block p-4 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-slate-900">
                          <span className="mr-1">{service.icon}</span>#{order.id}
                          {order.drip_interval_hours && order.drip_interval_hours > 0 ? (
                            <span className="ml-2 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
                              ⏱️ {order.drip_interval_hours}h
                            </span>
                          ) : null}
                        </p>
                        {order.subreddit && (
                          <p className="text-xs text-slate-500">
                            {order.target_type === 'youtube_upload' ? 'YouTube' : order.target_type === 'facebook_group_comment' ? 'Facebook Group' : (order.target_type === 'avvo_review' || order.target_type === 'avvo_comment') ? 'Avvo' : (order.target_type || 'upvote') === 'comment' ? order.subreddit : `r/${order.subreddit}`}
                          </p>
                        )}
                      </div>
                      {isOrderActionNeeded(order) ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ring-1 bg-rose-50 text-rose-700 ring-rose-300">
                          <AlertTriangle size={11} />
                          Resubmit Link
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          {status.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mb-3 truncate">
                      {order.thread_url.substring(0, 40)}...
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-slate-500">{service.metric}</p>
                        <p className="font-semibold text-slate-900">{service.value}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Cost</p>
                        <p className="font-semibold text-slate-900">{formatUSD(order.cost_credits)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Date</p>
                        <p className="font-semibold text-slate-900">
                          {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bulk replace modal */}
      {showBulkReplace && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-6"
          onClick={() => !bulkBusy && setShowBulkReplace(false)}
        >
          <div
            className="w-full sm:max-w-3xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Replace broken links in bulk</h2>
              <p className="text-sm text-slate-600 mt-1">
                Paste a direct replacement thread URL for each flagged order. Orders go back into delivery immediately.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 divide-y divide-slate-100">
              {bulkRows.map((row) => {
                const o = row.order;
                const h = row.health;
                const editable = Boolean(h?.can_update_url);
                const val = bulkUrls[o.id] || '';
                const res = bulkResults[o.id];
                return (
                  <div key={o.id} className={`py-4 ${editable ? '' : 'opacity-60'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        #{o.id} · {o.subreddit || serviceLabel(o).label}
                      </p>
                      <span className="text-sm font-semibold text-slate-500 shrink-0">{formatUSD(o.cost_credits)}</span>
                    </div>
                    <p className="text-xs text-rose-500 mt-0.5 truncate max-w-lg" title={o.thread_url}>
                      {o.thread_url}
                    </p>
                    {editable ? (
                      <div className="mt-2">
                        <input
                          value={val}
                          onChange={(e) => setBulkUrls((prev) => ({ ...prev, [o.id]: e.target.value }))}
                          placeholder="https:// replacement thread URL"
                          disabled={bulkBusy}
                          className={`w-full px-3 py-2 rounded-lg text-sm ring-1 focus:outline-none focus:ring-2 ${
                            res && !res.ok
                              ? 'ring-rose-300 focus:ring-rose-500'
                              : val.trim() && !urlLooksValid(val.trim())
                              ? 'ring-amber-300 focus:ring-amber-500'
                              : 'ring-slate-200 focus:ring-orange-500'
                          }`}
                        />
                        {val.trim() && !urlLooksValid(val.trim()) && (
                          <p className="text-xs text-amber-700 mt-1">
                            Search pages / invalid URLs are not allowed — paste a direct thread URL.
                          </p>
                        )}
                        {res?.ok && (
                          <p className="text-xs text-emerald-600 mt-1 inline-flex items-center gap-1">
                            <CheckCircle2 size={12} /> Resubmitted to delivery
                          </p>
                        )}
                        {res && !res.ok && (
                          <p className="text-xs text-rose-600 mt-1 inline-flex items-start gap-1">
                            <XCircle size={12} className="mt-0.5 shrink-0" /> {res.error}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 mt-1.5">{blockedBulkActionReason(h, o)}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {replaceableRows.length} order{replaceableRows.length === 1 ? '' : 's'} ready ·{' '}
                {replaceableRows.filter((r) => (bulkUrls[r.order.id] || '').trim().length > 0).length} URL(s) entered
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowBulkReplace(false)}
                  disabled={bulkBusy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={handleBulkReplace}
                  disabled={bulkBusy || replaceableRows.every((r) => !(bulkUrls[r.order.id] || '').trim())}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-bold"
                >
                  {bulkBusy && <Loader2 size={15} className="animate-spin" />}
                  Resubmit orders
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk cancel & refund modal */}
      {showBulkCancel && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-6"
          onClick={() => !bulkBusy && setShowBulkCancel(false)}
        >
          <div
            className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Cancel flagged orders &amp; get refunded</h2>
              <p className="text-sm text-slate-600 mt-1">
                Flagged orders are cancelled instantly and the undelivered amount goes straight back to your credit
                balance (6-hour limit waived).
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-1">
              {cancelableRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  No flagged orders are currently refundable — they still have worker submissions under review.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {cancelableRows.map((row) => {
                    const o = row.order;
                    const res = bulkResults[o.id];
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            #{o.id} · {o.subreddit || serviceLabel(o).label}
                          </p>
                          <p className="text-xs text-slate-500 truncate max-w-md" title={o.thread_url}>
                            {o.thread_url}
                          </p>
                          {res && !res.ok && (
                            <p className="text-xs text-rose-600 mt-0.5 inline-flex items-start gap-1">
                              <XCircle size={12} className="mt-0.5 shrink-0" /> {res.error}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {res?.ok ? (
                            <p className="text-sm font-bold text-emerald-600 inline-flex items-center gap-1">
                              <CheckCircle2 size={13} /> +{formatUSD(res.refund || 0)}
                            </p>
                          ) : (
                            <p className="text-sm font-bold text-slate-900">+{formatUSD(refundEstimate(o, row.health))}</p>
                          )}
                          <p className="text-[11px] text-slate-400">credit refund</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {bulkRows.length > cancelableRows.length && (
                <div className="my-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  {bulkRows.length - cancelableRows.length} flagged order
                  {bulkRows.length - cancelableRows.length === 1 ? ' is' : 's are'} skipped — worker submissions under
                  review. Open each order once the review finishes to replace the link or claim its refund.
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {cancelableRows.length} order{cancelableRows.length === 1 ? '' : 's'} · {formatUSD(totalRefund)} total
                refund
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowBulkCancel(false)}
                  disabled={bulkBusy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={handleBulkCancel}
                  disabled={bulkBusy || cancelableRows.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-bold"
                >
                  {bulkBusy && <Loader2 size={15} className="animate-spin" />}
                  Cancel {cancelableRows.length} orders · refund {formatUSD(totalRefund)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </RedditLayout>
  );
}
