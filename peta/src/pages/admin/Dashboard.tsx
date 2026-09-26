import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, ListChecks, ClipboardCheck, Link as LinkIcon, ArrowUpRight, Trophy, CheckCircle2, XCircle, TrendingUp, DollarSign, ShieldAlert, ShieldCheck, AlertTriangle, Flame, Target } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { supabase } from '../../lib/supabase';
import { adminGetReferralLeaderboard } from '../../lib/api';

export function AdminDashboard() {
  const { data: growth } = useQuery({
    queryKey: ['adminGrowthDashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_growth_dashboard', { p_days: 14 });
      if (error) {
        console.warn('admin_get_growth_dashboard error:', error);
        return null;
      }
      return data;
    },
    refetchInterval: 30_000,
  });
  const { data: stats } = useQuery({
    queryKey: ['adminStats'],
    queryFn: async () => {
      const [users, accounts, tasks, pending, payouts, approved, rejected, totalPayouts, recentSignups, platformStats] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'army'),
        supabase.from('reddit_accounts').select('id', { count: 'exact', head: true }),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('task_assignments').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('payouts').select('amount', { count: 'exact' }).eq('status', 'pending'),
        supabase.from('task_assignments').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase.from('task_assignments').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
        supabase.from('payouts').select('amount').eq('status', 'paid'),
        supabase.from('users').select('id', { count: 'exact', head: true })
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
          .eq('role', 'army'),
        supabase.from('task_assignments').select('id, tasks!inner(task_category, target_url)')
          .not('tasks.task_category', 'is', null),
      ]);

      const pendingPayoutTotal = (payouts.data || []).reduce((s: number, p: any) => s + p.amount, 0);
      const totalPaid = (totalPayouts.data || []).reduce((s: number, p: any) => s + p.amount, 0);
      const approvedCount = approved.count || 0;
      const rejectedCount = rejected.count || 0;
      const totalDecided = approvedCount + rejectedCount;
      const completionRate = totalDecided > 0 ? Math.round((approvedCount / totalDecided) * 100) : 0;

      // Platform breakdown from assignments
      const platforms: Record<string, number> = {};
      for (const a of (platformStats.data || [])) {
        const url = (a as any)?.tasks?.target_url || '';
        const cat = (a as any)?.tasks?.task_category || '';
        let platform = 'Lainnya';
        if (/reddit\.com/i.test(url) || cat.startsWith('reddit')) platform = 'Reddit';
        else if (/hubspot\.com/i.test(url)) platform = 'HubSpot';
        else if (/quora\.com/i.test(url)) platform = 'Quora';
        else if (/facebook\.com|fb\.com/i.test(url)) platform = 'Facebook';
        else if (/youtube\.com|youtu\.be/i.test(url)) platform = 'YouTube';
        platforms[platform] = (platforms[platform] || 0) + 1;
      }

      return {
        users: users.count || 0,
        accounts: accounts.count || 0,
        tasks: tasks.count || 0,
        pending: pending.count || 0,
        pendingPayouts: payouts.count || 0,
        pendingPayoutTotal,
        approvedCount,
        rejectedCount,
        completionRate,
        totalPaid,
        recentSignups: recentSignups.count || 0,
        platforms,
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

  const analyticsCards = [
    { label: 'Approved',       value: stats?.approvedCount ?? 0, icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
    { label: 'Rejected',       value: stats?.rejectedCount ?? 0, icon: XCircle,      color: 'text-danger',  bg: 'bg-danger/10' },
    { label: 'Completion Rate', value: `${stats?.completionRate ?? 0}%`, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Total Paid',     value: `Rp${(stats?.totalPaid ?? 0).toLocaleString('id-ID')}`, icon: DollarSign, color: 'text-success', bg: 'bg-success/10' },
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

      {/* OPERATING SUPPLY GATE — PIC Growth Engine */}
      {growth?.gate && (
        <Card className={`mb-6 p-4 border-2 ${
          growth.gate.status === 'STOP'
            ? 'border-red-400 bg-red-50/50'
            : growth.gate.status === 'LOW'
            ? 'border-yellow-400 bg-yellow-50/50'
            : 'border-emerald-400 bg-emerald-50/40'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/5">
            <div className="flex items-center gap-2.5">
              {growth.gate.status === 'STOP' ? (
                <div className="w-9 h-9 rounded-xl bg-red-500 text-white grid place-items-center shrink-0">
                  <ShieldAlert size={20} />
                </div>
              ) : growth.gate.status === 'LOW' ? (
                <div className="w-9 h-9 rounded-xl bg-yellow-500 text-white grid place-items-center shrink-0">
                  <AlertTriangle size={20} />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white grid place-items-center shrink-0">
                  <ShieldCheck size={20} />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-dark">Operating Supply Gate</h2>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${
                    growth.gate.status === 'STOP'
                      ? 'bg-red-600 text-white'
                      : growth.gate.status === 'LOW'
                      ? 'bg-yellow-600 text-white'
                      : 'bg-emerald-600 text-white'
                  }`}>
                    GATE {growth.gate.status}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {growth.gate.status === 'STOP'
                    ? 'Slot task habis (0). Hentikan promosi / referral push, cari supply task baru.'
                    : growth.gate.status === 'LOW'
                    ? 'Slot task menipis dibanding active army. Prioritaskan aktivasi, jangan scale iklan.'
                    : 'Supply task aman. Siap menerima demand army baru.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-bold shrink-0">
              <div>
                <span className="text-muted block text-[10px] uppercase">Open Slots</span>
                <span className="text-lg font-black text-dark">{growth.gate.open_slots}</span>
              </div>
              <div>
                <span className="text-muted block text-[10px] uppercase">Active Army (14d)</span>
                <span className="text-lg font-black text-primary">{growth.gate.active_army_14d}</span>
              </div>
              <div>
                <span className="text-muted block text-[10px] uppercase">Review Backlog</span>
                <span className="text-lg font-black text-orange-600">{growth.gate.submitted_backlog}</span>
              </div>
            </div>
          </div>

          {/* First-task funnel metrics */}
          <div className="pt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
            <div className="bg-white/80 rounded-lg p-2 ring-1 ring-black/5">
              <span className="text-[10px] text-muted block uppercase">Daftar Army</span>
              <span className="font-extrabold text-base">{growth.funnel?.total_registered_army ?? 0}</span>
            </div>
            <div className="bg-white/80 rounded-lg p-2 ring-1 ring-black/5">
              <span className="text-[10px] text-muted block uppercase">Onboarded</span>
              <span className="font-extrabold text-base text-blue-600">{growth.funnel?.onboarded_total ?? 0}</span>
            </div>
            <div className="bg-white/80 rounded-lg p-2 ring-1 ring-black/5">
              <span className="text-[10px] text-muted block uppercase">Ever Claim</span>
              <span className="font-extrabold text-base text-purple-600">{growth.funnel?.ever_claimed_task ?? 0}</span>
            </div>
            <div className="bg-white/80 rounded-lg p-2 ring-1 ring-black/5">
              <span className="text-[10px] text-muted block uppercase">Ever Approved</span>
              <span className="font-extrabold text-base text-emerald-600">{growth.funnel?.ever_approved_task ?? 0}</span>
            </div>
            <div className="bg-white/80 rounded-lg p-2 ring-1 ring-black/5 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-muted block uppercase font-bold text-primary">Active Army (14d)</span>
              <span className="font-black text-base text-primary">{growth.funnel?.active_14d_north_star ?? 0}</span>
            </div>
          </div>
        </Card>
      )}

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

      {/* Analytics metrics */}
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted mb-3 mt-6">Analytics</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {analyticsCards.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} padding="sm">
            <div className={`w-8 h-8 rounded-lg ${bg} ${color} grid place-items-center mb-1.5`}>
              <Icon size={16} />
            </div>
            <p className="text-[10px] text-muted">{label}</p>
            <p className="text-lg font-extrabold">{value}</p>
          </Card>
        ))}
      </div>

      {/* Platform breakdown */}
      {stats?.platforms && Object.keys(stats.platforms).length > 0 && (
        <Card padding="sm" className="mb-6">
          <p className="text-[10px] uppercase font-bold text-muted mb-2">Platform breakdown</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.platforms)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <div key={name} className="text-center">
                  <p className="text-lg font-extrabold">{count}</p>
                  <p className="text-[10px] text-muted">{name}</p>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Recent signups */}
      {(stats?.recentSignups ?? 0) > 0 && (
        <Card padding="sm" className="mb-6 bg-blue-50 ring-1 ring-blue-200">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            <p className="text-sm font-bold text-blue-900">
              {stats?.recentSignups} member baru dalam 7 hari terakhir
            </p>
          </div>
        </Card>
      )}

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

      {/* Campaign Attribution */}
      {growth?.campaigns && growth.campaigns.length > 0 && (
        <div className="mt-8 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted flex items-center gap-2">
              <Target size={14} className="text-primary" /> Campaign & Channel Attribution
            </h2>
            <span className="text-[11px] text-muted">first-touch attribution</span>
          </div>
          <Card padding="sm" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-1.5 pr-2 text-[10px] uppercase font-bold text-muted">Kanal / Source</th>
                  <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted">Campaign</th>
                  <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">Daftar</th>
                  <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">Onboarded</th>
                  <th className="py-1.5 px-2 text-[10px] uppercase font-bold text-muted text-right">CR Onboard</th>
                </tr>
              </thead>
              <tbody>
                {growth.campaigns.map((c: any, i: number) => {
                  const cr = c.signups > 0 ? ((c.onboarded / c.signups) * 100).toFixed(1) : '0';
                  return (
                    <tr key={`${c.source}-${c.campaign}-${i}`} className="border-b border-border last:border-0 hover:bg-light/50">
                      <td className="py-2 pr-2 font-bold">{c.source}</td>
                      <td className="py-2 px-2 text-xs text-muted">{c.campaign}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-bold">{c.signups}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-blue-600 font-bold">{c.onboarded}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs">{cr}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Reactivation Segments Quick Action */}
      {growth?.reactivation_segments && (
        <div className="mt-8 mb-6">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted mb-3 flex items-center gap-2">
            <Flame size={14} className="text-orange-500" /> Reactivation & Operational Follow-ups
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card padding="sm" className="bg-orange-50/50 border border-orange-200">
              <p className="text-[10px] uppercase font-bold text-orange-800">Task Belum Submit (&gt;6 jam)</p>
              <p className="text-2xl font-black text-orange-600">{growth.reactivation_segments.stalled_claims ?? 0}</p>
              <p className="text-xs text-muted mt-1">Assignment in-progress yang belum kirim bukti</p>
            </Card>

            <Card padding="sm" className="bg-blue-50/50 border border-blue-200">
              <p className="text-[10px] uppercase font-bold text-blue-800">Menunggu Review Admin</p>
              <p className="text-2xl font-black text-blue-600">{growth.reactivation_segments.submitted_awaiting_approval ?? 0}</p>
              <p className="text-xs text-muted mt-1">
                <Link to="/admin/approval" className="underline font-bold text-blue-700">Buka Approval Queue →</Link>
              </p>
            </Card>

            <Card padding="sm" className="bg-emerald-50/50 border border-emerald-200">
              <p className="text-[10px] uppercase font-bold text-emerald-800">Opt-in Notifikasi WA</p>
              <p className="text-2xl font-black text-emerald-600">{growth.reactivation_segments.opted_in_reactivation ?? 0}</p>
              <p className="text-xs text-muted mt-1">
                <Link to="/admin/broadcast" className="underline font-bold text-emerald-700">Kirim Broadcast Task →</Link>
              </p>
            </Card>
          </div>
        </div>
      )}
    </Layout>
  );
}
