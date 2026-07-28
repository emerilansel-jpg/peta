import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Trophy, Flame, Lock, Sparkles, Clock,
  CheckCircle2, XCircle, AlertTriangle, Wallet, RefreshCw,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import {
  getRedditArmyProfile,
  joinRedditArmyProgram,
  listChallengeTasksForUser,
  claimChallengeTask,
  requestRedditArmyResignation,
  cancelRedditArmyResignation,
} from '../lib/api';
import { toast } from '../components/Toast';

const REDDIT_URL = 'https://www.reddit.com';
const MIN_ACTIVE_DAYS_FOR_RESIGN = 20;

function formatRupiah(n: number): string {
  return 'Rp' + (n || 0).toLocaleString('id-ID');
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

  const joinMut = useMutation({
    mutationFn: joinRedditArmyProgram,
    onSuccess: () => {
      toast.success('🎉 Selamat bergabung! Challenge Phase 1 udah aktif. Gas kerjain misi pertama!');
      queryClient.invalidateQueries({ queryKey: ['reddit-army-profile'] });
    },
    onError: (err: Error) => {
      toast.error(`Gagal gabung: ${err.message}`);
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
          <NotJoinedState onJoin={() => joinMut.mutate()} joining={joinMut.isPending} />
        )}

        {status === 'phase1_active' && (
          <Phase1ActiveState
            profile={profile!}
            tasks={tasksQuery.data ?? []}
            claimingTaskId={claimMut.isPending ? claimMut.variables?.taskId : null}
            onClaim={(taskId) =>
              claimMut.mutate({ taskId, accountId: profile!.warmed_account_id! })
            }
          />
        )}

        {(status === 'phase1_complete' || status === 'phase2_active') && (
          <Phase2ActiveState
            profile={profile!}
            summary={profileQuery.data!}
            onResign={() => setShowResignConfirm(true)}
          />
        )}

        {status === 'resigning' && (
          <ResigningState
            profile={profile!}
            summary={profileQuery.data!}
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
// STATE 1: not_started
// ---------------------------------------------------------------
function NotJoinedState({ onJoin, joining }: { onJoin: () => void; joining: boolean }) {
  return (
    <>
      <Card className="bg-gradient-to-br from-primary/10 to-secondary/10 mb-4">
        <div className="text-center">
          <div className="text-4xl mb-2">🎖️</div>
          <h2 className="text-lg font-bold mb-1">Reddit Army Program</h2>
          <p className="text-sm text-gray-600">
            Mau dapet passive income tiap hari cuma modal aktif di Reddit?
          </p>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="font-bold mb-3">Kamu akan dapat:</h3>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Trophy size={18} className="text-yellow-500 mt-0.5 shrink-0" />
            <span>Bonus <strong>Rp100K</strong> setelah selesaiin warmup challenge</span>
          </li>
          <li className="flex items-start gap-2">
            <Wallet size={18} className="text-success mt-0.5 shrink-0" />
            <span>Bonus harian <strong>Rp2.500</strong> selama aktif (≈Rp75K/bulan)</span>
          </li>
          <li className="flex items-start gap-2">
            <Lock size={18} className="text-secondary mt-0.5 shrink-0" />
            <span>Tabungan retensi yang cair saat kamu pamit berhenti</span>
          </li>
        </ul>
      </Card>

      <Card className="mb-4">
        <h3 className="font-bold mb-3">Syarat main:</h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li>📱 Pakai akun Reddit kamu sendiri (di link pas gabung)</li>
          <li>🔒 1 device & 1 IP (jangan ganti selama program)</li>
          <li>⏰ Pamit <strong>H-30</strong> kalau mau berhenti</li>
          <li>🔥 Tetap aktif minimal 20 hari selama masa berhenti</li>
        </ul>
      </Card>

      <Button fullWidth size="lg" loading={joining} onClick={onJoin}>
        Gabung Program →
      </Button>
    </>
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
}: {
  profile: any;
  tasks: any[];
  claimingTaskId: string | null;
  onClaim: (taskId: string) => void;
}) {
  const currentLevel = profile.current_challenge_level + 1;
  const approvedCount = tasks.filter((t) => t.assignment_status === 'approved').length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;

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
            return (
              <Card key={task.task_id} padding="md">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    {status === 'approved' ? (
                      <CheckCircle2 size={20} className="text-success" />
                    ) : status === 'rejected' ? (
                      <XCircle size={20} className="text-danger" />
                    ) : status === 'submitted' ? (
                      <Clock size={20} className="text-warning" />
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

                    <div className="mt-3">
                      {status === 'approved' ? (
                        <span className="text-xs text-success font-semibold">✓ Selesai</span>
                      ) : status === 'submitted' ? (
                        <span className="text-xs text-warning font-semibold">⏳ Menunggu approve admin</span>
                      ) : status === 'in_progress' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            // navigate to task detail — handled by parent
                            window.location.href = `/task/${task.task_id}`;
                          }}
                        >
                          Lanjutkan Misi →
                        </Button>
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
          💡 <strong>Tips:</strong> Setiap kali task challenge di-approve, sistem otomatis cek apakah level udah kelar.
          Kalau iya, kamu naik level & dapat bonus locked. Kalau semua level kelar, kamu dapat Rp100K & masuk Fase 2!
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------
// STATE 3: phase2_active — Active Income Dashboard
// ---------------------------------------------------------------
function Phase2ActiveState({
  summary,
  onResign,
}: {
  profile: any;
  summary: any;
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
  onCancel,
  cancelling,
}: {
  profile: any;
  summary: any;
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
