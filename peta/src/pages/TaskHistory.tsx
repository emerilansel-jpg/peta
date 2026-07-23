import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
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

export function TaskHistory() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<any>(null);
  const [tab, setTab] = React.useState<Tab>('approved');

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  // Live assignments still actionable (rejected rows awaiting retry).
  const { data: myAssignments = [], isLoading: assignLoading } = useQuery<MyAssignmentRow[]>({
    queryKey: ['myAssignments', user?.id],
    queryFn: () => getMyPendingAssignments(),
    enabled: !!user?.id,
  });

  // Immutable history of every approved/rejected assignment.
  const { data: taskHistory = [], isLoading: historyLoading } = useQuery<TaskHistoryRow[]>({
    queryKey: ['taskHistory', user?.id],
    queryFn: () => getMyTaskHistory(),
    enabled: !!user?.id,
  });

  const loading = assignLoading || historyLoading;

  // Live rejected assignments that still allow retry (not yet in immutable
  // history-only state — these still mutate when the user retries).
  const liveRejected = myAssignments.filter((a) => a.status === 'rejected');
  const liveRejectedIds = new Set(liveRejected.map((a) => a.id));

  // Approved rows come purely from immutable history.
  const approvedHistory = taskHistory.filter((a) => a.status === 'approved');

  // Rejected rows: live (retry-eligible) first, then historical only.
  // Live rows are the source of truth for the retry button + admin notes.
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

  const list = tab === 'approved' ? approvedHistory : rejectedHistory;

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
            <p className="text-xs text-muted">Semua task yang sudah kamu kerjakan</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="grid grid-cols-2 gap-2 mb-5">
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

        {/* List */}
        {list.length === 0 ? (
          <Card className="text-center py-12">
            <div className="text-5xl mb-3">{tab === 'approved' ? '🎯' : '📭'}</div>
            <p className="font-bold">
              {tab === 'approved' ? 'Belum ada task approved' : 'Belum ada task ditolak'}
            </p>
            <p className="text-sm text-muted mt-1">
              {tab === 'approved'
                ? 'Kerjain task pertama kamu, approved masuk sini otomatis.'
                : 'Task yang ditolak admin bakal muncul di sini beserta alasannya.'}
            </p>
            <Button onClick={() => navigate('/tasks')} variant="primary" size="md" className="mt-4">
              Lihat task aktif
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {tab === 'approved' && approvedHistory.map((a) => (
              <Card key={a.id} padding="sm" className="ring-1 ring-success/25 bg-success/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm leading-snug truncate">{a.task_title}</p>
                    <p className="text-[10px] text-muted mt-0.5">
                      Selesai {new Date(a.event_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-extrabold text-success money">+Rp{a.task_reward.toLocaleString('id-ID')}</p>
                    <span className="text-[10px] font-bold text-success">✅ Approved</span>
                  </div>
                </div>
              </Card>
            ))}

            {tab === 'rejected' && rejectedHistory.map((a) => {
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
                      <p className="text-[10px] text-muted">
                        Ditolak {new Date(a.event_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
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
