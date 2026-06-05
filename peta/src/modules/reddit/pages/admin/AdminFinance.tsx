import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, CreditCard, ArrowDownCircle, ArrowUpCircle, RefreshCw, ShoppingCart } from 'lucide-react';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import { ServicePricingCard } from '../../components/ServicePricingCard';
import { supabase } from '../../../../lib/supabase';
import { formatUSD } from '../../lib/api';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

export function AdminFinance() {
  const [stats, setStats] = useState<any>(null);
  const [topups, setTopups] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [topupRes, txRes, ordersRes] = await Promise.all([
        supabase
          .from('reddit_topup_requests')
          .select('*')
          .eq('payment_status', 'completed')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('credit_transactions')
          .select('*')
          .in('type', ['adjust', 'refund'])
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('reddit_upvote_orders')
          .select('cost_credits, status, created_at, completed_at')
          .in('status', ['completed', 'processing', 'pending']),
      ]);

      // Enrich both with users separately
      const allUserIds = [
        ...new Set([
          ...(topupRes.data || []).map((t) => t.user_id),
          ...(txRes.data || []).map((t) => t.user_id),
        ]),
      ];
      const { data: users } =
        allUserIds.length > 0
          ? await supabase.from('users').select('id, email, full_name').in('id', allUserIds)
          : { data: [] };
      const userMap = new Map((users || []).map((u: any) => [u.id, u]));

      setTopups((topupRes.data || []).map((t) => ({ ...t, users: userMap.get(t.user_id) || null })));
      setRefunds((txRes.data || []).map((t) => ({ ...t, users: userMap.get(t.user_id) || null })));

      // Revenue from topups (real money in)
      const total = (topupRes.data || []).reduce((sum, t) => sum + t.amount_cents, 0);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = monthStart;

      const monthRevenue = (topupRes.data || [])
        .filter((t) => new Date(t.created_at) >= monthStart)
        .reduce((sum, t) => sum + t.amount_cents, 0);
      const lastMonthRevenue = (topupRes.data || [])
        .filter((t) => new Date(t.created_at) >= lastMonthStart && new Date(t.created_at) < lastMonthEnd)
        .reduce((sum, t) => sum + t.amount_cents, 0);

      const refundTotal = (txRes.data || [])
        .filter((tx) => tx.amount < 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      // Order value (credits spent on orders)
      const orderTotalValue = (ordersRes.data || [])
        .filter((o: any) => o.status === 'completed')
        .reduce((sum: number, o: any) => sum + o.cost_credits, 0);
      const orderMonthValue = (ordersRes.data || [])
        .filter((o: any) => o.status === 'completed' && new Date(o.completed_at || o.created_at) >= monthStart)
        .reduce((sum: number, o: any) => sum + o.cost_credits, 0);
      const orderInProgress = (ordersRes.data || [])
        .filter((o: any) => ['pending', 'processing'].includes(o.status))
        .reduce((sum: number, o: any) => sum + o.cost_credits, 0);

      setStats({
        totalRevenue: total,
        monthRevenue,
        lastMonthRevenue,
        refundTotal,
        netRevenue: total - refundTotal,
        orderCount: (topupRes.data || []).length,
        mom: lastMonthRevenue > 0 ? ((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : 0,
        orderTotalValue,
        orderMonthValue,
        orderInProgress,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useRealtimeRefresh({ table: 'reddit_topup_requests' }, () => load());
  useRealtimeRefresh({ table: 'credit_transactions', event: 'INSERT' }, () => load());
  useRealtimeRefresh({ table: 'reddit_upvote_orders' }, () => load());

  if (loading || !stats) {
    return (
      <AdminLayout>
        <div className="p-6 md:p-10">
          <p className="text-slate-500">Loading finance data...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Finance' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Finance</h1>
            <p className="text-slate-600 mt-1">Revenue, refunds, and cash flow · live every 15s</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <div className="p-8 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
            <div className="relative">
              <p className="text-xs text-emerald-100 uppercase tracking-widest font-semibold">💵 Cash revenue · PayPal top-ups</p>
              <p className="text-5xl font-bold mt-2">{formatUSD(stats.totalRevenue)}</p>
              <p className="text-sm text-emerald-100 mt-3">All-time, gross · Real money received</p>
            </div>
          </div>

          <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-orange-500/20 rounded-full blur-3xl" />
            <div className="relative">
              <p className="text-xs text-slate-300 uppercase tracking-widest font-semibold">📅 This month · PayPal cash</p>
              <p className="text-5xl font-bold mt-2">{formatUSD(stats.monthRevenue)}</p>
              <p className={`text-sm mt-3 ${stats.mom >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {stats.mom >= 0 ? '▲' : '▼'} {Math.abs(stats.mom).toFixed(1)}% vs last month
              </p>
            </div>
          </div>
        </div>

        {stats.totalRevenue === 0 && stats.orderTotalValue > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 ring-1 ring-amber-200">
            <p className="text-sm text-amber-900">
              <strong>Why does cash revenue show $0?</strong> You completed orders, but no PayPal payments have come in yet. Either the test client got credits via admin adjustments, or PayPal payments haven't happened. Cash revenue = only money actually charged via PayPal.
            </p>
          </div>
        )}

        {/* Secondary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MiniStat label="Net revenue" value={formatUSD(stats.netRevenue)} icon={DollarSign} />
          <MiniStat label="Refunds issued" value={formatUSD(stats.refundTotal)} icon={ArrowDownCircle} negative />
          <MiniStat label="Last month" value={formatUSD(stats.lastMonthRevenue)} icon={TrendingUp} />
          <MiniStat label="Top-up count" value={stats.orderCount.toString()} icon={CreditCard} />
        </div>

        {/* Order value section */}
        <div className="mb-8 p-5 rounded-2xl bg-white ring-1 ring-slate-200">
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <ShoppingCart size={16} className="text-orange-500" />
            Order value (credits spent by clients)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-200">
              <p className="text-xs uppercase tracking-wider font-semibold text-emerald-700">Delivered (all-time)</p>
              <p className="text-2xl font-bold text-emerald-900 mt-1">{formatUSD(stats.orderTotalValue)}</p>
            </div>
            <div className="p-4 rounded-xl bg-blue-50 ring-1 ring-blue-200">
              <p className="text-xs uppercase tracking-wider font-semibold text-blue-700">Delivered (this month)</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">{formatUSD(stats.orderMonthValue)}</p>
            </div>
            <div className="p-4 rounded-xl bg-amber-50 ring-1 ring-amber-200">
              <p className="text-xs uppercase tracking-wider font-semibold text-amber-700">In-progress queue</p>
              <p className="text-2xl font-bold text-amber-900 mt-1">{formatUSD(stats.orderInProgress)}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            ℹ️ "Revenue" above = actual PayPal top-ups received. "Order value" = credits spent on completed orders.
          </p>
        </div>

        {/* Service pricing matrix — the revenue lever lives with the money it drives */}
        <div className="mb-8">
          <ServicePricingCard />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent top-ups */}
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
              <ArrowUpCircle size={16} className="text-emerald-600" />
              <h2 className="font-bold text-slate-900">Recent revenue ({topups.length})</h2>
            </div>
            {topups.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No completed top-ups yet</p>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {topups.map((t) => (
                  <div key={t.id} className="px-6 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {t.users?.full_name || t.users?.email}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t.payment_method.toUpperCase()} · {new Date(t.created_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <p className="font-bold text-emerald-600">+{formatUSD(t.amount_cents)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Refunds / adjustments */}
          <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
              <ArrowDownCircle size={16} className="text-rose-600" />
              <h2 className="font-bold text-slate-900">Adjustments & refunds ({refunds.length})</h2>
            </div>
            {refunds.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No adjustments yet</p>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {refunds.map((tx) => (
                  <div key={tx.id} className="px-6 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {tx.users?.email}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {tx.metadata?.reason || tx.type}
                      </p>
                    </div>
                    <p className={`font-bold ${tx.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.amount > 0 ? '+' : ''}{formatUSD(tx.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}

function MiniStat({ label, value, icon: Icon, negative }: { label: string; value: string; icon: any; negative?: boolean }) {
  return (
    <div className="p-5 rounded-xl bg-white ring-1 ring-slate-200">
      <div className={`w-9 h-9 rounded-lg ${negative ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'} flex items-center justify-center mb-3`}>
        <Icon size={16} />
      </div>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}
