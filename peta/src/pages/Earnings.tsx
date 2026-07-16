import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, X, Banknote, Lock, ArrowRight, Zap, Info } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { getPayoutHistory, requestPayout, getTotalEarnings, getMaxRedditKarma, getMyPendingAssignments, listEligibleTasksForUser, type EligibleTask, sendPayoutRequestEmail } from '../lib/api';
import { toast } from '../components/Toast';

// Bonus (signup + referral) tetap locked sampai Rp100K task earnings.
const BONUS_UNLOCK_FLOOR = 100000;
const MIN_PAYOUT = 20000;
const PAYOUT_PRESETS = [20000, 50000, 100000, 500000];

const EWalletOptions = ['Shopee Pay', 'Dana', 'Gopay'] as const;
const BankOptions = ['Jago', 'Mandiri', 'BRI', 'BCA'] as const;
type PaymentType = 'ewallet' | 'bank';
const ProviderByType: Record<PaymentType, readonly string[]> = {
  ewallet: EWalletOptions,
  bank: BankOptions,
};

export function Earnings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<any>(null);
  const [userName, setUserName] = React.useState<string>('PeTa Army');
  const [amount, setAmount] = React.useState(MIN_PAYOUT);
  const [showSheet, setShowSheet] = React.useState(false);
  const [showHowItWorks, setShowHowItWorks] = React.useState(false);
  const [paymentType, setPaymentType] = React.useState<PaymentType>('ewallet');
  const [provider, setProvider] = React.useState<string>(EWalletOptions[0]);
  const [accountNumber, setAccountNumber] = React.useState('');
  const [accountHolderName, setAccountHolderName] = React.useState('');

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
      const { data: profile } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', data.user.id)
        .single();
      if (profile?.full_name) setUserName(profile.full_name);
    })();
  }, [navigate]);

  const { data: payouts = [], isLoading: payoutsLoading, refetch } = useQuery({
    queryKey: ['payouts', user?.id],
    queryFn: () => getPayoutHistory(user!.id),
    enabled: !!user?.id,
  });

  const { data: earningsBreakdown = {
    tasks: 0, manualAdj: 0, signupBonus: 0, referralBonus: 0,
    bonus: 0, bonusUnlocked: false, cashable: 0, total: 0,
    earned: 0, referral: 0, fromWork: 0,
  }, isLoading: earningsLoading } = useQuery({
    queryKey: ['earnings', user?.id],
    queryFn: () => getTotalEarnings(user!.id),
    enabled: !!user?.id,
  });

  // Task assignments awaiting admin review — value at risk. Distinct from
  // pending PAYOUTS (which are payout requests in queue). User confusion
  // here was: "I did 2 tasks and the page says I'm owed Rp0" — because the
  // value sits in submitted task_assignments, not user_credits yet.
  const { data: myAssignments = [] } = useQuery({
    queryKey: ['myAssignments', user?.id],
    queryFn: () => getMyPendingAssignments(),
    enabled: !!user?.id,
    refetchInterval: 120_000,
  });
  const pendingApprovalValue = myAssignments
    .filter((a) => a.status === 'submitted')
    .reduce((sum, a) => sum + (a.task_reward || 0), 0);
  const pendingApprovalCount = myAssignments.filter((a) => a.status === 'submitted').length;

  // Detect "no Reddit account" state — same gate Tasks uses. Earnings page
  // is the second-most likely place a stalled user lands ("kapan cair?"),
  // so we surface the same setup nudge here too.
  const { data: karmaInfo } = useQuery({
    queryKey: ['maxKarma', user?.id],
    queryFn: () => getMaxRedditKarma(user!.id),
    enabled: !!user?.id,
  });
  const needsReddit = user?.id ? !karmaInfo?.username : false;

  // Eligible tasks — used to compute concrete "X upvote = unlock bonus" CTA.
  // Pulls the cheapest available reward so the math feels achievable.
  const { data: eligibleTasks = [] } = useQuery<EligibleTask[]>({
    queryKey: ['eligibleTasks-earnings', user?.id],
    queryFn: () => listEligibleTasksForUser(),
    enabled: !!user?.id && !!karmaInfo?.username,
    refetchInterval: 120_000,
  });
  const cheapestUpvote = eligibleTasks
    .filter((t) => t.task_type === 'upvote')
    .sort((a, b) => a.reward_amount - b.reward_amount)[0];
  const cheapestAny = [...eligibleTasks].sort((a, b) => a.reward_amount - b.reward_amount)[0];
  const cheapestTask = cheapestUpvote || cheapestAny; // prefer upvote for "10 detik" framing
  const hasEligibleTask = !!cheapestTask;

  const payoutMutation = useMutation({
    mutationFn: () => requestPayout(user.id, amount, paymentType, provider, accountNumber, accountHolderName),
    onSuccess: () => {
      toast.success('Payout request terkirim! 24 jam max ✅ Cek inbox + spam folder buat konfirmasi (peta@penghasilantambahan.com)');
      if (user?.email) {
        sendPayoutRequestEmail(user.email, userName, amount).catch(() => {});
      }
      setAmount(MIN_PAYOUT);
      setAccountNumber('');
      setAccountHolderName('');
      setShowSheet(false);
      // Refresh BOTH payouts + earnings so the hero number decrements immediately
      refetch();
      queryClient.invalidateQueries({ queryKey: ['earnings', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['payouts', user?.id] });
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal request payout'),
  });

  if (!user || earningsLoading || payoutsLoading) {
    return (
      <Layout userRole="army">
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      </Layout>
    );
  }

  const totalPending = payouts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const totalPaid    = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const committed    = totalPending + totalPaid;
  // "Available" = pool yang lagi unlocked - sudah dipakai untuk payout
  const available    = Math.max(earningsBreakdown.cashable - committed, 0);
  // Locked saldo (bonus yg belum kebuka) — display only
  const lockedAmount = earningsBreakdown.bonusUnlocked ? 0 : earningsBreakdown.bonus;

  // Bonus-unlock rule: bonus (signup + referral) baru cair setelah
  // tasks ≥ Rp100K. Task earnings sendiri cair anytime, NO MINIMUM.
  const bonusUnlocked = earningsBreakdown.bonusUnlocked;
  const bonusShortfall = Math.max(BONUS_UNLOCK_FLOOR - earningsBreakdown.tasks, 0);
  const bonusProgress = Math.min((earningsBreakdown.tasks / BONUS_UNLOCK_FLOOR) * 100, 100);
  // Bisa narik = saldo cair sudah mencapai minimum Rp20K
  const canWithdraw = available >= MIN_PAYOUT;
  // Quick-win math: cheapest reward → tasksToUnlock for bonus
  const quickReward = cheapestTask?.reward_amount || 1000;
  const tasksToUnlock = bonusShortfall > 0 ? Math.ceil(bonusShortfall / quickReward) : 0;

  const submit = () => {
    if (amount < MIN_PAYOUT) { toast.error(`Minimum tarik Rp${MIN_PAYOUT.toLocaleString('id-ID')}`); return; }
    if (amount > available) {
      if (!bonusUnlocked && earningsBreakdown.bonus > 0) {
        toast.error(`Bonus (signup+referral) kebuka setelah Rp${BONUS_UNLOCK_FLOOR.toLocaleString('id-ID')} dari task. Kurang Rp${bonusShortfall.toLocaleString('id-ID')} lagi.`);
      } else {
        toast.error('Saldo tidak cukup');
      }
      return;
    }
    if (!paymentType || !provider) { toast.error('Pilih metode dan provider penarikan'); return; }
    if (!accountNumber.trim()) { toast.error('Nomor rekening/e-wallet wajib diisi'); return; }
    if (!accountHolderName.trim()) { toast.error('Nama pemilik rekening/e-wallet wajib diisi'); return; }
    payoutMutation.mutate();
  };

  return (
    <Layout userRole="army">
      {/* Email-deliverability nudge — payout confirmations + admin pesan dikirim
          via email. Tetap shown until user has dismissed (localStorage flag) so
          first-time payout requesters don't miss admin reply in Spam folder. */}
      {!localStorage.getItem(`peta_email_save_dismissed:${user?.id || ''}`) && (
        <Card className="mb-3 bg-orange-50 ring-orange-200 relative">
          <button
            onClick={() => {
              localStorage.setItem(`peta_email_save_dismissed:${user.id}`, '1');
              // Force re-render
              setUser({ ...user });
            }}
            className="absolute top-2 right-2 p-1 text-orange-700 hover:text-orange-900"
            aria-label="Tutup notifikasi"
          >
            <X size={16} />
          </button>
          <div className="flex items-start gap-2.5 pr-6">
            <div className="text-xl shrink-0">📬</div>
            <div className="flex-1">
              <p className="font-extrabold text-orange-950 text-sm">Simpan email PeTa di kontak kamu</p>
              <p className="text-xs text-orange-900/85 mt-0.5 leading-snug">
                Konfirmasi payout + update task dikirim dari <b>peta@penghasilantambahan.com</b>.
                Sering masuk <b>folder Spam / Promotions</b> — save ke contacts biar nggak ketinggalan.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Reddit setup nudge — only shown when user has no Reddit account.
          Without it, real task earnings are impossible, so we point them
          back to onboarding before they wonder why their saldo is stuck. */}
      {needsReddit && (
        <Card className="mb-3 bg-yellow-50 ring-yellow-300">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 bg-yellow-400 text-yellow-950 rounded-xl grid place-items-center shrink-0">
              <Lock size={18} />
            </div>
            <div className="flex-1">
              <p className="font-extrabold text-yellow-950">Setup Reddit dulu biar saldo bisa naik</p>
              <p className="text-sm text-yellow-900/85 mt-0.5">
                Task baru dibayar lewat akun Reddit kamu. Selesai 5 menit + bonus Rp10K masuk saldo.
              </p>
            </div>
          </div>
          <Button
            onClick={() => navigate('/onboarding')}
            variant="primary"
            size="md"
            fullWidth
            className="!bg-yellow-900 hover:!bg-yellow-950 !text-white"
          >
            🔓 Lanjutkan Setup <ArrowRight size={14} />
          </Button>
        </Card>
      )}

      {/* HERO — 2 visual states (minimum Rp20K payout):
          A) available >= MIN_PAYOUT → BIG "Tarik Sekarang" button (yellow, klik = tarik)
          B) available < MIN_PAYOUT → CTA ke /tasks ("Mulai Earning") */}
      <Card className="mb-3 bg-gradient-to-br from-primary to-secondary text-white border-0 ring-0">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs opacity-80 font-bold uppercase tracking-wide">
            {canWithdraw ? '💸 Siap Dicairkan' : '💰 Saldo Cair'}
          </p>
          <button
            onClick={() => setShowHowItWorks((v) => !v)}
            className="text-[11px] opacity-80 hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-full bg-white/10"
            aria-label="Cara hitung saldo"
          >
            <Info size={12} /> Cara hitung
          </button>
        </div>
        <p className="text-5xl sm:text-6xl font-extrabold money mb-1 leading-none">
          Rp{available.toLocaleString('id-ID')}
        </p>
        <p className="text-xs opacity-90 mb-4">
          {canWithdraw
            ? 'Cair kapan aja. Minimum tarik Rp20K per request.'
            : available > 0
              ? 'Minimum tarik Rp20K. Yuk earning lagi buat nyampe minimum.'
              : 'Belum ada saldo. Kerjain task pertama → langsung cair anytime.'}
        </p>

        {/* Action — STATE A: tarik (saldo > 0, no minimum) */}
        {canWithdraw && (
          <Button
            onClick={() => {
              setAmount(available);
              setShowSheet(true);
            }}
            variant="success"
            size="lg"
            fullWidth
            className="!bg-yellow-300 !text-dark hover:!brightness-95 !shadow-yellow-300/30"
          >
            <Banknote size={20} />
            Tarik Rp{available.toLocaleString('id-ID')} Sekarang
          </Button>
        )}

        {/* Action — STATE B: saldo kosong → drive ke /tasks */}
        {!canWithdraw && (
          <Button
            onClick={() => navigate('/tasks')}
            variant="success"
            size="lg"
            fullWidth
            className="!bg-yellow-300 !text-dark hover:!brightness-95 !shadow-yellow-300/30"
          >
            <Zap size={18} />
            {hasEligibleTask
              ? `🚀 Mulai dari Rp${quickReward.toLocaleString('id-ID')}/${cheapestTask?.task_type === 'upvote' ? 'tap' : 'task'}`
              : '🚀 Lanjut Earning'}
          </Button>
        )}

        {!canWithdraw && hasEligibleTask && (
          <p className="mt-2 text-[11px] text-center opacity-90">
            {cheapestTask?.task_type === 'upvote'
              ? '~10 detik per tap • saldo nambah otomatis tiap approved'
              : 'Komen sekali, saldo masuk setelah admin approve'}
          </p>
        )}
      </Card>

      {/* "Cara hitung" — collapsible explainer. Sekali baca, ngerti aturan. */}
      {showHowItWorks && (
        <Card className="mb-3 bg-blue-50 ring-blue-200" padding="sm">
          <p className="text-xs font-extrabold text-blue-950 mb-2 flex items-center gap-1.5">
            <Info size={13} /> Cara saldo dihitung
          </p>
          <ul className="text-[12px] text-blue-950/90 space-y-1.5 leading-snug">
            <li className="flex items-start gap-2">
              <span className="font-bold text-green-700 shrink-0">1.</span>
              <span><b>Saldo dari task</b> (komen + upvote approved) → <b>cair kapan aja</b>. Minimum tarik Rp20K per request. 🎉</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-orange-700 shrink-0">2.</span>
              <span><b>Bonus signup + referral</b> → <b>kebuka setelah Rp{(BONUS_UNLOCK_FLOOR/1000).toFixed(0)}K</b> dari task approved. Anti-farming.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-blue-700 shrink-0">3.</span>
              <span>Task selesai → admin verify max 3 hari → otomatis masuk saldo.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-blue-700 shrink-0">4.</span>
              <span>Request payout → admin transfer max 24 jam ke rekening kamu.</span>
            </li>
          </ul>
        </Card>
      )}

      {/* UNLOCK BONUS — biggest CRO card. Quick-win math + button ke /tasks.
          Cuma muncul kalo user emang punya bonus locked (ada signup/referral). */}
      {!bonusUnlocked && earningsBreakdown.bonus > 0 && (
        <Card className="mb-3 bg-gradient-to-br from-yellow-300 to-orange-300 text-dark border-0 ring-0">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-11 h-11 bg-dark/15 rounded-xl grid place-items-center shrink-0">
              <Lock size={20} className="text-dark" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide opacity-75">Bonus Terkunci</p>
              <p className="text-2xl font-extrabold money leading-tight">
                Rp{earningsBreakdown.bonus.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] opacity-80 leading-snug">
                signup + referral — tinggal kerjain task dikit, kebuka semua
              </p>
            </div>
          </div>

          {/* Progress bar — visual hook */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span>Progress task: Rp{earningsBreakdown.tasks.toLocaleString('id-ID')} / Rp{BONUS_UNLOCK_FLOOR.toLocaleString('id-ID')}</span>
              <span>{Math.round(bonusProgress)}%</span>
            </div>
            <div className="w-full h-2.5 bg-dark/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-dark rounded-full transition-all"
                style={{ width: `${bonusProgress}%` }}
              />
            </div>
          </div>

          {/* Quick-win iming-iming — concrete math */}
          {hasEligibleTask ? (
            <div className="bg-dark text-white rounded-xl p-3 mb-3">
              <p className="text-[11px] uppercase font-bold tracking-wide opacity-70 mb-0.5 flex items-center gap-1.5">
                <Zap size={12} className="text-yellow-300" /> QUICK WIN
              </p>
              <p className="text-base font-extrabold leading-tight">
                {tasksToUnlock}× {cheapestTask?.task_type === 'upvote' ? 'tap upvote' : 'task'} = unlock <span className="text-yellow-300">Rp{earningsBreakdown.bonus.toLocaleString('id-ID')}</span> bonus
              </p>
              <p className="text-[11px] opacity-80 mt-0.5">
                {cheapestTask?.task_type === 'upvote'
                  ? `Rp${quickReward.toLocaleString('id-ID')} per tap × ${tasksToUnlock} = ${tasksToUnlock * quickReward >= 1000 ? `Rp${(tasksToUnlock * quickReward).toLocaleString('id-ID')}` : ''} • ~${tasksToUnlock * 10} detik total`
                  : `Rp${quickReward.toLocaleString('id-ID')} per task × ${tasksToUnlock} task`}
              </p>
            </div>
          ) : (
            <div className="bg-dark/10 rounded-xl p-3 mb-3 text-[12px] leading-snug">
              Kerjain task biar saldo ke{BONUS_UNLOCK_FLOOR.toLocaleString('id-ID')} dulu — semua bonus langsung kebuka.
              <b className="block mt-0.5">Kurang Rp{bonusShortfall.toLocaleString('id-ID')} lagi.</b>
            </div>
          )}

          <Button
            onClick={() => navigate('/tasks')}
            variant="primary"
            size="lg"
            fullWidth
            className="!bg-dark hover:!bg-dark/90 !text-yellow-300 !shadow-dark/30"
          >
            🚀 Ambil Task Sekarang <ArrowRight size={16} />
          </Button>
        </Card>
      )}

      {/* Bonus unlocked — celebratory chip (kalo bonus > 0 dan sudah kebuka) */}
      {bonusUnlocked && earningsBreakdown.bonus > 0 && (
        <Card className="mb-3 bg-success/10 ring-success/30" padding="sm">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-success/20 text-success rounded-lg grid place-items-center shrink-0 text-base">🎉</div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-sm text-success leading-tight">
                Bonus unlocked! +Rp{earningsBreakdown.bonus.toLocaleString('id-ID')} udah masuk saldo cair
              </p>
              <p className="text-[11px] text-success/90 leading-snug">
                Kerjaan kamu kebayar — signup + referral semua bisa ditarik sekarang.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* SALDO BREAKDOWN — clear math, no mystery. 3 baris simpel. */}
      <Card className="mb-3" padding="sm">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-2">Rincian Saldo Kamu</p>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-dark">
              <span className="text-success">✅</span> Dari task approved
            </span>
            <span className="font-extrabold money">Rp{earningsBreakdown.tasks.toLocaleString('id-ID')}</span>
          </div>
          {earningsBreakdown.manualAdj > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-dark">
                <span>🎁</span> Bonus admin
              </span>
              <span className="font-extrabold money">Rp{earningsBreakdown.manualAdj.toLocaleString('id-ID')}</span>
            </div>
          )}
          {earningsBreakdown.signupBonus > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-dark">
                {bonusUnlocked ? <span>🎁</span> : <Lock size={13} className="text-orange-500" />}
                Saldo bonus (signup)
              </span>
              <span className={`font-extrabold money ${bonusUnlocked ? '' : 'text-orange-500'}`}>
                Rp{earningsBreakdown.signupBonus.toLocaleString('id-ID')}
                {!bonusUnlocked && <span className="ml-1 text-[10px] font-normal">(locked)</span>}
              </span>
            </div>
          )}
          {earningsBreakdown.referralBonus > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-dark">
                {bonusUnlocked ? <span>🤝</span> : <Lock size={13} className="text-orange-500" />}
                Saldo referral
              </span>
              <span className={`font-extrabold money ${bonusUnlocked ? '' : 'text-orange-500'}`}>
                Rp{earningsBreakdown.referralBonus.toLocaleString('id-ID')}
                {!bonusUnlocked && <span className="ml-1 text-[10px] font-normal">(locked)</span>}
              </span>
            </div>
          )}
          {committed > 0 && (
            <div className="flex items-center justify-between text-muted">
              <span className="flex items-center gap-1.5">
                <span>−</span> Sudah ditarik / pending
              </span>
              <span className="font-bold">Rp{committed.toLocaleString('id-ID')}</span>
            </div>
          )}
          <div className="border-t border-border/60 pt-1.5 mt-1 flex items-center justify-between font-extrabold">
            <span className="text-dark">💰 Bisa cair sekarang</span>
            <span className="money text-primary">Rp{available.toLocaleString('id-ID')}</span>
          </div>
          {lockedAmount > 0 && (
            <p className="text-[10px] text-orange-600/90 leading-snug pt-0.5">
              + Rp{lockedAmount.toLocaleString('id-ID')} nunggu unlock (lihat card kuning di atas)
            </p>
          )}
        </div>
      </Card>

      {/* Pending approval banner — shown when user has submitted tasks
          waiting on admin. Closes the gap between "I did the work" and
          "saldo masih Rp0" by surfacing the value at risk explicitly. */}
      {pendingApprovalCount > 0 && (
        <Card className="mb-3 bg-warning/10 ring-warning/30" padding="sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 bg-warning/20 text-warning rounded-lg grid place-items-center shrink-0 text-base">⏳</div>
              <div className="min-w-0">
                <p className="font-extrabold text-sm leading-tight">
                  {pendingApprovalCount} task lagi diverify admin
                </p>
                <p className="text-[11px] text-warning/90 leading-snug">
                  Max 3 hari kerja. Approved otomatis cair ke saldo.
                </p>
              </div>
            </div>
            <p className="text-base font-extrabold text-warning money shrink-0">
              +Rp{(pendingApprovalValue / 1000).toFixed(1)}K
            </p>
          </div>
        </Card>
      )}

      {/* Lifetime stats — 2 simple cards: Total + Cair (history below for detail). */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Total Hasil</p>
          <p className="text-lg font-extrabold money">Rp{(earningsBreakdown.total / 1000).toFixed(0)}K</p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Udah Cair</p>
          <p className="text-lg font-extrabold money text-success">Rp{(totalPaid / 1000).toFixed(0)}K</p>
        </Card>
      </div>

      {/* Always-on CTA — even kalo bonus unlocked, tetap drive ke /tasks */}
      {hasEligibleTask && (
        <Card
          className="mb-5 bg-gradient-to-r from-secondary/15 to-primary/10 ring-secondary/30 cursor-pointer hover:ring-secondary/60 transition tap-shrink"
          padding="sm"
          onClick={() => navigate('/tasks')}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 bg-secondary/25 text-secondary rounded-xl grid place-items-center shrink-0 text-lg"><Zap size={18} /></div>
              <div className="min-w-0">
                <p className="font-extrabold text-sm leading-tight">
                  ⚡ {eligibleTasks.length} task siap dikerjain
                </p>
                <p className="text-[11px] text-muted leading-snug">
                  Mulai dari Rp{quickReward.toLocaleString('id-ID')} • saldo nambah otomatis tiap approved
                </p>
              </div>
            </div>
            <ArrowRight size={18} className="text-secondary shrink-0" />
          </div>
        </Card>
      )}

      {/* Payout-pending stat — only show when there's something there */}
      {totalPending > 0 && (
        <Card padding="sm" className="mb-5 bg-primary/5 ring-primary/30 flex items-center justify-between">
          <p className="text-xs text-muted">
            💸 Payout request lagi diproses: <b className="text-dark">Rp{totalPending.toLocaleString('id-ID')}</b>
          </p>
          <p className="text-[10px] text-muted">max 24h</p>
        </Card>
      )}

      {/* History */}
      <h2 className="text-lg font-extrabold mb-3">Riwayat Payout</h2>
      {payouts.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">💸</div>
          <p className="font-bold">Belum ada payout</p>
          <p className="text-sm text-muted">Request pertama kamu akan muncul di sini.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {payouts.map((p) => {
            const styles = {
              paid:      { bg: 'bg-success/10',  text: 'text-success',  label: '✅ Cair' },
              pending:   { bg: 'bg-warning/10',  text: 'text-warning',  label: '⏳ Diproses' },
              cancelled: { bg: 'bg-danger/10',   text: 'text-danger',   label: '❌ Batal' },
            }[p.status as 'paid' | 'pending' | 'cancelled'] || { bg: 'bg-light', text: 'text-muted', label: p.status };

            return (
              <Card key={p.id} padding="sm" className="flex items-center justify-between">
                <div>
                  <p className="font-extrabold money">Rp{p.amount.toLocaleString('id-ID')}</p>
                  <p className="text-xs text-muted">
                    {new Date(p.requested_at).toLocaleDateString('id-ID', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </p>
                  {p.provider && (
                    <p className="text-[11px] text-muted mt-0.5">
                      {p.provider}
                      {p.account_number ? ` — ${p.account_number}` : ''}
                      {p.account_holder_name ? ` (${p.account_holder_name})` : ''}
                    </p>
                  )}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${styles.bg} ${styles.text}`}>
                  {styles.label}
                </span>
              </Card>
            );
          })}
        </div>
      )}

      {/* Bottom sheet: payout form */}
      {showSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSheet(false)} />
          <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-extrabold flex items-center gap-2">
                  <TrendingUp size={20} className="text-primary" />
                  Tarik Saldo
                </h3>
                <button onClick={() => setShowSheet(false)} className="p-2 -mr-2 text-muted hover:text-dark">
                  <X size={22} />
                </button>
              </div>

              <p className="text-xs text-muted mb-2">Saldo tersedia</p>
              <p className="text-2xl font-extrabold money mb-5">Rp{available.toLocaleString('id-ID')}</p>

              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Pilih nominal (preset)</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {PAYOUT_PRESETS.filter(v => v <= available).map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className={`tap-shrink min-h-[48px] rounded-xl font-bold text-sm ${
                      amount === v
                        ? 'bg-primary text-white shadow-md shadow-primary/30'
                        : 'bg-light text-dark ring-1 ring-border hover:ring-primary/40'
                    }`}
                  >
                    Rp{v.toLocaleString('id-ID')}
                  </button>
                ))}
                {/* "Tarik semua" — utility shortcut */}
                {available > 0 && (
                  <button
                    onClick={() => setAmount(available)}
                    className={`tap-shrink min-h-[48px] rounded-xl font-bold text-sm col-span-2 ${
                      amount === available
                        ? 'bg-success text-white shadow-md shadow-success/30'
                        : 'bg-success/10 text-success ring-1 ring-success/30 hover:ring-success/60'
                    }`}
                  >
                    💰 Tarik Semua: Rp{available.toLocaleString('id-ID')}
                  </button>
                )}
              </div>

              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Atau custom</p>
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Math.max(MIN_PAYOUT, parseInt(e.target.value) || MIN_PAYOUT))}
                min={MIN_PAYOUT}
                max={available}
                step={1000}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition mb-4"
              />

              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Metode penarikan</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {(['ewallet', 'bank'] as PaymentType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setPaymentType(t);
                      setProvider(ProviderByType[t][0]);
                    }}
                    className={`tap-shrink min-h-[48px] rounded-xl font-bold text-sm ${
                      paymentType === t
                        ? 'bg-primary text-white shadow-md shadow-primary/30'
                        : 'bg-light text-dark ring-1 ring-border hover:ring-primary/40'
                    }`}
                  >
                    {t === 'ewallet' ? '💳 E-wallet' : '🏦 Bank'}
                  </button>
                ))}
              </div>

              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Provider</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {ProviderByType[paymentType].map((p) => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`tap-shrink min-h-[44px] rounded-xl font-bold text-sm ${
                      provider === p
                        ? 'bg-success text-white shadow-md shadow-success/30'
                        : 'bg-success/10 text-success ring-1 ring-success/30 hover:ring-success/60'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs uppercase font-bold tracking-wide text-muted mb-1">
                    {paymentType === 'ewallet' ? 'Nomor e-wallet' : 'Nomor rekening'}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder={paymentType === 'ewallet' ? 'Contoh: 0812xxxx' : 'Contoh: 1234567890'}
                    className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase font-bold tracking-wide text-muted mb-1">
                    Nama pemilik
                  </label>
                  <input
                    type="text"
                    value={accountHolderName}
                    onChange={(e) => setAccountHolderName(e.target.value)}
                    placeholder="Nama sesuai akun"
                    className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition"
                  />
                </div>
              </div>

              <div className="bg-light rounded-xl p-3 mb-4 text-xs text-muted space-y-0.5">
                <p>✅ <b>Minimum Rp{MIN_PAYOUT.toLocaleString('id-ID')}</b> per penarikan</p>
                <p>⏱️ Max 24 jam proses transfer</p>
                <p>🏦 Transfer ke {paymentType === 'ewallet' ? 'e-wallet' : 'rekening'} yang kamu pilih</p>
              </div>

              <Button
                onClick={submit}
                variant="primary"
                size="lg"
                loading={payoutMutation.isPending}
                disabled={amount < MIN_PAYOUT || amount > available}
                fullWidth
              >
                Request Rp{amount.toLocaleString('id-ID')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
