import { useEffect, useState, useRef } from 'react';
import { Bell, MessageSquare, ShoppingCart, Star, DollarSign, Info, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getMyNotifications,
  getUnreadNotificationsCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../../../lib/supabase';

interface NotificationBellProps {
  targetRole: 'user' | 'admin';
  variant?: 'light' | 'dark';
}

const ICON_BY_TYPE: Record<string, any> = {
  message: MessageSquare,
  order_status: ShoppingCart,
  review: Star,
  credit: DollarSign,
  payment: DollarSign,
  general: Info,
};

const COLOR_BY_TYPE: Record<string, string> = {
  message: 'bg-blue-100 text-blue-600',
  order_status: 'bg-amber-100 text-amber-600',
  review: 'bg-yellow-100 text-yellow-600',
  credit: 'bg-emerald-100 text-emerald-600',
  payment: 'bg-emerald-100 text-emerald-600',
  general: 'bg-slate-100 text-slate-600',
};

export function NotificationBell({ targetRole, variant = 'light' }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const [list, count] = await Promise.all([
        getMyNotifications(targetRole, 15),
        getUnreadNotificationsCount(targetRole),
      ]);
      setNotifications(list);
      setUnreadCount(count);
    } catch {
      // silently fail — non-critical
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id || null));
    refresh();
  }, [targetRole]);

  // Real-time updates via Supabase Realtime — replaces polling
  useRealtimeRefresh(
    {
      table: 'notifications',
      event: '*',
      filter: userId ? `user_id=eq.${userId}` : undefined,
    },
    () => refresh(),
    [userId, targetRole]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNotificationClick = async (n: any) => {
    if (!n.is_read) {
      await markNotificationRead(n.id);
      refresh();
    }
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead(targetRole);
    refresh();
  };

  const buttonClasses = variant === 'dark'
    ? 'p-2 rounded-lg hover:bg-slate-800 text-white'
    : 'p-2 rounded-lg hover:bg-slate-100 text-slate-700';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`relative ${buttonClasses}`}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 z-50 max-h-[70vh] flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Notifications</h3>
              {unreadCount > 0 && (
                <p className="text-xs text-slate-500">{unreadCount} unread</p>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-semibold text-orange-600 hover:text-orange-700"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Check size={24} className="mx-auto text-emerald-500 mb-2" />
                <p className="text-sm font-semibold text-slate-900">All caught up</p>
                <p className="text-xs text-slate-500 mt-1">No notifications yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((n) => {
                  const Icon = ICON_BY_TYPE[n.type] || Info;
                  const colorClass = COLOR_BY_TYPE[n.type] || COLOR_BY_TYPE.general;
                  const inner = (
                    <div className={`px-4 py-3 hover:bg-slate-50 flex gap-3 ${!n.is_read ? 'bg-orange-50/30' : ''}`}>
                      <div className={`w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center shrink-0`}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!n.is_read ? 'font-bold' : 'font-semibold'} text-slate-900 truncate`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-slate-600 truncate mt-0.5">{n.body}</p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1">
                          {formatRelativeTime(n.created_at)}
                        </p>
                      </div>
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-orange-500 mt-2 shrink-0" />
                      )}
                    </div>
                  );

                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link to={n.link} onClick={() => handleNotificationClick(n)}>
                          {inner}
                        </Link>
                      ) : (
                        <button onClick={() => handleNotificationClick(n)} className="w-full text-left">
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
