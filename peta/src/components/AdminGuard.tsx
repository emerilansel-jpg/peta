import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from './Toast';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = React.useState<'checking' | 'allowed' | 'denied'>('checking');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          toast.error('Login dulu sebagai admin.');
          navigate('/login');
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
        toast.error('Halaman ini khusus admin.');
        navigate('/tasks');
        setState('denied');
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  if (state !== 'allowed') return null;
  return <>{children}</>;
}
