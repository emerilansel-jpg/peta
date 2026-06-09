import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

const CONFIRM_ERRORS: Record<string, string> = {
  weak_password: 'Password minimal 6 karakter.',
  invalid: 'Nomor atau kode salah. Cek lagi ya.',
  expired: 'Kode sudah kadaluarsa. Minta kode baru.',
  too_many_attempts: 'Terlalu banyak percobaan. Minta kode baru.',
  wrong_code: 'Kode salah. Cek lagi.',
  reset_failed: 'Gagal mengganti password. Coba lagi.',
  server_error: 'Ada gangguan. Coba lagi sebentar.',
};

export function ResetWhatsApp() {
  const [step, setStep] = React.useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    try {
      await supabase.functions.invoke('wa-reset-request', { body: { phone: phone.trim() } });
      // Always advance — the endpoint never reveals whether the number exists.
      setStep('code');
      toast.success('Kalau nomornya terdaftar, kode sudah dikirim ke WhatsApp kamu.');
    } catch {
      toast.error('Gagal mengirim kode. Coba lagi ya.');
    } finally {
      setLoading(false);
    }
  };

  const confirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length !== 6) {
      toast.error('Kode harus 6 angka.');
      return;
    }
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-reset-confirm', {
        body: { phone: phone.trim(), code: code.trim(), new_password: password },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success('Password berhasil diganti! Login pakai password baru ya.');
        navigate('/login');
        return;
      }
      toast.error(CONFIRM_ERRORS[data?.error] || 'Gagal reset. Coba lagi.');
    } catch {
      toast.error('Ada gangguan. Coba lagi sebentar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary flex flex-col">
      <div className="p-4 safe-top">
        <button
          onClick={() => (step === 'code' ? setStep('phone') : navigate('/login'))}
          className="text-white/90 flex items-center gap-1 text-sm font-semibold hover:text-white"
        >
          <ArrowLeft size={18} /> {step === 'code' ? 'Ganti nomor' : 'Kembali ke Login'}
        </button>
      </div>

      <div className="flex-1 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-8">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up">
          <div className="mx-auto w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mb-4">
            <MessageCircle size={30} className="text-success" />
          </div>

          {step === 'phone' ? (
            <>
              <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1 text-center">Reset lewat WhatsApp</h2>
              <p className="text-sm text-muted mb-6 text-center">
                Masukin nomor WhatsApp yang kamu daftarin. Kami kirim kode 6 angka buat bikin password baru.
              </p>
              <form onSubmit={requestCode} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">No. WhatsApp</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                    placeholder="0812xxxxxxxx"
                    required
                  />
                </div>
                <Button type="submit" variant="primary" size="lg" loading={loading} fullWidth className="!rounded-2xl">
                  Kirim kode ke WhatsApp
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1 text-center">Masukin kode</h2>
              <p className="text-sm text-muted mb-6 text-center">
                Cek WhatsApp <span className="font-bold text-dark">{phone}</span>. Ketik kode 6 angka + password baru kamu.
              </p>
              <form onSubmit={confirmReset} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">Kode 6 angka</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full min-h-[48px] px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                    placeholder="••••••"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">Password baru</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 pr-12 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                      placeholder="Minimal 6 karakter"
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
                  Simpan password baru
                </Button>
              </form>
              <button
                type="button"
                onClick={() => requestCode()}
                disabled={loading}
                className="mt-3 w-full text-xs text-muted font-semibold hover:underline disabled:opacity-50"
              >
                Nggak dapat kode? Kirim ulang
              </button>
            </>
          )}

          <p className="text-center text-sm text-muted mt-6">
            Inget password kamu?{' '}
            <Link to="/login" className="text-primary font-extrabold hover:underline">
              Login →
            </Link>
          </p>
        </div>
      </div>

      <p className="text-center text-xs text-white/80 pb-4 safe-bottom">
        🔒 Kode rahasia • Jangan kasih ke siapa pun
      </p>
    </div>
  );
}
