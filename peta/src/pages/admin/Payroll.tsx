// Admin → Payroll
//
// Pending payouts list with payment method details so admin can transfer +
// mark paid with a transaction reference. Also supports rejection with reason
// (e.g. "rekening tidak valid"). After "Mark as Paid", a WA modal opens so the
// admin can DM the army member a transfer confirmation + broadcast social proof
// to the WA group.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Check, X, Copy, MessageCircle, Users } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { buildWhatsappLink, sendWaDm } from '../../lib/api';
import { toast } from '../../components/Toast';
import { WaGroupSender } from '../../components/WaGroupSender';

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

function copyToClipboard(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

function buildPayoutDmMsg(name: string, amount: number, provider: string, accountNumber: string, accountHolderName: string): string {
  return `Halo ${name}! 💸\n\nTransfer kamu berhasil dikirim!\n\n✅ Nominal: *Rp${amount.toLocaleString('id-ID')}*\n✅ ${provider} · ${accountNumber}\n✅ a.n. ${accountHolderName}\n\nBiasanya masuk dalam beberapa menit — max 1 jam. Kalau belum masuk setelah 1 jam, balas pesan ini ya!\n\nMakasih udah kerja keras di PeTa 🙏 Saldo kamu cair — siap ambil task lagi? Masih banyak yang menanti! 💪🔥\n\n— Admin PeTa 🏆`;
}

function buildPayoutGroupMsg(amount: number): string {
  return `💸 *TRANSFER SUKSES!*\n\nMember PeTa baru aja terima Rp${amount.toLocaleString('id-ID')} dari hasil kerjain task. Langsung cair ke rekening — *KAPAN AJA, BERAPAPUN, nggak ada tahan-tahan!*\n\nMau dapet yang sama?\n✅ Task masih ada\n✅ Income cair ke bank/e-wallet kapan aja\n✅ Berapapun, nggak ada minimum\n✅ Daftar GRATIS\n\n👉 *https://penghasilantambahan.com*\n\nYuk gasss sebelum slot habis! ⚡`;
}

export function AdminPayroll() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>('pending');

  // Payout WA modal state
  const [payoutWaTarget, setPayoutWaTarget] = useState<{
    armyName: string; armyPhone: string; amount: number;
    provider: string; accountNumber: string; accountHolderName: string;
  } | null>(null);
  const [payoutWaTab, setPayoutWaTab] = useState<'dm' | 'group'>('dm');
  const [payoutWaDmPhone, setPayoutWaDmPhone] = useState('');
  const [payoutWaDmMsg, setPayoutWaDmMsg] = useState('');
  const [payoutWaGroupMsg, setPayoutWaGroupMsg] = useState('');
  const [payoutWaSending, setPayoutWaSending] = useState(false);

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
    mutationFn: async ({ id, ref, note, payout }: { id: string; ref?: string; note?: string; payout: any }) => {
      const { error } = await supabase.rpc('admin_mark_payout_paid', {
        p_payout_id: id,
        p_paid_reference: ref || null,
        p_admin_note: note || null,
      });
      if (error) throw error;
      return payout;
    },
    onSuccess: (payout) => {
      toast.success('Marked as paid ✅');
      // NOTE: don't refresh the list yet — keep the row in place while the
      // admin reads/sends the WA modal. Refresh happens in closePayoutModal().
      // Open WA modal to notify army member + broadcast social proof
      const name = payout.users?.full_name || payout.users?.email || 'member';
      const phone = payout.users?.whatsapp || '';
      const amount = payout.amount || 0;
      const provider = payout.provider || '—';
      const accountNumber = payout.account_number || '—';
      const accountHolderName = payout.account_holder_name || '—';
      setPayoutWaDmMsg(buildPayoutDmMsg(name, amount, provider, accountNumber, accountHolderName));
      setPayoutWaGroupMsg(buildPayoutGroupMsg(amount));
      setPayoutWaDmPhone(phone);
      setPayoutWaTab('dm');
      setPayoutWaTarget({ armyName: name, armyPhone: phone, amount, provider, accountNumber, accountHolderName });
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

  // Close the post-payout WA modal and only then refresh the list, so the
  // paid row stays put until the admin finishes the WA confirmation flow.
  const closePayoutModal = () => {
    setPayoutWaTarget(null);
    qc.invalidateQueries({ queryKey: ['adminPayouts'] });
  };

  const handleMarkPaid = (p: any) => {
    const ref = prompt(
      `Mark payout Rp${p.amount.toLocaleString('id-ID')} ke ${p.account_holder_name} as PAID?\n\nTransaction reference / receipt number (opsional):`
    );
    if (ref === null) return; // cancelled
    markPaid.mutate({ id: p.id, ref: ref.trim() || undefined, payout: p });
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
                          onClick={() => copyToClipboard(p.account_number, 'Nomor disalin')}
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
                  ⚠️ Old payout — no payment method recorded. DM user untuk minta data rekening/e-wallet.
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

      {/* Payout WA modal — appears after admin marks a payout as paid.
          Tab 1: WA DM to army user (auto-send via Fonnte + manual fallback)
          Tab 2: WA Group broadcast (copy message + open group link) */}
      {payoutWaTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !payoutWaSending && closePayoutModal()}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-extrabold flex items-center gap-2 text-success">
                  <Check size={20} /> Transfer Terkirim! 💸
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  <b className="text-dark">{payoutWaTarget.armyName}</b> · <span className="money font-bold text-primary">Rp{payoutWaTarget.amount.toLocaleString('id-ID')}</span> → {payoutWaTarget.provider}
                </p>
              </div>
              <button onClick={() => !payoutWaSending && closePayoutModal()} disabled={payoutWaSending} className="p-1 text-muted hover:text-dark disabled:opacity-40">
                <X size={20} />
              </button>
            </div>

            {/* Tab switch: DM | Group */}
            <div className="flex gap-1 mb-4 bg-light rounded-xl p-1">
              <button
                onClick={() => setPayoutWaTab('dm')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${
                  payoutWaTab === 'dm' ? 'bg-white text-dark shadow-sm ring-1 ring-black/5' : 'text-muted hover:text-dark'
                }`}
              >
                <MessageCircle size={13} /> DM ke Army
              </button>
              <button
                onClick={() => setPayoutWaTab('group')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${
                  payoutWaTab === 'group' ? 'bg-white text-dark shadow-sm ring-1 ring-black/5' : 'text-muted hover:text-dark'
                }`}
              >
                <Users size={13} /> WA Group
              </button>
            </div>

            {/* ─── Tab: DM ke Army ─── */}
            {payoutWaTab === 'dm' && (
              <>
                <p className="text-sm text-muted mb-2">
                  Konfirmasi transfer ke <b className="text-dark">{payoutWaTarget.armyName}</b> + semangatin ambil task lagi.
                </p>
                <div className="mb-3">
                  <label className="text-xs uppercase font-bold tracking-wide text-muted block mb-1">Nomor WA tujuan:</label>
                  <input
                    type="tel"
                    value={payoutWaDmPhone}
                    onChange={(e) => setPayoutWaDmPhone(e.target.value)}
                    disabled={payoutWaSending}
                    placeholder="628xxxxxxxxxx"
                    className="w-full px-3 py-2 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-sm font-mono disabled:opacity-60"
                  />
                  <p className="text-[10px] text-muted mt-1">Edit nomor untuk test sebelum kirim ke army.</p>
                </div>
                <textarea
                  value={payoutWaDmMsg}
                  onChange={(e) => setPayoutWaDmMsg(e.target.value)}
                  rows={9}
                  disabled={payoutWaSending}
                  className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-xs font-mono leading-relaxed mb-4 disabled:opacity-60"
                />
                <div className="space-y-2">
                  <button
                    disabled={payoutWaSending || !payoutWaDmPhone}
                    onClick={async () => {
                      setPayoutWaSending(true);
                      try {
                        const res = await sendWaDm(payoutWaDmPhone, payoutWaDmMsg);
                        if (res.sent) {
                          toast.success(`WA konfirmasi terkirim ke ${payoutWaTarget.armyName} ✅`);
                          setPayoutWaTab('group');
                        } else {
                          toast.error(`Fonnte gagal: ${res.error || 'unknown error'}`);
                        }
                      } catch (e: any) {
                        toast.error(`Error: ${e.message || String(e)}`);
                      } finally {
                        setPayoutWaSending(false);
                      }
                    }}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:brightness-110 disabled:opacity-60 text-white font-extrabold text-sm transition tap-shrink"
                  >
                    {payoutWaSending
                      ? <><span className="animate-spin">⏳</span> Mengirim...</>
                      : <><MessageCircle size={16} /> Kirim Konfirmasi via Fonnte</>
                    }
                  </button>
                  {!payoutWaSending && (
                    <a
                      href={buildWhatsappLink(payoutWaDmPhone, payoutWaDmMsg)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setPayoutWaTab('group')}
                      className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl ring-1 ring-[#25D366]/40 text-[#25D366] hover:bg-[#25D366]/5 font-semibold text-xs transition"
                    >
                      <MessageCircle size={13} /> Kirim Manual via WA Web
                    </a>
                  )}
                  <button onClick={() => setPayoutWaTab('group')} disabled={payoutWaSending} className="w-full text-xs text-muted hover:text-dark font-semibold py-1 disabled:opacity-40">
                    Skip → Lanjut ke WA Group
                  </button>
                </div>
              </>
            )}

            {/* ─── Tab: WA Group Broadcast ─── */}
            {payoutWaTab === 'group' && (
              <>
                <p className="text-sm text-muted mb-2">
                  Broadcast ke grup WA untuk create social proof + dorong member lain.
                </p>
                <textarea
                  value={payoutWaGroupMsg}
                  onChange={(e) => setPayoutWaGroupMsg(e.target.value)}
                  rows={9}
                  className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-xs font-mono leading-relaxed mb-4"
                />
                <WaGroupSender message={payoutWaGroupMsg} />
                <button onClick={closePayoutModal} className="w-full text-xs text-muted hover:text-dark font-semibold py-2 mt-2">
                  Selesai (tutup)
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
