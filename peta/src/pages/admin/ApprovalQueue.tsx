import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, ExternalLink, Clock, ImageIcon, AlertTriangle } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

// Format like "Sen, 13 Mei 2026 · 17:42" (Bahasa Indonesia day + 24h time).
function formatSubmittedAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('id-ID', { weekday: 'short' });
    const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day}, ${date} · ${time}`;
  } catch {
    return iso;
  }
}

export function AdminApprovalQueue() {
  // Lightbox state — opens an in-page modal so admin doesn't lose their
  // place in the approval queue every time they want to inspect proof.
  const [lightbox, setLightbox] = useState<{ src: string; caption?: string } | null>(null);

  const { data: assignments = [], isLoading, refetch } = useQuery({
    queryKey: ['pendingApprovals'],
    queryFn: async () => {
      const { data } = await supabase
        .from('task_assignments')
        .select('*, tasks(title, reward_amount, target_url, task_category, task_type), reddit_accounts(username)')
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
        <>
          {/* Desktop table — dense scannable layout for fast triage */}
          <Card className="hidden md:block overflow-x-auto" padding="sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-semibold text-muted">Submitted</th>
                  <th className="px-2 py-2 font-semibold text-muted">Task</th>
                  <th className="px-2 py-2 font-semibold text-muted">u/Username</th>
                  <th className="px-2 py-2 font-semibold text-muted">Bukti</th>
                  <th className="px-2 py-2 font-semibold text-muted">Komentar</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Reward</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a: any) => {
                  const hasProof = !!a.proof_url;
                  const hasComment = !!a.draft_comment?.trim();
                  const noEvidence = !hasProof && !hasComment;
                  return (
                    <tr key={a.id} className={`border-b border-border last:border-0 hover:bg-light/60 ${noEvidence ? 'bg-warning/5' : ''}`}>
                      <td className="px-2 py-3 align-top whitespace-nowrap">
                        <span className="text-xs text-muted flex items-center gap-1">
                          <Clock size={11} /> {formatSubmittedAt(a.submitted_at || a.updated_at || a.created_at)}
                        </span>
                      </td>
                      <td className="px-2 py-3 align-top">
                        <p className="font-bold leading-snug">{a.tasks?.title}</p>
                        {a.tasks?.target_url && (
                          <a
                            href={a.tasks.target_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline mt-0.5"
                          >
                            Thread <ExternalLink size={10} />
                          </a>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top text-xs">u/{a.reddit_accounts?.username}</td>
                      <td className="px-2 py-3 align-top">
                        {hasProof ? (
                          <button
                            onClick={() => setLightbox({ src: a.proof_url, caption: `${a.tasks?.title} — u/${a.reddit_accounts?.username}` })}
                            className="block w-16 h-16 rounded-lg overflow-hidden ring-1 ring-border hover:ring-primary transition group"
                            title="Klik untuk lihat besar"
                          >
                            <img
                              src={a.proof_url}
                              alt="Screenshot bukti"
                              className="w-full h-full object-cover group-hover:scale-105 transition"
                            />
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-warning font-bold">
                            <AlertTriangle size={11} /> no image
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top max-w-xs">
                        {hasComment ? (
                          <details>
                            <summary className="text-xs text-primary cursor-pointer hover:underline list-none">
                              {a.draft_comment.length > 60
                                ? a.draft_comment.slice(0, 60) + '… (klik)'
                                : a.draft_comment}
                            </summary>
                            <p className="text-xs whitespace-pre-wrap mt-1.5 p-2 bg-light rounded-lg max-w-[400px]">
                              {a.draft_comment}
                            </p>
                          </details>
                        ) : (
                          <span className="text-[11px] text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top text-right whitespace-nowrap font-extrabold text-primary money">
                        Rp{a.tasks?.reward_amount?.toLocaleString('id-ID')}
                      </td>
                      <td className="px-2 py-3 align-top text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <Button
                            onClick={() => updateStatus.mutate({ id: a.id, status: 'approved' })}
                            variant="success"
                            size="sm"
                            disabled={updateStatus.isPending}
                          >
                            <Check size={14} />
                          </Button>
                          <Button
                            onClick={() => updateStatus.mutate({ id: a.id, status: 'rejected' })}
                            variant="outline"
                            size="sm"
                            disabled={updateStatus.isPending}
                            className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards — compact, action-first */}
          <div className="md:hidden space-y-2">
            {assignments.map((a: any) => {
              const hasProof = !!a.proof_url;
              const hasComment = !!a.draft_comment?.trim();
              return (
                <Card key={a.id} padding="sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm leading-snug truncate">{a.tasks?.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5 flex-wrap">
                        <span>u/{a.reddit_accounts?.username}</span>
                      </div>
                      <p className="text-[11px] text-muted flex items-center gap-1 mt-0.5">
                        <Clock size={10} /> {formatSubmittedAt(a.submitted_at || a.updated_at || a.created_at)}
                      </p>
                    </div>
                    <p className="text-base font-extrabold text-primary money shrink-0">
                      Rp{a.tasks?.reward_amount?.toLocaleString('id-ID')}
                    </p>
                  </div>

                  <div className="flex gap-2 items-stretch">
                    {hasProof ? (
                      <button
                        onClick={() => setLightbox({ src: a.proof_url, caption: `${a.tasks?.title} — u/${a.reddit_accounts?.username}` })}
                        className="w-20 h-20 rounded-lg overflow-hidden ring-1 ring-border shrink-0"
                      >
                        <img src={a.proof_url} alt="Bukti" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-warning/10 ring-1 ring-warning/30 grid place-items-center shrink-0">
                        <ImageIcon size={20} className="text-warning/60" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {hasComment ? (
                        <details>
                          <summary className="text-xs text-primary cursor-pointer hover:underline list-none">
                            💬 {a.draft_comment.slice(0, 50)}{a.draft_comment.length > 50 ? '…' : ''}
                          </summary>
                          <p className="text-xs whitespace-pre-wrap mt-1.5 p-2 bg-light rounded-lg">
                            {a.draft_comment}
                          </p>
                        </details>
                      ) : !hasProof ? (
                        <p className="text-[11px] text-warning">⚠️ No screenshot, no comment</p>
                      ) : (
                        <p className="text-[11px] text-muted">No comment</p>
                      )}
                      {a.tasks?.target_url && (
                        <a
                          href={a.tasks.target_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold mt-1 hover:underline"
                        >
                          Buka thread <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button
                      onClick={() => updateStatus.mutate({ id: a.id, status: 'approved' })}
                      variant="success"
                      size="sm"
                      loading={updateStatus.isPending}
                      fullWidth
                    >
                      <Check size={14} /> Approve
                    </Button>
                    <Button
                      onClick={() => updateStatus.mutate({ id: a.id, status: 'rejected' })}
                      variant="outline"
                      size="sm"
                      loading={updateStatus.isPending}
                      className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                    >
                      <X size={14} /> Reject
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Image lightbox modal — Esc/backdrop click closes. Stays in-page so admin keeps queue scroll position. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-2"
            aria-label="Tutup"
          >
            <X size={22} />
          </button>
          <div
            className="relative max-w-5xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.src}
              alt={lightbox.caption || 'Screenshot bukti'}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {lightbox.caption && (
              <p className="text-white text-sm mt-3 text-center max-w-prose">
                {lightbox.caption}
              </p>
            )}
            <a
              href={lightbox.src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/80 hover:text-white text-xs mt-2 inline-flex items-center gap-1"
            >
              Buka di tab baru <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </Layout>
  );
}
