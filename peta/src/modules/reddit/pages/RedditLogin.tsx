import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft, Loader2, Lock, Shield } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { getStraightRegistrationMode } from '../lib/api';

export function RedditLogin() {
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regMode, setRegMode] = useState<'signup' | 'waitlist' | null>(null);
  const [armyError, setArmyError] = useState(false);

  useEffect(() => {
    getStraightRegistrationMode()
      .then((mode) => setRegMode(mode))
      .catch(() => setRegMode('signup'));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setArmyError(false);

    const email = emailRef.current?.value.trim().toLowerCase() || '';
    const password = passwordRef.current?.value || '';

    if (!email || !password) {
      toast.error('Please enter your email and password.');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      if (!data.user) throw new Error('Login failed');

      // Check if user is admin → route to admin
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .single();

      // Army users don't belong in the Straight Ltd dashboard.
      // Sign them out and surface a clear CTA to the PeTa login.
      if (profile?.role === 'army') {
        await supabase.auth.signOut();
        setArmyError(true);
        toast.error('This account is a PeTa Army account. Use the PeTa login instead.');
        return;
      }

      toast.success('Welcome back!');
      if (profile?.role === 'admin') {
        navigate('/reddit/admin');
      } else {
        navigate('/reddit/dashboard');
      }
    } catch (err: any) {
      toast.error(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-orange-50 via-white to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          to="/reddit"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft size={14} />
          Back to Straight Ltd
        </Link>

        <div className="bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 p-8">
          <div className="flex items-center gap-2 mb-2">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-10 h-10 rounded-lg object-cover" />
            <div>
              <div className="font-bold text-slate-900">Straight Ltd</div>
              <div className="text-xs text-slate-500">Pro Dashboard</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mt-6">Welcome back</h1>
          <p className="text-sm text-slate-600 mt-1">Sign in to your account</p>

          {armyError && (
            <div className="mt-4 p-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-sm">
              <p className="font-semibold text-amber-900 mb-1">This is a PeTa Army account</p>
              <p className="text-amber-800">
                Straight Ltd is for clients. Please log in at{' '}
                <a href="https://www.penghasilantambahan.com/login" className="font-bold underline text-amber-900">
                  penghasilantambahan.com/login
                </a>
                .
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 mt-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
              <input
                ref={emailRef}
                type="email"
                name="email"
                autoComplete="username"
                defaultValue=""
                placeholder="you@agency.com"
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-semibold text-slate-700">Password</label>
                <Link to="/reddit/forgot-password" className="text-xs text-orange-600 hover:underline">Forgot?</Link>
              </div>
              <div className="relative">
                <input
                  ref={passwordRef}
                  type={showPwd ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  defaultValue=""
                  placeholder="Your password"
                  className="w-full px-3.5 py-2.5 pr-10 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold shadow-lg shadow-orange-500/20"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {regMode !== null && (
            <div className="mt-6 pt-6 border-t border-slate-200 text-center">
              <p className="text-sm text-slate-600">
                Don't have an account?{' '}
                <Link
                  to={regMode === 'waitlist' ? '/reddit/waitlist' : '/reddit/signup'}
                  className="text-orange-600 font-semibold hover:underline"
                >
                  {regMode === 'waitlist' ? 'Join the waitlist' : 'Sign up free'}
                </Link>
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1">
            <Lock size={11} />
            256-bit SSL
          </div>
          <div className="flex items-center gap-1">
            <Shield size={11} />
            SOC 2 hosting
          </div>
        </div>
      </div>
    </div>
  );
}
