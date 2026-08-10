import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Trophy, Flame, Lock, Sparkles, Clock,
  CheckCircle2, XCircle, AlertTriangle, Wallet, RefreshCw, Hourglass,
  Camera,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import {
  getRedditArmyProfile,
  activateRedditArmyInvitation,
  listChallengeTasksForUser,
  claimChallengeTask,
  requestRedditArmyResignation,
  cancelRedditArmyResignation,
  getRedditAccounts,
  updateRedditAccountKarma
} from '../lib/api';
import { toast } from '../components/Toast';

const REDDIT_URL = 'https://www.reddit.com';
const MIN_ACTIVE_DAYS_FOR_RESIGN = 20;

function formatRupiah(n: number): string {
  return 'Rp' + (n || 0).toLocaleString('id-ID');
}


function RedditAccountManager({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['redditAccounts', userId],
    queryFn: () => getRedditAccounts(userId),
    enabled: !!userId,
  });

  const [syncFailedFor, setSyncFailedFor] = useState<string | null>(null);

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const account = accounts.find((a: any) => a.id === id);
      const beforeKarma = account?.karma ?? 0;
      const result = await updateRedditAccountKarma(id, account?.username);
      return { id, beforeKarma, ...result };
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['redditAccounts'] });
      const newKarma = data.account?.karma ?? data.karma ?? data.beforeKarma;
      if (data.fallback) {
        setSyncFailedFor(data.id);
        if (data.statusFlag === 'not_found' || data.statusFlag === 'suspended') {
          toast.error('❌ Akun Reddit kamu bermasalah. Hubungi admin.');
        } else {
          toast.error('🌐 Reddit memblokir auto-sync. Hubungi admin buat update manual.');
        }
      } else if (newKarma > data.beforeKarma) {
        setSyncFailedFor(null);
        toast.success(`Karma +${newKarma - data.beforeKarma} 🎉`);
      } else {
        setSyncFailedFor(null);
        toast.success('Sync OK — karma disync 📊');
      }
    },
    onError: (_e, id) => {
      setSyncFailedFor(id);
      toast.error('Gagal sync — Reddit memblokir.');
    },
  });

  if (isLoading || accounts.length === 0) return null;
  const account = accounts[0];

  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs text-muted font-semibold uppercase tracking-wide">Akun Terhubung</p>
          <p className="font-extrabold text-lg truncate">u/{account.username}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-extrabold money">{account.karma}</p>
          <p className="text-[10px] text-muted">karma</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
        <div className="bg-light rounded-lg p-2.5">
          <p className="text-muted">Umur akun</p>
          <p className="font-bold text-base">{account.account_age_days} hari</p>
        </div>
      </div>

      {(syncFailedFor === account.id || account.karma === 0 || account.status_flag === 'not_found' || account.status_flag === 'suspended') && (
        <div className="mb-3 rounded-xl p-3 ring-1 bg-warning/10 ring-warning/40">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning" />
            <div className="text-xs">
              <p className="font-extrabold text-warning">Perhatian Akun</p>
              <p className="text-warning/80 mt-0.5">
                Ada kemungkinan Reddit memblokir auto-sync atau akun error. Hubungi admin buat update karma manual jika perlu.
              </p>
            </div>
          </div>
        </div>
      )}

      <Button
        onClick={() => syncMutation.mutate(account.id)}
        variant="outline"
        size="md"
        loading={syncMutation.isPending}
        fullWidth
      >
        <RefreshCw size={16} /> Sync Karma (Poin Extra)
      </Button>
    </Card>
  );
}

function formatDaysRemaining(effectiveAt: string | null): number {
  if (!effectiveAt) return 0;
  const diff = new Date(effectiveAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function RedditArmy() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showResignConfirm, setShowResignConfirm] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['reddit-army-profile'],
    queryFn: getRedditArmyProfile,
    staleTime: 30_000,
  });

  const tasksQuery = useQuery({
    queryKey: ['reddit-army-challenge-tasks'],
    queryFn: listChallengeTasksForUser,
    enabled: profileQuery.data?.profile?.program_status === 'phase1_active',
    staleTime: 30_000,
  });

  const activateMut = useMutation({
    mutationFn: (username: string | undefined) => activateRedditArmyInvitation(username),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(`Gagal aktivasi: ${result.error || 'Unknown error'}`);
        return;
      }
      toast.success('🎉 Selamat bergabung! Challenge Phase 1 udah aktif. Gas kerjain misi pertama!');
      queryClient.invalidateQueries({ queryKey: ['reddit-army-profile'] });
    },
    onError: (err: Error) => {
      toast.error(`Gagal aktivasi: ${err.message}`);
    },
  });

  const claimMut = useMutation({
    mutationFn: ({ taskId, accountId }: { taskId: string; accountId: string }) =>
      claimChallengeTask(taskId, accountId),
    onSuccess: (data, vars) => {
      toast.success('Misi dimulai! Gas kerjakan, terus submit buktinya.');
      queryClient.invalidateQueries({ queryKey: ['reddit-army-challenge-tasks'] });
      if (data.assignmentId) {
        navigate(`/task/${vars.taskId}`);
      }
    },
    onError: (err: Error) => {
      toast.error(`Gagal mulai misi: ${err.message}`);
    },
  });

  const resignMut = useMutation({
    mutationFn: requestRedditArmyResignation,
    onSuccess: () => {
      toast.success('Pengajuan berhenti terkirim. Masa berhenti 30 hari dimulai hari ini. Tetep aktif minimal 20 hari ya!');
      setShowResignConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['reddit-army-profile'] });
    },
    onError: (err: Error) => {
      toast.error(`Gagal ajukan berhenti: ${err.message}`);
    },
  });

  const cancelResignMut = useMutation({
    mutationFn: cancelRedditArmyResignation,
    onSuccess: () => {
      toast.success('Berhenti dibatalkan. Selamat datang kembali ke Fase 2!');
      queryClient.invalidateQueries({ queryKey: ['reddit-army-profile'] });
    },
    onError: (err: Error) => {
      toast.error(`Gagal batal: ${err.message}`);
    },
  });

  // NOTE: Auto-sync handled by hourly cron (ra-sync-daily-activity).
  // No client-side sync needed — account is admin-issued (warmed).

  if (profileQuery.isLoading) {
    return (
      <Layout>
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => navigate(-1)} className="p-2 -ml-2 tap-shrink" aria-label="Kembali">
              <ArrowLeft size={22} />
            </button>
            <h1 className="text-xl font-bold">🎖️ Reddit Army</h1>
          </div>
          <Card><div className="animate-pulse h-40 bg-gray-200 rounded" /></Card>
        </div>
      </Layout>
    );
  }

  const profile = profileQuery.data?.profile;
  const status = profile?.program_status ?? 'not_started';

  return (
    <Layout>
      <div className="max-w-md mx-auto p-4 pb-bottomnav">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 tap-shrink" aria-label="Kembali">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-xl font-bold">🎖️ Reddit Army Program</h1>
          <button
            onClick={() => profileQuery.refetch()}
            className="ml-auto p-2 tap-shrink"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={profileQuery.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>

        {status === 'not_started' && (
          <InvitedState
            profile={profile}
            onActivate={(username) => activateMut.mutate(username)}
            activating={activateMut.isPending}
          />
        )}

        {status === 'phase1_active' && (
          <Phase1ActiveState
            profile={profile!}
            tasks={tasksQuery.data ?? []}
            claimingTaskId={claimMut.isPending ? claimMut.variables?.taskId : null}
            onClaim={(taskId) =>
              claimMut.mutate({ taskId, accountId: profile!.warmed_account_id! })
            }
            onTaskSubmitted={() => {
              queryClient.invalidateQueries({ queryKey: ['reddit-army-challenge-tasks'] });
              queryClient.invalidateQueries({ queryKey: ['reddit-army-profile'] });
            }}
          />
        )}

        {(status === 'phase1_complete' || status === 'phase2_active') && (
          <Phase2ActiveState
            profile={profile!}
            summary={profileQuery.data!}
            redditUsername={profileQuery.data?.redditUsername ?? null}
            onResign={() => setShowResignConfirm(true)}
          />
        )}

        {status === 'resigning' && (
          <ResigningState
            profile={profile!}
            summary={profileQuery.data!}
            redditUsername={profileQuery.data?.redditUsername ?? null}
            onCancel={() => cancelResignMut.mutate()}
            cancelling={cancelResignMut.isPending}
          />
        )}

        {status === 'resigned' && (
          <Card className="text-center">
            <Trophy size={48} className="mx-auto text-yellow-500 mb-3" />
            <h2 className="text-lg font-bold mb-2">Program Selesai</h2>
            <p className="text-sm text-gray-600 mb-4">
              Kamu udah berhenti dari Reddit Army dengan sopan. Semua tabungan retensi udah cair ke saldo kamu. Makasih sudah jadi bagian dari program! 🙏
            </p>
            <Button variant="outline" onClick={() => navigate('/earnings')} fullWidth>
              Lihat Saldo
            </Button>
          </Card>
        )}

        {status === 'expelled' && (
          <Card className="text-center">
            <AlertTriangle size={48} className="mx-auto text-danger mb-3" />
            <h2 className="text-lg font-bold mb-2">Program Dihentikan</h2>
            <p className="text-sm text-gray-600 mb-2">
              Kamu dikeluarkan dari program Reddit Army.
            </p>
            {profile?.expelled_reason && (
              <p className="text-sm text-gray-500 italic mb-4">"{profile.expelled_reason}"</p>
            )}
            <p className="text-xs text-gray-500">
              Tabungan retensi telah dihanguskan sesuai ketentuan. Hubungi admin kalau menurutmu ini kekeliruan.
            </p>
          </Card>
        )}

        {/* Resign confirmation modal */}
        {showResignConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
            <Card className="w-full max-w-md">
              <h3 className="text-lg font-bold mb-2">Mau berhenti?</h3>
              <p className="text-sm text-gray-600 mb-4">
                Kamu akan masuk masa berhenti <strong>30 hari</strong>. Selama itu:
              </p>
              <ul className="text-sm text-gray-600 space-y-1 mb-4 list-disc pl-5">
                <li>Tetap aktif minimal <strong>{MIN_ACTIVE_DAYS_FOR_RESIGN} hari</strong> selama 30 hari.</li>
                <li>Jangan ganti device / IP.</li>
                <li>Setelah 30 hari, semua tabungan retensi cair.</li>
                <li>Kalau ghosting, tabungan hangus.</li>
              </ul>
              <div className="flex gap-2">
                <Button variant="ghost" fullWidth onClick={() => setShowResignConfirm(false)}>
                  Batal
                </Button>
                <Button
                  variant="primary"
                  fullWidth
                  loading={resignMut.isPending}
                  onClick={() => resignMut.mutate()}
                >
                  Ya, Ajukan Berhenti
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------
// STATE 1: not_started — Invitation pending
// ---------------------------------------------------------------
function InvitedState({
  profile,
  onActivate,
  activating,
}: {
  profile: any;
  onActivate: (username?: string) => void;
  activating: boolean;
}) {
  const [username, setUsername] = useState('');

  // No profile at all → not invited
  if (!profile || profile.cohort === null) {
    return (
      <>
        <Card className="bg-gradient-to-br from-gray-100 to-gray-50 mb-4">
          <div className="text-center">
            <div className="text-4xl mb-2">🔒</div>
            <h2 className="text-lg font-bold mb-1">Akses Terkunci</h2>
            <p className="text-sm text-gray-600">
              Kamu belum diundang ke Reddit Army Program. Hubungi admin buat dapet undangan.
            </p>
          </div>
        </Card>
        <Card>
          <h3 className="font-bold mb-2">Tentang program ini</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li>🏆 Bonus Rp100K setelah selesai 5 level challenge</li>
            <li>💰 Bonus harian Rp2.500 selama aktif (≈Rp75K/bulan)</li>
            <li>🔒 Tabungan retensi yang cair saat pamit berhenti</li>
            <li>⏰ Challenge min 30 hari (warmup account — anti bot detection)</li>
          </ul>
        </Card>
      </>
    );
  }

  const isWarmed = profile.cohort === 'warmed_purchased';

  return (
    <>
      <Card className="bg-gradient-to-br from-primary/10 to-secondary/10 mb-4">
        <div className="text-center">
          <div className="text-4xl mb-2">🎖️</div>
          <h2 className="text-lg font-bold mb-1">Kamu Diundang!</h2>
          <p className="text-sm text-gray-600">
            {isWarmed
              ? 'Admin udah siapin akun Reddit warmed buat kamu. Tinggal aktivasi & gas!'
              : 'Kamu ikut program ini pakai akun Reddit kamu sendiri. Persiapkan dulu ya.'}
          </p>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="font-bold mb-2">Tipe partisipasi kamu:</h3>
        <div className={`p-3 rounded-lg mb-3 ${isWarmed ? 'bg-success/10' : 'bg-blue-50'}`}>
          <div className="font-semibold text-sm flex items-center gap-2">
            {isWarmed ? '✅ Warmed Account' : '🆕 Akun Baru'}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {isWarmed
              ? 'Akun Reddit udah matured & dikasih admin. Lihat detail via WA.'
              : 'Kamu daftar & rawat akun Reddit sendiri. Cocok buat long-term.'}
          </div>
        </div>

        {!isWarmed && (
          <label className="block">
            <span className="text-xs font-medium text-gray-600 mb-1 block">Username Reddit kamu</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="contoh: namasaya123"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Tanpa prefix u/ atau URL. Cuma username.
            </p>
          </label>
        )}
      </Card>

      <Card className="mb-4">
        <h3 className="font-bold mb-2 text-sm">Yang kamu bakal dapet:</h3>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Trophy size={16} className="text-yellow-500 mt-0.5 shrink-0" />
            <span>Bonus <strong>Rp100K</strong> setelah selesaiin 5 level (50% cair + 50% hold 30 hari)</span>
          </li>
          <li className="flex items-start gap-2">
            <Wallet size={16} className="text-success mt-0.5 shrink-0" />
            <span>Bonus harian <strong>Rp2.500</strong> selama aktif di Fase 2</span>
          </li>
          <li className="flex items-start gap-2">
            <Hourglass size={16} className="text-orange-500 mt-0.5 shrink-0" />
            <span>Minimal <strong>30 hari</strong> buat selesain challenge (warmup)</span>
          </li>
        </ul>
      </Card>

      <Card className="mb-4 bg-yellow-50 border border-yellow-200">
        <p className="text-xs text-yellow-800 leading-relaxed">
          ⚠️ <strong>Syarat main:</strong> 1 device & 1 IP. Jangan ganti selama program. Pamit H-30 kalau mau berhenti.
        </p>
      </Card>

      <Button
        fullWidth
        size="lg"
        loading={activating}
        disabled={!isWarmed && !username.trim()}
        onClick={() => onActivate(isWarmed ? undefined : username.trim())}
      >
        {isWarmed ? 'Aktivasi & Mulai Challenge →' : 'Daftar & Mulai Challenge →'}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------
// Proof Upload Sheet — submit challenge task with screenshot
// ---------------------------------------------------------------
function ProofUploadSheet({
  task,
  onClose,
  onSubmitted,
}: {
  task: any;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [proofImage, setProofImage] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [preview, setPreview] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const targetCount = task.target_count || 1;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProofImage(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!proofImage) {
      toast.error('Screenshot mode Incognito wajib diupload!');
      return;
    }
    setSubmitting(true);
    try {
      // Upload image to storage
      const { supabase } = await import('../lib/supabase');
      const ext = proofImage.name.split('.').pop() || 'png';
      const path = `challenge-proofs/${task.assignment_id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('task-proofs')
        .upload(path, proofImage, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('task-proofs').getPublicUrl(path);

      // Update assignment: status submitted + proof
      const { error: updErr } = await supabase
        .from('task_assignments')
        .update({
          status: 'submitted',
          proof_image_url: pub.publicUrl,
          proof_url: proofUrl.trim() || null,
          submitted_url: proofUrl.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.assignment_id);
      if (updErr) throw updErr;

      toast.success('Misi dikirim! Tunggu admin review ya 🙏');
      onSubmitted();
    } catch (e: any) {
      toast.error(`Gagal submit: ${e.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg">Submit Misi</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XCircle size={22} />
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
          <p className="font-semibold mb-1">📋 Yang harus dilakuin:</p>
          <p>Kerjakan <strong>{targetCount}x aktivitas</strong> sesuai misi, terus upload screenshot profile Reddit kamu yang nunjukin:</p>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            <li>Username Reddit kamu</li>
            <li>Karma terkini</li>
            <li>Aktivitas terbaru (komentar/post)</li>
          </ul>
        </div>

        {/* Proof Image Upload */}
        <label className="block mb-3">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">
            📸 Screenshot Profile Reddit (WAJIB)
          </span>
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-primary tap-shrink">
            <input
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
              id="proof-upload"
            />
            <label htmlFor="proof-upload" className="cursor-pointer block">
              {preview ? (
                <img src={preview} alt="Preview" className="max-h-40 mx-auto rounded-lg" />
              ) : (
                <>
                  <Camera size={32} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-xs text-gray-500">Klik untuk upload screenshot</p>
                </>
              )}
            </label>
          </div>
        </label>

        {/* Optional URL */}
        <label className="block mb-4">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">
            🔗 Link salah satu komentar/post kamu (opsional)
          </span>
          <input
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            placeholder="https://reddit.com/r/indonesia/comments/..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 tap-shrink"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={!proofImage || submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-primary disabled:opacity-50 tap-shrink"
          >
            {submitting ? 'Mengirim...' : 'Kirim Misi ✅'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Progress status — auto-detected by system cron (no manual sync).
// Admin-issued accounts are verified server-side; army just sees
// progress and waits for detection.
// ---------------------------------------------------------------
function ProgressStatus({ task }: { task: any }) {
  const tc = task.target_count ?? 1;
  const pc = task.progress_count ?? 0;
  const complete = pc >= tc;

  if (complete) {
    return (
      <span className="text-[11px] text-success font-semibold">
        ✅ Aktivitas terdeteksi ({pc}/{tc}) — kamu bisa selesaikan misi!
      </span>
    );
  }
  return (
    <span className="text-[11px] text-gray-500">
      🔄 Sistem otomatis cek aktivitas tiap jam. {pc}/{tc} terdeteksi — {tc - pc} lagi biar bisa submit.
    </span>
  );
}

// ---------------------------------------------------------------
// STATE 2: phase1_active — Warmup Challenge
// ---------------------------------------------------------------
function Phase1ActiveState({
  profile,
  tasks,
  claimingTaskId,
  onClaim,
  onTaskSubmitted,
}: {
  profile: any;
  tasks: any[];
  claimingTaskId: string | null;
  onClaim: (taskId: string) => void;
  onTaskSubmitted: () => void;
}) {
  const [submitTask, setSubmitTask] = useState<any | null>(null);
  const currentLevel = profile.current_challenge_level + 1;
  const approvedCount = tasks.filter((t) => t.assignment_status === 'approved').length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;
  const isLevelLocked = tasks[0]?.level_locked === true;
  const daysUntilUnlock = tasks[0]?.days_until_unlock ?? 0;
  const minDays = tasks[0]?.min_days_at_level ?? 0;

  return (
    <>
      <Card className="bg-gradient-to-br from-secondary/10 to-primary/10 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-3xl">🌱</div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Fase 1 — Warmup</div>
            <h2 className="text-lg font-bold">Level {currentLevel}</h2>
          </div>
        </div>
        <RedditAccountManager userId={profile.user_id} />

        {/* Reddit account badge — always visible */}
        {tasks[0]?.reddit_username && (
          <div className="mb-3 inline-flex items-center gap-2 bg-white/80 rounded-full px-3 py-1.5">
            <span className="text-xs text-gray-500">Akun Reddit:</span>
            <a
              href={`https://www.reddit.com/user/${tasks[0].reddit_username}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-bold text-primary hover:underline"
            >
              u/{tasks[0].reddit_username} ↗
            </a>
          </div>
        )}

        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Progress level</span>
            <span>{approvedCount}/{totalCount} task</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-secondary to-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2 text-xs text-gray-600">
          <Sparkles size={14} className="text-yellow-500" />
          <span>Bonus selesai Phase 1: <strong>Rp100K</strong> (50% langsung cair + 50% ditahan 30 hari)</span>
        </div>
      </Card>

      {/* Warmup time gate — show countdown when level still locked */}
      {isLevelLocked && (
        <Card className="mb-4 bg-gradient-to-br from-orange-50 to-yellow-50 border border-orange-200">
          <div className="flex items-center gap-3 mb-2">
            <Hourglass size={28} className="text-orange-500 shrink-0" />
            <div>
              <div className="font-bold text-sm text-orange-700">Warmup Period</div>
              <div className="text-xs text-gray-600">
                Level {currentLevel} baru bisa di-approve setelah <strong>{minDays} hari</strong> warmup
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-orange-600">{daysUntilUnlock}</div>
            <div className="text-xs text-gray-500">
              hari lagi sebelum task level ini bisa di-approve
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
            💡 Warmup dibutuhin biar akun keliatan natural &amp; ga kena shadowban Reddit. Sambil nunggu, army tetap bisa liat task di bawah tapi admin belum bisa approve.
          </p>
        </Card>
      )}

      <h3 className="font-bold mb-2 text-sm uppercase tracking-wide text-gray-600">
        Misi Level {currentLevel}
      </h3>

      {tasks.length === 0 ? (
        <Card className="text-center text-sm text-gray-500">
          Belum ada misi untuk level ini. Admin belum setting task challenge.
        </Card>
      ) : (
        <div className="space-y-3 mb-4">
          {tasks.map((task) => {
            const status = task.assignment_status;
            const canApproveVisually = !isLevelLocked;
            const pc = task.progress_count ?? 0;
            const tc = task.target_count ?? 1;
            const progressPct = Math.min(Math.round((pc / tc) * 100), 100);
            return (
              <Card key={task.task_id} padding="md">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    {status === 'approved' ? (
                      <CheckCircle2 size={20} className={canApproveVisually ? 'text-success' : 'text-gray-400'} />
                    ) : status === 'rejected' ? (
                      <XCircle size={20} className="text-danger" />
                    ) : status === 'submitted' ? (
                      <Clock size={20} className={canApproveVisually ? 'text-warning' : 'text-gray-400'} />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm">{task.title}</h4>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1">{task.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <Trophy size={12} className="text-yellow-500" />
                      <span>Reward level: {formatRupiah(task.reward_amount)} (locked)</span>
                    </div>

                    {/* Progress checklist — shown when claimed */}
                    {status === 'in_progress' && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-700">Checklist aktivitas</span>
                          <span className="text-primary font-bold">{pc}/{tc}</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
                          <div
                            className="h-full bg-gradient-to-r from-secondary to-primary transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from({ length: tc }).map((_, i) => (
                            <span
                              key={i}
                              className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                                i < pc
                                  ? 'bg-success/15 text-success'
                                  : 'bg-gray-200 text-gray-500'
                              }`}
                            >
                              {i < pc ? '✅' : '⬜'} #{i + 1}
                            </span>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-2">
                          💡 Kerjakan misi di Reddit, lalu cek di browser mode <b>Incognito / Private</b>. Pastikan komentarmu live (tidak shadowban), lalu screenshot sebagai bukti.
                        </p>
                      </div>
                    )}

                    <div className="mt-3">
                      {status === 'approved' ? (
                        <span className="text-xs text-success font-semibold">
                          {canApproveVisually ? '✓ Selesai' : '⏳ Selesai — menunggu warmup'}
                        </span>
                      ) : status === 'submitted' ? (
                        <span className="text-xs text-warning font-semibold">
                          {canApproveVisually ? '⏳ Menunggu approve admin' : '🔒 Submitted — antri warmup'}
                        </span>
                      ) : status === 'in_progress' ? (
                        <div className="flex flex-col gap-2">
                          <ProgressStatus task={task} />
                          {task.progress_complete ? (
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => setSubmitTask(task)}
                            >
                              Selesaikan Misi 📸
                            </Button>
                          ) : (
                            <span className="text-[11px] text-gray-400">
                              Upload screenshot incognito sebagai bukti (Anti-shadowban).
                            </span>
                          )}
                        </div>
                      ) : status === 'rejected' && task.can_retry ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onClaim(task.task_id)}
                          loading={claimingTaskId === task.task_id}
                        >
                          Coba Lagi
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => onClaim(task.task_id)}
                          loading={claimingTaskId === task.task_id}
                        >
                          Mulai Misi →
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="bg-blue-50 border border-blue-200">
        <p className="text-xs text-blue-700 leading-relaxed">
          💡 <strong>Tips:</strong> Kerjain task kapan aja, tapi admin baru bisa approve setelah warmup period selesai. Begitu approve + warmup cukup, kamu naik level &amp; dapat bonus locked!
        </p>
      </Card>

      {/* Proof upload modal */}
      {submitTask && (
        <ProofUploadSheet
          task={submitTask}
          onClose={() => setSubmitTask(null)}
          onSubmitted={() => {
            setSubmitTask(null);
            onTaskSubmitted();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------
// STATE 3: phase2_active — Active Income Dashboard
// ---------------------------------------------------------------
function Phase2ActiveState({
  summary,
  redditUsername,
  onResign,
}: {
  profile: any;
  summary: any;
  redditUsername: string | null;
  onResign: () => void;
}) {
  const todayActive = summary.todayActivity?.is_active_day;
  const todayCredited = summary.todayActivity?.bonus_credited;
  const recent = (summary.recentActivities ?? []).slice(0, 7);
  const streak = recent.filter((a: any) => a.active).length;

  // Total bonus bulan ini (dummy estimation: dari recent 30 hari)
  const monthBonus = (summary.recentActivities ?? [])
    .filter((a: any) => a.credited)
    .reduce((sum: number, a: any) => sum + a.amount, 0);

  return (
    <>
      {/* Hero status */}
      <Card className="bg-gradient-to-br from-primary to-secondary text-white mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">Fase 2 — Active Income</div>
            <h2 className="text-lg font-bold">🔥 Reddit Army Aktif</h2>
          </div>
          <Flame size={32} className="opacity-90" />
        </div>
        <RedditAccountManager userId={profile.user_id} />
        {redditUsername && (
          <div className="mb-3 inline-flex items-center gap-2 bg-white/20 rounded-full px-3 py-1.5">
            <span className="text-xs opacity-90">Akun Reddit:</span>
            <a
              href={`https://www.reddit.com/user/${redditUsername}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-bold hover:underline"
            >
              u/{redditUsername} ↗
            </a>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xl font-bold">{todayCredited ? '+Rp2.5K' : '—'}</div>
            <div className="text-xs opacity-80">Hari ini</div>
          </div>
          <div>
            <div className="text-xl font-bold">{streak} 🔥</div>
            <div className="text-xs opacity-80">Streak (7 hari)</div>
          </div>
          <div>
            <div className="text-xl font-bold">{formatRupiah(monthBonus)}</div>
            <div className="text-xs opacity-80">Bulan ini</div>
          </div>
        </div>
      </Card>

      {/* Mission today */}
      <Card className="mb-4">
        <h3 className="font-bold mb-2 text-sm uppercase tracking-wide text-gray-600">Mission Hari Ini</h3>
        {todayActive ? (
          <div className="flex items-center gap-3 p-3 bg-success/10 rounded-lg">
            <CheckCircle2 size={24} className="text-success shrink-0" />
            <div className="text-sm">
              <div className="font-semibold text-success">Misi kelar!</div>
              <div className="text-xs text-gray-600">
                {todayCredited ? '+Rp2.500 udah masuk (cair 2 minggu lagi)' : 'Aktif terdeteksi, tunggu credit'}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <div className="w-6 h-6 rounded-full border-2 border-gray-300 shrink-0" />
            <div className="text-sm flex-1">
              <div className="font-semibold">Belum aktif hari ini</div>
              <div className="text-xs text-gray-600">Bikin minimal 1 comment/post di Reddit buat dapet bonus</div>
            </div>
            <a href={REDDIT_URL} target="_blank" rel="noreferrer">
              <Button size="sm" variant="primary">Buka Reddit</Button>
            </a>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Sistem ngecek aktivitas tiap jam. Kadang butuh 1–2 jam setelah kamu comment biar ke-detect.
        </p>
      </Card>

      {/* Retention savings */}
      <Card className="mb-4 bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200">
        <div className="flex items-center gap-2 mb-2">
          <Lock size={18} className="text-yellow-600" />
          <h3 className="font-bold text-sm">💰 Tabungan Retensi</h3>
        </div>
        <div className="text-2xl font-bold text-yellow-700 mb-1">
          {formatRupiah(summary.retentionHeld)}
        </div>
        <p className="text-xs text-gray-600">
          Saldo ini <strong>di-lock</strong> & cuma cair saat kamu pamit berhenti (H-30 + aktif 20 hari). Kalau kabur/ghosting, hangus.
        </p>
        {summary.pendingCashable > 0 && (
          <div className="mt-3 pt-3 border-t border-yellow-200">
            <div className="flex justify-between text-xs">
              <span className="text-gray-600">Pending (cair Sabtu depan):</span>
              <span className="font-semibold">{formatRupiah(summary.pendingCashable)}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Recent activity */}
      <Card className="mb-4">
        <h3 className="font-bold mb-3 text-sm uppercase tracking-wide text-gray-600">Riwayat (7 hari)</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Belum ada riwayat. Mulai aktif hari ini!</p>
        ) : (
          <div className="space-y-2">
            {recent.map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm py-1">
                <div className="flex items-center gap-2">
                  {a.active ? (
                    <CheckCircle2 size={14} className="text-success" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />
                  )}
                  <span className="text-gray-700">{a.date}</span>
                </div>
                <span className={a.credited ? 'text-success font-semibold' : 'text-gray-400'}>
                  {a.credited ? `+${formatRupiah(a.amount)}` : '⏸️'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Button variant="ghost" fullWidth onClick={onResign}>
        Mau Berhenti? Lihat Syarat →
      </Button>
    </>
  );
}

// ---------------------------------------------------------------
// STATE 4: resigning
// ---------------------------------------------------------------
function ResigningState({
  profile,
  summary,
  redditUsername,
  onCancel,
  cancelling,
}: {
  profile: any;
  summary: any;
  redditUsername: string | null;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const daysRemaining = formatDaysRemaining(profile.resign_effective_at);
  const activeDays = profile.resign_active_days ?? 0;
  const meetsMinDays = activeDays >= MIN_ACTIVE_DAYS_FOR_RESIGN;

  return (
    <>
      <Card className="bg-gradient-to-br from-orange-50 to-yellow-50 border border-orange-200 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <Clock size={32} className="text-orange-500" />
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
            <h2 className="text-lg font-bold">Berhenti Diproses</h2>
          </div>
        </div>

        {redditUsername && (
          <div className="mb-3 inline-flex items-center gap-2 bg-white rounded-full px-3 py-1.5">
            <span className="text-xs text-gray-500">Akun Reddit:</span>
            <a
              href={`https://www.reddit.com/user/${redditUsername}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-bold text-primary hover:underline"
            >
              u/{redditUsername} ↗
            </a>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-white rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-orange-600">{daysRemaining}</div>
            <div className="text-xs text-gray-500">hari lagi</div>
          </div>
          <div className="bg-white rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${meetsMinDays ? 'text-success' : 'text-orange-600'}`}>
              {activeDays}/{MIN_ACTIVE_DAYS_FOR_RESIGN}
            </div>
            <div className="text-xs text-gray-500">hari aktif (min)</div>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          Effective: {profile.resign_effective_at
            ? new Date(profile.resign_effective_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
            : '-'}
        </p>
      </Card>

      <Card className="mb-4">
        <h3 className="font-bold mb-3 text-sm">Yang harus kamu lakuin:</h3>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span className={activeDays >= 1 ? 'text-success' : 'text-gray-400'}>
              {activeDays >= 1 ? '✓' : '○'}
            </span>
            <span>Tetap aktif tiap hari (minimal 1 comment/post)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className={meetsMinDays ? 'text-success' : 'text-gray-400'}>
              {meetsMinDays ? '✓' : '○'}
            </span>
            <span>Aktif minimal <strong>{MIN_ACTIVE_DAYS_FOR_RESIGN} hari</strong> dari 30 hari</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400">○</span>
            <span>Handover akun Reddit aman (jangan dihapus/ubah)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400">○</span>
            <span>Jangan ganti device / IP</span>
          </li>
        </ul>
      </Card>

      <Card className="mb-4 bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200">
        <div className="flex items-center gap-2 mb-2">
          <Wallet size={18} className="text-yellow-600" />
          <h3 className="font-bold text-sm">Yang bakal kamu dapat</h3>
        </div>
        <div className="text-2xl font-bold text-yellow-700">
          {formatRupiah(summary.retentionHeld)}
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Tabungan retensi cair penuh ke saldo kamu setelah 30 hari selesai & minimal aktif {MIN_ACTIVE_DAYS_FOR_RESIGN} hari.
        </p>
      </Card>

      <Button variant="ghost" fullWidth loading={cancelling} onClick={onCancel}>
        Batal Berhenti (Saya Mau Lanjut)
      </Button>
    </>
  );
}
