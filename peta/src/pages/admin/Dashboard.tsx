import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, ListChecks, ClipboardCheck, Link as LinkIcon, ArrowUpRight, Trophy } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { adminGetReferralLeaderboard } from '../../lib/api';

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

  const { data: leaderboard = [] } = useQuery({
    queryKey: ['referralLeaderboard'],
    queryFn: () => adminGetReferralLeaderboard(10),
    refetchInterval: 60_000,
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
    { href: '/admin/team',      label: 'PeTa Army',      sub: 'Lihat semua member army' },
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

      {/* Referral leaderboard — top 10 by signups */}
      <div className="flex items-center justify-between mt-8 mb-3">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted flex items-center gap-2">
          <Trophy size={14} className="text-yellow-500" /> Top referrers
        </h2>
        <span className="text-[11px] text-muted">live · refresh tiap 60s</span>
      </div>
      {leaderboard.length === 0 ? (
        <Card padding="sm" className="text-center text-muted text-sm">Belum ada referral activity</Card>
      ) : (
        <Card padding="sm" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-1.5 pr-2 text-[10px] uppercase font-bold text-muted">Member</th>
                <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">Klik</th>
                <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">Daftar</th>
                <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">CR</th>
                <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">Cuan</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={row.user_id} className="border-b border-border last:border-0 hover:bg-light/50">
                  <td className="py-2 pr-2 min-w-0">
                    <p className="font-bold truncate">
                      {i < 3 && <span className="mr-1">{['🥇','🥈','🥉'][i]}</span>}
                      {row.full_name || row.email.split('@')[0]}
                    </p>
                    <p className="text-[10px] text-muted truncate">{row.ref_code}</p>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {row.unique_clicks}
                    {row.total_clicks !== row.unique_clicks && (
                      <span className="text-[10px] text-muted ml-0.5">/{row.total_clicks}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-bold">{row.signups}</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {Number(row.conversion_rate).toFixed(1)}%
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums money font-bold text-success">
                    Rp{Number(row.total_earned).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}
