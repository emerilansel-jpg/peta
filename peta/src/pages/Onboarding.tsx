import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { claimOnboardingBonus, getFoundingMembers, type OnboardingStep } from '../lib/api';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import { ConfettiBurst } from '../components/Confetti';
import { ArrowRight, ExternalLink } from 'lucide-react';

export function Onboarding() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [currentStep, setCurrentStep] = React.useState(1);
  const [whatsapp, setWhatsapp] = React.useState('');
  const [warpConfirmed, setWarpConfirmed] = React.useState(false);
  const [waGroupConfirmed, setWaGroupConfirmed] = React.useState(false);
  const [confettiActive, setConfettiActive] = React.useState(false);
  const [completedSteps, setCompletedSteps] = React.useState<number[]>([]);
  // Founding cap: when the 100 slots are full, onboarding bonuses are no
  // longer awarded server-side — surface that honestly instead of claiming.
  const [foundingFull, setFoundingFull] = React.useState(false);

  React.useEffect(() => {
    getFoundingMembers().then((f) => setFoundingFull(f.isFull)).catch(() => {});
  }, []);

  const celebrate = () => {
    setConfettiActive(false);
    requestAnimationFrame(() => setConfettiActive(true));
  };

  const safeClaim = async (step: OnboardingStep) => {
    try { await claimOnboardingBonus(step); }
    catch (e) { console.warn('claimOnboardingBonus failed:', step, e); }
  };

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

      // Pre-fill whatsapp from profile if already saved
      const { data: profile } = await supabase
        .from('users')
        .select('whatsapp')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profile?.whatsapp) setWhatsapp(profile.whatsapp);

      // Check if user already completed onboarding
      const saved = localStorage.getItem(lsKey(data.user.id));
      if (saved) {
        const steps = JSON.parse(saved);
        if (steps.includes(4) || steps.includes(3)) {
          navigate('/tasks', { replace: true });
          return;
        }
        setCompletedSteps(steps);
        const firstIncomplete = [1, 2, 3].find((n) => !steps.includes(n));
        if (firstIncomplete) setCurrentStep(firstIncomplete);
      }

      // If user already has signup bonus credits in DB, onboarding is done
      const { data: existingCredits } = await supabase
        .from('user_credits')
        .select('id')
        .eq('user_id', data.user.id)
        .eq('source', 'signup_bonus')
        .limit(1);
      if (existingCredits && existingCredits.length > 0) {
        navigate('/tasks', { replace: true });
        return;
      }
    })();
  }, [navigate]);

  const markStepComplete = (stepNum: number) => {
    if (completedSteps.includes(stepNum)) return;
    const newCompleted = [...completedSteps, stepNum];
    setCompletedSteps(newCompleted);
    if (user?.id) localStorage.setItem(lsKey(user.id), JSON.stringify(newCompleted));
  };

  const handleStep1 = async () => {
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
      if (!foundingFull) {
        await safeClaim('signup');
        celebrate();
        toast.success('+Rp25.000 masuk saldo! 🎉');
      } else {
        toast('Bonus founding sudah penuh — kamu tetap bisa kerjain task 💪');
      }
    }
    setCurrentStep(2);
  };

  const handleStepWaGroup = async () => {
    if (!waGroupConfirmed) {
      toast.error('Klik "Buka Grup" dulu, gabung, lalu centang konfirmasi');
      return;
    }
    if (!completedSteps.includes(2)) {
      markStepComplete(2);
      await safeClaim('wa_group');
      celebrate();
      toast.success('+Rp10.000 masuk saldo! 🎊');
    }
    setCurrentStep(3);
  };

  const handleStep2 = async () => {
    if (!warpConfirmed) {
      toast.error('Silakan centang konfirmasi WARP terlebih dahulu');
      return;
    }
    if (!completedSteps.includes(3)) {
      markStepComplete(3);
      await safeClaim('warp');
      celebrate();
      toast.success('+Rp15.000 masuk saldo! Total bonus Rp50.000 ✨');
    }
    setCurrentStep(4);
  };

  const handleStepFinish = () => {
    markStepComplete(4);
    celebrate();
    toast.success('Selamat! Kamu siap mulai earning! 🚀');
    navigate('/tasks');
  };

  const needsWhatsappStep = user && whatsapp.trim().length === 0;
  const step1: any = {
    number: 1,
    title: '💰 Saldo kamu',
    balance: foundingFull ? 'Rp0' : 'Rp25.000',
    bonus: foundingFull ? 'Bonus founding sudah penuh' : '+Rp25.000 dari step ini',
    emoji: '🎁',
    heading: 'Selamat Datang!',
    subheading: 'Step 1 dari 4',
    description: needsWhatsappStep
      ? 'Selamat datang di PenghasilanTambahan.com (PeTa) — kamu sekarang bagian dari PeTa Army. Bakal dibayar buat ngerjain tugas ringan di internet — gampang banget.\n\nIsi nomor WhatsApp di bawah supaya admin bisa kontak kamu untuk konfirmasi payout. Lalu klik klaim bonus.'
      : foundingFull
        ? 'Selamat datang di PenghasilanTambahan.com (PeTa) — kamu sekarang bagian dari PeTa Army. Bakal dibayar buat ngerjain tugas ringan di internet — gampang banget.\n\nSlot founding (100 member pertama) sudah penuh, jadi bonus Rp50.000 founding tidak berlaku untuk kamu. Tapi kamu tetap bisa earning dari task.'
        : 'Selamat datang di PenghasilanTambahan.com (PeTa) — kamu sekarang bagian dari PeTa Army. Bonus Rp25.000 udah siap masuk saldo kamu.\n\nKlik tombol di bawah untuk klaim, lalu lanjut ke step setup berikutnya.',
    buttonText: foundingFull ? 'Lanjut Setup ➜' : '💰 Klaim Bonus Rp25.000',
    hint: foundingFull ? 'Bonus founding penuh — lanjut setup, task tetap bisa dikerjakan' : 'Bonus langsung masuk saldo setelah klaim',
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
      balance: 'Rp35.000',
      bonus: '+Rp10.000 dari step ini',
      emoji: '💬',
      heading: 'Gabung Grup WhatsApp',
      subheading: 'Step 2 dari 4',
      description: '🚨 Task baru DROP DI GRUP — first come first served.\n\n⏰ Slot task limited. Member di grup biasanya dapat slot 5-10 menit duluan dibanding yang ga gabung. Telat = slot abis = nunggu task berikutnya.\n\n💸 Notif payout, bukti transfer, tips naikin level — semua di sana.\n\nGabung sekali, ga ada spam. Buka link → tap "Join chat" → balik sini & centang.',
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
      balance: 'Rp50.000',
      bonus: '+Rp15.000 dari step ini',
      emoji: '🔒',
      heading: 'Pasang Cloudflare WARP',
      subheading: 'Step 3 dari 4',
      description: '⚡ Hanya 2 menit setup.\n\n🔐 Akses internet lebih cepat & lancar dengan Cloudflare WARP (1.1.1.1):\n✨ Gratis selamanya\n🔒 Aman & resmi dari Cloudflare\n📱 Cukup ON sekali di device\n✅ Lancar buka link tugas tanpa kendala ISP\n\nTutup page ini sementara kalau perlu — progress tersimpan.',
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
      balance: 'Rp50.000',
      bonus: 'Unlimited',
      emoji: '🎯',
      heading: 'Siap Mulai Earn!',
      subheading: 'Step 4 dari 4',
      description: 'Selamat! Kamu sudah selesai setup dan saldo bonus Rp50.000 sudah masuk.\n\nTask baru (Google Preferred Source, Forum, YouTube) siap kamu kerjakan.\n\nPantau notif di grup WhatsApp biar dapat duluan. Sementara nunggu, ajak teman → tiap teman = +Rp20.000.',
      buttonText: '🚀 Mulai Earning Sekarang!',
      hint: 'Kamu siap! Notif task masuk via WhatsApp.',
      action: handleStepFinish,
    },
  ];

  const current = steps[currentStep - 1];

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
      {foundingFull && (
        <div className="mb-4 p-3 bg-amber-50 ring-1 ring-amber-300 rounded-lg text-xs text-amber-900 leading-relaxed">
          <b>Bonus founding sudah penuh.</b> Slot ke-101+ tidak mendapat bonus Rp50.000 — tapi task tetap dibayar
          Rp5.000–Rp20.000 per komen, cair ke e-wallet.
        </div>
      )}
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
              (currentStep === 3 && !warpConfirmed)
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
          {steps.map((step) => (
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
