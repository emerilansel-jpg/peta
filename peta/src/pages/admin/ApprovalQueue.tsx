import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, ExternalLink, Clock, ImageIcon, AlertTriangle, MessageCircle, RotateCcw, Edit2, Users } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { adminRejectAssignment, buildWhatsappLink, sendWaDm, adminAssignmentHistory, adminRevertAssignment } from '../../lib/api';
import { toast } from '../../components/Toast';
import { WaGroupSender } from '../../components/WaGroupSender';

// Pre-baked rejection reasons for fast admin triage — covers ~90% of why
// upvote/comment proofs get rejected. Admin can override with custom text.
const REJECT_PRESETS = [
  'Screenshot blur / kepotong — upload yang jelas dan full thread terlihat.',
  'Panah upvote belum aktif (masih abu-abu). Pastikan kamu sudah klik panah ke atas, terus screenshot.',
  'Akun Reddit di screenshot beda dengan akun terdaftar. Pakai akun yang udah connect ke PeTa.',
  'Komentar terlalu pendek / generik. Komen yang nambah value (1-2 kalimat).',
  'Komentar kena auto-remove sama Reddit. Coba di subreddit lain atau pakai akun karma lebih tinggi.',
  'Bukan thread yang diminta. Cek URL target di brief task.',
];

function buildRejectionWaMessage(name: string, taskTitle: string, reason: string, allowRetry: boolean): string {
  const retry = allowRetry
    ? 'Masih bisa coba lagi kok! Perbaiki sesuai feedback di atas, terus submit ulang ya. 💪'
    : 'Submission ini sudah final, tidak bisa diretry. Tapi masih banyak task lain yang bisa kamu coba!';
  return `Halo ${name} 👋\n\nSubmission task *"${taskTitle}"* baru aja direview dan belum bisa diapprove nih.\n\n*Alasan:*\n${reason}\n\n${retry}\n\nCek app PeTa untuk detail.\n— Admin PeTa 🏆`;
}

function buildApprovalDmMsg(name: string, taskTitle: string, rewardAmount: number): string {
  return `Halo ${name}! 🎉\n\nSELAMAT — task *"${taskTitle}"* kamu udah di-APPROVE sama admin!\n\n💰 *Rp${rewardAmount.toLocaleString('id-ID')}* udah masuk saldo kamu SEKARANG. Bisa langsung cair kapan aja — BERAPAPUN, nggak ada minimum!\n\nCara narik:\n1. Buka PeTa → Earnings\n2. Klik *"Tarik Sekarang"*\n3. Transfer max 24 jam ke rekening kamu ✅\n\nMantap banget kerjanya! Yuk ambil task lagi biar saldo makin tebal 🔥\n\nKeep it up, ${name}! 💪\n— Admin PeTa 🏆`;
}

function buildApprovalGroupMsg(): string {
  return `🔥 *Ada member baru aja dapat bayaran dari PeTa!*\n\nTask approved dan income langsung masuk saldo — bisa cair *KAPAN AJA*, berapapun! Nggak ada minimum.\n\nKamu mau dapet yang sama?\n✅ Task masih ada\n✅ Daftar gratis\n✅ Income cair kapan aja ke bank/e-wallet kamu\n\n👉 *https://penghasilantambahan.com*\n\nAyo gasss sebelum slot habis! ⚡\n\n_(Udah daftar? Langsung buka app dan cek task baru hari ini!)_`;
}

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
  // Reject reason modal — opens when admin clicks reject. Forces them to
  // provide a reason so the army member knows what to fix when they retry.
  const [rejectTarget, setRejectTarget] = useState<{ id: string; title: string; username: string; phone?: string; name?: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectType, setRejectType] = useState<'bad_work' | 'quota_full'>('bad_work');
  const [waDmPrompt, setWaDmPrompt] = useState<{ phone: string; name: string; message: string } | null>(null);
  const [waDmPhone, setWaDmPhone] = useState('');
  const [waDmSending, setWaDmSending] = useState(false);
  // Approval WA modal — opens after admin approves a task.
  const [approveWaTarget, setApproveWaTarget] = useState<{ taskTitle: string; rewardAmount: number; armyName: string; armyPhone: string } | null>(null);
  const [approveWaTab, setApproveWaTab] = useState<'dm' | 'group'>('dm');
  const [approveWaDmPhone, setApproveWaDmPhone] = useState('');
  const [approveWaDmMsg, setApproveWaDmMsg] = useState('');
  const [approveWaGroupMsg, setApproveWaGroupMsg] = useState('');
  const [approveWaSending, setApproveWaSending] = useState(false);
  // Tab filter: pending | approved | rejected.
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // Diagnostic — exposes auth.uid + is_admin so we can see WHY the queue
  // is empty without guessing.  Always runs (anon-callable RPC).
  const { data: debug } = useQuery({
    queryKey: ['adminSessionDebug'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_session_debug');
      if (error) return { error: error.message };
      return data as { auth_uid: string | null; public_users_role: string | null; is_admin: boolean; submitted_count: number };
    },
    refetchInterval: 30_000,
  });

  const { data: assignments = [], isLoading, refetch, error: queueError } = useQuery({
    queryKey: ['pendingApprovals'],
    queryFn: async () => {
      // SECURITY DEFINER RPC — bypasses PostgREST embed quirks + stale RLS.
      // Returns flat rows; we adapt them to the legacy nested shape that the
      // JSX below expects (a.tasks.title / a.reddit_accounts.username).
      const { data, error } = await supabase.rpc('admin_pending_approvals');
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        status: r.status,
        proof_url: r.proof_url,
        draft_comment: r.draft_comment,
        admin_notes: r.admin_notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
        submitted_at: r.submitted_at,
        tasks: {
          title: r.task_title,
          reward_amount: r.task_reward,
          target_url: r.task_target_url,
          task_category: r.task_category,
          task_type: r.task_type,
        },
        reddit_accounts: { username: r.reddit_username },
        army_email: r.army_email,
        army_name: r.army_name,
        army_whatsapp: r.army_whatsapp,
      }));
    },
    // Pause the 30s auto-refetch while the approval WA modal is open, so the
    // row the admin is acting on doesn't vanish out from under them mid-read.
    refetchInterval: approveWaTarget ? false : 30_000,
  });

  // History queries — only fetch when the corresponding tab is active.
  const { data: approvedList = [], refetch: refetchApproved } = useQuery({
    queryKey: ['approvedHistory'],
    queryFn: () => adminAssignmentHistory('approved', 100),
    enabled: activeTab === 'approved',
    refetchInterval: 60_000,
  });
  const { data: rejectedList = [], refetch: refetchRejected } = useQuery({
    queryKey: ['rejectedHistory'],
    queryFn: () => adminAssignmentHistory('rejected', 100),
    enabled: activeTab === 'rejected',
    refetchInterval: 60_000,
  });

  // Revert mutation — undoes an approve or reject back to 'submitted'.
  const revertMutation = useMutation({
    mutationFn: (id: string) => adminRevertAssignment(id),
    onSuccess: (res) => {
      toast.success(
        res.credit_removed
          ? 'Direvert ke pending — credit Rp dihapus dari saldo army'
          : 'Direvert ke pending — army bisa kerjakan ulang',
      );
      refetch();
      refetchApproved();
      refetchRejected();
    },
    onError: (e: any) => toast.error(`Gagal revert: ${e.message || e}`),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, assignment }: { id: string; assignment: any }) => {
      const { error } = await supabase.from('task_assignments').update({ status: 'approved' }).eq('id', id);
      if (error) throw error;
      return assignment;
    },
    onSuccess: (assignment) => {
      toast.success('Approved ✅');
      // NOTE: deliberately DON'T refetch here. Keep the approved row visible in
      // the pending list while the admin reads/sends the WA modal — refetch
      // happens in closeApproveModal() once they're done (see Q2 fix). The 30s
      // auto-refetch is also paused while the modal is open.
      const name = assignment.army_name || assignment.reddit_accounts?.username || 'kamu';
      const taskTitle = assignment.tasks?.title || 'Task';
      const reward = assignment.tasks?.reward_amount || 0;
      const phone = assignment.army_whatsapp || '';
      setApproveWaDmMsg(buildApprovalDmMsg(name, taskTitle, reward));
      setApproveWaGroupMsg(buildApprovalGroupMsg());
      setApproveWaDmPhone(phone);
      setApproveWaTab('dm');
      setApproveWaTarget({ taskTitle, rewardAmount: reward, armyName: name, armyPhone: phone });
    },
    onError: () => toast.error('Gagal approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason, allowRetry, rejectionType }: { id: string; reason: string; allowRetry: boolean; rejectionType: 'bad_work' | 'quota_full' }) =>
      adminRejectAssignment(id, reason, allowRetry, rejectionType),
    onSuccess: (_, vars) => {
      if (vars.rejectionType === 'quota_full') {
        toast.success('Rejected: quota habis — army lihat FOMO card, bukan error');
      } else {
        toast.success(vars.allowRetry ? 'Rejected — army bisa coba lagi' : 'Rejected FINAL — no retry');
        // Always show WA DM modal for bad_work rejections — admin can
        // override phone to empty → fill with test number, or send to army.
        if (rejectTarget) {
          const msg = buildRejectionWaMessage(
            rejectTarget.name || rejectTarget.username,
            rejectTarget.title,
            vars.reason,
            vars.allowRetry,
          );
          setWaDmPhone(rejectTarget.phone || '');
          setWaDmPrompt({ phone: rejectTarget.phone || '', name: rejectTarget.name || rejectTarget.username, message: msg });
        }
      }
      setRejectTarget(null);
      setRejectReason('');
      setRejectType('bad_work');
      refetch();
    },
    onError: (e: any) => toast.error(`Gagal reject: ${e.message || e}`),
  });

  // Close the post-approve WA modal AND only then refresh the queue, so the
  // approved row stays in the pending tab until the admin finishes the WA flow.
  const closeApproveModal = () => {
    setApproveWaTarget(null);
    refetch();
    refetchApproved();
  };

  const openRejectModal = (a: any) => {
    setRejectReason('');
    setRejectType('bad_work');
    setRejectTarget({
      id: a.id,
      title: a.tasks?.title || 'Task',
      username: a.reddit_accounts?.username || '?',
      phone: a.army_whatsapp || undefined,
      name: a.army_name || undefined,
    });
  };

  return (
    <Layout userRole="admin">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Approval Queue</h1>
        <p className="text-sm text-muted">
          {activeTab === 'pending' && `${assignments.length} task menunggu review`}
          {activeTab === 'approved' && `${approvedList.length} task sudah di-approve (history)`}
          {activeTab === 'rejected' && `${rejectedList.length} task di-reject (history)`}
        </p>
      </div>

      {/* Tab strip — filter by status */}
      <div className="flex gap-1 mb-4 bg-light rounded-xl p-1 overflow-x-auto">
        {[
          { key: 'pending'  as const, label: '⏳ Pending',  count: assignments.length },
          { key: 'approved' as const, label: '✅ Approved', count: approvedList.length },
          { key: 'rejected' as const, label: '❌ Rejected', count: rejectedList.length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-bold transition tap-shrink whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-white text-dark shadow-sm ring-1 ring-black/5'
                : 'text-muted hover:text-dark hover:bg-white/60'
            }`}
          >
            {tab.label}
            {(activeTab === tab.key || tab.count > 0) && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] ${
                activeTab === tab.key ? 'bg-primary/15 text-primary' : 'bg-muted/15 text-muted'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Session diagnostic — only shown when something's wrong. After the
          2026-05-20 env-mismatch incident this stays in the codebase as a
          permanent self-debug surface (don't remove). */}
      {debug && !('error' in debug) && !debug.is_admin && (
        <Card className="mb-3 bg-danger/10 ring-danger/40" padding="sm">
          <p className="font-extrabold text-danger text-sm">⚠️ Session bukan admin</p>
          <p className="text-xs text-danger/90 mt-1 leading-snug">
            auth.uid: <code>{debug.auth_uid || 'NULL'}</code> · role: <code>{debug.public_users_role || 'NULL'}</code> · is_admin: <code>false</code>
          </p>
          <p className="text-xs text-danger/90 mt-2"><b>Fix:</b> Logout & login ulang (JWT expired) — kalau masih, cek kamu login pakai akun admin yang benar.</p>
        </Card>
      )}
      {debug && !('error' in debug) && debug.is_admin && debug.submitted_count !== assignments.length && (
        <Card className="mb-3 bg-warning/10 ring-warning/40" padding="sm">
          <p className="font-extrabold text-warning text-sm">⚠️ Sync mismatch</p>
          <p className="text-xs text-warning/90 mt-1">DB punya <b>{debug.submitted_count}</b> submitted, UI render <b>{assignments.length}</b>. Refresh atau tunggu 30 detik.</p>
        </Card>
      )}
      {queueError && (
        <Card className="mb-3 bg-danger/10 ring-danger/40" padding="sm">
          <p className="font-extrabold text-danger text-sm">⚠️ Query error</p>
          <p className="text-xs text-danger/90 mt-1"><code>{(queueError as any)?.message || String(queueError)}</code></p>
        </Card>
      )}

      {activeTab === 'pending' && (isLoading ? (
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
                            onClick={() => approveMutation.mutate({ id: a.id, assignment: a })}
                            variant="success"
                            size="sm"
                            disabled={approveMutation.isPending}
                          >
                            <Check size={14} />
                          </Button>
                          <Button
                            onClick={() => openRejectModal(a)}
                            variant="outline"
                            size="sm"
                            disabled={rejectMutation.isPending}
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
                      onClick={() => approveMutation.mutate({ id: a.id, assignment: a })}
                      variant="success"
                      size="sm"
                      loading={approveMutation.isPending}
                      fullWidth
                    >
                      <Check size={14} /> Approve
                    </Button>
                    <Button
                      onClick={() => openRejectModal(a)}
                      variant="outline"
                      size="sm"
                      loading={rejectMutation.isPending}
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
      ))}

      {/* ─── HISTORY VIEW (approved / rejected tabs) ─── */}
      {activeTab !== 'pending' && (() => {
        const rows = activeTab === 'approved' ? approvedList : rejectedList;
        if (rows.length === 0) {
          return (
            <Card className="text-center py-12">
              <div className="text-5xl mb-3">📭</div>
              <p className="font-bold">Belum ada task {activeTab === 'approved' ? 'di-approve' : 'di-reject'}.</p>
            </Card>
          );
        }
        return (
          <Card padding="sm" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-semibold text-muted">Direview</th>
                  <th className="px-2 py-2 font-semibold text-muted">Task</th>
                  <th className="px-2 py-2 font-semibold text-muted">Army</th>
                  <th className="px-2 py-2 font-semibold text-muted">Bukti</th>
                  {activeTab === 'rejected' && (
                    <th className="px-2 py-2 font-semibold text-muted">Alasan</th>
                  )}
                  <th className="px-2 py-2 font-semibold text-muted text-right">Reward</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const proofImage = a.proof_image_url || (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.proof_url || '') ? a.proof_url : '');
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-light/60">
                      <td className="px-2 py-3 align-top whitespace-nowrap">
                        <span className="text-xs text-muted flex items-center gap-1">
                          <Clock size={11} /> {formatSubmittedAt(a.updated_at)}
                        </span>
                      </td>
                      <td className="px-2 py-3 align-top">
                        <p className="font-bold leading-snug">{a.task_title}</p>
                        {a.task_target_url && (
                          <a
                            href={a.task_target_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline mt-0.5"
                          >
                            Thread <ExternalLink size={10} />
                          </a>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top text-xs">
                        <p className="font-semibold">{a.army_name || '—'}</p>
                        <p className="text-muted">u/{a.reddit_username}</p>
                      </td>
                      <td className="px-2 py-3 align-top">
                        {proofImage ? (
                          <button
                            onClick={() => setLightbox({ src: proofImage!, caption: `${a.task_title} — u/${a.reddit_username}` })}
                            className="block w-14 h-14 rounded-lg overflow-hidden ring-1 ring-border hover:ring-primary transition"
                          >
                            <img src={proofImage} alt="Bukti" className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted">—</span>
                        )}
                      </td>
                      {activeTab === 'rejected' && (
                        <td className="px-2 py-3 align-top text-xs max-w-[260px]">
                          {a.rejection_type === 'quota_full' && (
                            <span className="inline-block bg-warning/10 text-warning text-[10px] font-bold rounded px-1.5 py-0.5 mr-1">⏰ Slot habis</span>
                          )}
                          <span className="text-dark">{a.admin_notes || '—'}</span>
                        </td>
                      )}
                      <td className="px-2 py-3 align-top text-right whitespace-nowrap font-extrabold text-primary money">
                        Rp{a.task_reward?.toLocaleString('id-ID')}
                      </td>
                      <td className="px-2 py-3 align-top text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          {activeTab === 'rejected' && a.rejection_type !== 'quota_full' && (
                            <Button
                              onClick={() => openRejectModal({
                                id: a.id,
                                tasks: { title: a.task_title },
                                reddit_accounts: { username: a.reddit_username },
                                army_whatsapp: a.army_whatsapp,
                                army_name: a.army_name,
                              })}
                              variant="outline"
                              size="sm"
                              title="Edit alasan rejection"
                            >
                              <Edit2 size={13} />
                            </Button>
                          )}
                          <Button
                            onClick={() => {
                              const confirmMsg = activeTab === 'approved'
                                ? `Revert approval ini? Reward Rp${a.task_reward?.toLocaleString('id-ID')} akan dihapus dari saldo ${a.army_name}.`
                                : `Revert rejection ini? Task balik ke pending review.`;
                              if (!confirm(confirmMsg)) return;
                              revertMutation.mutate(a.id);
                            }}
                            variant="outline"
                            size="sm"
                            disabled={revertMutation.isPending}
                            title="Revert ke pending"
                            className="!border-warning !text-warning hover:!bg-warning hover:!text-white"
                          >
                            <RotateCcw size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        );
      })()}

      {/* Reject reason modal — admin must provide reason so user knows what
          to fix when they hit "Coba lagi" on the Tasks page. */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setRejectTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-extrabold flex items-center gap-2 text-danger">
                <X size={20} /> Reject Task
              </h3>
              <button onClick={() => setRejectTarget(null)} className="p-1 text-muted hover:text-dark">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-muted mb-1">
              <b className="text-dark">{rejectTarget.title}</b> · u/{rejectTarget.username}
            </p>

            {/* ── Step 1: Pilih jenis reject ── */}
            <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1.5 mt-3">
              Kenapa di-reject?
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => setRejectType('bad_work')}
                className={`rounded-xl p-2.5 text-left ring-2 transition text-xs ${
                  rejectType === 'bad_work'
                    ? 'ring-danger bg-danger/10 font-extrabold text-danger'
                    : 'ring-border bg-light text-muted hover:ring-danger/40'
                }`}
              >
                <p className="font-bold mb-0.5">❌ Kerja jelek</p>
                <p className="text-[10px] leading-snug">Bukti salah, curang, atau tidak sesuai brief. Army perlu perbaiki.</p>
              </button>
              <button
                onClick={() => setRejectType('quota_full')}
                className={`rounded-xl p-2.5 text-left ring-2 transition text-xs ${
                  rejectType === 'quota_full'
                    ? 'ring-warning bg-warning/10 font-extrabold text-warning'
                    : 'ring-border bg-light text-muted hover:ring-warning/40'
                }`}
              >
                <p className="font-bold mb-0.5">⏰ Slot habis</p>
                <p className="text-[10px] leading-snug">Task sudah penuh diambil army lain. Bukan salah mereka.</p>
              </button>
            </div>

            {/* ── Step 2: Tulis alasan (hanya tampil untuk bad_work) ── */}
            {rejectType === 'bad_work' && (
              <>
                <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1.5">
                  Quick pick alasan:
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {REJECT_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => setRejectReason(preset)}
                      className="text-[11px] bg-light hover:bg-danger/10 text-dark hover:text-danger rounded-full px-2.5 py-1 ring-1 ring-black/5 tap-shrink text-left max-w-full truncate"
                      title={preset}
                    >
                      {preset.length > 50 ? preset.slice(0, 50) + '…' : preset}
                    </button>
                  ))}
                </div>
                <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1.5">
                  Alasan (wajib, dilihat army):
                </p>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tulis alasan rejection (min 10 huruf). Yang dilihat army member."
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-danger focus:bg-white transition text-sm mb-3"
                />
              </>
            )}
            {rejectType === 'quota_full' && (
              <div className="bg-warning/5 ring-1 ring-warning/30 rounded-xl p-3 mb-3 text-xs text-warning">
                <p className="font-bold mb-1">Yang army lihat di app:</p>
                <p className="text-dark">😅 Slotnya habis duluan — army lain lebih cepet. Bukan salah kamu.</p>
                <p className="mt-1">+ tombol join grup WA untuk dapat notif task baru pertama.</p>
              </div>
            )}

            <p className="text-[11px] uppercase font-bold tracking-wide text-muted mb-2">
              Pilih aksi:
            </p>
            <div className="space-y-2">
              {rejectType === 'quota_full' ? (
                <Button
                  onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: 'Slot task sudah penuh diambil army lain.', allowRetry: false, rejectionType: 'quota_full' })}
                  loading={rejectMutation.isPending}
                  variant="primary"
                  size="md"
                  fullWidth
                  className="!bg-warning hover:!brightness-110"
                >
                  ⏰ Reject (Slot Habis) — army lihat FOMO card
                </Button>
              ) : (
                <>
              <Button
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason, allowRetry: true, rejectionType: 'bad_work' })}
                loading={rejectMutation.isPending && rejectMutation.variables?.allowRetry === true}
                disabled={rejectReason.trim().length < 10 || rejectMutation.isPending}
                variant="primary"
                size="md"
                fullWidth
                className="!bg-warning hover:!brightness-110"
              >
                🔄 Reject + Kasih Kesempatan Coba Lagi
              </Button>
              <Button
                onClick={() => {
                  if (!confirm('Yakin reject FINAL? Army member tidak bisa coba lagi untuk task ini. Pakai jika curang / cheating / berkali-kali gagal.')) return;
                  rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason, allowRetry: false, rejectionType: 'bad_work' });
                }}
                loading={rejectMutation.isPending && rejectMutation.variables?.allowRetry === false}
                disabled={rejectReason.trim().length < 10 || rejectMutation.isPending}
                variant="outline"
                size="md"
                fullWidth
                className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
              >
                ⛔ Reject FINAL (tidak bisa coba lagi)
              </Button>
                </>
              )}
              <button
                onClick={() => setRejectTarget(null)}
                disabled={rejectMutation.isPending}
                className="w-full text-xs text-muted hover:text-dark font-semibold py-2 disabled:opacity-50"
              >
                Batal
              </button>
            </div>
            <p className="text-[10px] text-muted/80 mt-3 leading-snug">
              💡 <b>Slot habis</b>: slot penuh, bukan salah army — army lihat FOMO card, bukan error merah. <br />
              💡 <b>Kerja jelek + coba lagi</b>: typical case, screenshot salah / kurang jelas. <br />
              💡 <b>Kerja jelek + final</b>: cheating / screenshot palsu / berkali-kali gagal.
            </p>
          </div>
        </div>
      )}

      {/* Approval WA modal — appears after admin approves a task. Offers two channels:
          1. WA DM to army user (auto-send via Fonnte + manual fallback)
          2. WA Group broadcast (copy message + open group link) */}
      {approveWaTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !approveWaSending && closeApproveModal()}
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
                  <Check size={20} /> Task Approved! 🎉
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  <b className="text-dark">{approveWaTarget.armyName}</b> · {approveWaTarget.taskTitle} · <span className="money font-bold text-primary">Rp{approveWaTarget.rewardAmount.toLocaleString('id-ID')}</span>
                </p>
              </div>
              <button onClick={() => !approveWaSending && closeApproveModal()} disabled={approveWaSending} className="p-1 text-muted hover:text-dark disabled:opacity-40">
                <X size={20} />
              </button>
            </div>

            {/* Tab switch: DM | Group */}
            <div className="flex gap-1 mb-4 bg-light rounded-xl p-1">
              <button
                onClick={() => setApproveWaTab('dm')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${
                  approveWaTab === 'dm' ? 'bg-white text-dark shadow-sm ring-1 ring-black/5' : 'text-muted hover:text-dark'
                }`}
              >
                <MessageCircle size={13} /> DM ke Army
              </button>
              <button
                onClick={() => setApproveWaTab('group')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${
                  approveWaTab === 'group' ? 'bg-white text-dark shadow-sm ring-1 ring-black/5' : 'text-muted hover:text-dark'
                }`}
              >
                <Users size={13} /> WA Group
              </button>
            </div>

            {/* ─── Tab: DM ke Army ─── */}
            {approveWaTab === 'dm' && (
              <>
                <p className="text-sm text-muted mb-2">
                  Kirim selamat + reminder income bisa cair sekarang ke <b className="text-dark">{approveWaTarget.armyName}</b>.
                </p>
                <div className="mb-3">
                  <label className="text-xs uppercase font-bold tracking-wide text-muted block mb-1">Nomor WA tujuan:</label>
                  <input
                    type="tel"
                    value={approveWaDmPhone}
                    onChange={(e) => setApproveWaDmPhone(e.target.value)}
                    disabled={approveWaSending}
                    placeholder="628xxxxxxxxxx"
                    className="w-full px-3 py-2 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-sm font-mono disabled:opacity-60"
                  />
                  <p className="text-[10px] text-muted mt-1">Edit nomor untuk test sebelum kirim ke army.</p>
                </div>
                <textarea
                  value={approveWaDmMsg}
                  onChange={(e) => setApproveWaDmMsg(e.target.value)}
                  rows={8}
                  disabled={approveWaSending}
                  className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-xs font-mono leading-relaxed mb-4 disabled:opacity-60"
                />
                <div className="space-y-2">
                  <button
                    disabled={approveWaSending || !approveWaDmPhone}
                    onClick={async () => {
                      setApproveWaSending(true);
                      try {
                        const res = await sendWaDm(approveWaDmPhone, approveWaDmMsg);
                        if (res.sent) {
                          toast.success(`WA terkirim ke ${approveWaTarget.armyName} ✅`);
                          setApproveWaTab('group');
                        } else {
                          toast.error(`Fonnte gagal: ${res.error || 'unknown error'}`);
                        }
                      } catch (e: any) {
                        toast.error(`Error: ${e.message || String(e)}`);
                      } finally {
                        setApproveWaSending(false);
                      }
                    }}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:brightness-110 disabled:opacity-60 text-white font-extrabold text-sm transition tap-shrink"
                  >
                    {approveWaSending
                      ? <><span className="animate-spin">⏳</span> Mengirim...</>
                      : <><MessageCircle size={16} /> Kirim Otomatis via Fonnte</>
                    }
                  </button>
                  {!approveWaSending && (
                    <a
                      href={buildWhatsappLink(approveWaDmPhone, approveWaDmMsg)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setApproveWaTab('group')}
                      className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl ring-1 ring-[#25D366]/40 text-[#25D366] hover:bg-[#25D366]/5 font-semibold text-xs transition"
                    >
                      <MessageCircle size={13} /> Kirim Manual via WA Web
                    </a>
                  )}
                  <button onClick={() => setApproveWaTab('group')} disabled={approveWaSending} className="w-full text-xs text-muted hover:text-dark font-semibold py-1 disabled:opacity-40">
                    Skip → Lanjut ke WA Group
                  </button>
                </div>
              </>
            )}

            {/* ─── Tab: WA Group Broadcast ─── */}
            {approveWaTab === 'group' && (
              <>
                <p className="text-sm text-muted mb-2">
                  Kirim ke grup WA PeTa untuk dorong member lain ambil task juga.
                </p>
                <textarea
                  value={approveWaGroupMsg}
                  onChange={(e) => setApproveWaGroupMsg(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-xs font-mono leading-relaxed mb-4"
                />
                <WaGroupSender message={approveWaGroupMsg} />
                <button onClick={closeApproveModal} className="w-full text-xs text-muted hover:text-dark font-semibold py-2 mt-2">
                  Selesai (tutup)
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* WA DM prompt — appears after bad_work rejection if the army member has a WA number registered.
          Primary: auto-send via Fonnte. Fallback: manual wa.me link. */}
      {waDmPrompt && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !waDmSending && setWaDmPrompt(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-extrabold flex items-center gap-2 text-[#25D366]">
                <MessageCircle size={20} /> Kirim Notif WA?
              </h3>
              <button onClick={() => setWaDmPrompt(null)} disabled={waDmSending} className="p-1 text-muted hover:text-dark disabled:opacity-40">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-muted mb-2">
              Kirim pesan ke <b className="text-dark">{waDmPrompt.name}</b> supaya mereka tau apa yang harus diperbaiki.
            </p>
            <div className="mb-3">
              <label className="text-xs uppercase font-bold tracking-wide text-muted block mb-1">Nomor WA tujuan:</label>
              <input
                type="tel"
                value={waDmPhone}
                onChange={(e) => setWaDmPhone(e.target.value)}
                disabled={waDmSending}
                placeholder="628xxxxxxxxxx"
                className="w-full px-3 py-2 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-sm font-mono disabled:opacity-60"
              />
              <p className="text-[10px] text-muted mt-1">Edit untuk test ke nomor lain sebelum kirim ke army.</p>
            </div>
            <textarea
              value={waDmPrompt.message}
              onChange={(e) => setWaDmPrompt({ ...waDmPrompt, message: e.target.value })}
              rows={7}
              disabled={waDmSending}
              className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-[#25D366] focus:bg-white transition text-xs font-mono leading-relaxed mb-4 disabled:opacity-60"
            />
            <div className="space-y-2">
              {/* Primary: auto-send via Fonnte */}
              <button
                disabled={waDmSending}
                onClick={async () => {
                  setWaDmSending(true);
                  try {
                    const res = await sendWaDm(waDmPhone, waDmPrompt.message);
                    if (res.sent) {
                      toast.success(`WA terkirim ke ${waDmPrompt.name} ✅`);
                      setWaDmPrompt(null);
                    } else {
                      toast.error(`Fonnte gagal: ${res.error || 'unknown error'}`);
                    }
                  } catch (e: any) {
                    toast.error(`Error: ${e.message || String(e)}`);
                  } finally {
                    setWaDmSending(false);
                  }
                }}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:brightness-110 disabled:opacity-60 text-white font-extrabold text-sm transition tap-shrink"
              >
                {waDmSending
                  ? <><span className="animate-spin">⏳</span> Mengirim...</>
                  : <><MessageCircle size={16} /> Kirim Otomatis via Fonnte</>
                }
              </button>
              {/* Fallback: manual wa.me */}
              {!waDmSending && (
                <a
                  href={buildWhatsappLink(waDmPhone, waDmPrompt.message)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setWaDmPrompt(null)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl ring-1 ring-[#25D366]/40 text-[#25D366] hover:bg-[#25D366]/5 font-semibold text-xs transition"
                >
                  <MessageCircle size={13} /> Kirim Manual via WA Web
                </a>
              )}
              <button
                onClick={() => setWaDmPrompt(null)}
                disabled={waDmSending}
                className="w-full text-xs text-muted hover:text-dark font-semibold py-2 disabled:opacity-40"
              >
                Lewati (jangan kirim)
              </button>
            </div>
          </div>
        </div>
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
