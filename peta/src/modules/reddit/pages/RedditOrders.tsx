import { useNavigate, Link } from 'react-router-dom';
import { Plus, Search, ShoppingCart, MessageSquare, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { RedditLayout } from '../components/RedditLayout';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { formatUSD } from '../lib/api';
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

const FILTERS = ['all', 'pending', 'processing', 'completed', 'cancelled'] as const;

export function RedditOrders() {
  const navigate = useNavigate();
  const { orders, isLoading } = useRedditOrders();
  const [filter, setFilter] = useState<typeof FILTERS[number]>('all');
  const [query, setQuery] = useState('');

  const filteredOrders = orders.filter((o: any) => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (query && !o.thread_url.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Orders</h1>
            <p className="text-slate-600 mt-1">Track and manage your upvote campaigns</p>
          </div>
          <button
            onClick={() => navigate('/reddit/new-order')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold shadow-md shadow-orange-500/20"
          >
            <Plus size={16} />
            New order
          </button>
        </div>

        {/* Filters bar */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-6 flex flex-col md:flex-row gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {FILTERS.map((f) => {
              const count = f === 'all' ? orders.length : orders.filter((o: any) => o.status === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                    filter === f
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f === 'all' ? 'All' : STATUS_CONFIG[f].label}
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
                ? 'Submit your first Reddit upvote order in under 2 minutes'
                : 'Try a different filter or search query'}
            </p>
            {orders.length === 0 && (
              <button
                onClick={() => navigate('/reddit/new-order')}
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
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Upvotes</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Cost</th>
                    <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Status</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Created</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((order: any) => {
                    const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                    return (
                      <tr key={order.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/reddit/orders/${order.id}`)}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                #{order.id} {order.subreddit && (
                                  <span className="text-slate-500 font-normal">· r/{order.subreddit}</span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500 truncate max-w-md mt-0.5">
                                {order.thread_url.substring(0, 50)}...
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-semibold text-slate-900">{order.requested_upvotes.toLocaleString()}</span>
                          {order.delivered_upvotes > 0 && order.delivered_upvotes < order.requested_upvotes && (
                            <p className="text-xs text-emerald-600 mt-0.5">{order.delivered_upvotes} delivered</p>
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
                          <Link
                            to={`/reddit/orders/${order.id}`}
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
              {filteredOrders.map((order: any) => {
                const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                return (
                  <Link
                    key={order.id}
                    to={`/reddit/orders/${order.id}`}
                    className="block p-4 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-slate-900">#{order.id}</p>
                        {order.subreddit && (
                          <p className="text-xs text-slate-500">r/{order.subreddit}</p>
                        )}
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3 truncate">
                      {order.thread_url.substring(0, 40)}...
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-slate-500">Upvotes</p>
                        <p className="font-semibold text-slate-900">{order.requested_upvotes}</p>
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
    </RedditLayout>
  );
}
