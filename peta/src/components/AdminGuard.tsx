import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from './Toast';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = React.useState<'checking' | 'allowed' | 'denied'>('checking');

  const isRedditPath = location.pathname.startsWith('/reddit');
  const loginPath = isRedditPath ? '/reddit/login' : '/login';
  const fallbackPath = isRedditPath ? '/reddit/dashboard' : '/tasks';
  const accessDeniedMsg = isRedditPath
    ? 'Admin access required.'
    : 'Halaman ini khusus admin.';
  const loginRequiredMsg = isRedditPath
    ? 'Please sign in as an admin.'
    : 'Login dulu sebagai admin.';

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          toast.error(loginRequiredMsg);
          navigate(loginPath);
        }
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.role === 'admin') {
        setState('allowed');
      } else {
        toast.error(accessDeniedMsg);
        navigate(fallbackPath);
        setState('denied');
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, loginPath, fallbackPath, accessDeniedMsg, loginRequiredMsg]);

  if (state !== 'allowed') return null;
  return <>{children}</>;
}
