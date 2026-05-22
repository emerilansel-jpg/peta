import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Home, Wallet, User as UserIcon, Menu, X, BarChart3, Users, ListChecks, ClipboardCheck, Coins, Link as LinkIcon, ShieldCheck, Megaphone, Target, Inbox, Key, Radio } from 'lucide-react';
import { getMyPendingAssignments } from '../lib/api';
import { supabase } from '../lib/supabase';

// Active broadcast indicator — admins often kick off a long blast (60+ recipients
// at 1.1s pacing = ~70s WA, plus email) then want to do other admin work without
// losing track. The RPC returns any broadcast with pending recipients in the last
// 30 min. The chip sits in the sidebar so it's visible on every admin page.
type ActiveBroadcast = {
  id: string; subject: string; created_at: string;
  total: number; sent: number; failed: number; pending: number; channels: string[];
};

interface LayoutProps {
  children: React.ReactNode;
  userRole?: 'army' | 'admin';
}

// Army-facing nav tabs. Deliberately NO /reddit (Straight Ltd surface) and NO
// admin links here — workers should never see how the platform is sold or
// administered. Admin gets a separate jump-link at the top when their role
// hits the public client area (see <AdminJumpLink/>).
const armyTabs = [
  { href: '/tasks',         label: 'Tugas', icon: Home },
  { href: '/karma-mission', label: 'Karma', icon: Target },
  { href: '/earnings',      label: 'Saldo', icon: Wallet },
  { href: '/account',       label: 'Akun',  icon: UserIcon },
];

const adminLinks = [
  { href: '/admin',           label: 'Dashboard',   icon: BarChart3 },
  { href: '/admin/tasks',     label: 'Task Queue',  icon: ListChecks },
  { href: '/admin/approval',  label: 'Approval',    icon: ClipboardCheck },
  { href: '/admin/accounts',  label: 'Akun Reddit', icon: LinkIcon },
  { href: '/admin/broadcast', label: 'Kirim Pesan', icon: Megaphone },
  { href: '/admin/wa-bot',    label: 'WA Bot',      icon: Radio },
  { href: '/admin/inbox',     label: 'Inbox',       icon: Inbox },
  { href: '/admin/secrets',   label: 'Secrets',     icon: Key },
  { href: '/admin/team',      label: 'Tim',         icon: Users },
  { href: '/admin/payroll',   label: 'Payroll',     icon: Coins },
];

export function Layout({ children, userRole = 'army' }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  // Detect admin role so we can surface a jump-link when admins land in the
  // army area (they can navigate the worker UX but always get one click back
  // to /admin without searching for it).
  const [isAdminUser, setIsAdminUser] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    if (userRole === 'army') {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !mounted) return;
        const { data } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (mounted && data?.role === 'admin') setIsAdminUser(true);
      })();
    }
    return () => { mounted = false; };
  }, [userRole]);

  // Pending task count for the notification dot on the "Tugas" tab. Army
  // users sometimes can't find their own submitted-but-not-approved work,
  // so the badge points them straight at /tasks where the pending list
  // sits above active tasks.
  const { data: pendingAssignments = [] } = useQuery({
    queryKey: ['layoutPendingCount'],
    queryFn: getMyPendingAssignments,
    enabled: userRole === 'army',
    refetchInterval: 180_000,
  });
  const pendingCount = pendingAssignments.filter((a) => a.status === 'submitted').length;
  const rejectedCount = pendingAssignments.filter((a) => a.status === 'rejected').length;
  const tasksBadgeCount = pendingCount + rejectedCount;

  // Poll for in-flight broadcasts only when admin is browsing admin pages.
  // Hits RPC every 5s while the indicator is showing, every 15s when idle —
  // saves quota while still giving live progress feel during blast windows.
  const { data: activeBroadcasts = [] } = useQuery<ActiveBroadcast[]>({
    queryKey: ['adminActiveBroadcasts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_active_broadcasts');
      if (error) throw error;
      return (data || []) as ActiveBroadcast[];
    },
    enabled: userRole === 'admin',
    refetchInterval: (q) => {
      const arr = (q.state.data as ActiveBroadcast[]) || [];
      return arr.length > 0 ? 5_000 : 15_000;
    },
    refetchOnWindowFocus: true,
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const isActive = (href: string) =>
    href === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(href);

  if (userRole === 'admin') {
    return (
      <div className="min-h-dvh bg-light flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:flex-col md:w-60 bg-white ring-1 ring-black/5 sticky top-0 h-dvh">
          <div className="p-5 border-b border-border">
            <Link to="/admin" className="block">
              <img
                src="/logo-horizontal.png"
                alt="PeTa · PenghasilanTambahan.com"
                className="h-12 w-auto"
              />
            </Link>
            <p className="text-xs text-muted mt-1">Admin Console</p>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {adminLinks.map((l) => {
              const Icon = l.icon;
              return (
                <Link
                  key={l.href}
                  to={l.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    isActive(l.href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-dark hover:bg-light'
                  }`}
                >
                  <Icon size={18} />
                  {l.label}
                </Link>
              );
            })}
          </nav>
          {activeBroadcasts.length > 0 && (
            <ActiveBlastChip broadcasts={activeBroadcasts} />
          )}
          <Link
            to="/tasks"
            className="mx-3 mt-2 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-secondary ring-1 ring-secondary/40 hover:bg-secondary/10"
          >
            <Home size={18} /> Lihat Sisi Army
          </Link>
          <button
            onClick={handleLogout}
            className="m-3 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-muted hover:bg-light"
          >
            <LogOut size={18} /> Logout
          </button>
        </aside>

        {/* Floating blast indicator — mobile only. Drawer is usually closed
            while the admin works on Approval / Task Queue, so the sidebar
            chip wouldn't be visible. This pinned pill is. */}
        {activeBroadcasts.length > 0 && (
          <Link
            to="/admin/broadcast"
            className="md:hidden fixed top-20 right-3 z-30 flex items-center gap-1.5 bg-primary text-white text-xs font-extrabold pl-2 pr-3 py-1.5 rounded-full shadow-lg ring-1 ring-primary/40 animate-fade-in"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-white/60 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            Blast {activeBroadcasts[0].sent + activeBroadcasts[0].failed}/{activeBroadcasts[0].total}
          </Link>
        )}

        {/* Mobile top bar */}
        <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-white ring-1 ring-black/5 safe-top">
          <div className="flex items-center justify-between h-16 px-4">
            <Link to="/admin" className="flex items-center gap-2">
              <img src="/logo-horizontal.png" alt="PeTa" className="h-10 w-auto" />
              <span className="text-xs font-bold text-muted">Admin</span>
            </Link>
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 -mr-2 rounded-lg hover:bg-light"
              aria-label="Menu"
            >
              <Menu size={24} />
            </button>
          </div>
        </header>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-50 animate-fade-in">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
            />
            <aside className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-2xl flex flex-col safe-top safe-bottom animate-slide-up">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <p className="font-extrabold text-primary">Menu Admin</p>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 -mr-2 rounded-lg hover:bg-light"
                  aria-label="Tutup"
                >
                  <X size={22} />
                </button>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {adminLinks.map((l) => {
                  const Icon = l.icon;
                  return (
                    <Link
                      key={l.href}
                      to={l.href}
                      onClick={() => setDrawerOpen(false)}
                      className={`flex items-center gap-3 px-3 py-3 rounded-lg text-base font-semibold ${
                        isActive(l.href)
                          ? 'bg-primary/10 text-primary'
                          : 'text-dark hover:bg-light'
                      }`}
                    >
                      <Icon size={20} />
                      {l.label}
                    </Link>
                  );
                })}
              </nav>
              {activeBroadcasts.length > 0 && (
                <ActiveBlastChip broadcasts={activeBroadcasts} compact onClick={() => setDrawerOpen(false)} />
              )}
              <Link
                to="/tasks"
                onClick={() => setDrawerOpen(false)}
                className="mx-3 mt-2 flex items-center gap-2 px-3 py-3 rounded-lg text-base font-semibold text-secondary ring-1 ring-secondary/40 hover:bg-secondary/10"
              >
                <Home size={20} /> Lihat Sisi Army
              </Link>
              <button
                onClick={handleLogout}
                className="m-3 flex items-center gap-2 px-3 py-3 rounded-lg text-base font-semibold text-muted hover:bg-light"
              >
                <LogOut size={20} /> Logout
              </button>
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 pt-16 md:pt-0">
          <div className="container-custom py-5 md:py-8">{children}</div>
        </main>
      </div>
    );
  }

  // Army layout — top mini-bar + bottom tab nav for mobile
  return (
    <div className="min-h-dvh bg-light flex flex-col">
      {/* Top brand bar — small on mobile, full nav on desktop */}
      <header className="bg-white ring-1 ring-black/5 sticky top-0 z-30 safe-top">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/tasks" className="flex items-center" aria-label="PeTa · PenghasilanTambahan.com">
            <img
              src="/logo-horizontal.png"
              alt="PeTa · PenghasilanTambahan.com"
              className="h-12 w-auto"
            />
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {armyTabs.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.href}
                  to={t.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${
                    isActive(t.href) ? 'bg-primary/10 text-primary' : 'text-dark hover:bg-light'
                  }`}
                >
                  <Icon size={18} /> {t.label}
                </Link>
              );
            })}
            {isAdminUser && (
              <Link
                to="/admin"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-primary ring-1 ring-primary/40 hover:bg-primary/10"
              >
                <ShieldCheck size={18} /> Admin
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-muted hover:bg-light"
            >
              <LogOut size={18} /> Logout
            </button>
          </div>
          <div className="md:hidden flex items-center gap-1">
            {isAdminUser && (
              <Link
                to="/admin"
                className="p-2 rounded-lg text-primary hover:bg-primary/10"
                aria-label="Buka Admin Console"
                title="Admin Console"
              >
                <ShieldCheck size={22} />
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="p-2 -mr-2 rounded-lg text-muted hover:bg-light"
              aria-label="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-bottomnav">
        <div className="container-custom py-4 md:py-8">{children}</div>
      </main>

      {/* Bottom tab nav — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-border safe-bottom">
        <div className="grid grid-cols-4 h-16">
          {armyTabs.map((t) => {
            const Icon = t.icon;
            const active = isActive(t.href);
            const showBadge = t.href === '/tasks' && tasksBadgeCount > 0;
            return (
              <Link
                key={t.href}
                to={t.href}
                className={`relative flex flex-col items-center justify-center gap-1 tap-shrink ${
                  active ? 'text-primary' : 'text-muted'
                }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                  {showBadge && (
                    <span className={`absolute -top-1 -right-2 min-w-[16px] h-[16px] grid place-items-center text-[9px] font-extrabold text-white rounded-full px-1 ${
                      rejectedCount > 0 ? 'bg-danger' : 'bg-warning'
                    }`}>
                      {tasksBadgeCount > 9 ? '9+' : tasksBadgeCount}
                    </span>
                  )}
                </div>
                <span className={`text-[11px] ${active ? 'font-bold' : 'font-medium'}`}>
                  {t.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// Visible-everywhere chip that surfaces in-flight broadcasts. Clicking jumps
// the admin to /admin/broadcast (where the full progress bar lives). Mobile
// drawer + desktop sidebar both render this. Animated dot makes "still alive"
// state obvious at a glance — kills the "is it stuck?" anxiety.
function ActiveBlastChip({
  broadcasts, compact, onClick,
}: { broadcasts: ActiveBroadcast[]; compact?: boolean; onClick?: () => void }) {
  // Show the most recent active broadcast; if more, append +N badge.
  const head = broadcasts[0];
  const rest = broadcasts.length - 1;
  const done = head.sent + head.failed;
  const pct = head.total > 0 ? Math.round((done / head.total) * 100) : 0;
  return (
    <Link
      to="/admin/broadcast"
      onClick={onClick}
      className={`mx-3 mt-2 flex items-start gap-2 px-3 ${compact ? 'py-3 text-base' : 'py-2.5 text-sm'} rounded-lg font-semibold bg-primary/10 ring-1 ring-primary/30 text-primary hover:bg-primary/15 transition`}
      aria-label="Broadcast in flight — click to view progress"
    >
      <span className="relative flex h-2.5 w-2.5 mt-1 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <Radio size={compact ? 14 : 12} className="shrink-0" />
          <span className="font-extrabold truncate">Blast jalan</span>
          {rest > 0 && (
            <span className="text-[10px] bg-primary text-white rounded-full px-1.5 py-0.5">+{rest}</span>
          )}
        </span>
        <span className="block text-[11px] font-normal text-primary/80 truncate" title={head.subject}>
          {head.subject}
        </span>
        <span className="block mt-1 text-[10px] font-bold tabular-nums">
          {done}/{head.total} · {pct}%
        </span>
      </span>
    </Link>
  );
}
