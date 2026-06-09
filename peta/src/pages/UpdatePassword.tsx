import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

export function UpdatePassword() {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  // null = still checking, true = valid recovery session, false = no/expired link
  const [recoveryReady, setRecoveryReady] = React.useState<boolean | null>(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    let mounted = true;
    // supabase-js (detectSessionInUrl) exchanges the recovery token on load and
    // fires PASSWORD_RECOVERY. Either path leaves us with a usable session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || session) setRecoveryReady(true);
    });
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) setRecoveryReady(true);
      else setTimeout(() => mounted && setRecoveryReady((v) => (v === null ? false : v)), 1500);
    })();
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter.');
      return;
    }
    if (password !== confirm) {
      toast.error('Password nggak sama. Cek lagi ya.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success('Password berhasil diganti! Login pakai password baru ya.');
      navigate('/login');
    } catch (error: any) {
      toast.error(error?.message || 'Gagal ganti password. Linknya mungkin sudah kadaluarsa.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary flex flex-col">
      <div className="flex-1 flex items-end sm:items-center justify-center px-4 py-8 safe-top safe-bottom">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 animate-slide-up">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-4">
            <ShieldCheck size={32} className="text-primary" />
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1 text-center">Bikin password baru</h2>

          {recoveryReady === false ? (
            <>
              <p className="text-sm text-muted mb-6 text-center">
                Link reset-nya nggak valid atau sudah kadaluarsa. Minta link baru ya.
              </p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="!rounded-2xl"
                onClick={() => navigate('/forgot-password')}
              >
                Minta link reset baru
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted mb-6 text-center">Masukin password baru kamu di bawah ini.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
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

                <div>
                  <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">Ulangi password</label>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                    placeholder="Ketik ulang password baru"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  disabled={recoveryReady === null}
                  fullWidth
                  className="!rounded-2xl"
                >
                  {recoveryReady === null ? 'Memeriksa link…' : 'Simpan password baru'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
