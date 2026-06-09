import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MailCheck, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

export function ForgotPassword() {
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/update-password`,
      });
      if (error) throw error;
      // Always show success even if the email isn't registered — don't leak
      // which emails exist.
      setSent(true);
    } catch (error: any) {
      toast.error(error?.message || 'Gagal mengirim email reset. Coba lagi ya.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary flex flex-col">
      <div className="p-4 safe-top">
        <button
          onClick={() => navigate('/login')}
          className="text-white/90 flex items-center gap-1 text-sm font-semibold hover:text-white"
        >
          <ArrowLeft size={18} /> Kembali ke Login
        </button>
      </div>

      <div className="flex-1 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-8">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mb-4">
                <MailCheck size={32} className="text-success" />
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-2">Cek email kamu 📩</h2>
              <p className="text-sm text-muted mb-6">
                Kalau <span className="font-bold text-dark">{email}</span> terdaftar, kami sudah kirim link
                buat bikin password baru. Cek juga folder spam/promosi ya.
              </p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="!rounded-2xl"
                onClick={() => navigate('/login')}
              >
                Balik ke Login
              </Button>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="mt-3 text-xs text-muted font-semibold hover:underline"
              >
                Salah email? Kirim ulang
              </button>
            </div>
          ) : (
            <>
              <img
                src="/logo-horizontal.png"
                alt="PeTa · PenghasilanTambahan.com"
                className="h-16 w-auto mb-4"
              />
              <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1">Lupa password?</h2>
              <p className="text-sm text-muted mb-6">
                Tenang. Masukin email kamu, nanti kami kirim link buat bikin password baru.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
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

                <Button type="submit" variant="primary" size="lg" loading={loading} fullWidth className="!rounded-2xl">
                  Kirim link reset
                </Button>
              </form>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-light" /></div>
                <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-muted">atau</span></div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/reset-whatsapp')}
                className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-success/30 bg-success/5 text-success font-bold hover:bg-success/10 tap-shrink"
              >
                <MessageCircle size={18} /> Reset lewat WhatsApp
              </button>

              <p className="text-center text-sm text-muted mt-6">
                Inget password kamu?{' '}
                <Link to="/login" className="text-primary font-extrabold hover:underline">
                  Login →
                </Link>
              </p>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-white/80 pb-4 safe-bottom">
        🔒 Data aman • Encrypted login
      </p>
    </div>
  );
}
