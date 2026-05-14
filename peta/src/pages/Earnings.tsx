import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, X, Banknote, Lock, ArrowRight } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { getPayoutHistory, requestPayout, getTotalEarnings, getMaxRedditKarma, getMyPendingAssignments } from '../lib/api';
import { toast } from '../components/Toast';

const MIN_PAYOUT = 150000;
const EARNINGS_FLOOR = 150000; // Rp150K dari task + signup bonus dulu
const PAYOUT_PRESETS = [150000, 250000, 500000, 1000000];

export function Earnings() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [amount, setAmount] = React.useState(MIN_PAYOUT);
  const [showSheet, setShowSheet] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  const { data: payouts = [], isLoading: payoutsLoading, refetch } = useQuery({
    queryKey: ['payouts', user?.id],
    queryFn: () => getPayoutHistory(user!.id),
    enabled: !!user?.id,
  });

  const { data: earningsBreakdown = { earned: 0, referral: 0, fromWork: 0, total: 0 }, isLoading: earningsLoading } = useQuery({
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
    refetchInterval: 30_000,
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

  const payoutMutation = useMutation({
    mutationFn: () => requestPayout(user.id, amount),
    onSuccess: () => {
      toast.success('Payout request terkirim! 24 jam max ✅ Cek inbox + spam folder buat konfirmasi (peta@penghasilantambahan.com)');
      setAmount(50000);
      setShowSheet(false);
      refetch();
    },
    onError: () => toast.error('Gagal request payout'),
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
  const available    = earningsBreakdown.total - totalPending - totalPaid;

  // Earnings-floor rule: must earn ≥Rp150K from task + signup bonus
  // BEFORE any saldo (including referral) bisa cair. Server-enforced
  // via validate_payout_eligibility — UI mirrors the gate.
  const floorMet = earningsBreakdown.fromWork >= EARNINGS_FLOOR;
  const floorShortfall = Math.max(EARNINGS_FLOOR - earningsBreakdown.fromWork, 0);
  const floorProgress = Math.min((earningsBreakdown.fromWork / EARNINGS_FLOOR) * 100, 100);
  const canWithdraw = floorMet && available >= MIN_PAYOUT;

  // Milestone — first goal is min payout, then bigger targets
  const milestones = [MIN_PAYOUT, 300000, 500000, 1000000, 2000000];
  const next = milestones.find((m) => m > earningsBreakdown.total) || milestones[milestones.length - 1];
  const progress = Math.min((earningsBreakdown.total / next) * 100, 100);
  const remaining = Math.max(next - earningsBreakdown.total, 0);

  const submit = () => {
    if (amount < MIN_PAYOUT) { toast.error(`Minimum payout Rp${MIN_PAYOUT.toLocaleString('id-ID')}`); return; }
    if (amount > available) { toast.error('Saldo tidak cukup'); return; }
    if (!floorMet) {
      toast.error(`Butuh Rp${floorShortfall.toLocaleString('id-ID')} lagi dari task + signup bonus dulu`);
      return;
    }
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

      {/* Hero saldo card */}
      <Card className="mb-4 bg-gradient-to-br from-primary to-secondary text-white border-0 ring-0">
        <p className="text-xs opacity-80 mb-1">Siap dicairkan</p>
        <p className="text-4xl sm:text-5xl font-extrabold money mb-3">
          Rp{available.toLocaleString('id-ID')}
        </p>

        {/* Breakdown: earned + referral */}
        <div className="bg-white/15 backdrop-blur rounded-xl p-3 mb-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">✅ Dari task & bonus</span>
            <span className="font-bold">Rp{earningsBreakdown.earned.toLocaleString('id-ID')}</span>
          </div>
          {earningsBreakdown.referral > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                {floorMet ? '🎁' : <Lock size={13} className="opacity-80" />} Dari referral
              </span>
              <span className="font-bold">
                Rp{earningsBreakdown.referral.toLocaleString('id-ID')}
                {!floorMet && <span className="ml-1 text-[10px] opacity-80 font-normal">(locked)</span>}
              </span>
            </div>
          )}
          <div className="border-t border-white/20 pt-2 flex items-center justify-between font-extrabold">
            <span>🎯 Total</span>
            <span>Rp{earningsBreakdown.total.toLocaleString('id-ID')}</span>
          </div>
        </div>

        {/* Earnings-floor gate — visible until cleared */}
        {!floorMet && (
          <div className="bg-yellow-300/95 text-dark rounded-xl p-3 mb-4">
            <div className="flex items-center justify-between text-xs mb-1.5 font-bold">
              <span className="flex items-center gap-1.5">
                <Lock size={13} /> Buka cair: task + signup bonus
              </span>
              <span>{Math.round(floorProgress)}%</span>
            </div>
            <div className="w-full h-2 bg-dark/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-dark rounded-full transition-all"
                style={{ width: `${floorProgress}%` }}
              />
            </div>
            <p className="text-[11px] mt-1.5 leading-snug">
              Kumpulin <b>Rp{EARNINGS_FLOOR.toLocaleString('id-ID')}</b> dari task + signup bonus dulu, baru semua saldo (termasuk referral) bisa cair.
              Kurang <b>Rp{floorShortfall.toLocaleString('id-ID')}</b> lagi.
            </p>
          </div>
        )}

        {floorMet && (
          <div className="bg-white/15 backdrop-blur rounded-xl p-3 mb-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span>Goal: Rp{next.toLocaleString('id-ID')}</span>
              <span className="font-bold">{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-yellow-300 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            {remaining > 0 ? (
              <p className="text-xs mt-2 opacity-90">
                🎯 Tinggal Rp{remaining.toLocaleString('id-ID')} lagi {remaining <= 50000 && '— hampir!'}
              </p>
            ) : (
              <p className="text-xs mt-2 opacity-90">🎉 Goal tercapai!</p>
            )}
          </div>
        )}

        <Button
          onClick={() => {
            setAmount(Math.min(Math.max(MIN_PAYOUT, available), available));
            setShowSheet(true);
          }}
          variant="success"
          size="lg"
          fullWidth
          disabled={!canWithdraw}
          className="!bg-yellow-300 !text-dark hover:!brightness-95 !shadow-yellow-300/30"
        >
          {!floorMet ? <Lock size={18} /> : <Banknote size={20} />}
          {!floorMet
            ? `Locked — kurang Rp${floorShortfall.toLocaleString('id-ID')} dari task`
            : available < MIN_PAYOUT
            ? `Min Rp${(MIN_PAYOUT/1000).toFixed(0)}K — kurang Rp${(MIN_PAYOUT - available).toLocaleString('id-ID')}`
            : 'Tarik Saldo Sekarang'}
        </Button>
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

      {/* Quick stats — Dari Task / Verify-pending / Cair */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Dari Task</p>
          <p className="text-base font-extrabold money">Rp{(earningsBreakdown.earned / 1000).toFixed(0)}K</p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide" title="Task selesai, lagi diverify admin">Verify</p>
          <p className="text-base font-extrabold money text-warning">
            Rp{(pendingApprovalValue / 1000).toFixed(0)}K
          </p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Cair</p>
          <p className="text-base font-extrabold money text-success">Rp{(totalPaid / 1000).toFixed(0)}K</p>
        </Card>
      </div>

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

              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Pilih nominal</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
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
              </div>

              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Atau custom</p>
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Math.max(MIN_PAYOUT, parseInt(e.target.value) || 0))}
                min={MIN_PAYOUT}
                max={available}
                step={10000}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition mb-4"
              />

              <div className="bg-light rounded-xl p-3 mb-4 text-xs text-muted">
                <p>📌 Min: Rp{MIN_PAYOUT.toLocaleString('id-ID')} • Max 24 jam proses</p>
                <p>🏦 Transfer ke rekening yang terdaftar</p>
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
