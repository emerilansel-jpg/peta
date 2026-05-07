import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { getLevelInfo } from '../../lib/levels';
import { adminSetKarma, updateRedditAccountKarma } from '../../lib/api';
import { toast } from '../../components/Toast';
import { Pencil, RefreshCw, Check, X } from 'lucide-react';

type Row = {
  id: string;
  username: string;
  karma: number;
  level: number;
  account_age_days: number;
  last_sync: string;
  users?: { email?: string; full_name?: string };
};

export function AdminRedditAccounts() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; karma: string; age: string } | null>(null);

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

  const startEdit = (a: Row) =>
    setEditing({ id: a.id, karma: String(a.karma), age: String(a.account_age_days) });

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
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Akun Reddit</h1>
        <p className="text-sm text-muted">{accounts.length} akun terdaftar — klik ✏️ untuk set karma manual, 🔄 untuk sync dari Reddit</p>
      </div>

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
