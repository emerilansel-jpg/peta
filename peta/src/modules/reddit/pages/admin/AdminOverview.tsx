import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  ShoppingCart,
  MessageSquare,
  Users,
  TrendingUp,
  Clock,
  ArrowRight,
  ChevronRight,
  Star,
  Lightbulb,
} from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout';
import {
  getAdminFinanceStats,
  getAdminAllOrders,
  getAdminAllTickets,
  getAdminAllUsers,
  getAdminReviews,
  getAdminFeatureRequests,
  formatUSD,
} from '../../lib/api';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

export function AdminOverview() {
  const [stats, setStats] = useState<any>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [recentTickets, setRecentTickets] = useState<any[]>([]);
  const [recentReviews, setRecentReviews] = useState<any[]>([]);
  const [recentFRs, setRecentFRs] = useState<any[]>([]);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [openFRCount, setOpenFRCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [s, orders, tickets, users, reviews, frs] = await Promise.all([
        getAdminFinanceStats(),
        getAdminAllOrders(),
        getAdminAllTickets(),
        getAdminAllUsers(),
        getAdminReviews(),
        getAdminFeatureRequests(),
      ]);
      setStats(s);
      setRecentOrders(orders.slice(0, 5));
      setRecentTickets(tickets.filter((t: any) => t.unread_admin > 0).slice(0, 5));
      setUserCount(users.length);
      setRecentReviews(reviews.slice(0, 5));
      setPendingReviewCount(reviews.filter((r: any) => r.status === 'pending').length);
      setRecentFRs(frs.slice(0, 5));
      setOpenFRCount(frs.filter((r: any) => r.status === 'open').length);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh({ table: 'reviews' }, load);
  useRealtimeRefresh({ table: 'feature_requests' }, load);
  useRealtimeRefresh({ table: 'reddit_upvote_orders' }, load);
  useRealtimeRefresh({ table: 'reddit_topup_requests' }, load);
  useRealtimeRefresh({ table: 'order_tickets' }, load);

  if (loading || !stats) {
    return (
      <AdminLayout>
        <div className="p-6 md:p-10">
          <p className="text-slate-500">Loading dashboard...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Overview</h1>
          <p className="text-slate-600 mt-1">Business at a glance</p>
        </div>

        {/* Top metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Today's revenue"
            value={formatUSD(stats.todayRevenue)}
            icon={DollarSign}
            color="emerald"
          />
          <MetricCard
            label="This month"
            value={formatUSD(stats.monthlyRevenue)}
            icon={TrendingUp}
            color="blue"
          />
          <MetricCard
            label="Pending orders"
            value={stats.pendingOrders.toString()}
            icon={Clock}
            color="amber"
            hrefLabel="View all"
            href="/reddit/admin/orders"
          />
          <MetricCard
            label="Total clients"
            value={userCount.toString()}
            icon={Users}
            color="purple"
            hrefLabel="View all"
            href="/reddit/admin/clients"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="All-time revenue"
            value={formatUSD(stats.totalRevenue)}
            icon={DollarSign}
            color="emerald"
            small
          />
          <MetricCard
            label="Total orders"
            value={stats.totalOrders.toString()}
            icon={ShoppingCart}
            color="blue"
            small
          />
          <MetricCard
            label="Completed orders"
            value={stats.completedOrders.toString()}
            icon={ShoppingCart}
            color="emerald"
            small
          />
          <MetricCard
            label="Upvotes delivered"
            value={stats.totalUpvotesDelivered.toLocaleString()}
            icon={TrendingUp}
            color="orange"
            small
          />
        </div>

        {/* Action items strip */}
        {(pendingReviewCount > 0 || openFRCount > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {pendingReviewCount > 0 && (
              <Link
                to="/reddit/admin/reviews"
                className="p-4 rounded-2xl bg-amber-50 ring-1 ring-amber-200 hover:ring-amber-300 hover:shadow-sm transition flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-amber-200 flex items-center justify-center">
                  <Star size={18} className="text-amber-700 fill-amber-700" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-amber-900">{pendingReviewCount} review{pendingReviewCount > 1 ? 's' : ''} pending approval</p>
                  <p className="text-xs text-amber-700">Approve to award credit + use as testimonial</p>
                </div>
                <ChevronRight size={16} className="text-amber-700" />
              </Link>
            )}
            {openFRCount > 0 && (
              <Link
                to="/reddit/admin/feature-requests"
                className="p-4 rounded-2xl bg-blue-50 ring-1 ring-blue-200 hover:ring-blue-300 hover:shadow-sm transition flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-200 flex items-center justify-center">
                  <Lightbulb size={18} className="text-blue-700" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-blue-900">{openFRCount} new feature request{openFRCount > 1 ? 's' : ''}</p>
                  <p className="text-xs text-blue-700">Triage and roadmap</p>
                </div>
                <ChevronRight size={16} className="text-blue-700" />
              </Link>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent orders */}
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Recent orders</h2>
              <Link to="/reddit/admin/orders" className="text-sm font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {recentOrders.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 text-center">No orders yet</p>
              ) : (
                recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    to={`/reddit/admin/orders?focus=${order.id}`}
                    className="block px-6 py-3 hover:bg-slate-50 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate">
                        #{order.id} · {order.users?.email}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {order.requested_upvotes} upvotes · {formatUSD(order.cost_credits)}
                      </p>
                    </div>
                    <StatusPill status={order.status} />
                    <ChevronRight size={16} className="text-slate-400" />
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* Unread messages */}
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Unread messages</h2>
              <Link to="/reddit/admin/tickets" className="text-sm font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                Inbox <ArrowRight size={12} />
              </Link>
            </div>{/* */}
            <div className="divide-y divide-slate-100">
              {recentTickets.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 text-center">
                  <MessageSquare size={20} className="inline mb-2 text-slate-300" />
                  <br />Inbox zero — nothing to reply to
                </p>
              ) : (
                recentTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    to={`/reddit/admin/tickets/${ticket.id}`}
                    className="block px-6 py-3 hover:bg-slate-50 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate">
                        {ticket.user?.email}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {ticket.subject}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
                      {ticket.unread_admin}
                    </span>
                    <ChevronRight size={16} className="text-slate-400" />
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Recent reviews + feature requests */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent reviews */}
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Star size={14} className="text-amber-500 fill-amber-500" />
                Recent reviews
              </h2>
              <Link to="/reddit/admin/reviews" className="text-sm font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {recentReviews.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 text-center">No reviews yet</p>
              ) : (
                recentReviews.map((r: any) => (
                  <Link
                    key={r.id}
                    to="/reddit/admin/reviews"
                    className="block px-6 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {r.type === 'trustpilot' ? '🌟 Trustpilot' : r.type === 'advise' ? '💬 advise.so' : '⭐ Internal'}
                      </span>
                      {r.rating && (
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} size={10} className={s <= r.rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-300'} />
                          ))}
                        </div>
                      )}
                      <StatusPill status={r.status} />
                    </div>
                    <p className="text-sm text-slate-900 truncate">{r.title || r.body || r.users?.email}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{r.users?.email}</p>
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* Recent feature requests */}
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Lightbulb size={14} className="text-amber-500" />
                Latest feature requests
              </h2>
              <Link to="/reddit/admin/feature-requests" className="text-sm font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {recentFRs.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 text-center">No requests yet</p>
              ) : (
                recentFRs.map((fr: any) => (
                  <Link
                    key={fr.id}
                    to="/reddit/admin/feature-requests"
                    className="block px-6 py-3 hover:bg-slate-50"
                  >
                    <p className="font-semibold text-slate-900 truncate">
                      {fr.platform || fr.category} · {fr.urgency === 'urgent' || fr.urgency === 'high' ? '🔥' : ''}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{fr.description}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{fr.users?.email}</p>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  small,
  hrefLabel,
  href,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'emerald' | 'blue' | 'amber' | 'purple' | 'orange';
  small?: boolean;
  hrefLabel?: string;
  href?: string;
}) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="p-5 rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${colors[color]} flex items-center justify-center`}>
          <Icon size={16} />
        </div>
      </div>
      <p className={`font-bold text-slate-900 ${small ? 'text-xl' : 'text-3xl'}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
      {href && hrefLabel && (
        <Link to={href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700">
          {hrefLabel}
          <ArrowRight size={10} />
        </Link>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    processing: 'bg-blue-50 text-blue-700 ring-blue-200',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    cancelled: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}
