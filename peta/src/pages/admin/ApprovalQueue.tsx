import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, ExternalLink, Clock, ImageIcon } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { adminApproveAssignment, adminRejectAssignment, adminRepairAssignmentUserId, sendTaskApprovedEmail } from '../../lib/api';
import { toast } from '../../components/Toast';

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
  // View toggle: pending (live queue) vs approved/rejected (history audit).
  const [view, setView] = useState<'pending' | 'approved' | 'rejected'>('pending');
  // Date range filter — scoped to the history tabs. Format YYYY-MM-DD.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Lightbox state — opens an in-page modal so admin doesn't lose their
  // place in the approval queue every time they want to inspect proof.
  const [lightbox, setLightbox] = useState<{ src: string; caption?: string } | null>(null);
  // Reject reason modal — opens when admin clicks reject. Forces them to
  // provide a reason so the army member knows what to fix when they retry.
  const [rejectTarget, setRejectTarget] = useState<{ id: string; title: string; username: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // Repair modal — for legacy forum_comment rows whose user_id is NULL.
  const [repairTarget, setRepairTarget] = useState<{ id: string; title: string } | null>(null);
  const [repairUserId, setRepairUserId] = useState('');

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
        id: r.assignment_id,
        status: r.status,
        proof_url: r.proof_url,
        proof_image_url: r.proof_image_url,
        submitted_url: r.submitted_url,
        submitted_username: r.submitted_username,
        draft_comment: r.draft_comment,
        user_note: r.user_note,
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
        reddit_accounts: { username: r.submitted_username || r.reddit_username },
        army_user_id: r.army_user_id,
        army_email: r.army_email,
        army_name: r.army_name,
      }));
    },
    refetchInterval: 30_000, // surface new submissions within 30s
  });

  // History audit trail — admin can review past approvals + rejections
  // (with the original screenshot/URL/comment) without relying on memory.
  // Date range filter scopes results to a calendar period.
  const { data: historyRaw = [], isLoading: historyLoading } = useQuery({
    queryKey: ['adminApprovalHistory', view, fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_approval_history', {
        p_from: fromDate || null,
        p_to: toDate || null,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: view !== 'pending',
    refetchInterval: 60_000,
  });
  const history = (historyRaw as any[]).map((r) => ({
    id: r.id,
    status: r.status,
    proof_url: r.proof_url,
    proof_image_url: r.proof_image_url,
    submitted_url: r.submitted_url,
    submitted_username: r.submitted_username,
    draft_comment: r.draft_comment,
    user_note: r.user_note,
    admin_notes: r.admin_notes,
    can_retry: r.can_retry,
    created_at: r.created_at,
    updated_at: r.updated_at,
    resolved_at: r.resolved_at,
    tasks: {
      title: r.task_title,
      reward_amount: r.task_reward,
      target_url: r.task_target_url,
      task_category: r.task_category,
      task_type: r.task_type,
    },
    reddit_accounts: { username: r.submitted_username || r.reddit_username },
    army_user_id: r.army_user_id,
    army_email: r.army_email,
    army_name: r.army_name,
  }));
  const approvedHistory = history.filter((h) => h.status === 'approved');
  const rejectedHistory = history.filter((h) => h.status === 'rejected');
  const visibleHistory = view === 'approved' ? approvedHistory : rejectedHistory;

  const approveMutation = useMutation({
    mutationFn: async (a: any) => {
      await adminApproveAssignment(a.id);
      return a;
    },
    onSuccess: (a: any) => {
      toast.success('Approved ✅');
      if (a?.army_email && a?.army_name) {
        sendTaskApprovedEmail(
          a.army_email,
          a.army_name,
          a.tasks?.title || 'Task',
          a.tasks?.reward_amount || 0
        ).catch(() => {});
      }
      refetch();
    },
    onError: (e: any) => {
      const msg = e?.message || String(e) || 'Gagal approve';
      toast.error(`Gagal approve: ${msg}`);
      console.error('adminApproveAssignment error:', e);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason, allowRetry }: { id: string; reason: string; allowRetry: boolean }) =>
      adminRejectAssignment(id, reason, allowRetry),
    onSuccess: (_, vars) => {
      toast.success(vars.allowRetry ? 'Rejected — army bisa coba lagi' : 'Rejected FINAL — no retry');
      setRejectTarget(null);
      setRejectReason('');
      refetch();
    },
    onError: (e: any) => toast.error(`Gagal reject: ${e.message || e}`),
  });

  const repairMutation = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      adminRepairAssignmentUserId(id, userId),
    onSuccess: () => {
      toast.success('Assignment di-repair ✅ User ID + kredit (jika approved) sudah di-link.');
      setRepairTarget(null);
      setRepairUserId('');
      refetch();
    },
    onError: (e: any) => toast.error(`Gagal repair: ${e.message || e}`),
  });

  const openRejectModal = (a: any) => {
    setRejectReason('');
    setRejectTarget({
      id: a.id,
      title: a.tasks?.title || 'Task',
      username: a.reddit_accounts?.username || '?',
    });
  };

  return (
    <Layout userRole="admin">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Approval Queue</h1>
        <p className="text-sm text-muted">
          {view === 'pending' && `${assignments.length} task menunggu review`}
          {view === 'approved' && `${approvedHistory.length} task sudah di-approve`}
          {view === 'rejected' && `${rejectedHistory.length} task di-reject`}
        </p>
      </div>

      {/* View toggle: live queue | approved history | rejected history */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
        {([
          ['pending', `Menunggu (${assignments.length})`],
          ['approved', `Approved (${approvedHistory.length})`],
          ['rejected', `Reject (${rejectedHistory.length})`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`tap-shrink shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${
              view === k
                ? k === 'approved'
                  ? 'bg-success text-white'
                  : k === 'rejected'
                    ? 'bg-danger text-white'
                    : 'bg-primary text-white'
                : 'bg-white ring-1 ring-border text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Date range filter — only relevant for history views. */}
      {view !== 'pending' && (
        <Card className="mb-4" padding="sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wide text-muted mb-1">Dari tanggal</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                max={toDate || undefined}
                className="px-3 py-2 bg-light rounded-lg border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wide text-muted mb-1">Sampai tanggal</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                min={fromDate || undefined}
                className="px-3 py-2 bg-light rounded-lg border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition text-sm"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => { setFromDate(''); setToDate(''); }}
                disabled={!fromDate && !toDate}
                className="tap-shrink px-3 py-2 rounded-lg text-xs font-bold bg-light text-muted ring-1 ring-border hover:ring-primary/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              {([
                { key: '7', label: '7 hari', from: -6 },
                { key: '30', label: '30 hari', from: -29 },
                { key: 'month', label: 'Bulan ini', monthStart: true },
              ] as const).map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => {
                    const today = new Date();
                    const start = new Date();
                    if ('monthStart' in preset && preset.monthStart) {
                      start.setDate(1);
                    } else if ('from' in preset) {
                      start.setDate(start.getDate() + preset.from);
                    }
                    setFromDate(start.toISOString().split('T')[0]);
                    setToDate(today.toISOString().split('T')[0]);
                  }}
                  className="tap-shrink px-3 py-2 rounded-lg text-xs font-bold bg-primary/10 text-primary ring-1 ring-primary/30 hover:bg-primary/20"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {(fromDate || toDate) && (
              <span className="text-xs text-muted ml-auto">
                Menampilkan: {fromDate || 'awal'} → {toDate || 'sekarang'}
              </span>
            )}
          </div>
        </Card>
      )}

      {view === 'pending' && debug && !('error' in debug) && !debug.is_admin && (
        <Card className="mb-3 bg-danger/10 ring-danger/40" padding="sm">
          <p className="font-extrabold text-danger text-sm">⚠️ Session bukan admin</p>
          <p className="text-xs text-danger/90 mt-1 leading-snug">
            auth.uid: <code>{debug.auth_uid || 'NULL'}</code> · role: <code>{debug.public_users_role || 'NULL'}</code> · is_admin: <code>false</code>
          </p>
          <p className="text-xs text-danger/90 mt-2"><b>Fix:</b> Logout & login ulang (JWT expired) — kalau masih, cek kamu login pakai akun admin yang benar.</p>
        </Card>
      )}
      {view === 'pending' && debug && !('error' in debug) && debug.is_admin && debug.submitted_count !== assignments.length && (
        <Card className="mb-3 bg-warning/10 ring-warning/40" padding="sm">
          <p className="font-extrabold text-warning text-sm">⚠️ Sync mismatch</p>
          <p className="text-xs text-warning/90 mt-1">DB punya <b>{debug.submitted_count}</b> submitted, UI render <b>{assignments.length}</b>. Refresh atau tunggu 30 detik.</p>
        </Card>
      )}
      {view === 'pending' && queueError && (
        <Card className="mb-3 bg-danger/10 ring-danger/40" padding="sm">
          <p className="font-extrabold text-danger text-sm">⚠️ Query error</p>
          <p className="text-xs text-danger/90 mt-1"><code>{(queueError as any)?.message || String(queueError)}</code></p>
        </Card>
      )}

      {/* ===== HISTORY VIEW (approved / rejected audit trail) ===== */}
      {view !== 'pending' && (
        historyLoading ? (
          <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
        ) : visibleHistory.length === 0 ? (
          <Card className="text-center py-12">
            <div className="text-5xl mb-3">{view === 'approved' ? '✅' : '📋'}</div>
            <p className="font-bold">Belum ada riwayat {view === 'approved' ? 'approve' : 'reject'}</p>
            <p className="text-sm text-muted mt-1">Riwayat {view === 'approved' ? 'approval' : 'rejection'} akan muncul di sini.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {visibleHistory.map((a: any) => {
              const proofImage = a.proof_image_url || (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.proof_url || '') ? a.proof_url : '');
              const submittedUrl = a.submitted_url || a.proof_url;
              const isApproved = a.status === 'approved';
              return (
                <Card key={a.id} padding="sm" className={isApproved ? 'ring-1 ring-success/30 bg-success/5' : 'ring-1 ring-danger/30 bg-danger/5'}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${isApproved ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
                          {isApproved ? '✅ Approved' : '❌ Rejected'}
                        </span>
                        {!isApproved && a.can_retry === false && (
                          <span className="text-[9px] font-extrabold uppercase bg-danger text-white px-1.5 py-0.5 rounded">FINAL</span>
                        )}
                        <span className="text-[10px] text-muted">{formatSubmittedAt(a.resolved_at || a.updated_at || a.created_at)}</span>
                      </div>
                      <p className="font-bold text-sm leading-snug">{a.tasks?.title}</p>
                      <p className="text-[11px] text-muted mt-0.5">
                        u/{a.reddit_accounts?.username || '-'} · {a.army_email || 'no email'}
                      </p>
                    </div>
                    <p className="text-sm font-extrabold money shrink-0" style={{ color: isApproved ? '#06D6A0' : undefined }}>
                      Rp{(a.tasks?.reward_amount || 0).toLocaleString('id-ID')}
                    </p>
                  </div>

                  {/* Evidence row — screenshot thumbnail + URL + comment, same as pending view */}
                  <div className="flex items-start gap-3 flex-wrap">
                    {proofImage && (
                      <button
                        onClick={() => setLightbox({ src: proofImage, caption: `${a.tasks?.title} - u/${a.reddit_accounts?.username}` })}
                        className="block w-14 h-14 rounded-lg overflow-hidden ring-1 ring-border hover:ring-primary transition group shrink-0"
                      >
                        <img src={proofImage} alt="Bukti" className="w-full h-full object-cover group-hover:scale-105 transition" />
                      </button>
                    )}
                    {submittedUrl && (
                      <a href={submittedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline shrink-0">
                        Submitted URL <ExternalLink size={10} />
                      </a>
                    )}
                    {a.tasks?.target_url && (
                      <a href={a.tasks.target_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted font-semibold hover:underline shrink-0">
                        Thread asli <ExternalLink size={10} />
                      </a>
                    )}
                  </div>

                  {a.draft_comment?.trim() && (
                    <div className="mt-2 bg-white ring-1 ring-border rounded-lg p-2">
                      <p className="text-[10px] uppercase font-bold text-muted mb-0.5">Komentar</p>
                      <p className="text-xs text-dark whitespace-pre-wrap leading-snug">{a.draft_comment}</p>
                    </div>
                  )}

                  {!isApproved && a.admin_notes?.trim() && (
                    <div className="mt-2 bg-white ring-1 ring-danger/30 rounded-lg p-2">
                      <p className="text-[10px] uppercase font-bold text-danger mb-0.5">Alasan reject</p>
                      <p className="text-xs text-dark whitespace-pre-wrap leading-snug">{a.admin_notes}</p>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ===== PENDING VIEW (live queue) ===== */}
      {view === 'pending' && (isLoading ? (
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
                  <th className="px-2 py-2 font-semibold text-muted">Username</th>
                  <th className="px-2 py-2 font-semibold text-muted">Bukti</th>
                  <th className="px-2 py-2 font-semibold text-muted">Komentar</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Reward</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a: any) => {
                  const proofImage = a.proof_image_url || (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.proof_url || '') ? a.proof_url : '');
                  const submittedUrl = a.submitted_url || a.proof_url;
                  const hasProof = !!proofImage;
                  const hasComment = !!a.draft_comment?.trim();
                  const hasUserNote = !!a.user_note?.trim();
                  const noEvidence = !hasProof && !submittedUrl && !hasComment;
                  const broken = !a.army_user_id;
                  return (
                    <tr key={a.id} className={`border-b border-border last:border-0 hover:bg-light/60 ${noEvidence ? 'bg-warning/5' : ''} ${broken ? 'bg-danger/5' : ''}`}>
                      <td className="px-2 py-3 align-top whitespace-nowrap">
                        <span className="text-xs text-muted flex items-center gap-1">
                          <Clock size={11} /> {formatSubmittedAt(a.submitted_at || a.updated_at || a.created_at)}
                        </span>
                        {broken && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-danger bg-danger/10 px-2 py-0.5 rounded-full">
                            ⚠️ Missing owner
                          </span>
                        )}
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
                      <td className="px-2 py-3 align-top text-xs">{a.reddit_accounts?.username || '-'}</td>
                      <td className="px-2 py-3 align-top">
                        {hasProof ? (
                          <button
                            onClick={() => setLightbox({ src: proofImage, caption: `${a.tasks?.title} - ${a.reddit_accounts?.username}` })}
                            className="block w-16 h-16 rounded-lg overflow-hidden ring-1 ring-border hover:ring-primary transition group"
                            title="Klik untuk lihat besar"
                          >
                            <img
                              src={proofImage}
                              alt="Screenshot bukti"
                              className="w-full h-full object-cover group-hover:scale-105 transition"
                            />
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted font-bold">optional</span>
                        )}
                        {submittedUrl && (
                          <a
                            href={submittedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline"
                          >
                            Submitted URL <ExternalLink size={10} />
                          </a>
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
                        {hasUserNote && (
                          <p className="text-[10px] text-muted mt-1.5">
                            📝 Catatan: {a.user_note}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3 align-top text-right whitespace-nowrap font-extrabold text-primary money">
                        Rp{a.tasks?.reward_amount?.toLocaleString('id-ID')}
                      </td>
                      <td className="px-2 py-3 align-top text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <Button
                            onClick={() => approveMutation.mutate(a)}
                            variant="success"
                            size="sm"
                            disabled={approveMutation.isPending || broken}
                            title={broken ? 'Repair owner sebelum approve' : 'Approve'}
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
                          {broken && (
                            <Button
                              onClick={() => setRepairTarget({ id: a.id, title: a.tasks?.title })}
                              variant="primary"
                              size="sm"
                              className="!bg-danger hover:!bg-danger/90"
                              title="Link owner"
                            >
                              Repair
                            </Button>
                          )}
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
              const proofImage = a.proof_image_url || (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.proof_url || '') ? a.proof_url : '');
              const submittedUrl = a.submitted_url || a.proof_url;
                  const hasProof = !!proofImage;
                  const hasComment = !!a.draft_comment?.trim();
                  const hasUserNote = !!a.user_note?.trim();
                  const broken = !a.army_user_id;
                  return (
                <Card key={a.id} padding="sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm leading-snug truncate">{a.tasks?.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5 flex-wrap">
                        <span>{a.reddit_accounts?.username || '-'}</span>
                      </div>
                      <p className="text-[11px] text-muted flex items-center gap-1 mt-0.5">
                        <Clock size={10} /> {formatSubmittedAt(a.submitted_at || a.updated_at || a.created_at)}
                      </p>
                      {broken && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-danger bg-danger/10 px-2 py-0.5 rounded-full">
                          ⚠️ Missing owner
                        </span>
                      )}
                    </div>
                    <p className="text-base font-extrabold text-primary money shrink-0">
                      Rp{a.tasks?.reward_amount?.toLocaleString('id-ID')}
                    </p>
                  </div>

                  <div className="flex gap-2 items-stretch">
                    {hasProof ? (
                      <button
                        onClick={() => setLightbox({ src: proofImage, caption: `${a.tasks?.title} - ${a.reddit_accounts?.username}` })}
                        className="w-20 h-20 rounded-lg overflow-hidden ring-1 ring-border shrink-0"
                      >
                        <img src={proofImage} alt="Bukti" className="w-full h-full object-cover" />
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
                      ) : !hasProof && !submittedUrl ? (
                        <p className="text-[11px] text-warning">No screenshot or URL</p>
                      ) : (
                        <p className="text-[11px] text-muted">No comment</p>
                      )}
                      {hasUserNote && (
                        <p className="text-[10px] text-muted mt-1">
                          📝 {a.user_note}
                        </p>
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
                      {submittedUrl && (
                        <a
                          href={submittedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold mt-1 hover:underline"
                        >
                          Submitted URL <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button
                      onClick={() => approveMutation.mutate(a)}
                      variant="success"
                      size="sm"
                      loading={approveMutation.isPending}
                      disabled={approveMutation.isPending || broken}
                      fullWidth
                      title={broken ? 'Repair owner sebelum approve' : 'Approve'}
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
                  {broken && (
                    <Button
                      onClick={() => setRepairTarget({ id: a.id, title: a.tasks?.title })}
                      variant="primary"
                      size="sm"
                      fullWidth
                      className="mt-2 !bg-danger hover:!bg-danger/90"
                    >
                      Repair owner
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      ))}

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
            <p className="text-xs text-muted mb-3">
              Alasan reject akan ditampilkan ke army member supaya mereka tau apa yang harus diperbaiki.
            </p>

            <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1.5">
              Quick pick:
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
              Alasan (wajib):
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Tulis alasan rejection (min 10 huruf). Yang dilihat army member."
              rows={4}
              autoFocus
              className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-danger focus:bg-white transition text-sm mb-3"
            />

            <p className="text-[11px] uppercase font-bold tracking-wide text-muted mb-2">
              Pilih jenis rejection:
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason, allowRetry: true })}
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
                  rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason, allowRetry: false });
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
              <button
                onClick={() => setRejectTarget(null)}
                disabled={rejectMutation.isPending}
                className="w-full text-xs text-muted hover:text-dark font-semibold py-2 disabled:opacity-50"
              >
                Batal
              </button>
            </div>
            <p className="text-[10px] text-muted/80 mt-3 leading-snug">
              💡 <b>Coba lagi</b>: typical case, user lupa screenshot bagus / salah klik. <br />
              💡 <b>Final</b>: kalau jelas cheating (screenshot palsu, akun bukan punya sendiri, atau berkali-kali submit asal).
            </p>
          </div>
        </div>
      )}

      {/* Repair owner modal — for legacy forum_comment rows with user_id = NULL. */}
      {repairTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setRepairTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-extrabold flex items-center gap-2 text-danger">
                🔧 Repair Owner
              </h3>
              <button onClick={() => setRepairTarget(null)} className="p-1 text-muted hover:text-dark">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-muted mb-1">
              <b className="text-dark">{repairTarget.title}</b>
            </p>
            <p className="text-xs text-danger mb-3">
              Assignment ini tidak punya user_id (owner tidak bisa terdeteksi). Masukkan user ID yang benar supaya saldo masuk ke akun army.
            </p>
            <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1.5">
              User ID (UUID):
            </p>
            <input
              type="text"
              value={repairUserId}
              onChange={(e) => setRepairUserId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-danger focus:bg-white transition text-sm mb-4"
            />
            <div className="space-y-2">
              <Button
                onClick={() => repairMutation.mutate({ id: repairTarget.id, userId: repairUserId.trim() })}
                loading={repairMutation.isPending}
                disabled={repairUserId.trim().length < 36 || repairMutation.isPending}
                variant="primary"
                size="md"
                fullWidth
                className="!bg-danger hover:!bg-danger/90"
              >
                🔧 Link Owner & Backfill Kredit
              </Button>
              <button
                onClick={() => setRepairTarget(null)}
                disabled={repairMutation.isPending}
                className="w-full text-xs text-muted hover:text-dark font-semibold py-2 disabled:opacity-50"
              >
                Batal
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
