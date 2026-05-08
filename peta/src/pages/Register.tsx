import React from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft, Check, Gift, Tag, MessageCircle, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

export function Register() {
  const [params] = useSearchParams();
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [whatsapp, setWhatsapp] = React.useState('');
  const [referralCode, setReferralCode] = React.useState(params.get('ref') || '');
  const [showRefField, setShowRefField] = React.useState(!!params.get('ref'));
  const [showPwd, setShowPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();

  const pwdScore = React.useMemo(() => {
    if (!password) return { score: 0, label: '', color: 'bg-gray-200' };
    if (password.length < 6) return { score: 1, label: 'Lemah', color: 'bg-danger' };
    if (password.length < 8) return { score: 2, label: 'Sedang', color: 'bg-warning' };
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) return { score: 4, label: 'Kuat', color: 'bg-success' };
    return { score: 3, label: 'Lumayan', color: 'bg-warning' };
  }, [password]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error('Isi nama kamu dulu ya');
      return;
    }
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter ya.');
      return;
    }
    const cleanedWa = whatsapp.replace(/\D/g, '').replace(/^0/, '62');
    if (cleanedWa.length < 9) {
      toast.error('Nomor WhatsApp tidak valid');
      return;
    }
    setLoading(true);
    try {
      const meta: Record<string, string> = {
        full_name: fullName.trim(),
        whatsapp: cleanedWa,
      };
      if (referralCode.trim()) meta.referral_code = referralCode.trim().toLowerCase();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: meta },
      });
      if (error) throw error;
      if (!data.user) throw new Error('Registrasi gagal — coba lagi');

      const successMsg = referralCode.trim()
        ? 'Daftar berhasil! +Rp20K bonus referral 🎉'
        : 'Daftar berhasil! Bonus Rp50K menunggu 🎉';

      // With the DB-level auto-confirm trigger, signUp returns a live session.
      // Fallback: if for any reason session is null, attempt password sign-in
      // so user lands in /onboarding instead of bouncing to /login.
      if (data.session) {
        toast.success(successMsg);
        navigate('/onboarding');
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          toast.success('Akun siap! Login sekali ya, terus langsung onboarding.');
          navigate('/login');
        } else {
          toast.success(successMsg);
          navigate('/onboarding');
        }
      }
    } catch (error: any) {
      const msg = error?.message || 'Registrasi gagal';
      if (/already registered|already exists/i.test(msg)) {
        toast.error('Email sudah terdaftar. Coba login aja.');
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
          {/* Bonus banner */}
          <div className="bg-yellow-100 ring-2 ring-yellow-300 rounded-xl p-3 mb-5 flex items-start gap-3">
            <Gift size={22} className="text-yellow-700 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-extrabold text-yellow-900">Bonus Rp50.000 menunggu</p>
              <p className="text-yellow-800/80">Selesai onboarding 5 menit, langsung masuk saldo.</p>
            </div>
          </div>

          <img
            src="/logo-horizontal.png"
            alt="PeTa · PenghasilanTambahan.com"
            className="h-16 w-auto mb-4"
          />
          <h1 className="text-2xl sm:text-3xl font-extrabold text-dark mb-1">Gabung PeTa Army, gratis</h1>
          <p className="text-sm text-muted mb-5">Selesai dalam 30 detik.</p>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <User size={12} /> Nama
              </label>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                placeholder="Nama kamu"
                required
              />
            </div>

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
              <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <MessageCircle size={12} className="text-success" /> WhatsApp Aktif
              </label>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                placeholder="08xxxxxxxxxx"
                required
              />
              <p className="text-[11px] text-muted mt-1">Buat verifikasi & konfirmasi payout</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">Password</label>
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
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i <= pwdScore.score ? pwdScore.color : 'bg-gray-200'
                        } transition-all`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted">
                    {pwdScore.label && <span className="font-semibold text-dark">{pwdScore.label}.</span>}{' '}
                    {password.length < 6 && 'Tambah lagi sampai min 6 karakter.'}
                    {password.length >= 6 && pwdScore.score < 4 && 'Tip: kombinasikan huruf BESAR + angka biar lebih kuat.'}
                    {pwdScore.score === 4 && '✅ Password kuat!'}
                  </p>
                </div>
              )}
            </div>

            {/* Referral code (collapsible) */}
            {showRefField ? (
              <div>
                <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide flex items-center gap-1">
                  <Tag size={12} /> Kode Referral
                </label>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.trim())}
                  placeholder="kode dari teman kamu"
                  className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all uppercase"
                />
                {referralCode.trim() && (
                  <p className="text-xs text-success mt-1.5 font-semibold">
                    ✨ +Rp20.000 bonus referral aktif
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowRefField(true)}
                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
              >
                <Tag size={12} /> Punya kode referral? Klik sini
              </button>
            )}

            <Button type="submit" variant="primary" size="lg" loading={loading} fullWidth className="!rounded-2xl">
              💰 Daftar & Klaim Bonus Rp50K
            </Button>

            <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <li className="flex items-center gap-1"><Check size={12} className="text-success" /> Gratis selamanya</li>
              <li className="flex items-center gap-1"><Check size={12} className="text-success" /> Data aman</li>
              <li className="flex items-center gap-1"><Check size={12} className="text-success" /> Tanpa kartu kredit</li>
            </ul>
          </form>

          <p className="text-center text-sm text-muted mt-5">
            Sudah punya akun?{' '}
            <Link to="/login" className="text-primary font-extrabold hover:underline">
              Login →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
