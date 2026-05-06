import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, ListChecks, ClipboardCheck, Link as LinkIcon, ArrowUpRight } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';

export function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['adminStats'],
    queryFn: async () => {
      const [users, accounts, tasks, pending, payouts] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'army'),
        supabase.from('reddit_accounts').select('id', { count: 'exact', head: true }),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('task_assignments').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('payouts').select('amount', { count: 'exact' }).eq('status', 'pending'),
      ]);

      const pendingPayoutTotal = (payouts.data || []).reduce((s: number, p: any) => s + p.amount, 0);

      return {
        users: users.count || 0,
        accounts: accounts.count || 0,
        tasks: tasks.count || 0,
        pending: pending.count || 0,
        pendingPayouts: payouts.count || 0,
        pendingPayoutTotal,
      };
    },
  });

  const cards = [
    { label: 'Army',         value: stats?.users ?? '–',    icon: Users,           color: 'text-blue-600',   bg: 'bg-blue-50' },
    { label: 'Akun Reddit',  value: stats?.accounts ?? '–', icon: LinkIcon,        color: 'text-emerald-600',bg: 'bg-emerald-50' },
    { label: 'Task Aktif',   value: stats?.tasks ?? '–',    icon: ListChecks,      color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Approval',     value: stats?.pending ?? '–',  icon: ClipboardCheck,  color: 'text-orange-600', bg: 'bg-orange-50' },
  ];

  const actions = [
    { href: '/admin/approval',  label: 'Approval Queue', sub: `${stats?.pending ?? 0} menunggu review`, urgent: (stats?.pending ?? 0) > 0 },
    { href: '/admin/payroll',   label: 'Payroll',        sub: `${stats?.pendingPayouts ?? 0} payout • Rp${(stats?.pendingPayoutTotal ?? 0).toLocaleString('id-ID')}`, urgent: (stats?.pendingPayouts ?? 0) > 0 },
    { href: '/admin/tasks',     label: 'Task Queue',     sub: 'Buat & kelola task' },
    { href: '/admin/team',      label: 'Tim Army',       sub: 'Lihat semua member' },
    { href: '/admin/accounts',  label: 'Akun Reddit',    sub: 'Sync karma & monitoring' },
  ];

  return (
    <Layout userRole="admin">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Dashboard</h1>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} padding="sm">
            <div className={`w-9 h-9 rounded-lg ${bg} ${color} grid place-items-center mb-2`}>
              <Icon size={18} />
            </div>
            <p className="text-xs text-muted">{label}</p>
            <p className="text-2xl sm:text-3xl font-extrabold money">{value}</p>
          </Card>
        ))}
      </div>

      {/* Quick action cards */}
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted mb-3">Quick actions</h2>
      <div className="space-y-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            to={a.href}
            className="block tap-shrink"
          >
            <Card padding="sm" className={`flex items-center justify-between gap-3 ${a.urgent ? 'ring-2 ring-orange-400' : ''}`}>
              <div className="min-w-0">
                <p className="font-bold flex items-center gap-2">
                  {a.label}
                  {a.urgent && <span className="bg-orange-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">!</span>}
                </p>
                <p className="text-xs text-muted truncate">{a.sub}</p>
              </div>
              <ArrowUpRight size={20} className="text-muted shrink-0" />
            </Card>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
