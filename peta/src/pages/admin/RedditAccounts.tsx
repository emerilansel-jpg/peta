import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { getLevelInfo } from '../../lib/levels';
import { adminSetKarma, adminRejectKarmaClaim, updateRedditAccountKarma } from '../../lib/api';
import { toast } from '../../components/Toast';
import { Pencil, RefreshCw, Check, X, ExternalLink, ShieldCheck, Trash2, Zap } from 'lucide-react';

type Row = {
  id: string;
  username: string;
  karma: number;
  level: number;
  account_age_days: number;
  last_sync: string;
  pending_karma: number | null;
  pending_karma_submitted_at: string | null;
  users?: { email?: string; full_name?: string };
};

export function AdminRedditAccounts() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; karma: string; age: string } | null>(null);
  // Bulk sync state — single in-flight loop, throttled to avoid hammering
  // the codetabs proxy (free tier, may rate-limit). 500ms gap = ~2 req/sec.
  const [bulkSync, setBulkSync] = useState<{ running: boolean; current: number; total: number; updated: number; failed: number; lastUser: string } | null>(null);

  const { data: accounts = [], isLoading } = useQuery<Row[]>({
    queryKey: ['allRedditAccounts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('reddit_accounts')
        .select('*, users(email, full_name)')
        .order('karma', { ascending: false });
      return (data || []) as Row[];
    },
  });

  const setKarmaMutation = useMutation({
    mutationFn: ({ id, karma, age }: { id: string; karma: number; age: number }) =>
      adminSetKarma(id, karma, age),
    onSuccess: () => {
      toast.success('Karma di-update — level otomatis dihitung ulang');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['allRedditAccounts'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const syncMutation = useMutation({
    mutationFn: ({ id, username }: { id: string; username: string }) =>
      updateRedditAccountKarma(id, username),
    onSuccess: (res: any) => {
      if (res?.fallback) {
        toast.error('Reddit blokir / akun tidak ditemukan — set manual');
      } else {
        toast.success('Karma disync dari Reddit');
      }
      queryClient.invalidateQueries({ queryKey: ['allRedditAccounts'] });
    },
    onError: (e: any) => toast.error(`Sync gagal: ${e.message || e}`),
  });

  // Approve a pending honor-system claim — writes the claimed value into
  // the live karma column (DB trigger recomputes level + last_sync).
  const approveClaimMutation = useMutation({
    mutationFn: ({ id, karma, age }: { id: string; karma: number; age: number }) =>
      adminSetKarma(id, karma, age),
    onSuccess: () => {
      toast.success('Claim approved — karma updated, level recomputed');
      queryClient.invalidateQueries({ queryKey: ['allRedditAccounts'] });
    },
    onError: (e: any) => toast.error(`Gagal approve: ${e.message || e}`),
  });

  const rejectClaimMutation = useMutation({
    mutationFn: (id: string) => adminRejectKarmaClaim(id),
    onSuccess: () => {
      toast.success('Claim ditolak — pending fields dikosongkan');
      queryClient.invalidateQueries({ queryKey: ['allRedditAccounts'] });
    },
    onError: (e: any) => toast.error(`Gagal reject: ${e.message || e}`),
  });

  const pendingClaims = accounts.filter(
    (a) => a.pending_karma !== null && a.pending_karma_submitted_at !== null
  );

  const relativeAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} jam lalu`;
    const days = Math.floor(hours / 24);
    return `${days} hari lalu`;
  };

  const startEdit = (a: Row) =>
    setEditing({ id: a.id, karma: String(a.karma), age: String(a.account_age_days) });

  // Bulk re-sync: iterate every account through the same single-account
  // sync path (updateRedditAccountKarma). Throttled to 500ms between
  // requests so we don't blow through the free codetabs proxy quota.
  // Cancel flag — useRef so mutations inside the closure are visible without re-renders.
  const bulkCancelRef = useRef(false);
  const startBulkSync = async () => {
    if (bulkSync?.running) return;
    if (!confirm(`Sync ${accounts.length} akun dari Reddit? Estimasi ${Math.ceil(accounts.length * 0.7)} detik.`)) return;
    bulkCancelRef.current = false;
    setBulkSync({ running: true, current: 0, total: accounts.length, updated: 0, failed: 0, lastUser: '' });
    let updated = 0, failed = 0;
    for (let i = 0; i < accounts.length; i++) {
      if (bulkCancelRef.current) break;
      const a = accounts[i];
      setBulkSync((s) => s && { ...s, current: i + 1, lastUser: a.username });
      try {
        const res = await updateRedditAccountKarma(a.id, a.username);
        if (res?.fallback) failed++;
        else updated++;
      } catch {
        failed++;
      }
      setBulkSync((s) => s && { ...s, updated, failed });
      if (i < accounts.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    setBulkSync((s) => s && { ...s, running: false });
    queryClient.invalidateQueries({ queryKey: ['allRedditAccounts'] });
    if (bulkCancelRef.current) {
      toast.success(`Dibatalkan: ${updated} updated · ${failed} fallback`);
    } else {
      toast.success(`Sync selesai: ${updated} updated · ${failed} fallback`);
    }
  };

  const cancelBulkSync = () => {
    bulkCancelRef.current = true;
  };

  const saveEdit = () => {
    if (!editing) return;
    const karma = parseInt(editing.karma, 10);
    const age = parseInt(editing.age, 10);
    if (isNaN(karma) || karma < 0) return toast.error('Karma harus angka >= 0');
    if (isNaN(age) || age < 0) return toast.error('Umur akun harus angka >= 0');
    setKarmaMutation.mutate({ id: editing.id, karma, age });
  };

  return (
    <Layout userRole="admin">
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold">Akun Reddit</h1>
          <p className="text-sm text-muted">{accounts.length} akun terdaftar — ✏️ set manual · 🔄 sync per-akun · ⚡ sync semua</p>
        </div>
        {accounts.length > 0 && (
          <div className="flex items-center gap-2">
            {bulkSync?.running ? (
              <>
                <Button onClick={cancelBulkSync} variant="outline" size="sm" className="!border-danger !text-danger hover:!bg-danger hover:!text-white">
                  <X size={14} /> Cancel
                </Button>
                <span className="text-xs font-bold tabular-nums text-muted">
                  {bulkSync.current}/{bulkSync.total} · ✅{bulkSync.updated} ⚠️{bulkSync.failed}
                </span>
              </>
            ) : (
              <Button onClick={startBulkSync} variant="primary" size="sm" loading={false}>
                <Zap size={14} /> Sync Semua ({accounts.length})
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Bulk sync progress indicator — only visible while running */}
      {bulkSync?.running && (
        <Card padding="sm" className="mb-4 bg-primary/5 ring-primary/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-primary uppercase tracking-wide">Sync Berjalan</span>
            <span className="text-xs text-muted tabular-nums">u/{bulkSync.lastUser}</span>
          </div>
          <div className="w-full h-2 bg-primary/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(bulkSync.current / bulkSync.total) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-muted mt-1.5">
            {bulkSync.current} dari {bulkSync.total} · {bulkSync.updated} updated · {bulkSync.failed} fallback. Jangan tutup tab.
          </p>
        </Card>
      )}

      {/* PENDING KARMA CLAIMS — honor-system submissions waiting on
          admin verification. Highest-priority work. */}
      {pendingClaims.length > 0 && (
        <Card className="mb-5 bg-warning/10 ring-warning/40">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs uppercase tracking-wide font-bold text-warning">Verify queue</p>
              <h2 className="text-lg sm:text-xl font-extrabold">
                {pendingClaims.length} klaim karma menunggu
              </h2>
              <p className="text-xs text-muted">
                User submit angka karma sendiri (auto-sync diblokir Reddit). Buka profile mereka, cocokin angka, lalu approve/reject.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {pendingClaims.map((a) => (
              <div
                key={a.id}
                className="bg-white rounded-xl ring-1 ring-warning/30 p-3 sm:p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-extrabold truncate">u/{a.username}</p>
                    <p className="text-xs text-muted truncate">{a.users?.email}</p>
                    <p className="text-[11px] text-muted mt-0.5">
                      Submitted {relativeAgo(a.pending_karma_submitted_at!)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Claimed</p>
                    <p className="text-2xl sm:text-3xl font-extrabold money tabular-nums">
                      {a.pending_karma!.toLocaleString('id-ID')}
                    </p>
                    <p className="text-[10px] text-muted">vs current: {a.karma.toLocaleString('id-ID')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <a
                    href={`https://www.reddit.com/user/${a.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white ring-1 ring-black/15 rounded-xl px-3 py-2 text-sm font-bold flex items-center justify-center gap-1.5 hover:ring-primary"
                  >
                    <ExternalLink size={14} /> Buka profile
                  </a>
                  <Button
                    onClick={() =>
                      approveClaimMutation.mutate({
                        id: a.id,
                        karma: a.pending_karma!,
                        age: a.account_age_days,
                      })
                    }
                    loading={approveClaimMutation.isPending}
                    variant="success"
                    size="sm"
                  >
                    <ShieldCheck size={14} /> Approve {a.pending_karma!.toLocaleString('id-ID')}
                  </Button>
                  <Button
                    onClick={() => rejectClaimMutation.mutate(a.id)}
                    loading={rejectClaimMutation.isPending}
                    variant="outline"
                    size="sm"
                    className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                  >
                    <Trash2 size={14} /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : accounts.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">🔗</div>
          <p className="font-bold">Belum ada akun Reddit</p>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {accounts.map((a) => {
              const lvl = getLevelInfo(a.level);
              const isEdit = editing?.id === a.id;
              return (
                <Card key={a.id} padding="sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-bold truncate">u/{a.username}</p>
                      <p className="text-xs text-muted truncate">{a.users?.email}</p>
                    </div>
                    {isEdit ? (
                      <input
                        type="number" min={0}
                        value={editing!.karma}
                        onChange={(e) => setEditing((s) => s && { ...s, karma: e.target.value })}
                        className="w-24 px-2 py-1 text-right border rounded font-bold money"
                      />
                    ) : (
                      <p className="text-xl font-extrabold money shrink-0">{a.karma.toLocaleString()}</p>
                    )}
                  </div>

                  {isEdit && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-muted">Umur akun (hari):</span>
                      <input
                        type="number" min={0}
                        value={editing!.age}
                        onChange={(e) => setEditing((s) => s && { ...s, age: e.target.value })}
                        className="w-20 px-2 py-1 text-right border rounded text-sm"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                    <span className="bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">
                      {lvl.emoji} {lvl.name}
                    </span>
                    <span className="text-muted">{a.account_age_days}d • sync {new Date(a.last_sync).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>

                    {isEdit ? (
                      <div className="flex gap-1 ml-auto">
                        <Button size="sm" onClick={saveEdit} disabled={setKarmaMutation.isPending}>
                          <Check className="w-4 h-4" /> Simpan
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1 ml-auto">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(a)} aria-label="Edit karma">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => syncMutation.mutate({ id: a.id, username: a.username })}
                          disabled={syncMutation.isPending}
                          aria-label="Sync from Reddit"
                        >
                          <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-semibold text-muted">Username</th>
                  <th className="px-2 py-2 font-semibold text-muted">Owner</th>
                  <th className="px-2 py-2 font-semibold text-muted">Karma</th>
                  <th className="px-2 py-2 font-semibold text-muted">Age (days)</th>
                  <th className="px-2 py-2 font-semibold text-muted">Level</th>
                  <th className="px-2 py-2 font-semibold text-muted">Last Sync</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const lvl = getLevelInfo(a.level);
                  const isEdit = editing?.id === a.id;
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-light">
                      <td className="px-2 py-3 font-bold">u/{a.username}</td>
                      <td className="px-2 py-3 text-muted">{a.users?.email}</td>
                      <td className="px-2 py-3 money font-semibold">
                        {isEdit ? (
                          <input type="number" min={0}
                            value={editing!.karma}
                            onChange={(e) => setEditing((s) => s && { ...s, karma: e.target.value })}
                            className="w-28 px-2 py-1 border rounded text-right"
                          />
                        ) : (
                          a.karma.toLocaleString()
                        )}
                      </td>
                      <td className="px-2 py-3">
                        {isEdit ? (
                          <input type="number" min={0}
                            value={editing!.age}
                            onChange={(e) => setEditing((s) => s && { ...s, age: e.target.value })}
                            className="w-20 px-2 py-1 border rounded text-right"
                          />
                        ) : (
                          a.account_age_days
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <span className="bg-primary/10 text-primary font-bold text-xs px-2 py-0.5 rounded-full">
                          {lvl.emoji} {lvl.name}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-muted">
                        {new Date(a.last_sync).toLocaleDateString('id-ID')}
                      </td>
                      <td className="px-2 py-3 text-right whitespace-nowrap">
                        {isEdit ? (
                          <>
                            <Button size="sm" onClick={saveEdit} disabled={setKarmaMutation.isPending}>
                              <Check className="w-4 h-4" /> Simpan
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="ml-1">
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => startEdit(a)} aria-label="Edit karma">
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="ml-1"
                              onClick={() => syncMutation.mutate({ id: a.id, username: a.username })}
                              disabled={syncMutation.isPending}
                              aria-label="Sync from Reddit"
                            >
                              <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Layout>
  );
}
