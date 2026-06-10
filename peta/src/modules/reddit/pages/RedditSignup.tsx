import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft, Check, Loader2, Shield, Lock } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { getStraightRegistrationMode } from '../lib/api';
import { WebsiteFieldCRO } from '../components/WebsiteFieldCRO';

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.20455c0-.63818-.05727-1.25182-.16364-1.84091H9v3.48136h4.84364c-.20864 1.125-.84273 2.07818-1.79591 2.71636v2.25818h2.90909c1.70182-1.56682 2.68318-3.87409 2.68318-6.61500z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.46727-.80591 5.95636-2.18182l-2.90909-2.25818c-.80591.54-1.83727.85909-3.04727.85909-2.34409 0-4.32818-1.58318-5.03591-3.71045H.957273v2.33182C2.43818 15.98318 5.48182 18 9 18z" fill="#34A853"/>
      <path d="M3.96409 10.71c-.18-.54-.28227-1.11818-.28227-1.71s.10227-1.17.28227-1.71V4.95818H.957273C.347727 6.17318 0 7.54773 0 9s.347727 2.82682.957273 4.04182L3.96409 10.71z" fill="#FBBC04"/>
      <path d="M9 3.57955c1.32136 0 2.5077.45409 3.44045 1.34591l2.58136-2.58136C13.4632.891818 11.4259 0 9 0 5.48182 0 2.43818 2.01682.957273 4.95818L3.96409 7.29c.70773-2.12727 2.69182-3.71045 5.03591-3.71045z" fill="#EA4335"/>
    </svg>
  );
}

const ROLE_OPTIONS = [
  'Founder',
  'CEO',
  'Entrepreneur',
  'Marketing Director',
  'Growth Lead',
  'SEO Manager',
  'Content Manager',
  'Affiliate Marketer',
  'Agency Owner',
  'Consultant',
  'Other',
];

export function RedditSignup() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [website, setWebsite] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [blocked, setBlocked] = useState(true);
  const [modeLoading, setModeLoading] = useState(true);

  useEffect(() => {
    getStraightRegistrationMode()
      .then((mode) => {
        if (mode === 'waitlist') {
          setBlocked(true);
          toast('Sign up is currently closed. Join the waitlist instead.', { icon: '🔒' });
          setTimeout(() => navigate('/reddit/waitlist'), 1500);
        } else {
          setBlocked(false);
        }
      })
      .catch(() => {
        // Fail closed: block signup if we can't verify mode
        setBlocked(true);
      })
      .finally(() => setModeLoading(false));
  }, [navigate]);

  const pwdScore = (() => {
    if (!password) return { score: 0, label: '', color: 'bg-slate-200' };
    if (password.length < 6) return { score: 1, label: 'Weak', color: 'bg-rose-500' };
    if (password.length < 10) return { score: 2, label: 'OK', color: 'bg-amber-500' };
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
    return { score: 3, label: 'Decent', color: 'bg-amber-500' };
  })();

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      // OAuth providers (Google, etc.) are Straight-only — PeTa never uses OAuth.
      // handle_new_user trigger detects OAuth via raw_app_meta_data->>'provider'
      // and assigns role='client' accordingly.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/reddit/dashboard`,
        },
      });
      if (error) throw error;
      // Browser will redirect — no further action needed
    } catch (err: any) {
      toast.error(err.message || 'Google sign-in failed. Is Google enabled in Supabase?');
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!agreed) {
      toast.error('Please accept the Terms of Service');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            product: 'straight', // marks this signup as Straight Ltd client (vs PeTa army)
            full_name: fullName.trim(),
            role_title: roleTitle || null,
            website: website.trim() || null,
          },
        },
      });

      if (error) throw error;
      if (!data.user) throw new Error('Signup failed. Please try again.');

      toast.success('Account created! Welcome aboard.');

      if (data.session) {
        navigate('/reddit/dashboard');
      } else {
        // Fall back to login if no session was created
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) {
          navigate('/reddit/login');
        } else {
          navigate('/reddit/dashboard');
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-orange-50 via-white to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back to landing */}
        <Link
          to="/reddit"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft size={14} />
          Back to Straight Ltd
        </Link>

        <div className="bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 p-8">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-2">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-10 h-10 rounded-lg object-cover" />
            <div>
              <div className="font-bold text-slate-900">Straight Ltd</div>
              <div className="text-xs text-slate-500">Pro Dashboard</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mt-6">Create your account</h1>
          <p className="text-sm text-slate-600 mt-1">Get $5 free credit on signup. No credit card required.</p>

          {/* Trust signals */}
          <div className="flex flex-wrap gap-3 mt-5">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Check size={12} className="text-emerald-500" />
              No subscription
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Check size={12} className="text-emerald-500" />
              Cancel anytime
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Check size={12} className="text-emerald-500" />
              PayPal secured
            </div>
          </div>

          {/* Google sign-up */}
          <button
            type="button"
            onClick={handleGoogleSignup}
            disabled={loading || blocked || modeLoading}
            className="mt-6 w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-900 font-semibold transition"
          >
            <GoogleLogo />
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-500 font-medium">or sign up with email</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Marcus Chen"
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@agency.com"
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Your role <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <select
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-slate-900"
              >
                <option value="">Select...</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <WebsiteFieldCRO value={website} onChange={setWebsite} variant="signup" />

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3.5 py-2.5 pr-10 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${pwdScore.color}`}
                      style={{ width: `${(pwdScore.score / 4) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 font-medium">{pwdScore.label}</span>
                </div>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 rounded text-orange-500 focus:ring-orange-500"
              />
              <span>
                I agree to the{' '}
                <a href="#" className="text-orange-600 hover:underline">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="text-orange-600 hover:underline">Privacy Policy</a>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || blocked || modeLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold shadow-lg shadow-orange-500/20"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating account...
                </>
              ) : blocked ? (
                <>
                  <Lock size={16} />
                  Sign up closed
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-200 text-center">
            <p className="text-sm text-slate-600">
              Already have an account?{' '}
              <Link to="/reddit/login" className="text-orange-600 font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          </div>
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
