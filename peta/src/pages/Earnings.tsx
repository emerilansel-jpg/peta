import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, X, Banknote } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { getPayoutHistory, requestPayout, getTotalEarnings } from '../lib/api';
import { toast } from '../components/Toast';

const MIN_PAYOUT = 150000;
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

  const { data: totalEarnings = 0, isLoading: earningsLoading } = useQuery({
    queryKey: ['earnings', user?.id],
    queryFn: () => getTotalEarnings(user!.id),
    enabled: !!user?.id,
  });

  const payoutMutation = useMutation({
    mutationFn: () => requestPayout(user.id, amount),
    onSuccess: () => {
      toast.success('Payout request terkirim! 24 jam max ✅');
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
  const available    = totalEarnings - totalPending - totalPaid;

  // Milestone — first goal is min payout, then bigger targets
  const milestones = [MIN_PAYOUT, 300000, 500000, 1000000, 2000000];
  const next = milestones.find((m) => m > totalEarnings) || milestones[milestones.length - 1];
  const progress = Math.min((totalEarnings / next) * 100, 100);
  const remaining = Math.max(next - totalEarnings, 0);

  const submit = () => {
    if (amount < MIN_PAYOUT) { toast.error(`Minimum payout Rp${MIN_PAYOUT.toLocaleString('id-ID')}`); return; }
    if (amount > available) { toast.error('Saldo tidak cukup'); return; }
    payoutMutation.mutate();
  };

  return (
    <Layout userRole="army">
      {/* Hero saldo card */}
      <Card className="mb-4 bg-gradient-to-br from-primary to-secondary text-white border-0 ring-0">
        <p className="text-xs opacity-80 mb-1">Saldo bisa dicairkan</p>
        <p className="text-4xl sm:text-5xl font-extrabold money mb-3">
          Rp{available.toLocaleString('id-ID')}
        </p>

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

        <Button
          onClick={() => {
            setAmount(Math.min(Math.max(MIN_PAYOUT, available), available));
            setShowSheet(true);
          }}
          variant="success"
          size="lg"
          fullWidth
          disabled={available < MIN_PAYOUT}
          className="!bg-yellow-300 !text-dark hover:!brightness-95 !shadow-yellow-300/30"
        >
          <Banknote size={20} />
          {available < MIN_PAYOUT
            ? `Min Rp${(MIN_PAYOUT/1000).toFixed(0)}K (kurang Rp${(MIN_PAYOUT - available).toLocaleString('id-ID')})`
            : 'Tarik Saldo Sekarang'}
        </Button>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Total</p>
          <p className="text-base font-extrabold money">Rp{(totalEarnings / 1000).toFixed(0)}K</p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Pending</p>
          <p className="text-base font-extrabold money text-warning">Rp{(totalPending / 1000).toFixed(0)}K</p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Cair</p>
          <p className="text-base font-extrabold money text-success">Rp{(totalPaid / 1000).toFixed(0)}K</p>
        </Card>
      </div>

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
