import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Wallet, Clock, LogOut, Shield, Menu, X, Star, Sparkles, ExternalLink, Lightbulb } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { formatUSD, getUnreadOrderNotificationsCount, getReviewableOrders } from '../lib/api';
import { NotificationBell } from './NotificationBell';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface RedditLayoutProps {
  children: ReactNode;
  showAdminLink?: boolean;
}

export function RedditLayout({ children, showAdminLink = false }: RedditLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { balance } = useRedditCredits();
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [unreadOrders, setUnreadOrders] = useState(0);
  const [reviewableOrders, setReviewableOrders] = useState<any[]>([]);
  const [reviewBannerDismissed, setReviewBannerDismissed] = useState<boolean>(
    () => sessionStorage.getItem('reviewBannerDismissed') === '1'
  );
  const [userId, setUserId] = useState<string | null>(null);

  const refreshBadges = async () => {
    try {
      const [orderCount, reviewable] = await Promise.all([
        getUnreadOrderNotificationsCount(),
        getReviewableOrders(),
      ]);
      setUnreadOrders(orderCount);
      setReviewableOrders(reviewable);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/reddit/login');
        return;
      }
      setUserId(user.id);
      setUserEmail(user.email || '');

      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      setIsAdmin(profile?.role === 'admin');
      refreshBadges();
    })();
  }, [navigate]);

  // Realtime instead of polling
  useRealtimeRefresh(
    { table: 'notifications', filter: userId ? `user_id=eq.${userId}` : undefined },
    refreshBadges,
    [userId]
  );
  useRealtimeRefresh(
    { table: 'reddit_upvote_orders', filter: userId ? `user_id=eq.${userId}` : undefined },
    refreshBadges,
    [userId]
  );
  useRealtimeRefresh(
    { table: 'reviews', filter: userId ? `user_id=eq.${userId}` : undefined },
    refreshBadges,
    [userId]
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/reddit/login');
  };

  const navItems = [
    { href: '/reddit/dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: 0 },
    { href: '/reddit/new-order', label: 'New order', icon: ShoppingCart, badge: 0 },
    { href: '/reddit/orders', label: 'Orders', icon: Clock, badge: unreadOrders },
    { href: '/reddit/topup', label: 'Top up', icon: Wallet, badge: 0 },
    { href: '/reddit/reviews', label: 'Reviews · Earn $25', icon: Star, badge: reviewableOrders.length },
    { href: '/reddit/feature-requests', label: 'Roadmap', icon: Lightbulb, badge: 0 },
  ];

  if (isAdmin && showAdminLink) {
    navItems.push({ href: '/reddit/admin', label: 'Admin', icon: Shield, badge: 0 });
  }

  const isActive = (href: string) => location.pathname === href;

  return (
    <div className="min-h-dvh bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 bg-white border-r border-slate-200 sticky top-0 h-dvh">
        <div className="p-6 border-b border-slate-200">
          <Link to="/reddit" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white font-bold">
              R
            </div>
            <div>
              <div className="font-bold text-slate-900">Straight Ltd</div>
              <div className="text-xs text-slate-500">Pro Dashboard</div>
            </div>
          </Link>
        </div>

        {/* Credit balance card */}
        <div className="m-4 p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Available credit</p>
          <p className="text-3xl font-bold mt-1">{formatUSD(balance)}</p>
          <Link
            to="/reddit/topup"
            className="mt-3 block text-center text-xs font-semibold py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white transition"
          >
            Top up via PayPal
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  active
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon size={18} />
                  {item.label}
                </span>
                {item.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold min-w-[20px] text-center">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
          {isAdmin && !showAdminLink && (
            <Link
              to="/reddit/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <Shield size={18} />
              Admin
            </Link>
          )}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="text-xs text-slate-500 truncate mb-3">{userEmail}</div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200">
        <div className="h-14 px-4 flex items-center justify-between">
          <Link to="/reddit" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center text-white text-sm font-bold">R</div>
            <span className="font-bold text-slate-900">Straight Ltd</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/reddit/topup" className="text-sm font-semibold text-orange-600">
              {formatUSD(balance)}
            </Link>
            <NotificationBell targetRole="user" variant="light" />
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg hover:bg-slate-100"
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
          <div className="absolute right-0 top-0 bottom-0 w-72 bg-white p-6 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <span className="font-bold">Menu</span>
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
                      isActive(item.href)
                        ? 'bg-orange-50 text-orange-700'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </span>
                    {item.badge > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-3 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-0 mt-14 md:mt-0 flex flex-col">
        {/* Desktop top bar */}
        <div className="hidden md:flex sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 h-14 items-center justify-end gap-3">
          <NotificationBell targetRole="user" variant="light" />
        </div>

        {/* CRO Review banner — shows on every page when there are reviewable orders */}
        {!reviewBannerDismissed && reviewableOrders.length > 0 && location.pathname !== '/reddit/reviews' && (
          <div className="sticky top-14 z-20 bg-gradient-to-r from-orange-500 to-amber-500 text-white px-4 md:px-6 py-3 shadow-md">
            <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="hidden md:flex w-10 h-10 rounded-lg bg-white/20 items-center justify-center shrink-0">
                  <Sparkles size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm md:text-base">
                    ⭐ Earn up to $25 in free credits
                  </p>
                  <p className="text-xs text-orange-50 hidden md:block">
                    {reviewableOrders.length === 1 ? '1 order ready' : `${reviewableOrders.length} orders ready`} · $5 here + $10 Trustpilot + $10 advise.so · 60 sec each
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <RouterLink
                  to={reviewableOrders.length === 1
                    ? `/reddit/orders/${reviewableOrders[0].id}`
                    : '/reddit/reviews'}
                  className="px-3 md:px-4 py-1.5 rounded-lg bg-white text-orange-600 hover:bg-orange-50 text-xs md:text-sm font-bold inline-flex items-center gap-1 whitespace-nowrap"
                >
                  Leave review
                  <ExternalLink size={12} />
                </RouterLink>
                <button
                  onClick={() => {
                    setReviewBannerDismissed(true);
                    sessionStorage.setItem('reviewBannerDismissed', '1');
                  }}
                  className="p-1.5 rounded hover:bg-white/10"
                  aria-label="Dismiss"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
