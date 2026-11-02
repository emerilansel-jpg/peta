import React from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, ArrowLeft, Check, Gift, Tag, MessageCircle, User, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { sendWelcomeEmail, trackInvitationClick, recordLoginEvent } from '../lib/api';

export function Register() {
  const [params] = useSearchParams();
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [whatsapp, setWhatsapp] = React.useState('');
  const [referralCode, setReferralCode] = React.useState('');
  const [showRefField, setShowRefField] = React.useState(false);
  const [showPwd, setShowPwd] = React.useState(false);
  const [optInReactivation, setOptInReactivation] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [invitationToken, setInvitationToken] = React.useState<string | null>(null);
  const [invitationInfo, setInvitationInfo] = React.useState<{
    fullName?: string;
    campaignName?: string;
    recruiterName?: string;
    code?: string;
  } | null>(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    const rawRef = params.get('ref') || params.get('inv') || params.get('code') || sessionStorage.getItem('peta_invitation_token');
    if (!rawRef) return;

    // Check if this ref matches an invitation token, recruiter code (e.g. GHINA), or campaign code
    trackInvitationClick(rawRef).then((res) => {
      if (res.valid) {
        setInvitationToken(rawRef);
        sessionStorage.setItem('peta_invitation_token', rawRef);
        setReferralCode(res.code || rawRef);
        setShowRefField(true);
        setInvitationInfo({
          fullName: res.full_name,
          campaignName: res.campaign_name,
          recruiterName: res.recruiter_name,
          code: res.code || res.invitation_code || rawRef,
        });
        if (res.full_name) setFullName((prev) => prev || res.full_name || '');
        if (res.email) setEmail((prev) => prev || res.email || '');
        if (res.phone) setWhatsapp((prev) => prev || res.phone || '');
      } else {
        // Standard user-to-user referral code
        setReferralCode(rawRef);
        setShowRefField(true);
      }
    }).catch(() => {
      setReferralCode(rawRef);
      setShowRefField(true);
    });
  }, [params]);

  // Dynamically resolve recruiter name when user types an invite/referral code
  React.useEffect(() => {
    if (!referralCode.trim() || referralCode.trim().length < 3) {
      if (!params.get('ref') && !sessionStorage.getItem('peta_invitation_token')) {
        setInvitationInfo(null);
      }
      return;
    }
    const timer = setTimeout(() => {
      trackInvitationClick(referralCode.trim()).then((res) => {
        if (res.valid) {
          setInvitationInfo({
            fullName: res.full_name,
            campaignName: res.campaign_name,
            recruiterName: res.recruiter_name,
            code: res.code || res.invitation_code || referralCode.trim(),
          });
        }
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [referralCode]);

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
      // Pre-flight phone-uniqueness check via SECURITY DEFINER RPC. RLS
      // blocks anon SELECT on users, so we route through `is_whatsapp_taken`
      // which returns a boolean only (no PII leak). The Postgres UNIQUE
      // constraint still backstops inside the handle_new_user trigger if a
      // race condition lets a duplicate slip past this check.
      const { data: waTaken } = await supabase.rpc('is_whatsapp_taken', {
        p_whatsapp: cleanedWa,
      });
      if (waTaken === true) {
        toast.error('Nomor WhatsApp ini sudah terdaftar di akun PeTa lain. Pakai nomor lain atau login.');
        setLoading(false);
        return;
      }
      const meta: Record<string, string> = {
        full_name: fullName.trim(),
        whatsapp: cleanedWa,
      };
      if (referralCode.trim()) meta.referral_code = referralCode.trim().toLowerCase();
      if (invitationToken) meta.invitation_token = invitationToken;

      // First-touch attribution from URL params or sessionStorage
      const utmSource = params.get('utm_source') || sessionStorage.getItem('peta_utm_source');
      const utmMedium = params.get('utm_medium') || sessionStorage.getItem('peta_utm_medium');
      const utmCampaign = params.get('utm_campaign') || sessionStorage.getItem('peta_utm_campaign');
      const utmContent = params.get('utm_content') || sessionStorage.getItem('peta_utm_content');
      const utmTerm = params.get('utm_term') || sessionStorage.getItem('peta_utm_term');
      const landingPath = sessionStorage.getItem('peta_landing_path') || window.location.pathname;

      if (utmSource) meta.acquisition_source = utmSource;
      if (utmMedium) meta.acquisition_medium = utmMedium;
      if (utmCampaign) meta.acquisition_campaign = utmCampaign;
      if (utmContent) meta.acquisition_content = utmContent;
      if (utmTerm) meta.acquisition_term = utmTerm;
      if (landingPath) meta.acquisition_landing_path = landingPath;
      meta.reactivation_opt_in = String(optInReactivation);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: meta },
      });
      if (error) throw error;
      if (!data.user) throw new Error('Registrasi gagal — coba lagi');

      recordLoginEvent('signup').catch(() => {});

      const successMsg = referralCode.trim()
        ? 'Daftar berhasil! +Rp20K bonus referral 🎉'
        : 'Daftar berhasil! Bonus Rp50K menunggu 🎉';

      // With the DB-level auto-confirm trigger, signUp returns a live session.
      // Fallback: if for any reason session is null, attempt password sign-in
      // so user lands in /onboarding instead of bouncing to /login.
      if (data.session) {
        toast.success(successMsg);
        // Send welcome email in background; don't block navigation on failure.
        sendWelcomeEmail(email, fullName.trim()).catch(() => {});
        navigate('/onboarding');
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          toast.success('Akun siap! Login sekali ya, terus langsung onboarding.');
          navigate('/login');
        } else {
          toast.success(successMsg);
          sendWelcomeEmail(email, fullName.trim()).catch(() => {});
          navigate('/onboarding');
        }
      }
    } catch (error: any) {
      const msg = error?.message || 'Registrasi gagal';
      if (/already registered|already exists/i.test(msg)) {
        toast.error('Email sudah terdaftar. Coba login aja.');
      } else if (/database error|saving new user/i.test(msg)) {
        // Race condition: someone took the WA number between our pre-check
        // and the auth signup. Surface the same friendly message.
        toast.error('Email atau nomor WhatsApp sudah terdaftar. Coba data lain atau login.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary flex flex-col justify-between py-4">
      <div className="flex-1 flex items-center justify-center px-4 py-4 sm:py-6">
        <div className="w-full max-w-md animate-slide-up">
          <div className="mb-3">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/20 hover:bg-white/30 active:scale-95 text-white text-sm font-semibold backdrop-blur-md border border-white/25 transition-all shadow-sm"
            >
              <ArrowLeft size={16} /> Kembali
            </button>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8">
          {/* Bonus or Invitation banner */}
          {invitationInfo ? (
            <div className="bg-emerald-50 ring-2 ring-emerald-400 rounded-2xl p-4 mb-5 flex items-start gap-3">
              <Sparkles size={22} className="text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-950">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-extrabold text-xs uppercase tracking-wide bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                    Undangan Resmi
                  </span>
                  <span className="text-[11px] font-mono font-bold text-emerald-800">
                    {invitationInfo.code}
                  </span>
                </div>
                <p className="leading-relaxed">
                  Kamu diundang khusus oleh <b>{invitationInfo.recruiterName || 'Tim Recruitment'}</b>
                  {invitationInfo.campaignName ? ` melalui program ${invitationInfo.campaignName}` : ''}.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-100 ring-2 ring-yellow-300 rounded-xl p-3 mb-5 flex items-start gap-3">
              <Gift size={22} className="text-yellow-700 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-extrabold text-yellow-900">
                  {referralCode ? 'Bonus Referral Rp20.000 Menunggu' : 'Cuan Komentar & Bonus Referral Rp20K'}
                </p>
                <p className="text-yellow-800/80">
                  {referralCode
                    ? 'Daftar dengan kode referral, dapatkan Rp20.000 langsung masuk saldo kamu.'
                    : 'Daftar gratis dalam 30 detik. Kerjakan tugas & dapatkan Rp20.000 tiap undang teman.'}
                </p>
              </div>
            </div>
          )}

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

            {/* Referral / Invitation code */}
            {showRefField ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-dark uppercase tracking-wide flex items-center gap-1">
                    <Tag size={12} /> Kode Undangan / Referral
                  </label>
                  {invitationInfo?.recruiterName && (
                    <span className="text-[10px] font-extrabold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                      ✓ Undangan {invitationInfo.recruiterName}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.trim().toUpperCase())}
                  placeholder="Contoh: GHINA"
                  className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition-all uppercase font-mono font-bold tracking-wider"
                />
                {referralCode.trim() && (
                  <p className="text-xs text-success mt-1.5 font-semibold flex items-center gap-1">
                    ✨ +Rp20.000 bonus pendaftaran aktif
                    {invitationInfo?.recruiterName && ` (Terhubung ke ${invitationInfo.recruiterName})`}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowRefField(true)}
                className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
              >
                <Tag size={12} /> Punya kode undangan atau referral? Masukkan di sini
              </button>
            )}

            <label className="flex items-start gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={optInReactivation}
                onChange={(e) => setOptInReactivation(e.target.checked)}
                className="mt-0.5 rounded text-primary focus:ring-primary h-4 w-4"
              />
              <span>Kirimkan notifikasi WhatsApp jika ada task baru yang sesuai (bisa diubah kapan saja di akun).</span>
            </label>

            <Button type="submit" variant="primary" size="lg" loading={loading} fullWidth className="!rounded-2xl">
              💰 Daftar & Mulai Earning
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
    </div>
  );
}
