import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  ShoppingCart,
  Clock,
  CheckCircle2,
  ArrowUpRight,
  Plus,
  Wallet,
} from 'lucide-react';
import { RedditLayout } from '../components/RedditLayout';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { formatUSD, getPricePerUpvoteUSD } from '../lib/api';

export function RedditDashboard() {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const { orders } = useRedditOrders();

  const pricePerUpvote = getPricePerUpvoteUSD();
  const upvotesAvailable = Math.floor((balance / 100) / pricePerUpvote);

  const stats = {
    totalOrders: orders.length,
    pending: orders.filter((o: any) => o.status === 'pending' || o.status === 'processing').length,
    completed: orders.filter((o: any) => o.status === 'completed').length,
    totalUpvotes: orders
      .filter((o: any) => o.status === 'completed')
      .reduce((sum: number, o: any) => sum + (o.delivered_upvotes || o.requested_upvotes), 0),
  };

  const recentOrders = orders.slice(0, 5);

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-10 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-600 mt-1">Manage your Reddit growth campaigns</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/reddit/new-order')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold shadow-md shadow-orange-500/20"
            >
              <Plus size={16} />
              New order
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Credit balance — featured */}
          <div className="md:col-span-2 p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/20 rounded-full blur-3xl" />
            <div className="relative">
              <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-2">
                Available credit
              </p>
              <p className="text-5xl font-bold">{formatUSD(balance)}</p>
              <p className="text-sm text-slate-300 mt-2">
                ≈ {upvotesAvailable.toLocaleString()} upvotes available
              </p>
              <button
                onClick={() => navigate('/reddit/topup')}
                className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold backdrop-blur-sm border border-white/20"
              >
                <Wallet size={14} />
                Top up via PayPal
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>

          {/* Other stats */}
          <StatCard
            label="Total orders"
            value={stats.totalOrders.toString()}
            icon={ShoppingCart}
            color="blue"
          />
          <StatCard
            label="In progress"
            value={stats.pending.toString()}
            icon={Clock}
            color="amber"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <StatCard
            label="Completed orders"
            value={stats.completed.toString()}
            icon={CheckCircle2}
            color="emerald"
          />
          <StatCard
            label="Upvotes delivered"
            value={stats.totalUpvotes.toLocaleString()}
            icon={TrendingUp}
            color="orange"
          />
        </div>

        {/* Recent orders */}
        <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Recent orders</h2>
              <p className="text-sm text-slate-500">Your latest 5 campaigns</p>
            </div>
            <button
              onClick={() => navigate('/reddit/orders')}
              className="text-sm font-semibold text-orange-600 hover:text-orange-700"
            >
              View all →
            </button>
          </div>

          {recentOrders.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 flex items-center justify-center mb-4">
                <ShoppingCart size={20} className="text-slate-400" />
              </div>
              <p className="text-slate-900 font-semibold mb-1">No orders yet</p>
              <p className="text-sm text-slate-500 mb-6">Create your first Reddit upvote order</p>
              <button
                onClick={() => navigate('/reddit/new-order')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
              >
                <Plus size={16} />
                Create order
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentOrders.map((order: any) => (
                <div key={order.id} className="px-6 py-4 hover:bg-slate-50 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      {order.thread_url.replace(/^https?:\/\/(www\.)?reddit\.com\//, 'r/').substring(0, 50)}...
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="hidden md:block text-right">
                    <p className="font-semibold text-slate-900">{order.requested_upvotes}</p>
                    <p className="text-xs text-slate-500">upvotes</p>
                  </div>
                  <div className="hidden md:block text-right">
                    <p className="font-semibold text-slate-900">{formatUSD(order.cost_credits)}</p>
                    <p className="text-xs text-slate-500">cost</p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </RedditLayout>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'blue' | 'amber' | 'emerald' | 'orange';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="p-6 rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; class: string }> = {
    pending: { label: 'Pending', class: 'bg-amber-50 text-amber-700 ring-amber-200' },
    processing: { label: 'Processing', class: 'bg-blue-50 text-blue-700 ring-blue-200' },
    completed: { label: 'Completed', class: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    cancelled: { label: 'Cancelled', class: 'bg-rose-50 text-rose-700 ring-rose-200' },
  };
  const c = config[status] || config.pending;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${c.class}`}>
      {c.label}
    </span>
  );
}
