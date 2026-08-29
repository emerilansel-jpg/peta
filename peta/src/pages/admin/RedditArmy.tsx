import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trophy, Users, Target, RefreshCw, Lock, AlertTriangle,
  CheckCircle2, XCircle, Clock, Mail, ChevronDown, MessageCircle,
  ShieldCheck, Unlock,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import {
  getRedditArmyAdminStats,
  adminListRedditArmyMembers,
  adminListRedditArmyContacts,
  adminListRedditArmyTaskProgress,
  type ArmyTaskProgress,
  adminListBonusHolds,
  adminForfeitRedditArmyHolds,
  adminReleaseHold,
  adminListChallengeLevels,
  adminUpdateChallengeLevel,
  adminCreateChallengeTask,
  adminInviteRedditArmy,
  adminRevokeRedditArmyInvitation,
  adminTriggerDailySync,
  adminListDailyActivityLog,
  adminVerifyDailyActivity,
  listAvailableWarmedAccounts,
  type RedditArmyAdminStats,
  type RedditArmyProfile,
  type ChallengeLevel,
  type DailyActivityLogRow,
} from '../../lib/api';

type TabKey = 'invitations' | 'members' | 'challenges' | 'sync' | 'dailylog' | 'holds' | 'exit';

const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: 'invitations', label: 'Invitations', icon: Mail },
  { key: 'members', label: 'Members', icon: Users },
  { key: 'challenges', label: 'Challenges', icon: Target },
  { key: 'dailylog', label: 'Daily Log', icon: ShieldCheck },
  { key: 'sync', label: 'Daily Sync', icon: RefreshCw },
  { key: 'holds', label: 'Holds', icon: Lock },
  { key: 'exit', label: 'Exit', icon: AlertTriangle },
];

function formatRupiah(n: number): string {
  return 'Rp' + (n || 0).toLocaleString('id-ID');
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  not_started:    { label: 'Belum Mulai', cls: 'bg-gray-100 text-gray-600', icon: Clock },
  phase1_active:  { label: '🌱 Phase 1', cls: 'bg-blue-100 text-blue-700', icon: Target },
  phase1_complete:{ label: 'Phase 1 Done', cls: 'bg-purple-100 text-purple-700', icon: CheckCircle2 },
  phase2_active:  { label: '🔥 Phase 2', cls: 'bg-success/20 text-success', icon: Trophy },
  resigning:      { label: '⏳ Resigning', cls: 'bg-warning/20 text-warning', icon: Clock },
  resigned:       { label: '✓ Resigned', cls: 'bg-gray-100 text-gray-700', icon: CheckCircle2 },
  expelled:       { label: '❌ Expelled', cls: 'bg-danger/20 text-danger', icon: XCircle },
};

export function AdminRedditArmy() {
  const [tab, setTab] = useState<TabKey>('invitations');

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-4">
        <header className="mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            🎖️ Reddit Army
          </h1>
          <p className="text-sm text-gray-500 mt-1">Gamification system — challenge, daily bonus, retention hold.</p>
        </header>

        <StatsBar />

        {/* Tab nav */}
        <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap tap-shrink transition ${
                tab === key
                  ? 'bg-primary text-white shadow-md shadow-primary/30'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'invitations' && <InvitationsTab />}
        {tab === 'members' && <MembersTab />}
        {tab === 'challenges' && <ChallengesTab />}
        {tab === 'dailylog' && <DailyLogTab />}
        {tab === 'sync' && <SyncTab />}
        {tab === 'holds' && <HoldsTab />}
        {tab === 'exit' && <ExitTab />}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------
function StatsBar() {
  const { data, isLoading } = useQuery({
    queryKey: ['ra-admin-stats'],
    queryFn: getRedditArmyAdminStats,
    staleTime: 60_000,
  });

  if (isLoading || !data) return <CardSkeleton />;

  const s: RedditArmyAdminStats = data;
  return (
    <Card className="mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <Stat label="Total" value={s?.total_members ?? 0} />
        <Stat label="Phase 1" value={s?.phase1_active ?? 0} accent="text-blue-600" />
        <Stat label="Phase 2" value={s?.phase2_active ?? 0} accent="text-success" />
        <Stat label="Resigning" value={s?.resigning ?? 0} accent="text-warning" />
        <Stat label="Resigned" value={s?.resigned ?? 0} />
        <Stat label="Expelled" value={s?.expelled ?? 0} accent="text-danger" />
        <Stat label="Total Hold" value={formatRupiah(s?.total_hold ?? 0)} />
        <Stat label="Release Week" value={formatRupiah(s?.release_this_week ?? 0)} accent="text-orange-600" />
      </div>
    </Card>
  );
}

function Stat({ label, value, accent = 'text-gray-800' }: { label: string; value: any; accent?: string }) {
  return (
    <div className="p-2">
      <div className={`text-lg font-bold ${accent}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------
// INVITATIONS TAB — invite users, manage cohort
// ---------------------------------------------------------------
function InvitationsTab() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [cohort, setCohort] = useState<'new_self_register' | 'warmed_purchased'>('warmed_purchased');
  const [warmedAccountId, setWarmedAccountId] = useState('');
  const [editTarget, setEditTarget] = useState<RedditArmyProfile | null>(null);
  const [editCohort, setEditCohort] = useState<'new_self_register' | 'warmed_purchased'>('new_self_register');
  const [editWarmedAccountId, setEditWarmedAccountId] = useState('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['ra-admin-members'],
    queryFn: adminListRedditArmyMembers,
    staleTime: 30_000,
  });

  const { data: availableAccounts = [] } = useQuery({
    queryKey: ['availableWarmedAccounts'],
    queryFn: listAvailableWarmedAccounts,
    enabled: cohort === 'warmed_purchased' || (editTarget !== null && editCohort === 'warmed_purchased'),
  });

  const inviteMut = useMutation({
    mutationFn: () => adminInviteRedditArmy(userId.trim(), cohort, cohort === 'warmed_purchased' ? warmedAccountId || null : null),
    onSuccess: () => {
      toast.success(`User ${userId.trim().slice(0, 8)} diundang (${cohort === 'warmed_purchased' ? 'Warmed' : 'New'})`);
      setUserId('');
      setWarmedAccountId('');
      queryClient.invalidateQueries({ queryKey: ['ra-admin-members'] });
      queryClient.invalidateQueries({ queryKey: ['ra-admin-stats'] });
    },
    onError: (err: Error) => toast.error(`Gagal invite: ${err.message}`),
  });

  const revokeMut = useMutation({
    mutationFn: (uid: string) => adminRevokeRedditArmyInvitation(uid),
    onSuccess: () => {
      toast.success('Undangan dicabut');
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ['ra-admin-members'] });
      queryClient.invalidateQueries({ queryKey: ['ra-admin-stats'] });
    },
    onError: (err: Error) => toast.error(`Gagal revoke: ${err.message}`),
  });

  const editMut = useMutation({
    mutationFn: () => {
      if (!editTarget) return Promise.resolve({ ok: true, error: 'no target' });
      // Re-invite with new cohort + warmed account (admin_invite_reddit_army handles update if status='not_started')
      return adminInviteRedditArmy(editTarget.user_id, editCohort, editCohort === 'warmed_purchased' ? editWarmedAccountId || null : null);
    },
    onSuccess: (res) => {
      if (res?.ok) {
        toast.success('Undangan diupdate');
        setEditTarget(null);
        queryClient.invalidateQueries({ queryKey: ['ra-admin-members'] });
        queryClient.invalidateQueries({ queryKey: ['ra-admin-stats'] });
      }
    },
    onError: (err: Error) => toast.error(`Gagal update: ${err.message}`),
  });

  // Pending invitations = profile exists but program_status='not_started'
  const pendingInvites = members.filter((m) => m.program_status === 'not_started');

  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold mb-2">📨 Invite User Baru</h3>
        <p className="text-xs text-gray-500 mb-3">
          Pilih user & tentuin cohort. User bakal lihat undangan di halaman <code>/reddit-army</code>.
        </p>
        <div className="space-y-3">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User UUID (copy dari /admin/team)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 font-mono"
          />
          <div>
            <span className="text-xs font-medium text-gray-600 mb-1 block">Tipe partisipasi (cohort):</span>
            <div className="flex gap-2">
              <button
                onClick={() => setCohort('warmed_purchased')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
                  cohort === 'warmed_purchased'
                    ? 'border-success bg-success/10 text-success'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                ✅ Warmed Account
                <div className="text-[10px] text-gray-500 mt-0.5">Admin kasih akun matang</div>
              </button>
              <button
                onClick={() => setCohort('new_self_register')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
                  cohort === 'new_self_register'
                    ? 'border-blue-500 bg-blue-50 text-blue-600'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                🆕 Akun Baru
                <div className="text-[10px] text-gray-500 mt-0.5">Army daftar sendiri</div>
              </button>
            </div>
          </div>
          {cohort === 'warmed_purchased' && (
            <div>
              <span className="text-xs font-medium text-gray-600 mb-1 block">Pilih Akun Reddit Warmed:</span>
              <select
                value={warmedAccountId}
                onChange={(e) => setWarmedAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300"
              >
                <option value="">— Pilih akun —</option>
                {availableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    u/{a.username} · {a.karma.toLocaleString('id-ID')} karma · {a.account_age_days}d
                  </option>
                ))}
              </select>
              {availableAccounts.length === 0 && (
                <p className="text-[10px] text-warning mt-1">Tidak ada akun warmed tersedia. Tambah akun Reddit dulu di /admin/accounts.</p>
              )}
            </div>
          )}
          <Button
            fullWidth
            loading={inviteMut.isPending}
            disabled={!userId.trim() || (cohort === 'warmed_purchased' && !warmedAccountId)}
            onClick={() => inviteMut.mutate()}
          >
            Kirim Undangan
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold mb-3">⏳ Undangan Pending ({pendingInvites.length})</h3>
        {isLoading ? (
          <CardSkeleton />
        ) : pendingInvites.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Belum ada undangan pending.</p>
        ) : (
          <div className="space-y-2">
            {pendingInvites.map((m) => (
              <div key={m.id} className="border border-gray-200 rounded p-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{m.user_id.slice(0, 8)}…</div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] px-2 py-0.5 rounded ${
                        m.cohort === 'warmed_purchased'
                          ? 'bg-success/20 text-success'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {m.cohort === 'warmed_purchased' ? '✅ Warmed' : '🆕 New'}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        invited {m.invited_at ? new Date(m.invited_at).toLocaleDateString('id-ID') : '-'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => {
                      setEditTarget(m);
                      setEditCohort(m.cohort as any || 'new_self_register');
                      setEditWarmedAccountId(m.warmed_account_id || '');
                    }}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={revokeMut.isPending}
                      onClick={() => {
                        if (confirm('Cabut undangan ini?')) revokeMut.mutate(m.user_id);
                      }}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
                {/* Inline edit form */}
                {editTarget?.user_id === m.user_id && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2 border border-gray-200">
                    <p className="text-xs font-bold text-gray-700">Edit Undangan</p>
                    <div className="flex gap-2">
                      <button onClick={() => setEditCohort('warmed_purchased')} className={`px-2 py-1 rounded text-xs font-medium border ${editCohort === 'warmed_purchased' ? 'border-success bg-success/10 text-success' : 'border-gray-200'}`}>
                        ✅ Warmed
                      </button>
                      <button onClick={() => setEditCohort('new_self_register')} className={`px-2 py-1 rounded text-xs font-medium border ${editCohort === 'new_self_register' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200'}`}>
                        🆕 New
                      </button>
                    </div>
                    {editCohort === 'warmed_purchased' && (
                      <select value={editWarmedAccountId} onChange={(e) => setEditWarmedAccountId(e.target.value)} className="w-full px-2 py-1 text-xs rounded border border-gray-300">
                        <option value="">— Pilih akun —</option>
                        {availableAccounts
                          .filter((a) => a.id !== m.warmed_account_id) // exclude current assignment
                          .map((a) => (
                          <option key={a.id} value={a.id}>u/{a.username} · {a.karma} karma</option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => editMut.mutate()} loading={editMut.isPending} disabled={editCohort === 'warmed_purchased' && !editWarmedAccountId}>
                        Simpan
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditTarget(null)}>Batal</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// MEMBERS TAB
// ---------------------------------------------------------------
function MembersTab() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ra-admin-members'],
    queryFn: adminListRedditArmyMembers,
    staleTime: 60_000,
  });
  const members = data ?? [];

  // Contact info (name/email/WA) + task progress — fetched in parallel, merged per member.
  const { data: contacts = {} } = useQuery({
    queryKey: ['ra-admin-contacts', members.map((m) => m.user_id)],
    queryFn: () => adminListRedditArmyContacts(members.map((m) => m.user_id)),
    enabled: members.length > 0,
    staleTime: 60_000,
  });
  const { data: progress = [] } = useQuery({
    queryKey: ['ra-admin-task-progress'],
    queryFn: adminListRedditArmyTaskProgress,
    staleTime: 30_000,
  });
  // Index progress by user_id for O(1) lookup per row.
  const progressByUser: Record<string, ArmyTaskProgress[]> = {};
  for (const p of progress) {
    (progressByUser[p.user_id] ||= []).push(p);
  }

  if (isLoading) return <CardSkeleton />;

  const filtered = members.filter((m) => {
    if (statusFilter && m.program_status !== statusFilter) return false;
    const c = contacts[m.user_id];
    const q = search.toLowerCase();
    if (q && !m.user_id.includes(q)
      && !(c?.full_name || '').toLowerCase().includes(q)
      && !(c?.email || '').toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <Card>
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama / email / user ID..."
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-primary"
        >
          <option value="">Semua status</option>
          {Object.keys(STATUS_BADGE).map((k) => (
            <option key={k} value={k}>{STATUS_BADGE[k].label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Belum ada member.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((m: RedditArmyProfile) => {
            const badge = STATUS_BADGE[m.program_status] ?? STATUS_BADGE.not_started;
            const Icon = badge.icon;
            const c = contacts[m.user_id];
            const tasks = progressByUser[m.user_id] ?? [];
            const submitted = tasks.filter((t) => t.status === 'submitted').length;
            const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
            const approved = tasks.filter((t) => t.status === 'approved').length;
            const isOpen = expandedId === m.id;
            return (
              <div key={m.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(isOpen ? null : m.id)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-bold text-sm truncate">
                        {c?.full_name || <span className="font-mono text-gray-500">{m.user_id.slice(0, 8)}…</span>}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${badge.cls}`}>
                        <Icon size={10} /> Lv{m.current_challenge_level} · {badge.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                      {c?.email && <span className="truncate max-w-[180px]">{c.email}</span>}
                      {submitted > 0 && (
                        <span className="text-warning font-bold">⏳ {submitted} menunggu review</span>
                      )}
                      {inProgress > 0 && <span className="text-blue-600">{inProgress} on-going</span>}
                      {approved > 0 && <span className="text-success">{approved} selesai</span>}
                      {tasks.length === 0 && <span>belum ada task</span>}
                    </div>
                  </div>
                  <ChevronDown
                    size={18}
                    className={`text-gray-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 p-3 bg-gray-50/50 space-y-3">
                    {/* Follow-up contact */}
                    <div className="flex flex-wrap gap-2">
                      {c?.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-full hover:bg-primary/20"
                        >
                          <Mail size={12} /> {c.email}
                        </a>
                      )}
                      {c?.whatsapp && (
                        <a
                          href={`https://wa.me/${c.whatsapp.replace(/[^0-9]/g, '').replace(/^0/, '62')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-success bg-success/10 px-2.5 py-1 rounded-full hover:bg-success/20"
                        >
                          <MessageCircle size={12} /> WA {c.whatsapp}
                        </a>
                      )}
                      <span className="text-[11px] text-gray-400 self-center">
                        Bergabung {formatDate(m.phase1_started_at ?? m.created_at ?? null)}
                        {m.last_active_date && ` · Aktif terakhir ${formatDate(m.last_active_date)}`}
                      </span>
                    </div>

                    {/* Task progress detail */}
                    {tasks.length === 0 ? (
                      <p className="text-xs text-gray-400">Member belum klaim task challenge apa pun.</p>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wide font-bold text-gray-500">Progress task challenge</p>
                        {tasks.map((t, i) => {
                          const stCls =
                            t.status === 'approved' ? 'bg-success/15 text-success' :
                            t.status === 'submitted' ? 'bg-warning/15 text-warning' :
                            t.status === 'rejected' ? 'bg-danger/15 text-danger' :
                            t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600';
                          const ageLabel = t.updated_at ? `${formatDate(t.updated_at)}` : '-';
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs bg-white rounded-lg px-2.5 py-1.5 ring-1 ring-gray-100">
                              <span className={`shrink-0 px-1.5 py-0.5 rounded font-bold text-[10px] ${stCls}`}>
                                {t.status === 'in_progress' ? 'ON-GOING' : t.status.toUpperCase()}
                              </span>
                              <span className="text-gray-500 shrink-0">Lv{t.level_number}</span>
                              <span className="flex-1 truncate text-gray-700">{t.task_title}</span>
                              <span className="text-[10px] text-gray-400 shrink-0">{ageLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {m.notes && (
                      <p className="text-[11px] text-gray-500 bg-yellow-50 rounded-lg px-2.5 py-1.5">📝 {m.notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------
// CHALLENGES TAB
// ---------------------------------------------------------------
function ChallengesTab() {
  const queryClient = useQueryClient();
  const [editingLevel, setEditingLevel] = useState<ChallengeLevel | null>(null);
  const [showTaskSheet, setShowTaskSheet] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['ra-challenge-levels'],
    queryFn: adminListChallengeLevels,
    staleTime: 60_000,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      adminUpdateChallengeLevel(id, updates),
    onSuccess: () => {
      toast.success('Level diupdate');
      queryClient.invalidateQueries({ queryKey: ['ra-challenge-levels'] });
      setEditingLevel(null);
    },
    onError: (err: Error) => toast.error(`Gagal update: ${err.message}`),
  });

  if (isLoading) return <CardSkeleton />;

  const levels = data ?? [];

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">Level Challenge</h3>
          <Button size="sm" variant="outline" onClick={() => setShowTaskSheet(true)}>
            + Task Baru
          </Button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Edit reward & status level. Task per level dibuat via tombol di atas atau di <strong>/admin/tasks</strong> dengan category <code>reddit_challenge</code>.
        </p>

        <div className="space-y-2">
          {levels.map((lvl) => (
            <div key={lvl.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">Level {lvl.level_number}</span>
                    <span className="text-sm text-gray-600">{lvl.level_name}</span>
                    {!lvl.is_active && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{lvl.title}</p>
                  <div className="text-xs text-yellow-700 mt-1">
                    Reward: {formatRupiah(lvl.reward_amount)} {lvl.reward_amount === 0 && '(trigger phase1)'}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditingLevel(lvl)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {editingLevel && (
        <EditLevelModal
          level={editingLevel}
          onClose={() => setEditingLevel(null)}
          onSave={(updates) => updateMut.mutate({ id: editingLevel.id, updates })}
          saving={updateMut.isPending}
        />
      )}

      {showTaskSheet && (
        <CreateTaskSheet
          levels={levels}
          onClose={() => setShowTaskSheet(false)}
          onSaved={() => {
            setShowTaskSheet(false);
            toast.success('Task challenge dibuat');
          }}
        />
      )}
    </div>
  );
}

function EditLevelModal({
  level, onClose, onSave, saving,
}: {
  level: ChallengeLevel;
  onClose: () => void;
  onSave: (updates: any) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(level.level_name);
  const [title, setTitle] = useState(level.title);
  const [reward, setReward] = useState(level.reward_amount);
  const [isActive, setIsActive] = useState(level.is_active);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <h3 className="font-bold mb-3">Edit Level {level.level_number}</h3>
        <div className="space-y-3">
          <Field label="Nama level">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="Judul / deskripsi singkat">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </Field>
          <Field label="Reward (Rp)">
            <input
              type="number"
              value={reward}
              onChange={(e) => setReward(Number(e.target.value))}
              className="input"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Aktif
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" fullWidth onClick={onClose}>Batal</Button>
          <Button
            fullWidth
            loading={saving}
            onClick={() => onSave({ level_name: name, title, reward_amount: reward, is_active: isActive })}
          >
            Simpan
          </Button>
        </div>
        <style>{`.input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
          .input:focus { outline: none; border-color: var(--color-primary); }`}</style>
      </Card>
    </div>
  );
}

function CreateTaskSheet({
  levels, onClose, onSaved,
}: {
  levels: ChallengeLevel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [levelId, setLevelId] = useState(levels[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [reward, setReward] = useState(5000);
  const [brief, setBrief] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      adminCreateChallengeTask({
        levelId,
        title,
        targetUrl,
        rewardAmount: reward,
        brief,
      }),
    onSuccess: onSaved,
    onError: (err: Error) => toast.error(`Gagal buat task: ${err.message}`),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold mb-3">+ Task Challenge Baru</h3>
        <div className="space-y-3">
          <Field label="Level">
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)} className="input">
              {levels.map((l) => (
                <option key={l.id} value={l.id}>Level {l.level_number} — {l.level_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Judul task">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Comment di r/indonesia" />
          </Field>
          <Field label="Target URL (opsional)">
            <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className="input" placeholder="https://reddit.com/r/..." />
          </Field>
          <Field label="Reward task (Rp)">
            <input type="number" value={reward} onChange={(e) => setReward(Number(e.target.value))} className="input" />
          </Field>
          <Field label="Brief / instruksi">
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} className="input min-h-[80px]" placeholder="Tulis komen natural tentang..." />
          </Field>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" fullWidth onClick={onClose}>Batal</Button>
          <Button fullWidth loading={mut.isPending} disabled={!title || !levelId} onClick={() => mut.mutate()}>
            Buat Task
          </Button>
        </div>
        <style>{`.input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
          .input:focus { outline: none; border-color: var(--color-primary); }`}</style>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------
// DAILY LOG TAB — Phase 2 check-ins + spot-check verification.
// Check-ins are self-reported (honor system): admin reviews the
// optional screenshots here and marks them verified/suspicious.
// ---------------------------------------------------------------
function DailyLogTab() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(14);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ra-daily-log', days],
    queryFn: () => adminListDailyActivityLog(days),
    staleTime: 30_000,
  });

  const verifyMut = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => adminVerifyDailyActivity(id, ok),
    onSuccess: () => {
      toast.success('Spot-check tersimpan');
      queryClient.invalidateQueries({ queryKey: ['ra-daily-log'] });
    },
    onError: (err: Error) => toast.error(`Gagal: ${err.message}`),
  });

  const selfReported = rows.filter((r) => r.sync_source === 'self_report');

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-bold">🛡️ Daily Check-in Log</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {selfReported.length} check-in self-report dari {rows.length} baris ({days} hari terakhir).
            Spot-check screenshot acak — yang mencurigakan tandai merah lalu follow-up via WA.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-2 py-1.5 text-xs rounded-lg border border-gray-300"
        >
          <option value={7}>7 hari</option>
          <option value={14}>14 hari</option>
          <option value={30}>30 hari</option>
        </select>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          Belum ada aktivitas tercatat (baru ada setelah ada member Fase 2 yang check-in).
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: DailyActivityLogRow) => {
            const images = (r.proof_media ?? []).filter((p) => p.type === 'image');
            const isSelf = r.sync_source === 'self_report';
            return (
              <div key={r.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{r.users?.full_name || r.user_id.slice(0, 8) + '…'}</span>
                      {isSelf && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">SELF-REPORT</span>
                      )}
                      {r.verified_by_admin === true && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success font-bold">✓ VERIFIED</span>
                      )}
                      {r.verified_by_admin === false && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/20 text-danger font-bold">⚠ SUSPICIOUS</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {r.activity_date} · {r.comments_today} komentar · {r.posts_today} post
                      {r.bonus_credited ? ` · +Rp${(r.credited_amount || 0).toLocaleString('id-ID')}` : ''}
                    </p>
                    {r.note && <p className="text-xs text-gray-600 mt-1">📝 {r.note}</p>}
                  </div>
                  {isSelf && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={verifyMut.isPending && verifyMut.variables?.id === r.id && verifyMut.variables?.ok}
                        onClick={() => verifyMut.mutate({ id: r.id, ok: true })}
                        className="!border-success !text-success hover:!bg-success hover:!text-white"
                        title="Tandai OK"
                      >
                        <CheckCircle2 size={13} /> OK
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={verifyMut.isPending && verifyMut.variables?.id === r.id && !verifyMut.variables?.ok}
                        onClick={() => verifyMut.mutate({ id: r.id, ok: false })}
                        className="!border-danger !text-danger hover:!bg-danger hover:!text-white"
                        title="Tandai mencurigakan"
                      >
                        <XCircle size={13} /> Suspicious
                      </Button>
                    </div>
                  )}
                </div>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {images.map((p, i) => (
                      <a
                        key={i}
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-16 h-16 rounded-lg overflow-hidden ring-1 ring-border hover:ring-primary transition"
                        title={p.name || `Bukti ${i + 1}`}
                      >
                        <img src={p.url} alt={`Bukti ${i + 1}`} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------
// SYNC TAB
// ---------------------------------------------------------------
function SyncTab() {
  const [userId, setUserId] = useState('');
  const queryClient = useQueryClient();

  const syncMut = useMutation({
    mutationFn: () => adminTriggerDailySync(userId ? [userId] : []),
    onSuccess: (data) => {
      const errCount = data.errors?.length ?? 0;
      if (errCount > 0) {
        toast(`Sync selesai: ${data.synced ?? 0} user, ${errCount} error`);
      } else {
        toast.success(`Sync selesai: ${data.synced ?? 0} user, tanpa error`);
      }
      queryClient.invalidateQueries({ queryKey: ['ra-admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['ra-admin-members'] });
    },
    onError: (err: Error) => toast.error(`Gagal sync: ${err.message}`),
  });

  return (
    <Card>
      <h3 className="font-bold mb-2">Trigger Manual Sync</h3>
      <p className="text-xs text-gray-500 mb-4">
        Sync Reddit activity untuk 1 user (atau biarkan kosong = semua user phase2). Pakai edge function <code>sync-reddit-daily-activity</code>.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User UUID (kosongkan = semua)"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 font-mono"
        />
        <Button loading={syncMut.isPending} onClick={() => syncMut.mutate()}>
          Sync
        </Button>
      </div>
      <div className="text-xs text-gray-500">
        <p className="font-semibold mb-1">Scheduled cron jobs:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code>ra-release-phase1-hold</code> — tiap jam</li>
          <li><code>ra-biweekly-cashout</code> — Sabtu 09:00 WIB</li>
          <li><code>ra-resignation-process</code> — harian 09:00 WIB</li>
          <li><code>ra-flag-ghosting</code> — mingguan</li>
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------
// HOLDS TAB
// ---------------------------------------------------------------
function HoldsTab() {
  const [status, setStatus] = useState<'held' | 'released' | 'forfeited' | ''>('held');
  const [releaseTarget, setReleaseTarget] = useState<{ id: string; userId: string; amount: number; source: string } | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ra-holds', status],
    queryFn: () => adminListBonusHolds(status || undefined),
    staleTime: 30_000,
  });

  const releaseMut = useMutation({
    mutationFn: () =>
      adminReleaseHold(releaseTarget!.id, releaseReason),
    onSuccess: () => {
      toast.success(`Hold ${releaseTarget && formatRupiah(releaseTarget.amount)} dilepas & masuk saldo user.`);
      setReleaseTarget(null);
      setReleaseReason('');
      queryClient.invalidateQueries({ queryKey: ['ra-holds'] });
      queryClient.invalidateQueries({ queryKey: ['ra-admin-stats'] });
    },
    onError: (err: Error) => toast.error(`Gagal release: ${err.message}`),
  });

  const holds = data ?? [];
  const total = holds.reduce((s: number, h: any) => s + h.amount, 0);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">Bonus Holds</h3>
        <div className="flex gap-1">
          {(['held', 'released', 'forfeited', ''] as const).map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              className={`px-2 py-1 text-xs rounded ${status === s ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {s || 'Semua'}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 text-sm text-gray-600">
        Total {holds.length} hold — <strong>{formatRupiah(total)}</strong>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : holds.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Belum ada hold.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase border-b">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((h: any) => (
                <tr key={h.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3 font-mono text-xs">{h.user_id.slice(0, 8)}…</td>
                  <td className="py-2 pr-3 text-xs">{h.source}</td>
                  <td className="py-2 pr-3 font-semibold">{formatRupiah(h.amount)}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      h.status === 'held' ? 'bg-yellow-100 text-yellow-700'
                      : h.status === 'released' ? 'bg-success/20 text-success'
                      : 'bg-danger/20 text-danger'
                    }`}>{h.status}</span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-500">{formatDate(h.created_at)}</td>
                  <td className="py-2 pr-3 text-right">
                    {(h.status === 'held' || h.status === 'vesting') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReleaseReason('');
                          setReleaseTarget({ id: h.id, userId: h.user_id, amount: h.amount, source: h.source });
                        }}
                        title="Lepas hold manual — uang masuk saldo user"
                      >
                        <Unlock size={12} /> Release
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Release modal — the manual repair valve for stuck money. */}
      {releaseTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <h3 className="font-bold mb-1">🔓 Release Hold Manual</h3>
            <p className="text-sm text-gray-600 mb-3">
              Lepas <strong>{formatRupiah(releaseTarget.amount)}</strong> (source: <code>{releaseTarget.source}</code>)
              untuk user <code className="text-xs">{releaseTarget.userId.slice(0, 8)}…</code>. Uang langsung masuk saldo user dan
              hold berstatus released. Dipakai buat perbaikan kalau cron meleset / kasus khusus.
            </p>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Alasan (wajib, min 10 huruf):</p>
            <textarea
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              rows={3}
              placeholder="Contoh: member tamat resign tapi cron gagal jalan; sudah diverifikasi via WA."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20 mb-3"
            />
            <div className="flex gap-2">
              <Button variant="ghost" fullWidth onClick={() => setReleaseTarget(null)}>Batal</Button>
              <Button
                variant="primary"
                fullWidth
                loading={releaseMut.isPending}
                disabled={releaseReason.trim().length < 10 || releaseMut.isPending}
                onClick={() => releaseMut.mutate()}
              >
                🔓 Release Sekarang
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------
// EXIT TAB
// ---------------------------------------------------------------
function ExitTab() {
  const queryClient = useQueryClient();
  const [forfeitUser, setForfeitUser] = useState('');
  const [forfeitReason, setForfeitReason] = useState('');

  const { data } = useQuery({
    queryKey: ['ra-admin-members'],
    queryFn: adminListRedditArmyMembers,
    staleTime: 60_000,
  });

  const resigning = (data ?? []).filter((m) => m.program_status === 'resigning');
  const ghosting = (data ?? []).filter((m) =>
    m.program_status === 'phase2_active' && m.notes?.includes('GHOSTING REVIEW')
  );

  const forfeitMut = useMutation({
    mutationFn: () => adminForfeitRedditArmyHolds(forfeitUser, forfeitReason),
    onSuccess: () => {
      toast.success(`Hold dihanguskan — User ${forfeitUser.slice(0, 8)} expelled.`);
      setForfeitUser('');
      setForfeitReason('');
      queryClient.invalidateQueries({ queryKey: ['ra-admin-members'] });
      queryClient.invalidateQueries({ queryKey: ['ra-admin-stats'] });
    },
    onError: (err: Error) => toast.error(`Gagal forfeit: ${err.message}`),
  });

  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold mb-2">⏳ Resigning ({resigning.length})</h3>
        {resigning.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">Belum ada yang pengajuan berhenti.</p>
        ) : (
          <div className="space-y-2">
            {resigning.map((m) => {
              const daysLeft = Math.max(0, Math.ceil(
                (new Date(m.resign_effective_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              ));
              return (
                <div key={m.id} className="border border-gray-200 rounded p-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-mono text-xs">{m.user_id.slice(0, 8)}…</span>
                    <span className="text-xs text-gray-500">{daysLeft} hari lagi</span>
                  </div>
                  <div className="text-xs mt-1">
                    Aktif {m.resign_active_days}/20 hari —{' '}
                    {m.resign_active_days >= 20 ? <span className="text-success font-semibold">OK</span> : <span className="text-warning">kurang</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-bold mb-2 flex items-center gap-2 text-danger">
          <AlertTriangle size={16} /> Ghosting Review ({ghosting.length})
        </h3>
        {ghosting.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">Tidak ada.</p>
        ) : (
          <div className="space-y-2">
            {ghosting.map((m) => (
              <div key={m.id} className="border border-danger/30 rounded p-2 text-sm">
                <div className="font-mono text-xs">{m.user_id.slice(0, 8)}…</div>
                <div className="text-xs text-gray-500 mt-1">{m.notes}</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setForfeitUser(m.user_id)}
                >
                  Forfeit Hold
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-bold mb-2">🚫 Forfeit Manual</h3>
        <p className="text-xs text-gray-500 mb-3">
          Hapus SEMUA hold user (status held/vesting) & tandai expelled. Hanya untuk ghosting / akun suspended. Tidak bisa di-undo.
        </p>
        <div className="space-y-2">
          <input
            value={forfeitUser}
            onChange={(e) => setForfeitUser(e.target.value)}
            placeholder="User UUID"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 font-mono"
          />
          <input
            value={forfeitReason}
            onChange={(e) => setForfeitReason(e.target.value)}
            placeholder="Alasan (wajib, min 10 char)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300"
          />
          <Button
            variant="primary"
            fullWidth
            loading={forfeitMut.isPending}
            disabled={!forfeitUser || forfeitReason.length < 10}
            onClick={() => forfeitMut.mutate()}
          >
            Forfeit & Expel User
          </Button>
        </div>
      </Card>
    </div>
  );
}
