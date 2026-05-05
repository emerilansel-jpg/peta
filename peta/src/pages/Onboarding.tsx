import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { addRedditAccount, claimOnboardingBonus, type OnboardingStep } from '../lib/api';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import { ConfettiBurst } from '../components/Confetti';
import { CheckCircle, Lock, ArrowRight, ExternalLink } from 'lucide-react';

export function Onboarding() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [currentStep, setCurrentStep] = React.useState(1);
  const [whatsapp, setWhatsapp] = React.useState('');
  const [redditUrl, setRedditUrl] = React.useState('');
  const [warpConfirmed, setWarpConfirmed] = React.useState(false);
  const [redditConfirmed, setRedditConfirmed] = React.useState(false);
  const [waGroupConfirmed, setWaGroupConfirmed] = React.useState(false);
  const [confettiActive, setConfettiActive] = React.useState(false);
  const [completedSteps, setCompletedSteps] = React.useState<number[]>([]);

  const celebrate = () => {
    // Re-trigger by toggling — set false first so even successive calls fire fresh
    setConfettiActive(false);
    requestAnimationFrame(() => setConfettiActive(true));
  };

  // Centralised bonus claim that NEVER throws — onboarding advances even if the
  // network or RPC hiccups. The server enforces idempotency.
  const safeClaim = async (step: OnboardingStep) => {
    try { await claimOnboardingBonus(step); }
    catch (e) { console.warn('claimOnboardingBonus failed:', step, e); }
  };
  const [, setTotalBalance] = React.useState(0);

  // Per-user localStorage key — prevents one user's progress leaking to the next
  const lsKey = (uid: string) => `onboarding_completed:${uid}`;

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        toast.error('Sesi habis. Silakan login ulang.');
        navigate('/login');
        return;
      }
      setUser(data.user);

      // Drop any legacy un-scoped onboarding state from previous accounts
      localStorage.removeItem('onboarding_completed');

      // Pre-fill whatsapp from profile if already saved
      const { data: profile } = await supabase
        .from('users')
        .select('whatsapp')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profile?.whatsapp) setWhatsapp(profile.whatsapp);

      // If user already has a Reddit account, onboarding is essentially done.
      const { data: existing } = await supabase
        .from('reddit_accounts')
        .select('id')
        .eq('user_id', data.user.id)
        .limit(1);
      if (existing && existing.length > 0) {
        navigate('/tasks', { replace: true });
        return;
      }

      // Load completed steps for THIS user only
      const saved = localStorage.getItem(lsKey(data.user.id));
      if (saved) {
        const steps = JSON.parse(saved);
        setCompletedSteps(steps);
        setTotalBalance(steps.length * 10000);
        const firstIncomplete = [1, 2, 3, 4].find((n) => !steps.includes(n));
        if (firstIncomplete) setCurrentStep(firstIncomplete);
      }
    })();
  }, [navigate]);

  const markStepComplete = (stepNum: number) => {
    if (completedSteps.includes(stepNum)) return;
    const newCompleted = [...completedSteps, stepNum];
    setCompletedSteps(newCompleted);
    if (user?.id) localStorage.setItem(lsKey(user.id), JSON.stringify(newCompleted));
    setTotalBalance(newCompleted.length * 10000);
  };

  const handleStep1 = async () => {
    // WhatsApp is captured at registration. Only fall back to asking here for older accounts that don't have it yet.
    if (!whatsapp.trim() && user?.id) {
      const { data: profile } = await supabase
        .from('users').select('whatsapp').eq('id', user.id).maybeSingle();
      if (!profile?.whatsapp) {
        toast.error('Masukkan nomor WhatsApp yang valid');
        return;
      }
    } else if (whatsapp.trim() && user?.id) {
      const cleaned = whatsapp.replace(/\D/g, '').replace(/^0/, '62');
      if (cleaned.length < 9) {
        toast.error('Nomor WhatsApp tidak valid');
        return;
      }
      await supabase.from('users').update({ whatsapp: cleaned }).eq('id', user.id);
    }
    if (!completedSteps.includes(1)) {
      markStepComplete(1);
      await safeClaim('signup');
      celebrate();
      toast.success('+Rp25.000 masuk saldo! 🎉');
    }
    setCurrentStep(2);
  };

  // Step 2: Mandatory WhatsApp group join
  const handleStepWaGroup = async () => {
    if (!waGroupConfirmed) {
      toast.error('Klik "Buka Grup" dulu, gabung, lalu centang konfirmasi');
      return;
    }
    if (!completedSteps.includes(2)) {
      markStepComplete(2);
      await safeClaim('wa_group');
      celebrate();
      toast.success('+Rp5.000 masuk saldo! 🎊');
    }
    setCurrentStep(3);
  };

  // Step 3: WARP
  const handleStep2 = async () => {
    if (!warpConfirmed) {
      toast.error('Silakan centang konfirmasi WARP terlebih dahulu');
      return;
    }
    if (!completedSteps.includes(3)) {
      markStepComplete(3);
      await safeClaim('warp');
      celebrate();
      toast.success('+Rp10.000 masuk saldo! 💪');
    }
    setCurrentStep(4);
  };

  // Step 4: Reddit account
  const handleStep3 = async () => {
    if (!redditConfirmed) {
      toast.error('Centang konfirmasi dulu setelah daftar Reddit');
      return;
    }
    if (!completedSteps.includes(4)) {
      markStepComplete(4);
      await safeClaim('reddit_account');
      celebrate();
      toast.success('+Rp5.000 masuk saldo! 🎊');
    }
    setCurrentStep(5);
  };

  const handleStep4 = async () => {
    if (!user?.id) {
      toast.error('Sesi habis. Silakan login ulang.');
      navigate('/login');
      return;
    }

    // Only short-circuit if a Reddit account *actually* exists in the DB.
    // The completedSteps flag alone is not trustworthy across re-tries / sessions.
    if (completedSteps.includes(5)) {
      const { data: existing } = await supabase
        .from('reddit_accounts')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);
      if (existing && existing.length > 0) {
        setCurrentStep(6);
        return;
      }
    }

    if (!redditUrl.trim()) {
      toast.error('Masukkan URL profil Reddit terlebih dahulu');
      return;
    }

    try {
      // Extract username from URL
      let username = '';
      if (redditUrl.includes('reddit.com/user/')) {
        username = redditUrl.split('reddit.com/user/')[1].split('?')[0].replace('/', '');
      } else if (redditUrl.startsWith('u/')) {
        username = redditUrl.substring(2);
      } else {
        username = redditUrl;
      }

      if (!username) {
        toast.error('Format URL tidak valid');
        return;
      }

      // Add Reddit account
      await addRedditAccount(user.id, username);

      markStepComplete(5);
      await safeClaim('reddit_url');
      celebrate();
      toast.success('+Rp5.000 masuk saldo! Total bonus Rp50.000 ✨');
      setCurrentStep(6);
    } catch (error: any) {
      console.error('addRedditAccount error:', error);
      const msg =
        error?.message ||
        error?.error_description ||
        error?.details ||
        (typeof error === 'string' ? error : JSON.stringify(error));
      // Friendly message for common cases
      if (error?.code === '23505' || /duplicate|unique/i.test(msg)) {
        toast.error('Username Reddit ini sudah terdaftar. Pakai username lain atau hubungi admin.');
      } else if (error?.code === '42501' || /row-level security|RLS|policy/i.test(msg)) {
        toast.error('Akun Anda belum lengkap di database. Coba logout & login ulang.');
      } else {
        toast.error(`Error: ${msg}`);
      }
    }
  };

  const handleStep5 = () => {
    toast.success('Selamat! Kamu siap mulai earning! 🚀');
    navigate('/tasks');
  };

  // Only show the WhatsApp field on Step 1 for legacy accounts that didn't enter it at registration.
  const needsWhatsappStep = user && whatsapp.trim().length === 0;
  const step1: any = {
    number: 1,
    title: '💰 Saldo kamu',
    balance: 'Rp25.000',
    bonus: '+Rp25.000 dari step ini',
    emoji: '🎁',
    heading: 'Selamat Datang!',
    subheading: 'Step 1 dari 6',
    description: needsWhatsappStep
      ? 'Hai! Selamat datang di PeTa. Kamu bakal dibayar buat komen di internet — gampang banget.\n\nIsi nomor WhatsApp di bawah supaya admin bisa kontak kamu untuk konfirmasi payout. Lalu klik klaim bonus.'
      : 'Hai! Selamat datang di PeTa. Bonus Rp25.000 udah siap masuk saldo kamu.\n\nKlik tombol di bawah untuk klaim, lalu lanjut ke step setup berikutnya.',
    buttonText: '💰 Klaim Bonus Rp25.000',
    hint: 'Bonus langsung masuk saldo setelah klaim',
    action: handleStep1,
  };
  if (needsWhatsappStep) {
    step1.inputValue = whatsapp;
    step1.setInputValue = setWhatsapp;
    step1.inputPlaceholder = '08xxxxxxxxxx';
    step1.inputType = 'tel';
    step1.inputLabel = 'Nomor WhatsApp Aktif';
  }
  const steps = [
    step1,
    {
      number: 2,
      title: '💰 Saldo kamu',
      balance: 'Rp30.000',
      bonus: '+Rp5.000 dari step ini',
      emoji: '💬',
      heading: 'Gabung Grup WhatsApp',
      subheading: 'Step 2 dari 6',
      description: '🚨 WAJIB — semua update task baru, pengumuman payout, tips & trik dikirim ke grup ini.\n\nYang ga gabung = ketinggalan task yang cair duluan.\n\nBuka link, gabung, lalu balik ke sini & centang konfirmasi.',
      buttonText: '✅ Sudah Gabung, Lanjut',
      hint: 'Klik "Buka Grup" dulu → tap "Join chat" di WhatsApp → balik ke sini',
      action: handleStepWaGroup,
      extraAction: () => window.open(WHATSAPP_GROUP_URL, '_blank'),
      extraButtonText: '💬 Buka Grup',
      checkbox: waGroupConfirmed,
      setCheckbox: setWaGroupConfirmed,
      checkboxLabel: 'Saya sudah gabung grup WhatsApp',
    },
    {
      number: 3,
      title: '💰 Saldo kamu',
      balance: 'Rp40.000',
      bonus: '+Rp10.000 dari step ini',
      emoji: '🔒',
      heading: 'Pasang Cloudflare WARP',
      subheading: 'Step 3 dari 6',
      description: '⚡ Hanya 2 menit setup.\n\n🔐 Reddit diblokir ISP di Indonesia. Kita pakai Cloudflare WARP (1.1.1.1):\n✨ Gratis selamanya\n🔒 Aman & resmi dari Cloudflare\n📱 Cukup ON sekali di device\n✅ Unlock akses unlimited Reddit\n\nTutup page ini sementara kalau perlu — progress tersimpan. Atau buka di device lain.',
      buttonText: '✅ Sudah Install, Lanjut',
      hint: 'Klik "Buka 1.1.1.1" dulu, install & turn ON, lalu centang & klik Lanjut',
      action: handleStep2,
      extraAction: () => window.open('https://1.1.1.1/', '_blank'),
      extraButtonText: '📥 Buka 1.1.1.1',
      checkbox: warpConfirmed,
      setCheckbox: setWarpConfirmed,
      checkboxLabel: 'Saya sudah install & turn ON WARP',
    },
    {
      number: 4,
      title: '💰 Saldo kamu',
      balance: 'Rp45.000',
      bonus: '+Rp5.000 dari step ini',
      emoji: '👤',
      heading: 'Buat Akun Reddit',
      subheading: 'Step 4 dari 6',
      description: '💡 Silakan daftar Reddit dulu baru lanjut.\n\nTutup page ini sementara kalau perlu — progress tersimpan. Atau pakai device lain (HP untuk WARP+Reddit, laptop untuk PeTa).\n\nTips pilih username: jangan bot-like. Hindari angka random panjang. Pilih interest natural (animals, gaming, news, dll).',
      buttonText: '✅ Sudah Daftar, Lanjut',
      hint: 'Klik "Buka Reddit" dulu, daftar akun baru, lalu centang & klik Lanjut',
      action: handleStep3,
      extraAction: () => window.open('https://reddit.com/register/', '_blank'),
      extraButtonText: '📝 Buka Reddit',
      checkbox: redditConfirmed,
      setCheckbox: setRedditConfirmed,
      checkboxLabel: 'Saya sudah buat akun Reddit',
    },
    {
      number: 5,
      title: '💰 Saldo kamu',
      balance: 'Rp50.000',
      bonus: '+Rp5.000 dari step ini',
      emoji: '🔗',
      heading: 'URL Profil Reddit Kamu',
      subheading: 'Step 5 dari 6',
      description: 'Masukkan URL profil Reddit kamu. Kita butuh ini untuk tracking karma & verifikasi.',
      buttonText: '✅ Simpan & Lanjut',
      hint: 'u/Username atau https://reddit.com/user/Username',
      action: handleStep4,
      inputValue: redditUrl,
      setInputValue: setRedditUrl,
      inputPlaceholder: 'u/Username atau https://reddit.com/user/Username',
      expandableHint: true,
    },
    {
      number: 6,
      title: '💰 Saldo kamu',
      balance: 'Rp50.000+',
      bonus: 'Unlimited',
      emoji: '🎯',
      heading: 'Siap Mulai Earn!',
      subheading: 'Step 6 dari 6',
      description: 'Selamat! Kamu sudah selesai setup.\n\nTask baru dibuka tiap pagi 09:00 WIB — pantau notif di grup WhatsApp biar dapat duluan.\n\nSementara nunggu, ajak teman → tiap teman = +Rp20.000.',
      buttonText: '🚀 Mulai Earning Sekarang!',
      hint: 'Kamu siap! Notif task masuk via WhatsApp.',
      action: handleStep5,
    },
  ];

  const current = steps[currentStep - 1];
  const isCompleted = completedSteps.includes(currentStep);

  return (
    <Layout userRole="army">
      <ConfettiBurst active={confettiActive} onDone={() => setConfettiActive(false)} />
      {/* Header dengan saldo */}
      <div className="mb-8">
        <div className="bg-gradient-to-r from-primary to-secondary text-white p-6 rounded-lg shadow-lg">
          <p className="text-sm opacity-90 mb-2">{current.title}</p>
          <h1 className="text-5xl font-bold mb-2">{current.balance}</h1>
          <p className="text-green-200 text-lg font-semibold">{current.bonus}</p>
        </div>
      </div>

      {/* Navigation */}
      {currentStep > 1 && (
        <div className="mb-6">
          <button
            onClick={() => setCurrentStep(currentStep - 1)}
            className="text-primary hover:underline flex items-center gap-1"
          >
            ← Kembali
          </button>
        </div>
      )}

      {/* Current Step */}
      <Card className="mb-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="text-5xl">{current.emoji}</div>
          <div>
            <p className="text-sm text-gray-600 mb-1">{current.subheading}</p>
            <h2 className="text-3xl font-bold">{current.heading}</h2>
          </div>
        </div>

        <p className="text-gray-700 whitespace-pre-line mb-6 leading-relaxed">
          {current.description}
        </p>

        {/* Input untuk step yang butuh input */}
        {current.inputValue !== undefined && (
          <div className="mb-6">
            {current.inputLabel && (
              <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                {current.inputLabel}
              </label>
            )}
            <input
              type={current.inputType || 'text'}
              inputMode={current.inputType === 'tel' ? 'tel' : undefined}
              value={current.inputValue}
              onChange={(e) => current.setInputValue?.(e.target.value)}
              placeholder={current.inputPlaceholder}
              className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition"
            />
            {current.expandableHint && (
              <details className="group mt-4 p-3 bg-light rounded-lg ring-1 ring-black/5">
                <summary className="font-semibold cursor-pointer text-dark list-none flex items-center justify-between [&::-webkit-details-marker]:hidden">
                  <span>Cara dapat URL profil Reddit</span>
                  <span className="text-primary transition-transform group-open:rotate-180">▾</span>
                </summary>
                <ul className="mt-3 space-y-2 text-sm text-muted">
                  <li>• Buka Reddit (pastikan WARP ON)</li>
                  <li>• Klik foto / ikon profil kamu di pojok kanan atas</li>
                  <li>• Klik username kamu di dropdown menu</li>
                  <li>• Copy URL dari address bar browser</li>
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Checkbox untuk step 2 & 3 */}
        {current.checkbox !== undefined && (
          <div className="mb-6 flex items-center gap-3">
            <input
              type="checkbox"
              id={`step-${currentStep}`}
              checked={current.checkbox}
              onChange={(e) => current.setCheckbox?.(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor={`step-${currentStep}`} className="text-gray-700 font-medium cursor-pointer">
              {current.checkboxLabel}
            </label>
          </div>
        )}

        {/* Hint */}
        <p className="text-sm text-gray-600 mb-6 italic">{current.hint}</p>

        {/* Buttons */}
        <div className="flex gap-3">
          {current.extraAction && (
            <Button
              onClick={current.extraAction}
              variant="outline"
              className="flex-1 flex items-center justify-center gap-2"
            >
              {current.extraButtonText}
              <ExternalLink size={18} />
            </Button>
          )}
          <Button
            onClick={current.action}
            variant="primary"
            className="flex-1"
            disabled={
              (currentStep === 1 && needsWhatsappStep && whatsapp.replace(/\D/g, '').length < 9) ||
              (currentStep === 2 && !waGroupConfirmed) ||
              (currentStep === 3 && !warpConfirmed) ||
              (currentStep === 4 && !redditConfirmed) ||
              (currentStep === 5 && !redditUrl.trim())
            }
          >
            {currentStep === steps.length ? (
              current.buttonText
            ) : (
              <>
                {current.buttonText}
                <ArrowRight size={18} className="inline ml-2" />
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Progress Indicator */}
      <div className="mt-12">
        <p className="text-center text-sm text-gray-600 mb-4">Progress Onboarding</p>
        <div className="flex gap-2 justify-center">
          {steps.map((step, idx) => (
            <button
              key={step.number}
              onClick={() => completedSteps.includes(step.number) && setCurrentStep(step.number)}
              className={`w-10 h-10 rounded-full font-bold transition-all ${
                currentStep === step.number
                  ? 'bg-primary text-white scale-110'
                  : completedSteps.includes(step.number)
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-300 text-gray-600'
              }`}
            >
              {completedSteps.includes(step.number) ? '✓' : step.number}
            </button>
          ))}
        </div>
      </div>

      {/* Skip button */}
      {currentStep > 1 && (
        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/tasks')}
            className="text-gray-600 hover:text-gray-800 hover:underline"
          >
            Skip (Bisa dilanjut nanti)
          </button>
        </div>
      )}
    </Layout>
  );
}
