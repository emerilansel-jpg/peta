import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Client-side auth gate for protected (non-admin) routes: /tasks, /account,
// /earnings, /task/:id, /reddit/* client area, etc. Before this wrapper each
// page re-implemented `supabase.auth.getUser()` + navigate('/login') in its own
// useEffect, which was inconsistent and rendered page shells for unauthenticated
// viewers on first paint.
//
// This is a UX/defense-in-depth guard only. The real authorization boundary is
// Row Level Security on the backend — an attacker cannot read/modify other
// users' data even by spoofing past this client check.
//
// Renders a centered loader (not a blank screen) while the session check is
// in flight, so users on slow links see feedback instead of a white page.

interface RequireAuthProps {
  children: React.ReactNode;
  /** Login path to redirect to when unauthenticated. */
  loginPath?: string;
}

export function RequireAuth({ children, loginPath }: RequireAuthProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Resolve the right login path for the tenant/host. /reddit/* uses the
  // Straight Ltd login; everything else uses the PeTa login. Default to the
  // peer of the current path so the user lands back where they came from.
  const resolvedLogin = loginPath
    ?? (location.pathname.startsWith('/reddit') ? '/reddit/login' : '/login');

  const [state, setState] = React.useState<'checking' | 'ok' | 'denied'>('checking');

  React.useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // Prefer getSession() — it reads from the in-memory/local session and is
      // fast. If it has no session, fall back to getUser() which refreshes
      // from the server (handles tab-open-after-token-refresh edge cases).
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        setState('ok');
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) {
        setState('ok');
      } else {
        // Preserve where they were trying to go so login can bounce them back.
        navigate(resolvedLogin, { replace: true, state: { from: location.pathname } });
        setState('denied');
      }
    };

    check();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-dvh bg-light grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted font-semibold">Cek login…</p>
        </div>
      </div>
    );
  }

  if (state === 'denied') return null;
  return <>{children}</>;
}
