// Admin → Payroll
//
// Pending payouts list with payment method details so admin can transfer +
// mark paid with a transaction reference. Also supports rejection with reason
// (e.g. "rekening tidak valid").
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Check, X, Copy } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

type FilterStatus = 'pending' | 'paid' | 'cancelled' | 'all';

function fmtTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru aja';
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.floor(h / 24)}h lalu`;
}

function copy(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

export function AdminPayroll() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>('pending');

  const { data: payouts = [], isLoading } = useQuery({
    queryKey: ['adminPayouts', filter],
    queryFn: async () => {
      let q = supabase.from('payouts').select('*, users(email, full_name, whatsapp)');
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q.order('created_at', { ascending: filter === 'pending' });
      return data || [];
    },
  });

  const markPaid = useMutation({
    mutationFn: async ({ id, ref, note }: { id: string; ref?: string; note?: string }) => {
      const { error } = await supabase.rpc('admin_mark_payout_paid', {
        p_payout_id: id,
        p_paid_reference: ref || null,
        p_admin_note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marked as paid ✅');
      qc.invalidateQueries({ queryKey: ['adminPayouts'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('admin_reject_payout', {
        p_payout_id: id,
        p_admin_note: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Payout rejected');
      qc.invalidateQueries({ queryKey: ['adminPayouts'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const handleMarkPaid = (p: any) => {
    const ref = prompt(
      `Mark payout Rp${p.amount.toLocaleString('id-ID')} ke ${p.account_holder_name} as PAID?\n\nTransaction reference / receipt number (opsional):`
    );
    if (ref === null) return; // cancelled
    markPaid.mutate({ id: p.id, ref: ref.trim() || undefined });
  };

  const handleReject = (p: any) => {
    const reason = prompt(
      `Reject payout Rp${p.amount.toLocaleString('id-ID')}?\n\nAlasan (akan dikirim ke army member via admin manual):`
    );
    if (!reason || reason.trim().length < 3) return;
    reject.mutate({ id: p.id, reason: reason.trim() });
  };

  const pendingTotal = payouts
    .filter((p: any) => p.status === 'pending')
    .reduce((s: number, p: any) => s + p.amount, 0);

  const exportCSV = () => {
    const csv = [
      ['Status', 'Name', 'Email', 'WhatsApp', 'Amount', 'Type', 'Provider', 'Account#', 'Holder', 'User Note', 'Requested', 'PaidRef', 'Admin Note'],
      ...payouts.map((p: any) => [
        p.status,
        p.users?.full_name || '',
        p.users?.email || '',
        p.users?.whatsapp || '',
        p.amount,
        p.payment_type || '',
        p.provider || '',
        p.account_number || '',
        p.account_holder_name || '',
        (p.user_note || '').replace(/[\n,]/g, ' '),
        new Date(p.created_at).toISOString(),
        p.paid_reference || '',
        (p.admin_note || '').replace(/[\n,]/g, ' '),
      ]),
    ].map((row) => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Payroll</h1>
        <p className="text-sm text-muted">
          {filter === 'pending' && `${payouts.length} pending • Rp${pendingTotal.toLocaleString('id-ID')}`}
          {filter === 'paid' && `${payouts.length} sudah dibayar`}
          {filter === 'cancelled' && `${payouts.length} rejected`}
          {filter === 'all' && `${payouts.length} total payouts`}
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['pending', 'paid', 'cancelled', 'all'] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`tap-shrink px-3 py-1.5 rounded-full text-xs font-bold ring-1 ${
              filter === s
                ? 'bg-primary text-white ring-primary'
                : 'bg-light text-dark ring-border hover:ring-primary/40'
            }`}
          >
            {s === 'pending' && '⏳ Pending'}
            {s === 'paid' && '✅ Paid'}
            {s === 'cancelled' && '❌ Rejected'}
            {s === 'all' && '📊 All'}
          </button>
        ))}
        {payouts.length > 0 && (
          <Button onClick={exportCSV} variant="outline" size="sm">
            <Download size={14} /> Export CSV
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : payouts.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-5xl mb-3">💸</div>
          <p className="font-bold">Tidak ada payout {filter !== 'all' && filter}.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {payouts.map((p: any) => (
            <Card key={p.id} className={p.status === 'paid' ? 'opacity-70' : ''}>
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold truncate">{p.users?.full_name || p.users?.email}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <a
                      href={`mailto:${p.users?.email}`}
                      className="text-[11px] text-primary underline truncate"
                    >{p.users?.email}</a>
                    {p.users?.whatsapp && (
                      <a
                        href={`https://wa.me/${p.users.whatsapp}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-success font-bold"
                      >WA →</a>
                    )}
                  </div>
                  <p className="text-[10px] text-muted mt-1">
                    Requested {fmtTimeAgo(p.created_at)} · {new Date(p.created_at).toLocaleString('id-ID')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-extrabold text-primary money">
                    Rp{p.amount.toLocaleString('id-ID')}
                  </p>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    p.status === 'pending' ? 'bg-warning/15 text-warning' :
                    p.status === 'paid' ? 'bg-success/15 text-success' :
                    'bg-danger/15 text-danger'
                  }`}>
                    {p.status === 'pending' && '⏳ Pending'}
                    {p.status === 'paid' && '✅ Paid'}
                    {p.status === 'cancelled' && '❌ Rejected'}
                  </span>
                </div>
              </div>

              {/* Payment method */}
              {p.payment_type ? (
                <div className="bg-light rounded-xl p-3 mb-3 text-sm">
                  <p className="text-[10px] uppercase font-bold text-muted tracking-wide mb-1">
                    Transfer ke
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-sm">
                        {p.payment_type === 'ewallet' ? '📱' : '🏦'} {p.provider}
                      </p>
                      <p className="font-mono text-base">
                        <button
                          onClick={() => copy(p.account_number, 'Nomor disalin')}
                          className="hover:text-primary inline-flex items-center gap-1"
                        >
                          {p.account_number} <Copy size={12} />
                        </button>
                      </p>
                      <p className="text-xs text-muted">a.n. <b>{p.account_holder_name}</b></p>
                    </div>
                  </div>
                  {p.user_note && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-[10px] uppercase font-bold text-muted mb-0.5">Pesan dari user</p>
                      <p className="text-xs italic">"{p.user_note}"</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-warning/10 ring-1 ring-warning/30 rounded-xl p-3 mb-3 text-xs text-warning">
                  ⚠️ Old payout (pre-2026-05-25) — no payment method recorded. DM user untuk minta data rekening/e-wallet.
                </div>
              )}

              {/* Admin note / reference (if paid/rejected) */}
              {p.paid_reference && (
                <p className="text-xs text-success mb-2">
                  💳 Ref: <code className="font-mono">{p.paid_reference}</code> · paid {fmtTimeAgo(p.paid_at)}
                </p>
              )}
              {p.admin_note && (
                <p className="text-xs text-muted italic mb-2">📝 {p.admin_note}</p>
              )}

              {/* Actions (only on pending) */}
              {p.status === 'pending' && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleMarkPaid(p)}
                    variant="success"
                    loading={markPaid.isPending}
                    fullWidth
                  >
                    <Check size={16} /> Mark as Paid
                  </Button>
                  <Button
                    onClick={() => handleReject(p)}
                    variant="outline"
                    loading={reject.isPending}
                    className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                  >
                    <X size={16} /> Reject
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
