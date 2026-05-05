import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, ExternalLink } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

export function AdminApprovalQueue() {
  const { data: assignments = [], isLoading, refetch } = useQuery({
    queryKey: ['pendingApprovals'],
    queryFn: async () => {
      const { data } = await supabase
        .from('task_assignments')
        .select('*, tasks(title, reward_amount, target_url), reddit_accounts(username)')
        .eq('status', 'submitted')
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase.from('task_assignments').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.status === 'approved' ? 'Approved ✅' : 'Rejected');
      refetch();
    },
    onError: () => toast.error('Gagal update'),
  });

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Approval Queue</h1>
        <p className="text-sm text-muted">{assignments.length} task menunggu review</p>
      </div>

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : assignments.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-5xl mb-3">🎉</div>
          <p className="font-bold">Inbox zero!</p>
          <p className="text-sm text-muted">Semua task sudah direview.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignments.map((a: any) => (
            <Card key={a.id} className="border-l-4 border-warning">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h3 className="font-bold leading-snug">{a.tasks?.title}</h3>
                  <p className="text-xs text-muted">u/{a.reddit_accounts?.username}</p>
                </div>
                <p className="text-lg sm:text-xl font-extrabold text-primary money shrink-0">
                  Rp{a.tasks?.reward_amount.toLocaleString('id-ID')}
                </p>
              </div>

              {a.tasks?.target_url && (
                <a
                  href={a.tasks.target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary font-semibold mb-3 hover:underline"
                >
                  Buka thread <ExternalLink size={12} />
                </a>
              )}

              <div className="bg-light rounded-xl p-3 mb-4">
                <p className="text-[10px] uppercase font-bold tracking-wide text-muted mb-1">Komentar</p>
                <p className="text-sm whitespace-pre-wrap">{a.draft_comment}</p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => updateStatus.mutate({ id: a.id, status: 'approved' })}
                  variant="success"
                  loading={updateStatus.isPending}
                  fullWidth
                >
                  <Check size={18} /> Approve
                </Button>
                <Button
                  onClick={() => updateStatus.mutate({ id: a.id, status: 'rejected' })}
                  variant="outline"
                  loading={updateStatus.isPending}
                >
                  <X size={18} /> Reject
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
