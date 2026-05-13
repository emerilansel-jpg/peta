import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Lightbulb, Check, Camera, Link as LinkIcon, X, Upload } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { createTaskAssignment, updateTaskAssignment, uploadTaskProofImage } from '../lib/api';
import { toast } from '../components/Toast';

type Stage = 'preview' | 'submit' | 'done';

export function TaskDetail() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [, setUser] = React.useState<any>(null);
  const [accounts, setAccounts] = React.useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState('');
  const [draftComment, setDraftComment] = React.useState('');
  const [proofUrl, setProofUrl] = React.useState('');
  const [proofImageUrl, setProofImageUrl] = React.useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>('preview');
  const [assignmentId, setAssignmentId] = React.useState<string>('');

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
    })();
  }, [navigate]);

  const { data: task, isLoading: taskLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const { data } = await supabase.from('tasks').select('*').eq('id', taskId).single();
      return data;
    },
    enabled: !!taskId,
  });

  const startMutation = useMutation({
    mutationFn: () => createTaskAssignment(taskId!, selectedAccountId),
    onSuccess: (a: any) => {
      setAssignmentId(a.id);
      setStage('submit');
      toast.success('Task dimulai. Yuk tulis komentarnya 👇');
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal memulai task'),
  });

  const submitMutation = useMutation({
    mutationFn: () => updateTaskAssignment(assignmentId, {
      draft_comment: draftComment || null,
      proof_url: proofUrl || proofImageUrl || null,
      status: 'submitted',
    }),
    onSuccess: () => {
      setStage('done');
      toast.success('Tersubmit! Tunggu approval admin ✅');
      setTimeout(() => navigate('/tasks'), 1500);
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal submit task'),
  });

  // Upload a screenshot file from <input type=file capture> (mobile camera
  // or gallery picker). Public URL gets saved to assignment.proof_url on
  // submit. We upload immediately on file-select so admin sees the preview
  // while user is still composing the comment.
  const handleProofFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error('Foto > 5MB. Kompres dulu atau pilih yang lebih kecil.');
      return;
    }
    setUploadingProof(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth required');
      const url = await uploadTaskProofImage({ userId: user.id, taskId: taskId!, file });
      setProofImageUrl(url);
      toast.success('Screenshot ter-upload ✅');
    } catch (e: any) {
      toast.error(`Upload gagal: ${e.message || e}`);
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
          <div className="text-5xl mb-3">🤷</div>
          <h2 className="text-2xl font-extrabold mb-2">Task tidak ditemukan</h2>
          <Button onClick={() => navigate('/tasks')} variant="primary" fullWidth>Kembali ke daftar</Button>
        </div>
      </Layout>
    );
  }

  const minutes = task.reward_amount > 15000 ? '5–10' : '3–5';
  // Upvote tasks: proof must be screenshot; URL paste makes no sense
  // (a 1-click upvote doesn't generate a permalink the user can grab).
  const isUpvote = (task.task_category || task.task_type) === 'reddit_upvote' || task.task_type === 'upvote';

  return (
    <Layout userRole="army">
      <div className="max-w-2xl mx-auto pb-24 sm:pb-0">
        <button
          onClick={() => navigate('/tasks')}
          className="text-muted hover:text-dark flex items-center gap-1 text-sm font-semibold mb-3"
        >
          <ArrowLeft size={16} /> Semua Tugas
        </button>

        {/* Reward header card */}
        <Card className="mb-4 bg-gradient-to-br from-primary/10 via-yellow-50 to-secondary/10 ring-primary/20">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold mb-2 leading-tight">{task.title}</h1>
              <p className="text-sm text-muted mb-3">{task.description}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>⏱️ {minutes} min</span>
                <span>👥 {task.current_assignments}/{task.max_assignments} sedang dikerjakan</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Reward</p>
              <p className="text-2xl sm:text-3xl font-extrabold text-primary money leading-none">
                Rp{task.reward_amount.toLocaleString('id-ID')}
              </p>
            </div>
          </div>

          {task.target_url && (
            <a
              href={task.target_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-between bg-white rounded-xl px-4 py-3 ring-1 ring-black/5 hover:ring-primary/40 transition"
            >
              <div className="min-w-0">
                <p className="text-[10px] text-muted uppercase font-bold tracking-wide">Buka thread Reddit</p>
                <p className="text-sm font-semibold truncate">{task.target_url}</p>
              </div>
              <ExternalLink size={18} className="text-primary shrink-0 ml-3" />
            </a>
          )}
        </Card>

        {/* Brief — full instructions admin wrote for this task. Shown
            prominently above the submit form because army needs to follow
            this exactly. Only renders if admin actually wrote something. */}
        {task.brief && task.brief.trim() && (
          <Card className="mb-4 bg-yellow-50 ring-yellow-300">
            <p className="text-xs uppercase font-bold tracking-wide text-yellow-900 mb-2 flex items-center gap-1.5">
              📋 Brief — Ikutin instruksi ini
            </p>
            <p className="text-sm text-yellow-950 whitespace-pre-line leading-relaxed">
              {task.brief}
            </p>
          </Card>
        )}

        {/* Stage content */}
        {accounts.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Belum ada akun Reddit terhubung. <button onClick={() => navigate('/onboarding')} className="text-primary font-bold underline">Setup dulu</button>.
            </p>
          </Card>
        ) : stage === 'preview' ? (
          <Card>
            <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Step 1 / 2</p>
            <h2 className="text-lg font-extrabold mb-1">Pilih akun Reddit</h2>
            <p className="text-sm text-muted mb-4">Komentar akan dipost atas nama akun ini.</p>
            <div className="space-y-2 mb-5">
              {accounts.map((acc) => (
                <label
                  key={acc.id}
                  className={`flex items-center gap-3 p-3 rounded-xl ring-2 cursor-pointer tap-shrink ${
                    selectedAccountId === acc.id
                      ? 'ring-primary bg-primary/5'
                      : 'ring-border hover:ring-primary/40'
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
              ✨ Mulai Task
            </Button>
          </Card>
        ) : stage === 'submit' ? (
          <>
            <Card className="mb-4 bg-blue-50 ring-blue-200">
              <div className="flex gap-3">
                <Lightbulb size={20} className="text-blue-600 shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-bold mb-1">Cara submit (paling gampang dari HP):</p>
                  <ul className="space-y-1 list-disc pl-4 text-blue-800/90">
                    <li><b>📸 Foto bukti</b> (paling cepat): klik tombol → buka kamera/galeri → pilih screenshot.</li>
                    <li>Atau <b>🔗 paste URL</b> komentar/post yang sudah kamu submit.</li>
                    <li>Bisa keduanya buat percepat approval.</li>
                  </ul>
                </div>
              </div>
            </Card>
            <Card>
              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Step 2 / 2 — Bukti task</p>

              {/* SCREENSHOT UPLOAD — primary input, mobile-camera-friendly */}
              <p className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                📸 Upload screenshot bukti
              </p>
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
                    ✓ Terupload
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
                  <div className={`flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed transition ${
                    uploadingProof ? 'border-primary/50 bg-primary/5' : 'border-border bg-light hover:border-primary/40 hover:bg-primary/5'
                  }`}>
                    {uploadingProof ? (
                      <>
                        <Upload size={28} className="text-primary animate-pulse" />
                        <p className="text-sm font-bold text-primary">Uploading…</p>
                      </>
                    ) : (
                      <>
                        <Camera size={32} className="text-primary" />
                        <p className="text-sm font-bold text-dark">Tap untuk foto / pilih dari galeri</p>
                        <p className="text-[11px] text-muted">JPG, PNG, WEBP — max 5 MB</p>
                      </>
                    )}
                  </div>
                </label>
              )}

              {/* URL PASTE — only for comment/post tasks. Upvote has no
                  unique permalink to paste, so screenshot is mandatory. */}
              {!isUpvote && (
                <>
                  <p className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                    🔗 ATAU paste URL komentar/post
                  </p>
                  <div className="relative mb-3">
                    <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="url"
                      value={proofUrl}
                      onChange={(e) => setProofUrl(e.target.value)}
                      placeholder="https://reddit.com/r/.../comments/..."
                      className="w-full pl-10 pr-3 py-3 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition text-sm"
                    />
                  </div>

                  <p className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">
                    💬 Catatan/komentar (opsional)
                  </p>
                  <textarea
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    placeholder="Optional: tulis komentar atau catatan buat admin…"
                    className="w-full px-4 py-3 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition resize-none text-sm"
                    rows={4}
                  />
                  <p className="text-xs text-muted mt-1.5">{draftComment.length} karakter</p>
                </>
              )}
              {isUpvote && (
                <p className="text-xs text-warning bg-warning/10 px-3 py-2 rounded-lg mt-2">
                  📸 Upvote task: <b>screenshot wajib</b>. Pastikan terlihat tombol upvote sudah orange/aktif.
                </p>
              )}

              <div className="hidden sm:block mt-5">
                <Button
                  onClick={() => submitMutation.mutate()}
                  variant="success"
                  size="lg"
                  loading={submitMutation.isPending}
                  disabled={isUpvote ? !proofImageUrl : (!proofImageUrl && !proofUrl.trim() && !draftComment.trim())}
                  fullWidth
                >
                  ✅ Submit untuk Approval
                </Button>
                {!proofImageUrl && !proofUrl.trim() && !draftComment.trim() && (
                  <p className="text-[11px] text-muted text-center mt-2">
                    {isUpvote ? 'Upload screenshot dulu untuk submit.' : 'Submit setelah upload screenshot, paste URL, atau tulis komentar.'}
                  </p>
                )}
              </div>
            </Card>

            {/* Sticky mobile submit */}
            <div className="sm:hidden fixed left-0 right-0 bottom-16 z-30 px-4 pb-2 pt-2 bg-light/80 backdrop-blur safe-bottom">
              <Button
                onClick={() => submitMutation.mutate()}
                variant="success"
                size="lg"
                loading={submitMutation.isPending}
                disabled={isUpvote ? !proofImageUrl : (!proofImageUrl && !proofUrl.trim() && !draftComment.trim())}
                fullWidth
              >
                ✅ Submit untuk Approval
              </Button>
            </div>
          </>
        ) : (
          <Card className="bg-success/10 ring-success/30 text-center py-8">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-2xl font-extrabold text-success mb-2">Tersubmit!</h2>
            <p className="text-sm text-muted">Admin sedang review. Cair otomatis kalau approved.</p>
          </Card>
        )}
      </div>
    </Layout>
  );
}
