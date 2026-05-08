import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Home, Wallet, User as UserIcon, Menu, X, BarChart3, Users, ListChecks, ClipboardCheck, Coins, Link as LinkIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LayoutProps {
  children: React.ReactNode;
  userRole?: 'army' | 'admin';
}

const armyTabs = [
  { href: '/tasks',    label: 'Tugas',     icon: Home },
  { href: '/earnings', label: 'Saldo',     icon: Wallet },
  { href: '/account',  label: 'Akun',      icon: UserIcon },
];

const adminLinks = [
  { href: '/admin',           label: 'Dashboard', icon: BarChart3 },
  { href: '/admin/tasks',     label: 'Task Queue', icon: ListChecks },
  { href: '/admin/approval',  label: 'Approval',   icon: ClipboardCheck },
  { href: '/admin/accounts',  label: 'Akun Reddit', icon: LinkIcon },
  { href: '/admin/team',      label: 'Tim',        icon: Users },
  { href: '/admin/payroll',   label: 'Payroll',    icon: Coins },
];

export function Layout({ children, userRole = 'army' }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

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
                className="h-8 w-auto"
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
          <button
            onClick={handleLogout}
            className="m-3 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-muted hover:bg-light"
          >
            <LogOut size={18} /> Logout
          </button>
        </aside>

        {/* Mobile top bar */}
        <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-white ring-1 ring-black/5 safe-top">
          <div className="flex items-center justify-between h-14 px-4">
            <Link to="/admin" className="flex items-center gap-2">
              <img src="/logo-horizontal.png" alt="PeTa" className="h-7 w-auto" />
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
              <button
                onClick={handleLogout}
                className="m-3 flex items-center gap-2 px-3 py-3 rounded-lg text-base font-semibold text-muted hover:bg-light"
              >
                <LogOut size={20} /> Logout
              </button>
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 pt-14 md:pt-0">
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
        <div className="container-custom flex items-center justify-between h-14">
          <Link to="/tasks" className="flex items-center" aria-label="PeTa · PenghasilanTambahan.com">
            <img
              src="/logo-horizontal.png"
              alt="PeTa · PenghasilanTambahan.com"
              className="h-8 w-auto"
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
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-muted hover:bg-light"
            >
              <LogOut size={18} /> Logout
            </button>
          </div>
          <button
            onClick={handleLogout}
            className="md:hidden p-2 -mr-2 rounded-lg text-muted hover:bg-light"
            aria-label="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 pb-bottomnav">
        <div className="container-custom py-4 md:py-8">{children}</div>
      </main>

      {/* Bottom tab nav — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-border safe-bottom">
        <div className="grid grid-cols-3 h-16">
          {armyTabs.map((t) => {
            const Icon = t.icon;
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                to={t.href}
                className={`flex flex-col items-center justify-center gap-1 tap-shrink ${
                  active ? 'text-primary' : 'text-muted'
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
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
