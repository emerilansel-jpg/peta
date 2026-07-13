import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, CheckCircle, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';

export function RedditForgotPassword() {
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Please enter your email');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-password-reset-email', {
        body: {
          email: email.trim(),
          base_url: window.location.origin,
          product: 'straight',
          reset_path: '/reddit/reset-password',
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to send reset link');
      }
      setSent(true);
      toast.success(data.message || 'Reset link sent');
    } catch (error: any) {
      const msg = error?.message || 'Failed to send reset link';
      if (/rate limit/i.test(msg)) {
        toast.error('Too many requests. Please try again in 60 seconds.');
      } else if (/smtp_not_configured/i.test(msg)) {
        toast.error('Email gateway is not configured. Contact support.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

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

          {sent ? (
            <div className="text-center py-4">
              <CheckCircle size={48} className="text-emerald-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-slate-900 mb-2">Check your email</h2>
              <p className="text-sm text-slate-600 mb-4">
                If <strong>{email}</strong> is registered, a password reset link has been sent.
              </p>
              <p className="text-xs text-slate-500 mb-6">
                Didn’t receive it? Check spam or promotions. Links expire in 15 minutes.
              </p>
              <button
                onClick={() => { setSent(false); setEmail(''); }}
                className="w-full px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              >
                Send another link
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 mb-1">Reset your password</h1>
              <p className="text-sm text-slate-600 mb-6">
                Enter your email and we’ll send you a link to create a new password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@agency.com"
                      className="w-full pl-10 pr-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold shadow-lg shadow-orange-500/20"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Sending...
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </button>
              </form>
            </>
          )}

          <p className="text-center text-sm text-slate-600 mt-6">
            Remember your password?{' '}
            <Link to="/reddit/login" className="text-orange-600 font-semibold hover:underline">
              Sign in →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
