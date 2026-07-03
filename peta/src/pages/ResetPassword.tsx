import React from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Lock, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState('');
  const navigate = useNavigate();

  const token = searchParams.get('token');
  const isWaReset = !!token;

  // Validate token on mount for WA reset
  React.useEffect(() => {
    if (isWaReset && !token) {
      setError('Link reset tidak valid atau sudah expired.');
    }
  }, [isWaReset, token]);

  const pwdScore = React.useMemo(() => {
    if (!password) return { score: 0, label: '', color: 'bg-gray-200' };
    if (password.length < 6) return { score: 1, label: 'Lemah', color: 'bg-danger' };
    if (password.length < 8) return { score: 2, label: 'Sedang', color: 'bg-warning' };
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) return { score: 4, label: 'Kuat', color: 'bg-success' };
    return { score: 3, label: 'Lumayan', color: 'bg-warning' };
  }, [password]);

  const handleWaReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter ya.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Password dan konfirmasi tidak cocok.');
      return;
    }
    setLoading(true);
    try {
      // 1. Verify token and get user_id
      const { data: verifyData, error: verifyError } = await supabase.rpc('verify_password_reset_token', {
        p_token: token,
      });
      if (verifyError || !verifyData?.[0]?.valid) {
        throw new Error(verifyData?.[0]?.message || 'Token tidak valid atau sudah expired');
      }

      const userId = verifyData[0].user_id;

      // 2. Update password via admin RPC (service_role)
      const { error: updateError } = await supabase.rpc('admin_update_user_password', {
        p_user_id: userId,
        p_password: password,
      });
      if (updateError) throw updateError;

      // 3. Consume token
      await supabase.rpc('consume_password_reset_token', {
        p_token: token,
      });

      setDone(true);
      toast.success('Password berhasil diubah! 🎉');
    } catch (error: any) {
      const msg = error?.message || 'Gagal ubah password';
      if (/same password/i.test(msg)) {
        toast.error('Password baru tidak boleh sama dengan password lama.');
      } else if (/expired|invalid|token/i.test(msg)) {
        setError('Link reset expired atau tidak valid. Minta link baru ya.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter ya.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Password dan konfirmasi tidak cocok.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success('Password berhasil diubah! 🎉');
    } catch (error: any) {
      const msg = error?.message || 'Gagal ubah password';
      if (/same password/i.test(msg)) {
        toast.error('Password baru tidak boleh sama dengan password lama.');
      } else if (/expired|invalid|token/i.test(msg)) {
        setError('Link reset expired atau tidak valid. Minta link baru ya.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = isWaReset ? handleWaReset : handleEmailReset;

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary flex flex-col">
      <div className="p-4 safe-top">
        <button
          onClick={() => navigate('/login')}
          className="text-white/90 flex items-center gap-1 text-sm font-semibold hover:text-white"
        >
          <ArrowLeft size={18} /> Kembali ke login
        </button>
      </div>

      <div className="flex-1 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-8">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up">
          <img
            src="/logo-horizontal.png"
            alt="PeTa · PenghasilanTambahan.com"
            className="h-16 w-auto mb-4"
          />

          {done ? (
            <div className="text-center py-4">
              <CheckCircle size={48} className="text-success mx-auto mb-3" />
              <h2 className="text-xl font-extrabold text-dark mb-2">Password diperbarui!</h2>
              <p className="text-sm text-muted mb-6">
                Password baru aktif. Login pakai password baru sekarang.
              </p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="!rounded-2xl"
                onClick={() => navigate('/login')}
              >
                → Login Sekarang
              </Button>
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <Lock size={48} className="text-danger mx-auto mb-3" />
              <h2 className="text-xl font-extrabold text-dark mb-2">Link tidak valid</h2>
              <p className="text-sm text-muted mb-6">{error}</p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="!rounded-2xl"
                onClick={() => navigate('/forgot-password')}
              >
                Minta Link Baru
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1">Buat password baru</h2>
              <p className="text-sm text-muted mb-6">
                {isWaReset
                  ? 'Reset via WhatsApp. Password minimal 6 karakter.'
                  : 'Password minimal 6 karakter. Kombinasi huruf besar + angka = lebih aman.'}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                    Password Baru
                  </label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 pr-12 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                      placeholder="Minimal 6 karakter"
                      required
                      disabled={loading}
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

                <div>
                  <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                    Konfirmasi Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPwd ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 pr-12 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                      placeholder="Ulangi password baru"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPwd(!showConfirmPwd)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted hover:text-dark"
                      aria-label={showConfirmPwd ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPwd ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  fullWidth
                  className="!rounded-2xl"
                >
                  🔐 Simpan Password Baru
                </Button>
              </form>

              <p className="text-center text-sm text-muted mt-6">
                Ingat password lama?{' '}
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
