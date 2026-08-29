import { useEffect, useMemo, useState } from 'react';
import { Activity, HeartPulse, Loader2, MailWarning, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminBreadcrumb, AdminLayout } from '../../components/AdminLayout';
import { getAdminClientHealth, runChurnSweep, type ClientHealth, type ClientHealthSegment } from '../../lib/api';

const SEGMENT_META: Record<ClientHealthSegment, { label: string; chip: string; help: string }> = {
  active: { label: 'Active', chip: 'bg-emerald-100 text-emerald-700', help: 'Ordered in the last 14 days' },
  new: { label: 'New', chip: 'bg-blue-100 text-blue-700', help: 'Signed up recently, no orders yet' },
  cooling: { label: 'Cooling', chip: 'bg-amber-100 text-amber-700', help: 'No orders for 14–30 days' },
  at_risk: { label: 'At risk', chip: 'bg-orange-100 text-orange-700', help: 'No orders for 30–60 days' },
  dormant: { label: 'Dormant', chip: 'bg-rose-100 text-rose-700', help: 'No orders for 60+ days' },
  never_activated: { label: 'Never ordered', chip: 'bg-slate-100 text-slate-600', help: 'Signed up 14+ days ago, no orders yet' },
};

const SEGMENT_ORDER: ClientHealthSegment[] = ['active', 'new', 'cooling', 'at_risk', 'dormant', 'never_activated'];

function formatUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AdminRetention() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ClientHealth[]>([]);
  const [sweeping, setSweeping] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await getAdminClientHealth());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load client health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(SEGMENT_ORDER.map((s) => [s, 0])) as Record<ClientHealthSegment, number>;
    for (const r of rows) c[r.segment] = (c[r.segment] || 0) + 1;
    return c;
  }, [rows]);

  const totalSpend = useMemo(
    () => rows.reduce((acc, r) => acc + (r.lifetime_spent_cents || 0), 0),
    [rows]
  );

  const sweep = async () => {
    setSweeping(true);
    try {
      const res = await runChurnSweep();
      const total = res.first_order_nudges + res.reengagements + res.balance_reminders;
      toast.success(
        total === 0
          ? 'Sweep done — no one needed a nudge'
          : `Sweep sent ${total} email${total === 1 ? '' : 's'} (${res.first_order_nudges} first-order, ${res.reengagements} re-engagement, ${res.balance_reminders} balance)`
      );
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Retention' }]} />

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 text-orange-600 mb-2">
              <HeartPulse size={20} />
              <p className="text-xs uppercase tracking-widest font-bold">Churn Prevention</p>
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Client Retention</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              A daily job emails clients who go quiet: new sign-ups who never order, buyers inactive for 2+ weeks,
              and idle credit balances. The same nudge is never sent twice within its window.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-semibold"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh
            </button>
            <button
              onClick={sweep}
              disabled={sweeping}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm font-semibold"
            >
              {sweeping ? <Loader2 size={15} className="animate-spin" /> : <MailWarning size={15} />}
              Run sweep now
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {SEGMENT_ORDER.filter((s) => s !== 'never_activated').map((s) => (
            <div key={s} className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${SEGMENT_META[s].chip}`}>
                {SEGMENT_META[s].label}
              </span>
              <div className="text-3xl font-bold text-slate-900 mt-2">{counts[s]}</div>
              <p className="text-xs text-slate-500 mt-1">{SEGMENT_META[s].help}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 mb-6 flex flex-wrap items-center gap-x-8 gap-y-2">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Activity size={16} className="text-orange-600" />
            <span><span className="font-bold text-slate-900">{rows.length}</span> clients tracked</span>
          </div>
          <div className="text-sm text-slate-600">
            Lifetime spend: <span className="font-bold text-slate-900">{formatUSD(totalSpend)}</span>
          </div>
          <div className="text-sm text-slate-600">
            Never ordered: <span className="font-bold text-slate-900">{counts.never_activated}</span>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-slate-600">Loading client health...</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-slate-600">No clients yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="px-5 py-3 font-semibold">Client</th>
                    <th className="px-5 py-3 font-semibold">Segment</th>
                    <th className="px-5 py-3 font-semibold">Orders</th>
                    <th className="px-5 py-3 font-semibold">Spent</th>
                    <th className="px-5 py-3 font-semibold">Balance</th>
                    <th className="px-5 py-3 font-semibold">Last order</th>
                    <th className="px-5 py-3 font-semibold">Last login</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = SEGMENT_META[r.segment] || SEGMENT_META.never_activated;
                    return (
                      <tr key={r.user_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-5 py-3">
                          <p className="font-semibold text-slate-900">{r.full_name || '—'}</p>
                          <p className="text-xs text-slate-500">{r.email}</p>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${meta.chip}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-700">
                          {r.total_orders}
                          {r.completed_orders > 0 && (
                            <span className="text-xs text-slate-500"> ({r.completed_orders} done)</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-700">{formatUSD(r.lifetime_spent_cents || 0)}</td>
                        <td className="px-5 py-3 text-slate-700">{formatUSD(r.credit_balance || 0)}</td>
                        <td className="px-5 py-3 text-slate-700">
                          {formatDate(r.last_order_at)}
                          {r.days_since_last_order !== null && (
                            <span className="text-xs text-slate-500"> · {r.days_since_last_order}d ago</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-700">{formatDate(r.last_sign_in_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
