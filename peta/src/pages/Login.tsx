import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

export function Login() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success('Login berhasil! 🎉');
      navigate('/tasks');
    } catch (error: any) {
      const msg = error?.message || 'Login gagal';
      if (/invalid login credentials/i.test(msg)) {
        toast.error('Email atau password salah. Coba lagi ya.');
      } else if (/email not confirmed|not.+confirmed/i.test(msg)) {
        // Should not happen now that DB auto-confirms, but just in case any
        // legacy account is still in unconfirmed limbo.
        toast.error('Akun masih nunggu verifikasi. Hubungi admin di grup WA ya 🙏');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary flex flex-col">
      <div className="p-4 safe-top">
        <button
          onClick={() => navigate('/')}
          className="text-white/90 flex items-center gap-1 text-sm font-semibold hover:text-white"
        >
          <ArrowLeft size={18} /> Kembali
        </button>
      </div>

      <div className="flex-1 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-8">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up">
          <img
            src="/logo-horizontal.png"
            alt="PeTa · PenghasilanTambahan.com"
            className="h-16 w-auto mb-4"
          />
          <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1">Welcome back, PeTa Army!</h2>
          <p className="text-sm text-muted mb-6">Lanjut earning, ambil saldonya.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">Email</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                placeholder="kamu@email.com"
                required
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="block text-xs font-bold text-dark uppercase tracking-wide">Password</label>
                <button
                  type="button"
                  onClick={() => toast.success('Hubungi admin untuk reset password.')}
                  className="text-xs text-primary font-semibold hover:underline"
                >
                  Lupa password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[48px] px-4 py-3 pr-12 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted hover:text-dark"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" loading={loading} fullWidth className="!rounded-2xl">
              ✨ Login & Lanjut Earning
            </Button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            Belum punya akun?{' '}
            <Link to="/register" className="text-primary font-extrabold hover:underline">
              Daftar gratis →
            </Link>
          </p>
        </div>
      </div>

      <p className="text-center text-xs text-white/80 pb-4 safe-bottom">
        🔒 Data aman • Encrypted login
      </p>
    </div>
  );
}
