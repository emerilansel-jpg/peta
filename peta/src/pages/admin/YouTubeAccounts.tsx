import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { adminListYouTubeAccounts, adminReviewYouTubeAccount, type AdminYouTubeAccountRow } from '../../lib/api';
import { toast } from '../../components/Toast';
import {
  Video, Check, X, ExternalLink, MessageCircle, AlertCircle,
  Clock, CheckCircle2, Eye, Search,
} from 'lucide-react';

const REJECT_PRESETS = [
  'Fitur Lanjutan (Advanced Features) belum aktif / tidak terlihat di screenshot.',
  'Screenshot bukan dari halaman studio.youtube.com (Kelayakan Fitur).',
  'Nama channel di screenshot berbeda dengan URL channel yang didaftarkan.',
  'Screenshot buram, terpotong, atau tidak terbaca.',
];

export function AdminYouTubeAccounts() {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [search, setSearch] = React.useState('');
  const [lightboxImg, setLightboxImg] = React.useState<{ src: string; title: string } | null>(null);

  // Reject Modal state
  const [rejectingAccount, setRejectingAccount] = React.useState<AdminYouTubeAccountRow | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');

  const { data: accounts = [], isLoading } = useQuery<AdminYouTubeAccountRow[]>({
    queryKey: ['adminYouTubeAccounts'],
    queryFn: adminListYouTubeAccounts,
    refetchInterval: 30_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ accountId, decision, reason }: { accountId: string; decision: 'approved' | 'rejected'; reason?: string }) =>
      adminReviewYouTubeAccount(accountId, decision, reason),
    onSuccess: (_, variables) => {
      toast.success(variables.decision === 'approved' ? 'Channel berhasil disetujui (Acc) ✓' : 'Channel berhasil ditolak.');
      queryClient.invalidateQueries({ queryKey: ['adminYouTubeAccounts'] });
      setRejectingAccount(null);
      setRejectReason('');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal memproses verifikasi');
    },
  });

  const pendingCount = accounts.filter((a) => a.verification_status === 'pending').length;
  const approvedCount = accounts.filter((a) => a.verification_status === 'approved').length;
  const rejectedCount = accounts.filter((a) => a.verification_status === 'rejected').length;

  const filtered = accounts.filter((a) => {
    if (tab !== 'all' && a.verification_status !== tab) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.channel_name || '').toLowerCase().includes(q) ||
      (a.channel_url || '').toLowerCase().includes(q) ||
      (a.user_full_name || '').toLowerCase().includes(q) ||
      (a.user_email || '').toLowerCase().includes(q) ||
      (a.user_whatsapp || '').toLowerCase().includes(q)
    );
  });

  return (
    <Layout userRole="admin">
      <div className="max-w-4xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 grid place-items-center">
                <Video size={18} />
              </div>
              <h1 className="text-2xl font-extrabold text-dark">Verifikasi Akun YouTube</h1>
            </div>
            <p className="text-xs text-muted mt-1">
              Verifikasi kelayakan 3 tahap (Advanced Features) channel YouTube army agar link di deskripsi video bisa diklik.
            </p>
          </div>
        </div>

        {/* Tabs & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setTab('pending')}
              className={`tap-shrink px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'pending'
                  ? 'bg-warning text-white shadow-sm'
                  : 'bg-light text-muted hover:bg-border'
              }`}
            >
              Menunggu Review
              {pendingCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${tab === 'pending' ? 'bg-white text-warning font-black' : 'bg-warning text-white'}`}>
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('approved')}
              className={`tap-shrink px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'approved'
                  ? 'bg-success text-white shadow-sm'
                  : 'bg-light text-muted hover:bg-border'
              }`}
            >
              Terverifikasi ({approvedCount})
            </button>
            <button
              onClick={() => setTab('rejected')}
              className={`tap-shrink px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'rejected'
                  ? 'bg-danger text-white shadow-sm'
                  : 'bg-light text-muted hover:bg-border'
              }`}
            >
              Ditolak ({rejectedCount})
            </button>
            <button
              onClick={() => setTab('all')}
              className={`tap-shrink px-3.5 py-1.5 rounded-full text-xs font-bold transition whitespace-nowrap ${
                tab === 'all'
                  ? 'bg-dark text-white shadow-sm'
                  : 'bg-light text-muted hover:bg-border'
              }`}
            >
              Semua ({accounts.length})
            </button>
          </div>

          <div className="relative min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Cari channel / nama army..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="text-center py-12">
            <Video size={36} className="mx-auto text-muted mb-2 opacity-50" />
            <h3 className="font-bold text-sm text-dark">Tidak ada data channel YouTube</h3>
            <p className="text-xs text-muted mt-1">
              {tab === 'pending'
                ? 'Semua pengajuan verifikasi sudah selesai direview! 🎉'
                : 'Belum ada akun di kategori ini.'}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((acc) => {
              const waClean = (acc.user_whatsapp || '').replace(/\D/g, '');
              const waLink = waClean ? `https://wa.me/${waClean}` : null;

              return (
                <Card key={acc.id} padding="sm" className="hover:ring-1 hover:ring-primary/20 transition">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left: User & Channel Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="font-extrabold text-sm text-dark truncate">
                          {acc.channel_name}
                        </span>
                        <a
                          href={acc.channel_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-semibold"
                        >
                          Buka Channel <ExternalLink size={12} />
                        </a>
                        {acc.verification_status === 'approved' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/15 text-success">
                            <CheckCircle2 size={11} /> Terverifikasi
                          </span>
                        ) : acc.verification_status === 'rejected' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger/15 text-danger">
                            <AlertCircle size={11} /> Ditolak
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/15 text-warning">
                            <Clock size={11} /> Menunggu Review
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
                        <div>
                          Army: <b className="text-dark">{acc.user_full_name || 'Tanpa nama'}</b> ({acc.user_email})
                        </div>
                        {waLink && (
                          <div className="flex items-center gap-1">
                            WA: <a href={waLink} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline font-bold inline-flex items-center gap-1">
                              <MessageCircle size={12} /> {acc.user_whatsapp}
                            </a>
                          </div>
                        )}
                        <div className="text-[11px]">
                          Submit: {new Date(acc.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        {acc.verified_at && (
                          <div className="text-[11px] text-success">
                            Acc: {new Date(acc.verified_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                          </div>
                        )}
                      </div>

                      {acc.rejection_reason && (
                        <div className="mt-2 p-2 rounded-lg bg-red-50 text-red-800 text-[11px] border border-red-200">
                          <b>Alasan Ditolak:</b> {acc.rejection_reason}
                        </div>
                      )}
                    </div>

                    {/* Middle: Screenshot Thumbnail */}
                    <div className="shrink-0 flex items-center gap-2">
                      <div
                        onClick={() => setLightboxImg({ src: acc.verification_screenshot_url, title: `Bukti ${acc.channel_name}` })}
                        className="group relative w-24 h-16 rounded-xl overflow-hidden border border-border bg-dark/5 cursor-pointer shadow-sm hover:ring-2 hover:ring-primary transition"
                      >
                        <img
                          src={acc.verification_screenshot_url}
                          alt="Screenshot bukti Fitur Lanjutan"
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition grid place-items-center text-white">
                          <Eye size={16} />
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="shrink-0 flex sm:flex-col gap-1.5 justify-end">
                      {acc.verification_status === 'pending' ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => reviewMutation.mutate({ accountId: acc.id, decision: 'approved' })}
                            loading={reviewMutation.isPending}
                            className="!bg-emerald-600 hover:!bg-emerald-700 !text-xs !py-1.5"
                          >
                            <Check size={14} className="mr-1 inline" /> Setujui (Acc)
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRejectingAccount(acc);
                              setRejectReason('');
                            }}
                            disabled={reviewMutation.isPending}
                            className="!text-xs !py-1.5 !text-red-600 !border-red-200 hover:!bg-red-50"
                          >
                            <X size={14} className="mr-1 inline" /> Tolak
                          </Button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            if (acc.verification_status === 'approved') {
                              setRejectingAccount(acc);
                              setRejectReason('');
                            } else {
                              reviewMutation.mutate({ accountId: acc.id, decision: 'approved' });
                            }
                          }}
                          className="text-[11px] text-muted underline hover:text-dark"
                        >
                          Ubah Status
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Modal Reject dengan Alasan */}
        {rejectingAccount && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
                <h3 className="font-extrabold text-base text-danger flex items-center gap-1.5">
                  <AlertCircle size={18} /> Tolak Verifikasi Channel
                </h3>
                <button onClick={() => setRejectingAccount(null)} className="text-muted hover:text-dark">
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-muted mb-3">
                Channel: <b className="text-dark">{rejectingAccount.channel_name}</b> (Army: {rejectingAccount.user_full_name})
              </p>

              <div className="space-y-2 mb-3">
                <label className="text-[11px] font-bold text-dark block">Pilih Alasan Cepat:</label>
                <div className="space-y-1">
                  {REJECT_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setRejectReason(p)}
                      className={`w-full text-left p-2 rounded-lg text-[11px] border transition ${
                        rejectReason === p ? 'bg-red-50 border-red-300 text-red-900 font-semibold' : 'bg-light/60 border-border hover:bg-border/60 text-muted'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[11px] font-bold text-dark block mb-1">Catatan Tambahan untuk Army:</label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tuliskan instruksi perbaikan..."
                  className="w-full p-2.5 rounded-xl border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" fullWidth onClick={() => setRejectingAccount(null)}>
                  Batal
                </Button>
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => reviewMutation.mutate({
                    accountId: rejectingAccount.id,
                    decision: 'rejected',
                    reason: rejectReason.trim() || 'Verifikasi ditolak oleh admin.',
                  })}
                  loading={reviewMutation.isPending}
                  className="!bg-red-600 hover:!bg-red-700"
                >
                  Tolak Pengajuan
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Lightbox Screenshot */}
        {lightboxImg && (
          <div
            onClick={() => setLightboxImg(null)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="relative max-w-3xl max-h-[90vh] bg-dark rounded-2xl overflow-hidden p-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-2 px-2 text-white border-b border-white/10 mb-2">
                <span className="text-xs font-bold truncate">{lightboxImg.title}</span>
                <button onClick={() => setLightboxImg(null)} className="text-white/70 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <img
                src={lightboxImg.src}
                alt={lightboxImg.title}
                className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain mx-auto"
              />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
