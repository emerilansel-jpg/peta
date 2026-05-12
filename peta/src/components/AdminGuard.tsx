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

    const checkAccess = async (session: any) => {
      if (cancelled) return;
      if (!session) {
        toast.error(loginRequiredMsg);
        navigate(loginPath);
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.role === 'admin') {
        setState('allowed');
      } else {
        toast.error(accessDeniedMsg);
        navigate(fallbackPath);
        setState('denied');
      }
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        checkAccess(session);
        return;
      }
      // No session yet — wait for OAuth hash if present
      const hasOAuthHash =
        typeof window !== 'undefined' && window.location.hash.includes('access_token');
      if (hasOAuthHash) {
        const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
          if (event === 'SIGNED_IN' && s) {
            sub.subscription.unsubscribe();
            checkAccess(s);
          }
        });
        setTimeout(() => {
          if (!cancelled) {
            sub.subscription.unsubscribe();
            supabase.auth.getSession().then(({ data }) => checkAccess(data.session));
          }
        }, 4000);
        return;
      }
      checkAccess(null);
    })();
    return () => { cancelled = true; };
  }, [navigate, loginPath, fallbackPath, accessDeniedMsg, loginRequiredMsg]);

  if (state !== 'allowed') return null;
  return <>{children}</>;
}
