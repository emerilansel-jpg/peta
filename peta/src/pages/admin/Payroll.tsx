import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Check, X } from 'lucide-react';
import { useState } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { supabase } from '../../lib/supabase';
import { adminMarkPayoutPaid, adminCancelPayout, sendPayoutPaidEmail } from '../../lib/api';
import { toast } from '../../components/Toast';

export function AdminPayroll() {
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const { data: payouts = [], isLoading, refetch } = useQuery({
    queryKey: ['adminPayouts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('payouts')
        .select('*, users(email, full_name)')
        .eq('status', 'pending')
        .order('requested_at', { ascending: true });
      return data || [];
    },
  });

  const markPaid = useMutation({
    mutationFn: async (p: any) => {
      await adminMarkPayoutPaid(p.id);
      return p;
    },
    onSuccess: (p: any) => {
      toast.success('Marked as paid ✅');
      if (p?.users?.email && p?.users?.full_name) {
        sendPayoutPaidEmail(
          p.users.email,
          p.users.full_name,
          p.amount || 0,
          p.provider,
          p.account_number,
          p.account_holder_name,
        ).catch(() => {});
      }
      refetch();
    },
    onError: () => toast.error('Gagal update'),
  });

  const cancelPayout = useMutation({
    mutationFn: async (p: any) => {
      await adminCancelPayout(p.id);
      return p;
    },
    onSuccess: () => {
      toast.success('Payout dibatalkan — dana kembali ke member');
      setCancelTarget(null);
      refetch();
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Gagal batalkan payout');
    },
  });

  const total = payouts.reduce((s: number, p: any) => s + p.amount, 0);

  const exportCSV = () => {
    const csvEscape = (v: any): string => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = [
      ['Name', 'Email', 'Amount', 'Payment Type', 'Provider', 'Account Number', 'Account Holder', 'Requested'],
      ...payouts.map((p: any) => [
        p.users?.full_name || '',
        p.users?.email || '',
        p.amount,
        p.payment_type || '',
        p.provider || '',
        p.account_number || '',
        p.account_holder_name || '',
        new Date(p.requested_at).toISOString(),
      ]),
    ]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Payroll</h1>
        <p className="text-sm text-muted">{payouts.length} pending • Rp{total.toLocaleString('id-ID')}</p>
      </div>

      {payouts.length > 0 && (
        <div className="mb-4">
          <Button onClick={exportCSV} variant="outline" size="md">
            <Download size={16} /> Export CSV
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : payouts.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-5xl mb-3">💸</div>
          <p className="font-bold">Tidak ada payout pending</p>
          <p className="text-sm text-muted">Semua sudah dibayar.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {payouts.map((p: any) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="font-bold truncate">{p.users?.full_name || p.users?.email}</p>
                  <p className="text-xs text-muted truncate">{p.users?.email}</p>
                  <p className="text-xs text-muted mt-1">
                    Requested: {new Date(p.requested_at).toLocaleString('id-ID')}
                  </p>
                  <div className="mt-2 inline-flex flex-wrap gap-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-light text-[11px] font-bold text-dark uppercase">
                      {p.payment_type === 'ewallet' ? 'E-wallet' : p.payment_type === 'bank' ? 'Bank' : 'Transfer'}
                    </span>
                    {p.provider && (
                      <span className="px-2 py-0.5 rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                        {p.provider}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dark mt-1.5">
                    <span className="font-bold">{p.account_number || '-'}</span>
                    {p.account_holder_name ? ` — a.n. ${p.account_holder_name}` : ''}
                  </p>
                </div>
                <p className="text-2xl font-extrabold text-primary money shrink-0">
                  Rp{p.amount.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => markPaid.mutate(p)}
                  variant="success"
                  loading={markPaid.isPending}
                  fullWidth
                >
                  <Check size={18} /> Mark as Paid
                </Button>
                <Button
                  onClick={() => setCancelTarget(p)}
                  variant="outline"
                  loading={cancelPayout.isPending}
                  className="!border-danger !text-danger hover:!bg-danger hover:!text-white shrink-0"
                  title="Batalkan payout (dana kembali ke member)"
                >
                  <X size={18} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {cancelTarget && (
        <ConfirmDialog
          open
          title="Batalkan payout?"
          description={`Payout Rp${cancelTarget.amount.toLocaleString('id-ID')} untuk ${cancelTarget.users?.full_name || cancelTarget.users?.email} akan dibatalkan. Dana otomatis kembali ke saldo member.`}
          confirmLabel="Ya, Batalkan"
          cancelLabel="Batal"
          onConfirm={() => cancelPayout.mutate(cancelTarget)}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </Layout>
  );
}
