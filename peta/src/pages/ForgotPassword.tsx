import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Mail, MessageCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

type Method = 'email' | 'whatsapp';

export function ForgotPassword() {
  const [method, setMethod] = React.useState<Method>('email');
  const [email, setEmail] = React.useState('');
  const [whatsapp, setWhatsapp] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [sentTo, setSentTo] = React.useState('');
  const navigate = useNavigate();

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Isi email dulu ya');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-password-reset-email', {
        body: {
          email: email.trim(),
          base_url: window.location.origin,
          product: 'peta',
          reset_path: '/reset-password',
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error || 'Gagal kirim link reset via email');
      }
      setSent(true);
      setSentTo(email);
      toast.success(data.message || 'Link reset password dikirim ke email kamu!');
    } catch (error: any) {
      const msg = error?.message || 'Gagal kirim link reset';
      if (/rate limit/i.test(msg)) {
        toast.error('Terlalu banyak request. Coba lagi dalam 60 detik.');
      } else if (/smtp_not_configured/i.test(msg)) {
        toast.error('Email gateway belum di-setup. Hubungi admin ya.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleWaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = whatsapp.replace(/\D/g, '').replace(/^0/, '62');
    if (cleaned.length < 9) {
      toast.error('Nomor WhatsApp tidak valid');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-wa-password-reset', {
        body: {
          whatsapp: cleaned,
          base_url: window.location.origin,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error || 'Gagal kirim link reset via WhatsApp');
      }
      setSent(true);
      setSentTo(whatsapp);
      toast.success(data.message || 'Link reset dikirim ke WhatsApp!');
    } catch (error: any) {
      const msg = error?.message || 'Gagal kirim link reset';
      if (/fonnte_not_configured/i.test(msg)) {
        toast.error('Fonnte belum di-setup. Hubungi admin ya.');
      } else if (/rate limit/i.test(msg)) {
        toast.error('Terlalu banyak request. Coba lagi dalam 60 detik.');
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

          {sent ? (
            <div className="text-center py-4">
              <CheckCircle size={48} className="text-success mx-auto mb-3" />
              <h2 className="text-xl font-extrabold text-dark mb-2">
                {method === 'email' ? 'Cek email kamu!' : 'Cek WhatsApp kamu!'}
              </h2>
              <p className="text-sm text-muted mb-4">
                Link reset password sudah dikirim ke <strong>{sentTo}</strong>. Klik link untuk buat password baru.
              </p>
              <p className="text-xs text-muted mb-6">
                Ga masuk? {method === 'email' ? 'Cek folder spam/promosi.' : 'Pastikan nomor terdaftar.'} Atau{' '}
                <button
                  onClick={() => setSent(false)}
                  className="text-primary font-semibold hover:underline"
                >
                  kirim ulang
                </button>
                .
              </p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="!rounded-2xl"
                onClick={() => navigate('/login')}
              >
                ← Kembali login
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-extrabold text-dark mb-1">Lupa password?</h2>
              <p className="text-sm text-muted mb-6">
                Pilih cara reset password kamu.
              </p>

              {/* Method toggle */}
              <div className="flex gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${
                    method === 'email'
                      ? 'bg-primary text-white shadow-md'
                      : 'bg-light text-dark hover:bg-gray-100'
                  }`}
                >
                  <Mail size={14} className="inline mr-1.5 -mt-0.5" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('whatsapp')}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${
                    method === 'whatsapp'
                      ? 'bg-success text-white shadow-md'
                      : 'bg-light text-dark hover:bg-gray-100'
                  }`}
                >
                  <MessageCircle size={14} className="inline mr-1.5 -mt-0.5" />
                  WhatsApp
                </button>
              </div>

              {method === 'email' ? (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide flex items-center gap-1">
                      <Mail size={12} /> Email
                    </label>
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all"
                      placeholder="kamu@email.com"
                      required
                      disabled={loading}
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    loading={loading}
                    fullWidth
                    className="!rounded-2xl"
                  >
                    📩 Kirim Link Reset
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleWaSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide flex items-center gap-1">
                      <MessageCircle size={12} className="text-success" /> Nomor WhatsApp
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-success focus:bg-white transition-all"
                      placeholder="08xxxxxxxxxx"
                      required
                      disabled={loading}
                    />
                    <p className="text-[11px] text-muted mt-1">
                      Nomor harus sama dengan saat daftar PeTa
                    </p>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    loading={loading}
                    fullWidth
                    className="!rounded-2xl"
                  >
                    💬 Kirim Link ke WhatsApp
                  </Button>
                </form>
              )}

              <p className="text-center text-sm text-muted mt-6">
                Ingat password?{' '}
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
