import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, ExternalLink, Check, Camera, Link as LinkIcon, X, Upload,
  ArrowRight, MessageCircle, Target, Sparkles, Copy,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { ConfettiBurst } from '../components/Confetti';
import { supabase } from '../lib/supabase';
import { createTaskAssignment, updateTaskAssignment, uploadTaskProofImage, type TaskAssignmentUpdate } from '../lib/api';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import { toast } from '../components/Toast';

type Stage = 'preview' | 'submit' | 'done';

export function TaskDetail() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [, setUser] = React.useState<any>(null);
  const [accounts, setAccounts] = React.useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState('');
  const [draftComment, setDraftComment] = React.useState('');
  const [userNote, setUserNote] = React.useState('');
  const [proofUrl, setProofUrl] = React.useState('');
  const [submittedUsername, setSubmittedUsername] = React.useState('');
  const [proofImageUrl, setProofImageUrl] = React.useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>('preview');
  const [assignmentId, setAssignmentId] = React.useState<string>('');
  const [threadOpened, setThreadOpened] = React.useState(false);
  const [confetti, setConfetti] = React.useState(false);
  const [checkingExistingAssignment, setCheckingExistingAssignment] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
      const { data: accs } = await supabase
        .from('reddit_accounts').select('*').eq('user_id', data.user.id);
      if (accs) {
        setAccounts(accs);
        setSelectedAccountId(accs[0]?.id || '');
      }
      const accountIds = (accs || []).map((a) => a.id);
      const accountFilter = accountIds.length
        ? `reddit_account_id.in.(${accountIds.join(',')})`
        : 'reddit_account_id.is.null';
      const { data: existing } = await supabase
        .from('task_assignments')
        .select('id, status, draft_comment, user_note, proof_url, submitted_username, proof_image_url')
        .eq('task_id', taskId)
        .or(`user_id.eq.${data.user.id},${accountFilter}`)
        .in('status', ['in_progress', 'submitted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        setAssignmentId(existing.id);
        setDraftComment(existing.draft_comment || '');
        setUserNote(existing.user_note || '');
        setProofUrl(existing.proof_url || '');
        setSubmittedUsername(existing.submitted_username || '');
        setProofImageUrl(existing.proof_image_url || null);
        setStage(existing.status === 'submitted' ? 'done' : 'submit');
      }
      setCheckingExistingAssignment(false);
    })();
  }, [navigate, taskId]);

  const { data: task, isLoading: taskLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const { data } = await supabase.from('tasks').select('*').eq('id', taskId).single();
      return data;
    },
    enabled: !!taskId,
  });
  const category = task?.task_category || task?.task_type;
  const isUpvote = category === 'reddit_upvote' || task?.task_type === 'upvote';
  const isForumComment = category === 'forum_comment';
  const isYouTubeUpload = category === 'youtube_upload';
  const isComment = isForumComment || category === 'reddit_comment' || task?.task_type === 'comment';
  const platformLabel = task ? platformForTask(task) : 'Forum';

  const startMutation = useMutation({
    mutationFn: () => createTaskAssignment(taskId!, selectedAccountId || null),
    onSuccess: (a: { id: string; draft_comment?: string | null }) => {
      setAssignmentId(a.id);
      if (a.draft_comment) setDraftComment(a.draft_comment);
      setStage('submit');
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : 'Gagal memulai task';
      toast.error(message);
      if (/quota|penuh|tidak aktif|sudah tidak aktif/i.test(message)) {
        setTimeout(() => navigate('/tasks'), 900);
      }
    },
  });

  // If user has exactly 1 reddit account (which is the enforced limit), skip
  // the manual account-pick step. Forum tasks can also start without Reddit.
  React.useEffect(() => {
    if (
      stage === 'preview' &&
      ((accounts.length === 1 && selectedAccountId) || ((isForumComment || isYouTubeUpload) && accounts.length === 0)) &&
      !startMutation.isPending &&
      !checkingExistingAssignment &&
      !assignmentId
    ) {
      startMutation.mutate();
    }
    // isForumComment/isYouTubeUpload must be in deps so the effect fires when
    // the task loads and reveals a task that doesn't need Reddit accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, selectedAccountId, stage, isForumComment, isYouTubeUpload, taskId, checkingExistingAssignment, assignmentId, startMutation.isPending]);

  const submitMutation = useMutation({
    mutationFn: () => {
      const updates: TaskAssignmentUpdate = {
        user_note: userNote || null,
        proof_url: proofUrl || proofImageUrl || null,
        submitted_url: proofUrl || null,
        submitted_username: submittedUsername || null,
        proof_image_url: proofImageUrl || null,
        status: 'submitted',
      };
      // For forum_comment, draft_comment is the assigned comment text from
      // reddit_order_comment_drafts and must stay immutable. The user note
      // (user_note) is the only editable free-text field.
      if (!isForumComment) {
        updates.draft_comment = draftComment || null;
      }
      return updateTaskAssignment(assignmentId, updates);
    },
    onSuccess: () => {
      setStage('done');
      setConfetti(true);
      toast.success('Tersubmit! Admin verify dalam max 3 hari kerja.');
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal submit task'),
  });

  const handleProofFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error('Foto > 5MB. Kompres dulu atau pilih yang lebih kecil.');
      return;
    }
    setUploadingProof(true);
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || !data?.user) {
        throw new Error('Sesi belum aktif. Coba refresh halaman dan login ulang.');
      }
      const url = await uploadTaskProofImage({ userId: data.user.id, taskId: taskId!, file });
      setProofImageUrl(url);
      toast.success('Screenshot ter-upload');
    } catch (e: any) {
      const message = e?.message || String(e);
      // Surface uuid-syntax errors in a human way; usually means the storage
      // policy/bucket is missing or the auth token was not supplied.
      if (/invalid input syntax for type uuid/i.test(message)) {
        toast.error('Upload gagal: konfigurasi storage belum siap atau sesi expired. Coba refresh dan login ulang.');
      } else {
        toast.error(`Upload gagal: ${message}`);
      }
    } finally {
      setUploadingProof(false);
    }
  };

  if (taskLoading) {
    return <Layout userRole="army"><CardSkeleton /></Layout>;
  }
  if (!task) {
    return (
      <Layout userRole="army">
        <div className="max-w-md mx-auto text-center py-12">
          <h2 className="text-2xl font-extrabold mb-2">Task tidak ditemukan</h2>
          <Button onClick={() => navigate('/tasks')} variant="primary" fullWidth>Kembali ke daftar</Button>
        </div>
      </Layout>
    );
  }

  const minutes = task.reward_amount > 15000 ? '5-10' : '3-5';
  // Comment tasks must have a non-empty comment text before submit.
  const hasCommentText = isComment
    ? (isForumComment
        ? !!(draftComment?.trim() || splitForumBrief(task.brief).commentPost.trim())
        : !!draftComment?.trim())
    : true;
  const canSubmit = isUpvote
    ? !!proofImageUrl && !!assignmentId
    : isYouTubeUpload
    ? !!proofUrl.trim() && !!assignmentId
    : !!proofUrl.trim() && !!submittedUsername.trim() && !!assignmentId && hasCommentText;

  // ----- DONE STAGE — celebrate + nudge to the next high-value action -----
  if (stage === 'done') {
    return (
      <Layout userRole="army">
        <ConfettiBurst active={confetti} onDone={() => setConfetti(false)} />
        <div className="max-w-2xl mx-auto pb-8">
          <Card className="bg-gradient-to-br from-success/15 via-success/5 to-secondary/10 ring-success/30 text-center py-7">
            <h1 className="text-3xl font-extrabold text-success mb-2">Tersubmit!</h1>
            <p className="text-base text-dark/85 mb-4">
              Admin lagi verify screenshot kamu sekarang.
            </p>

            <div className="bg-white rounded-2xl p-4 mb-5 ring-1 ring-success/30 max-w-sm mx-auto">
              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">
                Estimasi approval
              </p>
              <p className="text-xl font-extrabold text-success leading-tight">
                Max 3 hari kerja
              </p>
              <p className="text-sm text-muted mt-1">
                Biasanya jauh lebih cepat - <b className="text-success">rata-rata 24 jam</b>.
                Kalau approved, reward <b className="money">Rp{task.reward_amount.toLocaleString('id-ID')}</b> otomatis masuk saldo.
              </p>
            </div>

            <p className="text-sm font-bold mb-3 text-dark">
              Sambil nunggu, jangan diem aja
            </p>
          </Card>

          {/* 3 Next-action CTAs — ordered by earning leverage */}
          <div className="space-y-2 mt-3">
            <button
              onClick={() => navigate('/tasks')}
              className="w-full bg-primary hover:brightness-110 text-white rounded-2xl p-4 flex items-center gap-3 tap-shrink shadow-sm"
            >
              <div className="w-11 h-11 bg-white/20 rounded-xl grid place-items-center shrink-0">
                <Target size={22} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-extrabold text-base leading-tight">Lakuin task lain dulu</p>
                <p className="text-xs opacity-90 mt-0.5">
                  Cuan dobel - bisa kerjain task aktif lain selagi nunggu approval.
                </p>
              </div>
              <ArrowRight size={20} className="shrink-0" />
            </button>

            <button
              onClick={() => navigate('/karma-mission')}
              className="w-full bg-white hover:bg-light text-dark rounded-2xl p-4 flex items-center gap-3 tap-shrink ring-1 ring-yellow-300"
            >
              <div className="w-11 h-11 bg-yellow-100 text-yellow-700 rounded-xl grid place-items-center shrink-0">
                <Sparkles size={22} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-extrabold text-base leading-tight">Bangun karma Reddit</p>
                <p className="text-xs text-muted mt-0.5">
                  Karma naik = reward task naik (Rp5K ke Rp20K) + buka task premium.
                </p>
              </div>
              <ArrowRight size={20} className="shrink-0 text-muted" />
            </button>

            <button
              onClick={() => window.open(WHATSAPP_GROUP_URL, '_blank')}
              className="w-full bg-white hover:bg-light text-dark rounded-2xl p-4 flex items-center gap-3 tap-shrink ring-1 ring-success/40"
            >
              <div className="w-11 h-11 bg-success/15 text-success rounded-xl grid place-items-center shrink-0">
                <MessageCircle size={22} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-extrabold text-base leading-tight">Join grup WhatsApp</p>
                <p className="text-xs text-muted mt-0.5">
                  Task baru di-broadcast di sana real-time. Yang ga gabung = ketinggalan slot.
                </p>
              </div>
              <ArrowRight size={20} className="shrink-0 text-muted" />
            </button>
          </div>

          <button
            onClick={() => navigate('/tasks')}
            className="w-full mt-5 text-sm text-muted font-semibold hover:text-dark tap-shrink py-2"
          >
            Kembali ke daftar task
          </button>
        </div>
      </Layout>
    );
  }

  // ----- PREVIEW STAGE — only shown if user has MULTIPLE reddit accounts -----
  // With the 1-account-per-user enforcement, this stage is auto-skipped via
  // the effect above. Kept here for legacy multi-account rows / admins.
  if (stage === 'preview' && accounts.length > 1) {
    return (
      <Layout userRole="army">
        <div className="max-w-2xl mx-auto pb-8">
          <button
            onClick={() => navigate('/tasks')}
            className="text-muted hover:text-dark flex items-center gap-1 text-sm font-semibold mb-3"
          >
            <ArrowLeft size={16} /> Semua Tugas
          </button>
          <Card>
            <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Pilih akun</p>
            <h2 className="text-lg font-extrabold mb-1">
              {isForumComment ? 'Profil tracking untuk task ini' : isYouTubeUpload ? 'Task ini tanpa akun Reddit' : 'Akun Reddit untuk task ini'}
            </h2>
            <p className="text-sm text-muted mb-4">
              {isForumComment
                ? `Ini hanya untuk tracking PeTa. Username ${platformLabel} tetap kamu isi nanti saat submit bukti.`
                : isYouTubeUpload
                ? 'Upload video ke channel YouTube-mu sendiri. URL video hasil upload jadi bukti nanti.'
                : 'Komentar / upvote akan tercatat atas nama akun ini.'}
            </p>
            <div className="space-y-2 mb-5">
              {accounts.map((acc) => (
                <label
                  key={acc.id}
                  className={`flex items-center gap-3 p-3 rounded-xl ring-2 cursor-pointer tap-shrink ${
                    selectedAccountId === acc.id ? 'ring-primary bg-primary/5' : 'ring-border hover:ring-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="account"
                    checked={selectedAccountId === acc.id}
                    onChange={() => setSelectedAccountId(acc.id)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full grid place-items-center ${
                    selectedAccountId === acc.id ? 'bg-primary' : 'ring-2 ring-border bg-white'
                  }`}>
                    {selectedAccountId === acc.id && <Check size={12} className="text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">u/{acc.username}</p>
                    <p className="text-xs text-muted">Karma: {acc.karma}</p>
                  </div>
                </label>
              ))}
            </div>
            <Button
              onClick={() => startMutation.mutate()}
              variant="primary"
              size="lg"
              loading={startMutation.isPending}
              disabled={!selectedAccountId}
              fullWidth
            >
              Mulai Task
            </Button>
          </Card>
        </div>
      </Layout>
    );
  }

  // ----- NO REDDIT ACCOUNT: only block Reddit-specific tasks. Forum / YouTube
  // tasks can be completed without a Reddit account.
  if (accounts.length === 0 && !isForumComment && !isYouTubeUpload) {
    return (
      <Layout userRole="army">
        <div className="max-w-2xl mx-auto pb-8">
          <button
            onClick={() => navigate('/tasks')}
            className="text-muted hover:text-dark flex items-center gap-1 text-sm font-semibold mb-3"
          >
            <ArrowLeft size={16} /> Semua Tugas
          </button>
          <Card>
            <p className="text-sm text-muted">
              {isForumComment ? 'Belum ada profil task terhubung.' : 'Belum ada akun Reddit terhubung.'}{' '}
              <button onClick={() => navigate('/onboarding')} className="text-primary font-bold underline">
                Selesaikan setup dulu
              </button>.
            </p>
          </Card>
        </div>
      </Layout>
    );
  }

  // ----- SUBMIT STAGE — 3-step linear flow -----
  // Defensive: this default branch assumes we already have an active
  // assignment. If the auto-start effect is still waiting for the task to load
  // (e.g. a forum task with no linked Reddit account), show a loading state
  // instead of a broken form whose submit button would hit an empty UUID.
  if (stage !== 'submit') {
    return (
      <Layout userRole="army">
        <div className="max-w-2xl mx-auto pb-24 sm:pb-0">
          <button
            onClick={() => navigate('/tasks')}
            className="text-muted hover:text-dark flex items-center gap-1 text-sm font-semibold mb-3"
          >
            <ArrowLeft size={16} /> Semua Tugas
          </button>
          <CardSkeleton />
        </div>
      </Layout>
    );
  }
  return (
    <Layout userRole="army">
      <div className="max-w-2xl mx-auto pb-24 sm:pb-0">
        <button
          onClick={() => navigate('/tasks')}
          className="text-muted hover:text-dark flex items-center gap-1 text-sm font-semibold mb-3"
        >
          <ArrowLeft size={16} /> Semua Tugas
        </button>

        {/* Reward header */}
        <Card className="mb-4 bg-gradient-to-br from-primary/10 via-yellow-50 to-secondary/10 ring-primary/20">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wide bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                  {isUpvote ? 'Upvote' : isComment ? `${platformLabel} Comment` : isYouTubeUpload ? 'YouTube Upload' : `${platformLabel} Task`}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold mb-2 leading-tight">{task.title}</h1>
              <p className="text-sm text-muted line-clamp-2">{task.description}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted">
                <span>{minutes} min</span>
                <span>{task.current_assignments}/{task.max_assignments} dikerjakan</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Reward</p>
              <p className="text-2xl sm:text-3xl font-extrabold text-primary money leading-none">
                Rp{task.reward_amount.toLocaleString('id-ID')}
              </p>
            </div>
          </div>
        </Card>

        {/* ============ STEP 1 — BUKA TARGET ============ */}
        <StepCard
          num={1}
          done={threadOpened}
          active={!threadOpened}
          title={`Buka halaman ${platformLabel}`}
          subtitle="Klik tombol di bawah. Target akan terbuka di tab baru."
        >
          <a
            href={task.target_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setThreadOpened(true)}
            className="mt-1 flex items-center justify-between bg-white rounded-xl px-4 py-3 ring-2 ring-primary/30 hover:ring-primary/60 transition tap-shrink"
          >
            <div className="min-w-0">
              <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Target URL</p>
              <p className="text-sm font-bold truncate text-primary">{task.target_url}</p>
            </div>
            <div className="ml-3 shrink-0 flex items-center gap-1.5 bg-primary text-white px-3 py-2 rounded-lg font-bold text-sm">
              Buka <ExternalLink size={14} />
            </div>
          </a>
          {threadOpened && (
            <p className="text-xs text-success font-semibold mt-2 flex items-center gap-1">
              <Check size={12} /> Target terbuka. Lanjut Step 2 di bawah.
            </p>
          )}
        </StepCard>

        {/* ============ STEP 2 — LAKUKAN TASK + EXAMPLE SCREENSHOT ============ */}
        <StepCard
          num={2}
          done={false}
          active={threadOpened}
          title={isUpvote ? 'Klik tombol upvote' : isYouTubeUpload ? 'Upload video ke YouTube' : `Post komentar di ${platformLabel}`}
          subtitle={isUpvote
            ? 'Pastikan panah upvote berubah jadi warna terang. Itu tanda upvote sukses.'
            : isYouTubeUpload
            ? 'Upload video ke channel YouTube-mu sendiri. Pastikan judul, deskripsi, dan tags sesuai brief.'
            : 'Copy komentar yang sudah disediakan. Brief biru hanya untuk cara posting yang aman.'
          }
        >
          {/* Brief from admin — comment (copyable) + posting instructions.
              New model: comment lives in task.brief, instructions in task.description.
              Legacy tasks packed both into brief — splitForumBrief() still handles them. */}
          {(() => {
            // YouTube upload tasks: show the metadata guide from the brief.
            if (isYouTubeUpload) {
              const guide = (task.brief || task.description || '').trim();
              if (!guide) return null;
              return (
                <div className="bg-sky-50 ring-1 ring-sky-300 rounded-xl p-3 mb-3">
                  <p className="text-[10px] uppercase font-bold tracking-wide text-sky-900 mb-1">
                    Panduan upload
                  </p>
                  <p className="text-sm text-sky-950 whitespace-pre-line leading-relaxed">
                    {guide}
                  </p>
                </div>
              );
            }

            // Upvote tasks never require a text comment. Show the raw guide
            // (brief/description) as a neutral instruction card so users don't
            // mistake it for a comment they must paste into a text box.
            if (isUpvote) {
              const guide = (task.brief || task.description || '').trim();
              if (!guide) return null;
              return (
                <div className="bg-sky-50 ring-1 ring-sky-300 rounded-xl p-3 mb-3">
                  <p className="text-[10px] uppercase font-bold tracking-wide text-sky-900 mb-1">
                    Panduan tugas
                  </p>
                  <p className="text-sm text-sky-950 whitespace-pre-line leading-relaxed">
                    {guide}
                  </p>
                  <p className="text-[11px] text-sky-800 mt-2 font-semibold">
                    Task ini cuma upvote — gak perlu tulis komentar. Cukup ikuti langkah di atas dan screenshot bukti.
                  </p>
                </div>
              );
            }

            const comment = isForumComment
              ? (draftComment?.trim() || splitForumBrief(task.brief).commentPost.trim())
              : draftComment?.trim();
            const legacyStd = splitForumBrief(task.brief).standardBrief;
            const instructions = memberSafePostingBrief(legacyStd || task.description || '').trim();
            if (!comment && !instructions) return null;
            return (
              <div className="space-y-3 mb-3">
                {comment && (
                  <div className="bg-yellow-50 ring-1 ring-yellow-300 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-[10px] uppercase font-bold tracking-wide text-yellow-900">
                        Komentar yang harus diposting
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(comment);
                            toast.success('Komentar disalin! Tinggal paste — jangan diedit.');
                          } catch {
                            toast.error('Gagal menyalin otomatis. Copy manual ya.');
                          }
                        }}
                        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-yellow-900 bg-yellow-200 hover:bg-yellow-300 active:bg-yellow-300 rounded-lg px-2.5 py-1.5 tap-shrink"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy komentar
                      </button>
                    </div>
                    <p className="text-sm text-yellow-950 whitespace-pre-line leading-relaxed">
                      {comment}
                    </p>
                  </div>
                )}
                {instructions && (
                  <div className="bg-sky-50 ring-1 ring-sky-300 rounded-xl p-3">
                    <p className="text-[10px] uppercase font-bold tracking-wide text-sky-900 mb-1">
                      Cara posting aman
                    </p>
                    <p className="text-sm text-sky-950 whitespace-pre-line leading-relaxed">
                      {instructions}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Example screenshot reference — visual mock so users know
              what counts as valid proof. CSS-only, no asset weight. */}
          <ExampleScreenshot isUpvote={isUpvote} />
        </StepCard>

        {/* ============ STEP 3 — UPLOAD BUKTI ============ */}
        <StepCard
          num={3}
          done={false}
          active={threadOpened}
          title="Submit URL, username, dan bukti"
          subtitle={isUpvote ? 'Screenshot wajib untuk upvote.' : isYouTubeUpload ? 'URL video YouTube wajib. Screenshot optional tapi disarankan.' : 'URL komentar dan username wajib. Screenshot optional tapi disarankan.'}
        >
          {/* SCREENSHOT UPLOAD */}
          {proofImageUrl ? (
            <div className="relative mb-3">
              <img
                src={proofImageUrl}
                alt="Bukti task"
                className="w-full max-h-[300px] object-contain rounded-xl ring-1 ring-success/40 bg-light"
              />
              <button
                onClick={() => setProofImageUrl(null)}
                className="absolute top-2 right-2 bg-white/95 text-danger rounded-full p-1.5 shadow hover:bg-white"
                aria-label="Hapus screenshot"
              >
                <X size={16} />
              </button>
              <span className="absolute bottom-2 left-2 text-[10px] font-bold bg-success text-white px-2 py-0.5 rounded-full">
                Terupload
              </span>
            </div>
          ) : (
            <label className="block mb-3 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleProofFile(e.target.files?.[0])}
                disabled={uploadingProof}
                className="sr-only"
              />
              <div className={`flex flex-col items-center justify-center gap-2 px-4 py-7 rounded-xl border-2 border-dashed transition ${
                uploadingProof ? 'border-primary/50 bg-primary/5' : 'border-border bg-light hover:border-primary/40 hover:bg-primary/5'
              }`}>
                {uploadingProof ? (
                  <>
                    <Upload size={28} className="text-primary animate-pulse" />
                    <p className="text-sm font-bold text-primary">Uploading...</p>
                  </>
                ) : (
                  <>
                    <Camera size={32} className="text-primary" />
                    <p className="text-sm font-bold text-dark">Tap untuk foto / pilih dari galeri</p>
                    <p className="text-[11px] text-muted">JPG, PNG, WEBP - max 5 MB</p>
                  </>
                )}
              </div>
            </label>
          )}

          {/* For comment tasks — submitted URL + platform username are required, screenshot is optional. */}
          {!isUpvote && (
            <>
              <p className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                {isYouTubeUpload ? 'URL video hasil upload di YouTube' : 'URL komentar / thread setelah komentar tampil'}
              </p>
              <div className="relative mb-3">
                <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="url"
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  placeholder={isYouTubeUpload ? 'https://youtube.com/watch?v=...' : isForumComment ? 'https://community.hubspot.com/...' : 'https://reddit.com/r/.../comments/...'}
                  className="w-full pl-10 pr-3 py-3 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition text-sm"
                />
              </div>

              {!isYouTubeUpload && (
                <>
                  <p className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                    Username yang kamu pakai di {platformLabel}
                  </p>
                  <input
                    type="text"
                    value={submittedUsername}
                    onChange={(e) => setSubmittedUsername(e.target.value)}
                    placeholder={isForumComment ? 'Contoh: nama profile HubSpot kamu' : 'u/username'}
                    className="w-full px-4 py-3 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition text-sm mb-3"
                  />
                </>
              )}

              <p className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                Catatan untuk admin (optional)
              </p>
              <textarea
                value={isForumComment ? userNote : draftComment}
                onChange={(e) => isForumComment ? setUserNote(e.target.value) : setDraftComment(e.target.value)}
                placeholder="Optional: cerita singkat tentang komentar kamu..."
                className="w-full px-4 py-3 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition resize-none text-sm"
                rows={3}
              />
            </>
          )}

          {isUpvote && (
            <p className="text-xs text-warning bg-warning/10 px-3 py-2 rounded-lg mt-2">
              Upvote task: <b>screenshot wajib</b>. Pastikan panah upvote berwarna terang/aktif.
            </p>
          )}
          {isYouTubeUpload && (
            <p className="text-xs text-warning bg-warning/10 px-3 py-2 rounded-lg mt-2">
              YouTube Upload: <b>URL video hasil upload wajib</b>. Screenshot optional.
            </p>
          )}

          {/* Submit button — desktop inline */}
          <div className="hidden sm:block mt-5">
            <Button
              onClick={() => submitMutation.mutate()}
              variant="success"
              size="lg"
              loading={submitMutation.isPending}
              disabled={!canSubmit}
              fullWidth
            >
              Submit untuk Approval
            </Button>
            {!canSubmit && (
              <p className="text-[11px] text-muted text-center mt-2">
                {isUpvote
                  ? 'Upload screenshot dulu untuk submit.'
                  : isYouTubeUpload
                  ? 'Isi URL video YouTube hasil upload dulu.'
                  : 'Isi URL komentar/thread dan username yang kamu pakai dulu.'}
              </p>
            )}
          </div>
        </StepCard>

        {/* Sticky mobile submit */}
        <div className="sm:hidden fixed left-0 right-0 bottom-16 z-30 px-4 pb-2 pt-2 bg-light/80 backdrop-blur safe-bottom">
          <Button
            onClick={() => submitMutation.mutate()}
            variant="success"
            size="lg"
            loading={submitMutation.isPending}
            disabled={!canSubmit}
            fullWidth
          >
            Submit untuk Approval
          </Button>
        </div>
      </div>
    </Layout>
  );
}

// ============================================================
// StepCard — numbered step container with active / done states
// ============================================================
function StepCard({
  num, title, subtitle, active, done, children,
}: {
  num: number;
  title: string;
  subtitle?: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={`mb-3 transition ${
        done
          ? 'ring-success/40 bg-success/5'
          : active
            ? 'ring-primary/30'
            : 'ring-black/5 opacity-90'
      }`}
      padding="md"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-full grid place-items-center shrink-0 font-extrabold text-base ${
          done
            ? 'bg-success text-white'
            : active
              ? 'bg-primary text-white'
              : 'bg-light text-muted'
        }`}>
          {done ? <Check size={18} /> : num}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className={`font-extrabold text-base leading-tight ${done ? 'text-success' : 'text-dark'}`}>
            {title}
          </p>
          {subtitle && (
            <p className="text-xs text-muted mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="pl-0 sm:pl-12">{children}</div>
    </Card>
  );
}

function platformForTask(task: any) {
  const category = task.task_category || task.task_type;
  if (category === 'youtube_upload' || task.task_category === 'youtube_upload') return 'YouTube';
  if (category === 'reddit_upvote' || category === 'reddit_comment' || task.task_type === 'upvote') return 'Reddit';
  const text = `${task.title || ''} ${task.description || ''} ${task.target_url || ''}`.toLowerCase();
  if (text.includes('hubspot')) return 'HubSpot';
  if (text.includes('quora')) return 'Quora';
  if (text.includes('indiehackers')) return 'Indie Hackers';
  if (text.includes('stack')) return 'Stack Exchange';
  if (text.includes('producthunt')) return 'Product Hunt';
  return 'Forum';
}

function splitForumBrief(raw: string | null | undefined) {
  const text = raw || '';
  const commentMarker = 'COMMENT/POST YANG HARUS DIISI:';
  const detailMarker = 'DETAIL ORDER:';
  const stepsMarker = 'LANGKAH KERJA UNTUK NEWBIE:';
  const standardMarker = 'STANDARD BRIEF UNIVERSAL:';
  const platformMarker = 'Platform-specific';
  if (!text.includes(commentMarker) && !text.includes(standardMarker) && !text.includes(platformMarker)) {
    return { commentPost: text, standardBrief: '' };
  }
  const afterComment = text.includes(commentMarker) ? text.split(commentMarker)[1] : text;
  const nextMarkers = [detailMarker, stepsMarker, standardMarker, platformMarker]
    .map((marker) => ({ marker, index: afterComment.indexOf(marker) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);
  const commentPost = (nextMarkers.length ? afterComment.slice(0, nextMarkers[0].index) : afterComment).trim();
  const standardStart = text.indexOf(standardMarker);
  const platformStart = text.indexOf(platformMarker);
  const standardBrief = platformStart >= 0 ? text.slice(platformStart).trim() : standardStart >= 0 ? text.slice(standardStart).trim() : '';
  return { commentPost, standardBrief };
}

function memberSafePostingBrief(raw: string) {
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const lower = line.toLowerCase();
      return ![
        'jawab seperti praktisi',
        'mention brand',
        'komentar harus menjawab',
        'tulis komentar',
        'tulis komentar/post',
        'tulis komentar natural',
      ].some((blocked) => lower.includes(blocked));
    })
    .join('\n')
    .trim();
}

// ============================================================
// ExampleScreenshot — CSS-only visual mock of what valid proof
// looks like. Saves an asset download + always matches our brand.
// ============================================================
function ExampleScreenshot({ isUpvote }: { isUpvote: boolean }) {
  return (
    <div className="bg-light/60 rounded-xl p-3 ring-1 ring-black/5">
      <p className="text-[10px] uppercase font-bold tracking-wide text-muted mb-2">
        Contoh screenshot yang benar
      </p>
      <div className="bg-white rounded-lg p-3 ring-1 ring-black/10 shadow-inner max-w-[280px] mx-auto">
        {isUpvote ? (
          <>
            {/* Mock of Reddit upvote button — orange = upvoted */}
            <div className="flex items-start gap-2.5">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="text-orange-500 text-2xl leading-none font-black animate-pulse">▲</div>
                <div className="text-[10px] font-bold text-orange-500">142</div>
                <div className="text-gray-300 text-xl leading-none">▼</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="bg-gray-200 h-2.5 rounded w-4/5 mb-1.5" />
                <div className="bg-gray-100 h-1.5 rounded w-3/5 mb-2" />
                <div className="bg-gray-100 h-1.5 rounded w-2/5" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-[9px] text-gray-400">
              <span>r/example</span><span>-</span><span>2h ago</span>
            </div>
          </>
        ) : (
          <>
            {/* Mock of a forum comment thread with user's comment highlighted */}
            <div className="flex items-start gap-2">
              <div className="w-6 h-6 bg-primary/20 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold text-primary mb-1">username kamu</div>
                <div className="bg-primary/10 ring-1 ring-primary/30 rounded-md p-2">
                  <div className="bg-gray-300 h-1.5 rounded w-full mb-1" />
                  <div className="bg-gray-300 h-1.5 rounded w-4/5 mb-1" />
                  <div className="bg-gray-300 h-1.5 rounded w-2/3" />
                </div>
                <div className="flex gap-2 mt-1.5 text-[8px] text-gray-400">
                  <span>Reply</span><span>Share</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted mt-2 text-center leading-snug">
        {isUpvote
          ? 'Panah harus berwarna terang (orange/merah, tergantung tema). Sertakan URL bar juga biar admin verify.'
          : 'Komentar dari username kamu harus terlihat. Kalau bisa sertakan URL bar dan waktu post.'
        }
      </p>
    </div>
  );
}
