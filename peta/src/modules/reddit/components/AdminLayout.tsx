import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  MessageSquare,
  Users,
  DollarSign,
  Star,
  Lightbulb,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { getAdminUnreadTicketsCount } from '../lib/api';
import { NotificationBell } from './NotificationBell';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = async () => {
    try {
      const count = await getAdminUnreadTicketsCount();
      setUnreadCount(count);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/reddit/login');
        return;
      }
      setUserEmail(user.email || '');
      refreshUnread();
    })();
  }, [navigate]);

  // Realtime updates instead of polling
  useRealtimeRefresh({ table: 'order_tickets', event: 'UPDATE' }, refreshUnread);
  useRealtimeRefresh({ table: 'ticket_messages', event: 'INSERT' }, refreshUnread);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/reddit/login');
  };

  const navItems = [
    { href: '/reddit/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
    { href: '/reddit/admin/orders', label: 'Orders', icon: ShoppingCart },
    { href: '/reddit/admin/tickets', label: 'Messages', icon: MessageSquare, badge: unreadCount },
    { href: '/reddit/admin/clients', label: 'Clients', icon: Users },
    { href: '/reddit/admin/reviews', label: 'Reviews', icon: Star },
    { href: '/reddit/admin/feature-requests', label: 'Feature Requests', icon: Lightbulb },
    { href: '/reddit/admin/finance', label: 'Finance', icon: DollarSign },
  ];

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return location.pathname === href;
    return location.pathname.startsWith(href);
  };

  return (
    <div className="min-h-dvh bg-slate-100 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 bg-slate-900 text-white sticky top-0 h-dvh">
        <div className="p-6 border-b border-slate-800">
          <Link to="/reddit/admin" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white font-bold">
              R
            </div>
            <div>
              <div className="font-bold">RedditBoost</div>
              <div className="text-xs text-slate-400">Admin Console</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon size={18} />
                  {item.label}
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold min-w-[20px] text-center">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <Link
            to="/reddit/dashboard"
            className="block px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ← View as client
          </Link>
        </div>

        <div className="p-3 border-t border-slate-800">
          <div className="px-3 py-2 mb-1">
            <div className="text-xs text-slate-400 truncate">Signed in as</div>
            <div className="text-sm font-semibold truncate">{userEmail}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-slate-900 text-white">
        <div className="h-14 px-4 flex items-center justify-between">
          <Link to="/reddit/admin" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center text-white text-sm font-bold">R</div>
            <span className="font-bold">Admin</span>
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell targetRole="admin" variant="dark" />
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg hover:bg-slate-800"
              aria-label="Menu"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-72 bg-slate-900 text-white p-6 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <span className="font-bold">Admin Menu</span>
              <button onClick={() => setMobileOpen(false)} className="p-1">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                      isActive(item.href, item.exact)
                        ? 'bg-orange-500 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="space-y-2 pt-4 border-t border-slate-800">
              <Link to="/reddit/dashboard" className="block px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 rounded-lg">
                ← View as client
              </Link>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 md:ml-0 mt-14 md:mt-0 flex flex-col">
        {/* Desktop top bar */}
        <div className="hidden md:flex sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-6 h-14 items-center justify-end gap-3">
          <NotificationBell targetRole="admin" variant="light" />
        </div>
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}

// Reusable breadcrumb component
export function AdminBreadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="flex items-center gap-1 text-sm text-slate-500 mb-4">
      {items.map((item, idx) => (
        <span key={idx} className="flex items-center gap-1">
          {idx > 0 && <ChevronRight size={14} />}
          {item.href ? (
            <Link to={item.href} className="hover:text-slate-900">{item.label}</Link>
          ) : (
            <span className="text-slate-900 font-semibold">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
