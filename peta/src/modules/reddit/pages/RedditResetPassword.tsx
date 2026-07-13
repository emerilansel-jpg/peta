import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Lock, CheckCircle, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';

export function RedditResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const isTokenReset = !!token;

  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (isTokenReset && !token) {
      setError('Reset link is invalid or has expired.');
    }
  }, [isTokenReset, token]);

  const pwdScore = React.useMemo(() => {
    if (!password) return { score: 0, label: '', color: 'bg-slate-200' };
    if (password.length < 6) return { score: 1, label: 'Weak', color: 'bg-rose-500' };
    if (password.length < 8) return { score: 2, label: 'Okay', color: 'bg-amber-500' };
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
    return { score: 3, label: 'Decent', color: 'bg-amber-500' };
  }, [password]);

  const handleTokenReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { data: verifyData, error: verifyError } = await supabase.rpc('verify_password_reset_token', {
        p_token: token,
      });
      if (verifyError || !verifyData?.[0]?.valid) {
        throw new Error(verifyData?.[0]?.message || 'Reset link is invalid or expired');
      }
      const userId = verifyData[0].user_id;

      const { error: updateError } = await supabase.rpc('admin_update_user_password', {
        p_user_id: userId,
        p_password: password,
      });
      if (updateError) throw updateError;

      await supabase.rpc('consume_password_reset_token', {
        p_token: token,
      });

      setDone(true);
      toast.success('Password updated successfully');
    } catch (error: any) {
      const msg = error?.message || 'Failed to update password';
      if (/same password/i.test(msg)) {
        toast.error('New password must be different from your old password.');
      } else if (/expired|invalid|token/i.test(msg)) {
        setError('Reset link is invalid or has expired. Please request a new one.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success('Password updated successfully');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = isTokenReset ? handleTokenReset : handleEmailReset;

  return (
    <div className="min-h-dvh bg-gradient-to-br from-orange-50 via-white to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          to="/reddit/login"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft size={14} /> Back to sign in
        </Link>

        <div className="bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 p-8">
          <div className="flex items-center gap-2 mb-6">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-10 h-10 rounded-lg object-cover" />
            <div>
              <div className="font-bold text-slate-900">Straight Ltd</div>
              <div className="text-xs text-slate-500">Pro Dashboard</div>
            </div>
          </div>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle size={48} className="text-emerald-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-slate-900 mb-2">Password updated</h2>
              <p className="text-sm text-slate-600 mb-6">
                Your new password is active. Sign in with it now.
              </p>
              <Link
                to="/reddit/login"
                className="block w-full px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-center"
              >
                Sign in →
              </Link>
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <Lock size={48} className="text-rose-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-slate-900 mb-2">Link not valid</h2>
              <p className="text-sm text-slate-600 mb-6">{error}</p>
              <Link
                to="/reddit/forgot-password"
                className="block w-full px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-center"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 mb-1">Create new password</h1>
              <p className="text-sm text-slate-600 mb-6">
                Password must be at least 8 characters. Combine uppercase letters and numbers for a stronger password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">New password</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full px-4 py-3 pr-12 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {password && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`h-1.5 flex-1 rounded-full ${i <= pwdScore.score ? pwdScore.color : 'bg-slate-200'}`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">
                        {pwdScore.label && <span className="font-semibold text-slate-700">{pwdScore.label}.</span>}{' '}
                        {password.length < 8 && 'Use at least 8 characters.'}
                        {password.length >= 8 && pwdScore.score < 4 && 'Tip: add uppercase + number for a stronger password.'}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Confirm password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPwd ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full px-4 py-3 pr-12 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPwd(!showConfirmPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showConfirmPwd ? <EyeOff size={18} /> : <Eye size={18} />}
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
                      <Loader2 size={16} className="animate-spin" /> Saving...
                    </>
                  ) : (
                    'Save new password'
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
