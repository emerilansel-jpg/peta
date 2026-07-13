import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Check } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { adminMarkPayoutPaid, sendPayoutPaidEmail } from '../../lib/api';
import { toast } from '../../components/Toast';

export function AdminPayroll() {
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
        sendPayoutPaidEmail(p.users.email, p.users.full_name, p.amount || 0).catch(() => {});
      }
      refetch();
    },
    onError: () => toast.error('Gagal update'),
  });

  const total = payouts.reduce((s: number, p: any) => s + p.amount, 0);

  const exportCSV = () => {
    const csvEscape = (v: any): string => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = [
      ['Name', 'Email', 'Amount', 'Requested'],
      ...payouts.map((p: any) => [
        p.users?.full_name || '',
        p.users?.email || '',
        p.amount,
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
                </div>
                <p className="text-2xl font-extrabold text-primary money shrink-0">
                  Rp{p.amount.toLocaleString('id-ID')}
                </p>
              </div>
              <Button
                onClick={() => markPaid.mutate(p)}
                variant="success"
                loading={markPaid.isPending}
                fullWidth
              >
                <Check size={18} /> Mark as Paid
              </Button>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
