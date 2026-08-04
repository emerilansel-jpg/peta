import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle, RotateCcw, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import {
  getMyPendingAssignments, retryRejectedAssignment, getMyTaskHistory,
  type MyAssignmentRow, type TaskHistoryRow,
} from '../lib/api';
import { toast } from '../components/Toast';

type Tab = 'approved' | 'rejected';
type PlatformFilter = 'all' | 'reddit' | 'forum' | 'youtube';

const PLATFORM_LABELS: Record<PlatformFilter, string> = {
  all: 'Semua',
  reddit: 'Reddit',
  forum: 'Forum',
  youtube: 'YouTube',
};

function matchPlatform(a: TaskHistoryRow, f: PlatformFilter): boolean {
  if (f === 'all') return true;
  const cat = a.task_category || '';
  const title = (a.task_title || '').toLowerCase();
  if (f === 'youtube') return cat === 'youtube_upload' || title.includes('youtube');
  if (f === 'reddit') return cat.startsWith('reddit') || title.includes('reddit') || title.includes('r/');
  if (f === 'forum') return cat === 'forum_comment' || (!cat.startsWith('reddit') && !title.includes('reddit') && !title.includes('youtube'));
  return true;
}

export function TaskHistory() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<any>(null);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = React.useState<Tab>(() => {
    const t = searchParams.get('tab');
    if (t === 'rejected') return 'rejected';
    return 'approved';
  });
  const [searchQuery, setSearchQuery] = React.useState('');
  const [platformFilter, setPlatformFilter] = React.useState<PlatformFilter>('all');

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  const { data: myAssignments = [], isLoading: assignLoading } = useQuery<MyAssignmentRow[]>({
    queryKey: ['myAssignments', user?.id],
    queryFn: () => getMyPendingAssignments(),
    enabled: !!user?.id,
  });

  const { data: taskHistory = [], isLoading: historyLoading } = useQuery<TaskHistoryRow[]>({
    queryKey: ['taskHistory', user?.id],
    queryFn: () => getMyTaskHistory(),
    enabled: !!user?.id,
  });

  const loading = assignLoading || historyLoading;

  const liveRejected = myAssignments.filter((a) => a.status === 'rejected');
  const liveRejectedIds = new Set(liveRejected.map((a) => a.id));
  const approvedHistory = taskHistory.filter((a) => a.status === 'approved');

  const rejectedHistory = [
    ...liveRejected.map((a): TaskHistoryRow => ({
      id: `live-${a.id}`,
      assignment_id: a.id,
      task_id: a.task_id,
      status: 'rejected',
      admin_notes: a.admin_notes,
      can_retry: a.can_retry,
      proof_url: a.proof_url,
      draft_comment: a.draft_comment,
      event_at: a.updated_at,
      task_title: a.task_title,
      task_category: a.task_category,
      task_reward: a.task_reward,
      task_target_url: a.task_target_url,
    })),
    ...taskHistory.filter((a) => a.status === 'rejected' && !liveRejectedIds.has(a.assignment_id)),
  ];

  const retryMutation = useMutation({
    mutationFn: retryRejectedAssignment,
    onSuccess: (_, assignmentId) => {
      const assignment = myAssignments.find((a) => a.id === assignmentId);
      toast.success('OK, coba lagi');
      queryClient.invalidateQueries({ queryKey: ['myAssignments', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['taskHistory', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['eligibleTasks', user?.id] });
      if (assignment) navigate(`/task/${assignment.task_id}`);
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  if (!user || loading) {
    return (
      <Layout userRole="army">
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      </Layout>
    );
  }

  const rawList = tab === 'approved' ? approvedHistory : rejectedHistory;
  const list = rawList.filter((a) => matchPlatform(a, platformFilter))
    .filter((a) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (a.task_title || '').toLowerCase().includes(q);
    });

  // Stats
  const totalApproved = approvedHistory.length;
  const totalEarned = approvedHistory.reduce((sum, a) => sum + a.task_reward, 0);

  return (
    <Layout userRole="army">
      <div className="max-w-2xl mx-auto pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/tasks')}
            className="tap-shrink p-2 -ml-2 rounded-lg hover:bg-light text-muted hover:text-dark"
            aria-label="Kembali ke task"
          >
            <ArrowLeft size={22} />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold">Riwayat Task</h1>
            <p className="text-xs text-muted">
              {totalApproved} task approved · Total earned Rp{totalEarned.toLocaleString('id-ID')}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setTab('approved')}
            className={`tap-shrink min-h-[48px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${
              tab === 'approved'
                ? 'bg-success text-white shadow-md shadow-success/30'
                : 'bg-light text-dark ring-1 ring-border hover:ring-success/40'
            }`}
          >
            <CheckCircle2 size={16} />
            Approved ({approvedHistory.length})
          </button>
          <button
            onClick={() => setTab('rejected')}
            className={`tap-shrink min-h-[48px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${
              tab === 'rejected'
                ? 'bg-danger text-white shadow-md shadow-danger/30'
                : 'bg-light text-dark ring-1 ring-border hover:ring-danger/40'
            }`}
          >
            <XCircle size={16} />
            Reject ({rejectedHistory.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari task..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-light border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          />
        </div>

        {/* Platform filter chips */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {(Object.keys(PLATFORM_LABELS) as PlatformFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setPlatformFilter(f)}
              className={`tap-shrink px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                platformFilter === f
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-light text-muted ring-1 ring-border hover:ring-primary/40'
              }`}
            >
              {PLATFORM_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Results count */}
        {list.length !== rawList.length && (
          <p className="text-[10px] text-muted mb-3">
            {list.length} dari {rawList.length} task ditampilkan
          </p>
        )}

        {/* List */}
        {list.length === 0 ? (
          <Card className="text-center py-12">
            <div className="text-5xl mb-3">{tab === 'approved' ? '🎯' : '📭'}</div>
            <p className="font-bold">
              {rawList.length === 0
                ? tab === 'approved' ? 'Belum ada task approved' : 'Belum ada task ditolak'
                : 'Tidak ada yang cocok'
              }
            </p>
            <p className="text-sm text-muted mt-1">
              {rawList.length === 0
                ? tab === 'approved'
                  ? 'Kerjain task pertama kamu, approved masuk sini otomatis.'
                  : 'Task yang ditolak admin bakal muncul di sini beserta alasannya.'
                : 'Coba kata kunci atau filter lain.'
              }
            </p>
            {rawList.length > 0 && (
              <Button onClick={() => { setSearchQuery(''); setPlatformFilter('all'); }} variant="primary" size="sm" className="mt-4">
                Reset filter
              </Button>
            )}
            {rawList.length === 0 && (
              <Button onClick={() => navigate('/tasks')} variant="primary" size="md" className="mt-4">
                Lihat task aktif
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-2">
            {tab === 'approved' && list.map((a) => (
              <Card key={a.id} padding="sm" className="ring-1 ring-success/25 bg-success/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm leading-snug truncate">{a.task_title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted">
                        {new Date(a.event_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-success/15 text-success uppercase">
                        {a.task_category === 'youtube_upload' ? 'YouTube' : a.task_category?.startsWith('reddit') ? 'Reddit' : 'Forum'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-extrabold text-success money">+Rp{a.task_reward.toLocaleString('id-ID')}</p>
                    <span className="text-[10px] font-bold text-success">✅ Approved</span>
                  </div>
                </div>
              </Card>
            ))}

            {tab === 'rejected' && list.map((a) => {
              const isLive = a.id.startsWith('live-');
              const isFinal = !a.can_retry;
              return (
                <Card
                  key={a.id}
                  padding="sm"
                  className={`ring-1 ${isLive ? (isFinal ? 'ring-danger/60 bg-danger/10' : 'ring-danger/40 bg-danger/5') : 'ring-danger/20 bg-danger/5'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <p className="font-bold text-sm leading-snug">{a.task_title}</p>
                        {isFinal && (
                          <span className="text-[9px] font-extrabold uppercase tracking-wide bg-danger text-white px-1.5 py-0.5 rounded">
                            FINAL
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-muted">
                          Ditolak {new Date(a.event_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-danger/10 text-danger uppercase">
                          {a.task_category === 'youtube_upload' ? 'YouTube' : a.task_category?.startsWith('reddit') ? 'Reddit' : 'Forum'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm font-extrabold text-muted money shrink-0 line-through">
                      Rp{a.task_reward.toLocaleString('id-ID')}
                    </p>
                  </div>
                  {a.admin_notes && (
                    <div className="bg-white ring-1 ring-danger/30 rounded-lg p-2 mb-2">
                      <p className="text-[10px] uppercase font-bold tracking-wide text-danger mb-0.5">
                        Alasan ditolak
                      </p>
                      <p className="text-xs text-dark leading-snug whitespace-pre-wrap">{a.admin_notes}</p>
                    </div>
                  )}
                  {isLive && !isFinal && (
                    <Button
                      onClick={() => retryMutation.mutate(a.assignment_id)}
                      loading={retryMutation.isPending}
                      variant="primary"
                      size="sm"
                      fullWidth
                      className="!bg-danger hover:!brightness-110"
                    >
                      <RotateCcw size={14} /> Coba Lagi (upload bukti baru)
                    </Button>
                  )}
                  {isLive && isFinal && (
                    <div className="bg-white ring-1 ring-danger/20 rounded-lg p-2 text-center">
                      <p className="text-xs font-bold text-danger">
                        Reject final — task ini tidak bisa di-submit ulang
                      </p>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
