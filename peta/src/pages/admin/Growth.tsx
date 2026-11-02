import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, Users, UserPlus, Filter, Download, Search, CheckCircle2,
  Copy, Plus, RefreshCw, BarChart2, Eye, Check, X, Phone,
  ChevronRight, Layers, MessageSquare, Award
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import {
  getGrowthOverview, getUserActivityMonitoring, getRecruiterPerformance,
  getCampaigns, createCampaign, getInvitations, createInvitation,
  updateInvitation, getFollowupQueue, createFollowup, updateFollowup, getUserGrowthDetail,
  type InvitationRow
} from '../../lib/api';

type TabKey = 'overview' | 'campaigns' | 'invitations' | 'users' | 'followups' | 'reports';

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
};

function exportToCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escapeCsv = (val: any) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };
  const content = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\r\n');

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AdminGrowth() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Filters state
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedRecruiter, setSelectedRecruiter] = useState<string>('all');
  const [userSearch, setUserSearch] = useState('');
  const [userAcquisitionType, setUserAcquisitionType] = useState('all');
  const [userActivityStatus, setUserActivityStatus] = useState('all');
  const [userPage, setUserPage] = useState(0);

  // Invitation filters
  const [invStatus, setInvStatus] = useState('all');
  const [invSearch, setInvSearch] = useState('');

  // Modals state
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [selectedUserDetailId, setSelectedUserDetailId] = useState<string | null>(null);
  const [selectedInvitationDetail, setSelectedInvitationDetail] = useState<InvitationRow | null>(null);

  // Forms state
  const [campaignForm, setCampaignForm] = useState({
    code: '', name: '', description: '', audience: '', recruiterId: '',
    startDate: '', endDate: '', status: 'active' as const,
  });

  const [inviteForm, setInviteForm] = useState({
    fullName: '', email: '', phone: '', campaignId: '', recruiterId: '',
    channel: 'whatsapp', source: '', notes: '', expiresInDays: 30,
  });

  const [followupForm, setFollowupForm] = useState({
    userId: '', invitationId: '', assignedTo: '', category: 'not_started' as const,
    notes: '', nextFollowupAt: '',
  });

  // Calculate start/end date filters
  const dateFilters = useMemo(() => {
    if (dateRange === 'all') return {};
    const end = new Date();
    const start = new Date();
    if (dateRange === '7d') start.setDate(start.getDate() - 7);
    if (dateRange === '30d') start.setDate(start.getDate() - 30);
    if (dateRange === '90d') start.setDate(start.getDate() - 90);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }, [dateRange]);

  // Queries
  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery({
    queryKey: ['growthOverview', dateFilters, selectedCampaign, selectedRecruiter],
    queryFn: () => getGrowthOverview({
      ...dateFilters,
      campaignId: selectedCampaign !== 'all' ? selectedCampaign : undefined,
      recruiterId: selectedRecruiter !== 'all' ? selectedRecruiter : undefined,
    }),
  });

  const { data: campaigns = [], isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery({
    queryKey: ['growthCampaigns'],
    queryFn: getCampaigns,
  });

  const { data: recruiters = [], refetch: refetchRecruiters } = useQuery({
    queryKey: ['growthRecruiters'],
    queryFn: getRecruiterPerformance,
  });

  const { data: userMonitoring, isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ['growthUserMonitoring', userSearch, userAcquisitionType, userActivityStatus, selectedCampaign, selectedRecruiter, userPage],
    queryFn: () => getUserActivityMonitoring({
      search: userSearch,
      acquisitionType: userAcquisitionType !== 'all' ? userAcquisitionType : undefined,
      activityStatus: userActivityStatus !== 'all' ? userActivityStatus : undefined,
      campaignId: selectedCampaign !== 'all' ? selectedCampaign : undefined,
      recruiterId: selectedRecruiter !== 'all' ? selectedRecruiter : undefined,
      limit: 50,
      offset: userPage * 50,
    }),
    enabled: activeTab === 'users' || activeTab === 'reports',
  });

  const { data: invitationsData, isLoading: invLoading, refetch: refetchInvitations } = useQuery({
    queryKey: ['growthInvitations', selectedCampaign, selectedRecruiter, invStatus, invSearch],
    queryFn: () => getInvitations({
      campaignId: selectedCampaign !== 'all' ? selectedCampaign : undefined,
      recruiterId: selectedRecruiter !== 'all' ? selectedRecruiter : undefined,
      status: invStatus !== 'all' ? invStatus : undefined,
      search: invSearch,
    }),
    enabled: activeTab === 'invitations' || activeTab === 'reports',
  });

  const { data: followups = [], isLoading: followupsLoading, refetch: refetchFollowups } = useQuery({
    queryKey: ['growthFollowups'],
    queryFn: () => getFollowupQueue({}),
    enabled: activeTab === 'followups',
  });

  const { data: userDetail, isLoading: userDetailLoading } = useQuery({
    queryKey: ['growthUserDetail', selectedUserDetailId],
    queryFn: () => getUserGrowthDetail(selectedUserDetailId!),
    enabled: !!selectedUserDetailId,
  });

  // Mutations
  const createCampaignMutation = useMutation({
    mutationFn: () => createCampaign({
      campaignCode: campaignForm.code,
      campaignName: campaignForm.name,
      description: campaignForm.description,
      targetAudience: campaignForm.audience,
      assignedRecruiterId: campaignForm.recruiterId || undefined,
      startDate: campaignForm.startDate || undefined,
      endDate: campaignForm.endDate || undefined,
      status: campaignForm.status,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['growthCampaigns'] });
      toast.success('Campaign baru berhasil dibuat!');
      setShowCampaignModal(false);
      setCampaignForm({
        code: '', name: '', description: '', audience: '', recruiterId: '',
        startDate: '', endDate: '', status: 'active',
      });
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal membuat campaign'),
  });

  const createInviteMutation = useMutation({
    mutationFn: () => createInvitation({
      fullName: inviteForm.fullName,
      email: inviteForm.email || undefined,
      phone: inviteForm.phone || undefined,
      campaignId: inviteForm.campaignId || undefined,
      recruiterId: inviteForm.recruiterId || undefined,
      channel: inviteForm.channel,
      source: inviteForm.source || undefined,
      notes: inviteForm.notes || undefined,
      expiresInDays: Number(inviteForm.expiresInDays || 30),
    }),
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['growthInvitations'] });
      queryClient.invalidateQueries({ queryKey: ['growthOverview'] });
      toast.success(`Undangan berhasil dibuat! ID: ${inv.invitation_code}`);
      setShowInviteModal(false);
      setInviteForm({
        fullName: '', email: '', phone: '', campaignId: '', recruiterId: '',
        channel: 'whatsapp', source: '', notes: '', expiresInDays: 30,
      });
      setSelectedInvitationDetail(inv);
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal membuat invitation'),
  });

  const updateInviteStatusMutation = useMutation({
    mutationFn: ({ id, status, sentAt }: { id: string; status: any; sentAt?: string }) =>
      updateInvitation(id, { status, ...(sentAt ? { sent_at: sentAt } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['growthInvitations'] });
      queryClient.invalidateQueries({ queryKey: ['growthOverview'] });
      toast.success('Status undangan diperbarui!');
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal update status'),
  });

  const createFollowupMutation = useMutation({
    mutationFn: () => createFollowup({
      userId: followupForm.userId || undefined,
      invitationId: followupForm.invitationId || undefined,
      assignedTo: followupForm.assignedTo,
      category: followupForm.category,
      notes: followupForm.notes,
      nextFollowupAt: followupForm.nextFollowupAt || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['growthFollowups'] });
      toast.success('Follow-up berhasil ditugaskan!');
      setShowFollowupModal(false);
      setFollowupForm({
        userId: '', invitationId: '', assignedTo: '', category: 'not_started',
        notes: '', nextFollowupAt: '',
      });
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal menambahkan follow-up'),
  });

  const updateFollowupMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: any; notes?: string }) =>
      updateFollowup(id, {
        followup_status: status,
        ...(notes ? { notes } : {}),
        contacted_at: status === 'contacted' ? new Date().toISOString() : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['growthFollowups'] });
      toast.success('Status follow-up diperbarui!');
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal update follow-up'),
  });

  // Helpers
  const copyInviteLink = (token: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://penghasilantambahan.com';
    const link = `${origin}/register?ref=${token}`;
    navigator.clipboard.writeText(link);
    toast.success('Link undangan disalin ke clipboard!');
  };

  const openWhatsAppInvite = (inv: InvitationRow) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://penghasilantambahan.com';
    const link = `${origin}/register?ref=${inv.secure_token}`;
    const cleanPhone = (inv.phone || '').replace(/\D/g, '').replace(/^0/, '62');
    const msg = encodeURIComponent(
      `Halo ${inv.full_name}! 👋\n\nKamu diundang untuk bergabung dengan *PeTa (PenghasilanTambahan.com)* untuk menyelesaikan berbagai tugas berbayar (review, komentar, dll) dengan reward langsung cair ke saldo kamu.\n\nKlik tautan undangan khusus ini untuk mendaftar:\n${link}\n\nKode Undangan: ${inv.invitation_code}`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
  };

  // Status Badge Component
  const ActivityStatusBadge = ({ status }: { status: string }) => {
    switch (status) {
      case 'active':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">● Active</span>;
      case 'at_risk':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">▲ At Risk</span>;
      case 'inactive':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">■ Inactive</span>;
      case 'logged_in_no_task':
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">○ No Task</span>;
      default:
        return <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">◌ Not Started</span>;
    }
  };

  const AcquisitionBadge = ({ type }: { type: string }) => {
    switch (type) {
      case 'legacy':
        return <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-800">Legacy</span>;
      case 'invitation':
        return <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">Invitation</span>;
      default:
        return <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">Organic</span>;
    }
  };

  return (
    <Layout userRole="admin">
      <div className="max-w-7xl mx-auto pb-16">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="p-2 bg-primary/10 text-primary rounded-xl">
                <TrendingUp size={24} />
              </span>
              <h1 className="text-2xl font-black text-dark tracking-tight">Growth & User Performance</h1>
            </div>
            <p className="text-xs text-muted">
              Monitoring seluruh pengguna PeTa, performa recruitment Ghina & Admin, serta pipeline follow-up.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchOverview();
                refetchCampaigns();
                refetchRecruiters();
                refetchUsers();
                refetchInvitations();
                refetchFollowups();
              }}
              className="text-xs"
            >
              <RefreshCw size={14} className="mr-1.5" /> Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCampaignModal(true)}
              className="text-xs"
            >
              <Plus size={14} className="mr-1.5" /> Campaign Baru
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowInviteModal(true)}
              className="text-xs shadow-md"
            >
              <UserPlus size={14} className="mr-1.5" /> Buat Undangan
            </Button>
          </div>
        </div>

        {/* Global Filter Bar */}
        <Card className="mb-6 p-3 bg-white border border-border shadow-sm">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="font-bold text-dark flex items-center gap-1 text-muted">
              <Filter size={13} /> Filter:
            </span>

            {/* Date Range */}
            <div className="flex items-center gap-1 bg-light p-1 rounded-lg">
              {(['all', '7d', '30d', '90d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                    dateRange === r ? 'bg-white text-primary shadow-xs' : 'text-muted hover:text-dark'
                  }`}
                >
                  {r === 'all' ? 'Semua Waktu' : r === '7d' ? '7 Hari' : r === '30d' ? '30 Hari' : '90 Hari'}
                </button>
              ))}
            </div>

            {/* Campaign Filter */}
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="bg-light border border-border rounded-lg px-2.5 py-1 text-xs font-semibold text-dark focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="all">Semua Campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.campaign_code} - {c.campaign_name}
                </option>
              ))}
            </select>

            {/* Recruiter Filter */}
            <select
              value={selectedRecruiter}
              onChange={(e) => setSelectedRecruiter(e.target.value)}
              className="bg-light border border-border rounded-lg px-2.5 py-1 text-xs font-semibold text-dark focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="all">Semua Recruiter</option>
              {recruiters.map((r) => (
                <option key={r.recruiter_id} value={r.recruiter_id}>
                  {r.recruiter_name} ({r.role})
                </option>
              ))}
            </select>
          </div>
        </Card>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto pb-1 text-xs font-extrabold scrollbar-none">
          {[
            { key: 'overview', label: 'Overview', icon: BarChart2 },
            { key: 'campaigns', label: `Campaigns (${campaigns.length})`, icon: Layers },
            { key: 'invitations', label: `Invitations (${invitationsData?.total ?? 0})`, icon: UserPlus },
            { key: 'users', label: `User Monitoring (${userMonitoring?.total ?? overview?.users.total ?? 0})`, icon: Users },
            { key: 'followups', label: `Follow-up Queue (${followups.filter((f) => f.followup_status === 'pending').length})`, icon: MessageSquare },
            { key: 'reports', label: 'Recruitment & Cohorts', icon: Award },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
                  isActive
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-muted hover:text-dark hover:bg-light/60'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {overviewLoading ? (
              <CardSkeleton />
            ) : overview ? (
              <>
                {/* Global User Statistics Grid */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">
                    Global User Statistics (Seluruh 156+ Pengguna)
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <Card className="p-3.5 bg-white border border-border">
                      <p className="text-[11px] font-bold text-muted uppercase">Total Terdaftar</p>
                      <p className="text-2xl font-black text-dark mt-1">{overview.users.total}</p>
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted">
                        <span className="font-bold text-slate-700">{overview.users.legacy} Legacy</span> •
                        <span className="font-bold text-purple-700">{overview.users.invitation} Invited</span> •
                        <span className="font-bold text-emerald-700">{overview.users.organic} Organic</span>
                      </div>
                    </Card>

                    <Card className="p-3.5 bg-emerald-50/60 border border-emerald-200">
                      <p className="text-[11px] font-bold text-emerald-900 uppercase">Active Users</p>
                      <p className="text-2xl font-black text-emerald-700 mt-1">{overview.users.active}</p>
                      <p className="text-[10px] text-emerald-800/80 mt-2">Aktivitas task dlm 3 hari</p>
                    </Card>

                    <Card className="p-3.5 bg-amber-50/60 border border-amber-200">
                      <p className="text-[11px] font-bold text-amber-900 uppercase">At Risk</p>
                      <p className="text-2xl font-black text-amber-700 mt-1">{overview.users.at_risk}</p>
                      <p className="text-[10px] text-amber-800/80 mt-2">Idle 4 - 7 hari terakhir</p>
                    </Card>

                    <Card className="p-3.5 bg-rose-50/60 border border-rose-200">
                      <p className="text-[11px] font-bold text-rose-900 uppercase">Inactive</p>
                      <p className="text-2xl font-black text-rose-700 mt-1">{overview.users.inactive}</p>
                      <p className="text-[10px] text-rose-800/80 mt-2">Idle &gt; 7 hari / no task</p>
                    </Card>

                    <Card className="p-3.5 bg-slate-50 border border-slate-200">
                      <p className="text-[11px] font-bold text-slate-700 uppercase">Belum Submit Task</p>
                      <p className="text-2xl font-black text-slate-800 mt-1">{overview.users.never_submitted_task}</p>
                      <p className="text-[10px] text-slate-600 mt-2">Perlu dorongan onboarding</p>
                    </Card>
                  </div>
                </div>

                {/* Recruitment Statistics & Conversion Funnel */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Recruitment Stats */}
                  <Card className="p-4 bg-white border border-border lg:col-span-1">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3 flex items-center justify-between">
                      <span>Recruitment Stats</span>
                      <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                        Individual Tracking
                      </span>
                    </h3>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-1.5 border-b border-light text-xs">
                        <span className="text-muted">Undangan Dibuat</span>
                        <span className="font-extrabold text-dark">{overview.recruitment.created}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-light text-xs">
                        <span className="text-muted">Undangan Terkirim</span>
                        <span className="font-extrabold text-dark">{overview.recruitment.sent}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-light text-xs">
                        <span className="text-muted">Link Diklik</span>
                        <span className="font-extrabold text-primary">{overview.recruitment.clicked}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-light text-xs">
                        <span className="text-muted">Berhasil Mendaftar</span>
                        <span className="font-extrabold text-emerald-700">{overview.recruitment.registered}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-light text-xs">
                        <span className="text-muted">Mengerjakan Task Pertama</span>
                        <span className="font-extrabold text-emerald-700">{overview.recruitment.first_task}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1.5 text-xs">
                        <span className="text-muted">Member Aktif Saat Ini</span>
                        <span className="font-extrabold text-success">{overview.recruitment.active}</span>
                      </div>
                    </div>
                  </Card>

                  {/* Funnel Visualization */}
                  <Card className="p-4 bg-white border border-border lg:col-span-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">
                      Performance Funnel (Actual Data)
                    </h3>

                    <div className="space-y-3">
                      {overview.funnel.map((step, idx) => {
                        const topVal = overview.funnel[0]?.count || 1;
                        const pct = Math.round((step.count / Math.max(topVal, 1)) * 100);
                        return (
                          <div key={step.step} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-dark flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-light text-muted grid place-items-center text-[10px]">
                                  {idx + 1}
                                </span>
                                {step.step}
                              </span>
                              <span className="font-extrabold text-dark">
                                {step.count}{' '}
                                <span className="text-[10px] text-muted font-normal">
                                  ({topVal > 0 ? `${pct}%` : '0%'})
                                </span>
                              </span>
                            </div>
                            <div className="h-2 w-full bg-light rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-500"
                                style={{ width: `${topVal > 0 ? Math.max(pct, 2) : 0}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* TAB 2: CAMPAIGN MANAGEMENT */}
        {activeTab === 'campaigns' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-dark">Daftar Recruitment Campaign</h3>
                <p className="text-xs text-muted">Kelola inisiatif rekrutmen alumni, intern, dan database SF Group.</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setShowCampaignModal(true)} className="text-xs">
                <Plus size={14} className="mr-1" /> Buat Campaign Baru
              </Button>
            </div>

            {campaignsLoading ? (
              <CardSkeleton />
            ) : campaigns.length === 0 ? (
              <Card className="p-8 text-center text-muted">
                <Layers size={36} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-bold">Belum ada campaign</p>
                <p className="text-xs mt-1">Buat campaign pertama untuk mulai melacak rekrutmen.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {campaigns.map((c) => (
                  <Card key={c.id} className="p-4 border border-border hover:shadow-md transition-all">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                        {c.campaign_code}
                      </span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        c.status === 'active' ? 'bg-emerald-100 text-emerald-800' :
                        c.status === 'paused' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {c.status}
                      </span>
                    </div>

                    <h4 className="font-extrabold text-base text-dark leading-snug">{c.campaign_name}</h4>
                    {c.description && <p className="text-xs text-muted mt-1 line-clamp-2">{c.description}</p>}

                    <div className="mt-4 pt-3 border-t border-light space-y-1.5 text-[11px] text-muted">
                      <div className="flex justify-between">
                        <span>Target Audience:</span>
                        <span className="font-bold text-dark">{c.target_audience || 'Semua'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Assigned Recruiter:</span>
                        <span className="font-bold text-dark">{c.assigned_recruiter?.full_name || 'Admin'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Periode:</span>
                        <span className="font-bold text-dark">
                          {c.start_date ? formatDate(c.start_date) : '-'} s/d {c.end_date ? formatDate(c.end_date) : '-'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-light flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setInviteForm((prev) => ({ ...prev, campaignId: c.id, recruiterId: c.assigned_recruiter_id || '' }));
                          setShowInviteModal(true);
                        }}
                        className="!text-[11px] !py-1"
                      >
                        <UserPlus size={12} className="mr-1" /> Undangan Baru
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedCampaign(c.id);
                          setActiveTab('invitations');
                        }}
                        className="!text-[11px] !py-1"
                      >
                        Lihat Data →
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: INVITATION TRACKING */}
        {activeTab === 'invitations' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-dark">Individual Invitation Tracking</h3>
                <p className="text-xs text-muted">Setiap undangan memiliki Invitation ID unik dan token pelacakan aman.</p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const rows = (invitationsData?.data || []).map((i) => [
                      i.invitation_code, i.full_name, i.email || '', i.phone || '',
                      i.campaign?.campaign_name || '', i.recruiter?.full_name || '',
                      i.status, i.click_count, i.created_at, i.registered_at || '',
                    ]);
                    exportToCsv('invitations-peta.csv', [
                      'Invitation ID', 'Name', 'Email', 'Phone', 'Campaign', 'Recruiter', 'Status', 'Clicks', 'Created At', 'Registered At'
                    ], rows);
                  }}
                  className="text-xs"
                >
                  <Download size={13} className="mr-1.5" /> Export CSV
                </Button>
                <Button size="sm" variant="primary" onClick={() => setShowInviteModal(true)} className="text-xs">
                  <UserPlus size={13} className="mr-1.5" /> Buat Undangan
                </Button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <Card className="p-3 bg-white border border-border">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={14} className="absolute left-3 top-2.5 text-muted" />
                  <input
                    type="text"
                    placeholder="Cari ID undangan, nama, no HP..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="w-full bg-light pl-9 pr-3 py-1.5 rounded-lg text-xs border border-border focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>

                <div className="flex items-center gap-1 bg-light p-1 rounded-lg text-xs overflow-x-auto">
                  {(['all', 'created', 'sent', 'clicked', 'registered', 'first_task_submitted', 'active'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setInvStatus(s)}
                      className={`px-2.5 py-1 rounded-md font-bold whitespace-nowrap ${
                        invStatus === s ? 'bg-white text-primary shadow-xs' : 'text-muted hover:text-dark'
                      }`}
                    >
                      {s.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* Table */}
            {invLoading ? (
              <CardSkeleton />
            ) : !invitationsData || invitationsData.data.length === 0 ? (
              <Card className="p-8 text-center text-muted">
                <UserPlus size={36} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-bold">Tidak ada undangan yang cocok</p>
                <p className="text-xs mt-1">Coba sesuaikan kata kunci pencarian atau buat undangan baru.</p>
              </Card>
            ) : (
              <Card className="p-0 overflow-hidden border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-light/60 border-b border-border text-[11px] font-extrabold uppercase text-muted">
                      <tr>
                        <th className="py-3 px-4">Invitation ID</th>
                        <th className="py-3 px-4">Nama Calon</th>
                        <th className="py-3 px-4">Kontak</th>
                        <th className="py-3 px-4">Campaign</th>
                        <th className="py-3 px-4">Recruiter</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-center">Clicks</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invitationsData.data.map((inv) => (
                        <tr key={inv.id} className="hover:bg-light/30 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-primary">
                            {inv.invitation_code}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-dark block">{inv.full_name}</span>
                            <span className="text-[10px] text-muted">{formatDateTime(inv.created_at)}</span>
                          </td>
                          <td className="py-3 px-4">
                            {inv.phone && <span className="block text-dark font-medium">{inv.phone}</span>}
                            {inv.email && <span className="text-[10px] text-muted">{inv.email}</span>}
                          </td>
                          <td className="py-3 px-4 font-medium text-dark">
                            {inv.campaign?.campaign_name || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-dark">{inv.recruiter?.full_name || 'Admin'}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              inv.status === 'registered' || inv.status === 'first_task_submitted' || inv.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.status === 'clicked'
                                ? 'bg-blue-100 text-blue-800'
                                : inv.status === 'sent'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {inv.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-dark">
                            {inv.click_count}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1">
                            <button
                              onClick={() => copyInviteLink(inv.secure_token)}
                              className="p-1.5 rounded-md hover:bg-light text-muted hover:text-dark"
                              title="Salin link undangan"
                            >
                              <Copy size={13} />
                            </button>
                            {inv.phone && (
                              <button
                                onClick={() => {
                                  openWhatsAppInvite(inv);
                                  if (inv.status === 'created') {
                                    updateInviteStatusMutation.mutate({
                                      id: inv.id, status: 'sent', sentAt: new Date().toISOString()
                                    });
                                  }
                                }}
                                className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 hover:text-emerald-700"
                                title="Kirim link via WhatsApp"
                              >
                                <Phone size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => setSelectedInvitationDetail(inv)}
                              className="p-1.5 rounded-md hover:bg-light text-primary font-bold"
                              title="Detail undangan"
                            >
                              <Eye size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* TAB 4: GLOBAL USER ACTIVITY MONITORING */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-dark">Global User Activity Monitoring</h3>
                <p className="text-xs text-muted">
                  Memantau seluruh pengguna PeTa (Legacy 156+, Invitation, & Organic) secara konsisten.
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const rows = (userMonitoring?.users || []).map((u) => [
                    u.full_name, u.email, u.whatsapp || '', u.acquisition_type,
                    u.activity_status, u.tasks_7d, u.total_tasks_submitted, u.total_reward,
                    u.last_login_at || '', u.last_task_activity_at || '',
                  ]);
                  exportToCsv('peta-users-activity.csv', [
                    'Name', 'Email', 'WhatsApp', 'Acquisition', 'Activity Status', 'Tasks 7d', 'Total Tasks', 'Total Reward', 'Last Login', 'Last Task Activity'
                  ], rows);
                }}
                className="text-xs"
              >
                <Download size={13} className="mr-1.5" /> Export User CSV
              </Button>
            </div>

            {/* Filter Bar */}
            <Card className="p-3 bg-white border border-border">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={14} className="absolute left-3 top-2.5 text-muted" />
                  <input
                    type="text"
                    placeholder="Cari user (nama, email, WA, invitation ID)..."
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setUserPage(0); }}
                    className="w-full bg-light pl-9 pr-3 py-1.5 rounded-lg text-xs border border-border focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>

                {/* Acquisition Type Filter */}
                <select
                  value={userAcquisitionType}
                  onChange={(e) => { setUserAcquisitionType(e.target.value); setUserPage(0); }}
                  className="bg-light border border-border rounded-lg px-2.5 py-1.5 text-xs font-semibold text-dark outline-none"
                >
                  <option value="all">Semua Akuisisi</option>
                  <option value="legacy">Legacy Users (156)</option>
                  <option value="invitation">Invitation Users</option>
                  <option value="organic">Organic Users</option>
                </select>

                {/* Activity Status Filter */}
                <select
                  value={userActivityStatus}
                  onChange={(e) => { setUserActivityStatus(e.target.value); setUserPage(0); }}
                  className="bg-light border border-border rounded-lg px-2.5 py-1.5 text-xs font-semibold text-dark outline-none"
                >
                  <option value="all">Semua Status Aktivitas</option>
                  <option value="active">Active (Task &le; 3 hari)</option>
                  <option value="at_risk">At Risk (Idle 4-7 hari)</option>
                  <option value="inactive">Inactive (&gt; 7 hari)</option>
                  <option value="logged_in_no_task">Logged In - No Task</option>
                  <option value="not_started">Not Started</option>
                </select>
              </div>
            </Card>

            {/* User Activity Table */}
            {usersLoading ? (
              <CardSkeleton />
            ) : !userMonitoring || userMonitoring.users.length === 0 ? (
              <Card className="p-8 text-center text-muted">
                <Users size={36} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-bold">Tidak ada pengguna yang cocok</p>
              </Card>
            ) : (
              <Card className="p-0 overflow-hidden border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-light/60 border-b border-border text-[11px] font-extrabold uppercase text-muted">
                      <tr>
                        <th className="py-3 px-4">Nama</th>
                        <th className="py-3 px-4">Akuisisi</th>
                        <th className="py-3 px-4">Login Terakhir</th>
                        <th className="py-3 px-4 text-center">Task 7 Hari Terakhir</th>
                        <th className="py-3 px-4 text-center">Total Task Selesai</th>
                        <th className="py-3 px-4 text-right">Total Reward</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {userMonitoring.users.map((u) => (
                        <tr
                          key={u.id}
                          onClick={() => setSelectedUserDetailId(u.id)}
                          className="hover:bg-light/30 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-dark block">{u.full_name}</span>
                            <span className="text-[10px] text-muted">{u.email}</span>
                          </td>
                          <td className="py-3 px-4">
                            <AcquisitionBadge type={u.acquisition_type} />
                            {u.invitation_code && (
                              <span className="block text-[10px] font-mono text-muted mt-0.5">
                                {u.invitation_code}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-muted">
                            {formatDateTime(u.last_login_at)}
                          </td>
                          <td className="py-3 px-4 text-center font-extrabold text-dark">
                            {u.tasks_7d > 0 ? (
                              <span className="text-emerald-700 font-bold">{u.tasks_7d} task</span>
                            ) : (
                              <span className="text-muted">0</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-dark">
                            {u.total_tasks_submitted}
                            <span className="text-[10px] text-muted block">
                              ({u.total_approved} app / {u.total_rejected} rej)
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-extrabold text-primary money">
                            Rp{u.total_reward.toLocaleString('id-ID')}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <ActivityStatusBadge status={u.activity_status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button size="sm" variant="outline" className="!text-[11px] !py-1">
                              Lihat <ChevronRight size={12} className="ml-0.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted">
                  <span>
                    Menampilkan {userPage * 50 + 1} - {Math.min((userPage + 1) * 50, userMonitoring.total)} dari {userMonitoring.total} user
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={userPage === 0}
                      onClick={() => setUserPage((p) => Math.max(0, p - 1))}
                      className="!text-xs"
                    >
                      Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(userPage + 1) * 50 >= userMonitoring.total}
                      onClick={() => setUserPage((p) => p + 1)}
                      className="!text-xs"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* TAB 5: FOLLOW-UP QUEUE */}
        {activeTab === 'followups' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-dark">Follow-up Queue (Ghina & Admin)</h3>
                <p className="text-xs text-muted">Daftar pengguna yang memerlukan dorongan aktivasi, retensi, atau follow-up berkala.</p>
              </div>

              <Button size="sm" variant="primary" onClick={() => setShowFollowupModal(true)} className="text-xs">
                <Plus size={13} className="mr-1.5" /> Tugas Follow-up Baru
              </Button>
            </div>

            {followupsLoading ? (
              <CardSkeleton />
            ) : followups.length === 0 ? (
              <Card className="p-8 text-center text-muted">
                <CheckCircle2 size={36} className="mx-auto mb-2 text-emerald-500 opacity-60" />
                <p className="text-sm font-bold text-dark">Antrean Follow-up Bersih!</p>
                <p className="text-xs mt-1">Belum ada tugas follow-up pending. Semua pengguna terpantau aktif.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {followups.map((f) => (
                  <Card key={f.id} className="p-4 border border-border">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-extrabold text-sm text-dark">
                            {f.user?.full_name || f.invitation?.full_name || 'User'}
                          </span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            f.category === 'not_started' ? 'bg-slate-100 text-slate-800' :
                            f.category === 'at_risk' ? 'bg-amber-100 text-amber-800' :
                            f.category === 'inactive' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {f.category.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-muted">
                          Assigned to: <strong className="text-dark">{f.assignee?.full_name || 'Admin'}</strong> •
                          Kontak: <strong className="text-dark">{f.user?.whatsapp || f.invitation?.phone || '-'}</strong>
                        </p>
                        {f.notes && (
                          <div className="mt-2 text-xs bg-light p-2 rounded-lg text-dark">
                            💡 {f.notes}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {(f.user?.whatsapp || f.invitation?.phone) && (
                          <a
                            href={`https://wa.me/${(f.user?.whatsapp || f.invitation?.phone || '').replace(/\D/g, '').replace(/^0/, '62')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm tap-shrink"
                          >
                            <Phone size={12} /> Hubungi WA
                          </a>
                        )}

                        {f.followup_status !== 'contacted' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateFollowupMutation.mutate({ id: f.id, status: 'contacted' })}
                            className="!text-xs"
                          >
                            Tandai Sudah Kontak
                          </Button>
                        )}

                        {f.followup_status !== 'resolved' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updateFollowupMutation.mutate({ id: f.id, status: 'resolved' })}
                            className="!text-xs"
                          >
                            <Check size={12} className="mr-1" /> Selesai
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: RECRUITMENT REPORTS & COHORTS */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            {/* Recruiter Performance Table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-dark">Performa Recruiter (Ghina & Tim Admin)</h3>
                  <p className="text-xs text-muted">Transparansi hasil rekrutmen: rasio registrasi, aktivasi task pertama, dan retensi aktif.</p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const rows = recruiters.map((r) => [
                      r.recruiter_name, r.role, r.invitations_created, r.invitations_sent,
                      r.link_clicks, r.registrations, r.first_task_submissions, r.active_users,
                      r.reg_conversion_rate ? `${r.reg_conversion_rate}%` : 'N/A',
                      r.activation_rate ? `${r.activation_rate}%` : 'N/A',
                      r.active_user_rate ? `${r.active_user_rate}%` : 'N/A',
                    ]);
                    exportToCsv('recruiter-performance.csv', [
                      'Recruiter', 'Role', 'Created', 'Sent', 'Clicks', 'Registrations', 'First Task', 'Active', 'Reg %', 'Activation %', 'Active %'
                    ], rows);
                  }}
                  className="text-xs"
                >
                  <Download size={13} className="mr-1.5" /> Export Recruiter CSV
                </Button>
              </div>

              <Card className="p-0 overflow-hidden border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-light/60 border-b border-border text-[11px] font-extrabold uppercase text-muted">
                      <tr>
                        <th className="py-3 px-4">Recruiter</th>
                        <th className="py-3 px-4 text-center">Undangan Dibuat</th>
                        <th className="py-3 px-4 text-center">Terkirim</th>
                        <th className="py-3 px-4 text-center">Klik Link</th>
                        <th className="py-3 px-4 text-center">Registrasi</th>
                        <th className="py-3 px-4 text-center">Task 1 Selesai</th>
                        <th className="py-3 px-4 text-center">Active Now</th>
                        <th className="py-3 px-4 text-center">Reg %</th>
                        <th className="py-3 px-4 text-center">Aktivasi %</th>
                        <th className="py-3 px-4 text-center">Retention %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {recruiters.map((r) => (
                        <tr key={r.recruiter_id} className="hover:bg-light/30">
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-dark block">{r.recruiter_name}</span>
                            <span className="text-[10px] text-muted">{r.email} ({r.role})</span>
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-dark">{r.invitations_created}</td>
                          <td className="py-3 px-4 text-center font-bold text-dark">{r.invitations_sent}</td>
                          <td className="py-3 px-4 text-center font-bold text-primary">{r.link_clicks}</td>
                          <td className="py-3 px-4 text-center font-extrabold text-emerald-700">{r.registrations}</td>
                          <td className="py-3 px-4 text-center font-bold text-dark">{r.first_task_submissions}</td>
                          <td className="py-3 px-4 text-center font-extrabold text-success">{r.active_users}</td>
                          <td className="py-3 px-4 text-center font-bold">
                            {r.reg_conversion_rate !== null ? `${r.reg_conversion_rate}%` : 'N/A'}
                          </td>
                          <td className="py-3 px-4 text-center font-bold">
                            {r.activation_rate !== null ? `${r.activation_rate}%` : 'N/A'}
                          </td>
                          <td className="py-3 px-4 text-center font-bold">
                            {r.active_user_rate !== null ? `${r.active_user_rate}%` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Cohort Comparison */}
            <div>
              <h3 className="text-sm font-extrabold text-dark mb-1">Analisis Kohort Akuisisi</h3>
              <p className="text-xs text-muted mb-3">
                Perbandingan performa antara pengguna lama (Legacy 156+) dengan rekrutmen baru.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                    Legacy Cohort (156)
                  </span>
                  <h4 className="font-extrabold text-base text-dark mt-2">Member Eksisting</h4>
                  <p className="text-xs text-muted mt-1">Terdaftar sebelum sistem invitation diaktifkan.</p>
                  <div className="mt-4 pt-3 border-t border-slate-200 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted">Total:</span>
                      <strong className="text-dark">{overview?.users.legacy ?? 156}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Aktivitas Terjaga:</span>
                      <strong className="text-emerald-700">{overview?.users.active ?? 0} aktif</strong>
                    </div>
                  </div>
                </Card>

                <Card className="p-4 bg-purple-50 border border-purple-200">
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-purple-200 text-purple-900">
                    Invitation Cohort
                  </span>
                  <h4 className="font-extrabold text-base text-purple-950 mt-2">Hasil Rekrutmen</h4>
                  <p className="text-xs text-purple-800/80 mt-1">Direkrut secara personal oleh Ghina & Admin.</p>
                  <div className="mt-4 pt-3 border-t border-purple-200 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted">Total Mendaftar:</span>
                      <strong className="text-purple-950">{overview?.users.invitation ?? 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Aktivasi Task:</span>
                      <strong className="text-emerald-700">{overview?.recruitment.first_task ?? 0}</strong>
                    </div>
                  </div>
                </Card>

                <Card className="p-4 bg-emerald-50 border border-emerald-200">
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-emerald-200 text-emerald-900">
                    Organic Cohort
                  </span>
                  <h4 className="font-extrabold text-base text-emerald-950 mt-2">Pendaftaran Publik</h4>
                  <p className="text-xs text-emerald-800/80 mt-1">Mendaftar mandiri via Google / medsos / web.</p>
                  <div className="mt-4 pt-3 border-t border-emerald-200 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted">Total Mendaftar:</span>
                      <strong className="text-emerald-950">{overview?.users.organic ?? 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Aktivitas:</span>
                      <strong className="text-emerald-700">Terpantau real-time</strong>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: CREATE CAMPAIGN */}
        {showCampaignModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-light mb-4">
                <h3 className="font-extrabold text-base text-dark">Buat Recruitment Campaign Baru</h3>
                <button onClick={() => setShowCampaignModal(false)} className="text-muted hover:text-dark">
                  <X size={18} />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!campaignForm.code || !campaignForm.name) {
                    toast.error('Kode dan Nama Campaign wajib diisi');
                    return;
                  }
                  createCampaignMutation.mutate();
                }}
                className="space-y-3.5 text-xs"
              >
                <div>
                  <label className="block font-bold text-dark mb-1">Kode Campaign (Unik)</label>
                  <input
                    type="text"
                    placeholder="Contoh: CAM-2026-001"
                    value={campaignForm.code}
                    onChange={(e) => setCampaignForm({ ...campaignForm, code: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block font-bold text-dark mb-1">Nama Campaign</label>
                  <input
                    type="text"
                    placeholder="Contoh: SF Intern Recruitment November 2026"
                    value={campaignForm.name}
                    onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block font-bold text-dark mb-1">Target Audience</label>
                  <input
                    type="text"
                    placeholder="Contoh: Eks Intern SF Group / Alumni"
                    value={campaignForm.audience}
                    onChange={(e) => setCampaignForm({ ...campaignForm, audience: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block font-bold text-dark mb-1">Assigned Recruiter</label>
                  <select
                    value={campaignForm.recruiterId}
                    onChange={(e) => setCampaignForm({ ...campaignForm, recruiterId: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                  >
                    <option value="">Pilih Recruiter (Default: Admin)</option>
                    {recruiters.map((r) => (
                      <option key={r.recruiter_id} value={r.recruiter_id}>
                        {r.recruiter_name} ({r.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-dark mb-1">Tanggal Mulai</label>
                    <input
                      type="date"
                      value={campaignForm.startDate}
                      onChange={(e) => setCampaignForm({ ...campaignForm, startDate: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-dark mb-1">Tanggal Selesai</label>
                    <input
                      type="date"
                      value={campaignForm.endDate}
                      onChange={(e) => setCampaignForm({ ...campaignForm, endDate: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-dark mb-1">Deskripsi & Catatan</label>
                  <textarea
                    rows={2}
                    placeholder="Tujuan rekrutmen dan sasaran jumlah member..."
                    value={campaignForm.description}
                    onChange={(e) => setCampaignForm({ ...campaignForm, description: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="pt-3 border-t border-light flex justify-end gap-2">
                  <Button variant="outline" size="sm" type="button" onClick={() => setShowCampaignModal(false)}>
                    Batal
                  </Button>
                  <Button variant="primary" size="sm" type="submit" loading={createCampaignMutation.isPending}>
                    Simpan Campaign
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: CREATE INVITATION */}
        {showInviteModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-light mb-4">
                <div>
                  <h3 className="font-extrabold text-base text-dark">Buat Undangan Rekrutmen Baru</h3>
                  <p className="text-xs text-muted">Akan di-generate token unik &amp; Invitation ID otomatis.</p>
                </div>
                <button onClick={() => setShowInviteModal(false)} className="text-muted hover:text-dark">
                  <X size={18} />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!inviteForm.fullName.trim()) {
                    toast.error('Nama lengkap calon member wajib diisi');
                    return;
                  }
                  createInviteMutation.mutate();
                }}
                className="space-y-3.5 text-xs"
              >
                <div>
                  <label className="block font-bold text-dark mb-1">Nama Lengkap Calon Member *</label>
                  <input
                    type="text"
                    placeholder="Contoh: Fulan Al-Batawi"
                    value={inviteForm.fullName}
                    onChange={(e) => setInviteForm({ ...inviteForm, fullName: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-dark mb-1">No. WhatsApp</label>
                    <input
                      type="text"
                      placeholder="0812xxxx / 62812xxxx"
                      value={inviteForm.phone}
                      onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-dark mb-1">Email (Opsional)</label>
                    <input
                      type="email"
                      placeholder="fulan@example.com"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-dark mb-1">Campaign</label>
                    <select
                      value={inviteForm.campaignId}
                      onChange={(e) => setInviteForm({ ...inviteForm, campaignId: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                    >
                      <option value="">Pilih Campaign</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.campaign_code} - {c.campaign_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-dark mb-1">Recruiter Attribution</label>
                    <select
                      value={inviteForm.recruiterId}
                      onChange={(e) => setInviteForm({ ...inviteForm, recruiterId: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                    >
                      <option value="">Pilih Recruiter (Ghina / Admin)</option>
                      {recruiters.map((r) => (
                        <option key={r.recruiter_id} value={r.recruiter_id}>
                          {r.recruiter_name} ({r.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-dark mb-1">Channel Undangan</label>
                    <select
                      value={inviteForm.channel}
                      onChange={(e) => setInviteForm({ ...inviteForm, channel: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email</option>
                      <option value="telegram">Telegram</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="direct">Direct</option>
                      <option value="other">Lainnya</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-dark mb-1">Target / Sumber Database</label>
                    <input
                      type="text"
                      placeholder="Contoh: Database Pelamar Graphic Designer"
                      value={inviteForm.source}
                      onChange={(e) => setInviteForm({ ...inviteForm, source: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-dark mb-1">Internal Notes</label>
                  <textarea
                    rows={2}
                    placeholder="Catatan tambahan untuk tim recruitment..."
                    value={inviteForm.notes}
                    onChange={(e) => setInviteForm({ ...inviteForm, notes: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="pt-3 border-t border-light flex justify-end gap-2">
                  <Button variant="outline" size="sm" type="button" onClick={() => setShowInviteModal(false)}>
                    Batal
                  </Button>
                  <Button variant="primary" size="sm" type="submit" loading={createInviteMutation.isPending}>
                    Generate Undangan
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: DETAIL INVITATION */}
        {selectedInvitationDetail && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-light mb-4">
                <div>
                  <span className="text-[10px] font-mono font-bold text-primary block">
                    {selectedInvitationDetail.invitation_code}
                  </span>
                  <h3 className="font-extrabold text-base text-dark">{selectedInvitationDetail.full_name}</h3>
                </div>
                <button onClick={() => setSelectedInvitationDetail(null)} className="text-muted hover:text-dark">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* Link Box */}
                <div className="bg-light p-3 rounded-2xl border border-border">
                  <p className="text-[10px] font-bold uppercase text-muted mb-1">Secure Invitation Link</p>
                  <div className="flex items-center justify-between gap-2 bg-white p-2 rounded-xl border border-border font-mono text-[11px] text-dark break-all">
                    <span>
                      {typeof window !== 'undefined' ? window.location.origin : 'https://penghasilantambahan.com'}/register?ref={selectedInvitationDetail.secure_token}
                    </span>
                    <button
                      onClick={() => copyInviteLink(selectedInvitationDetail.secure_token)}
                      className="p-1.5 hover:bg-light rounded-lg text-primary font-bold shrink-0"
                      title="Salin"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-light/50 p-3 rounded-xl border border-border">
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Status</span>
                    <span className="font-extrabold text-dark uppercase">{selectedInvitationDetail.status}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Total Klik Link</span>
                    <span className="font-extrabold text-primary">{selectedInvitationDetail.click_count} kali</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Dikirim Pada</span>
                    <span className="font-bold text-dark">{formatDateTime(selectedInvitationDetail.sent_at)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Pertama Diklik</span>
                    <span className="font-bold text-dark">{formatDateTime(selectedInvitationDetail.clicked_at)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Terdaftar Pada</span>
                    <span className="font-bold text-dark">{formatDateTime(selectedInvitationDetail.registered_at)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block">Task Pertama Submit</span>
                    <span className="font-bold text-dark">{formatDateTime(selectedInvitationDetail.first_task_submitted_at)}</span>
                  </div>
                </div>

                {selectedInvitationDetail.internal_notes && (
                  <div className="p-2.5 bg-yellow-50 rounded-xl border border-yellow-200 text-yellow-950">
                    <p className="font-bold text-[11px]">Catatan:</p>
                    <p>{selectedInvitationDetail.internal_notes}</p>
                  </div>
                )}

                <div className="pt-3 border-t border-light flex justify-between gap-2">
                  {selectedInvitationDetail.phone && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openWhatsAppInvite(selectedInvitationDetail)}
                      className="!text-xs"
                    >
                      <Phone size={13} className="mr-1.5" /> Kirim via WhatsApp
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => copyInviteLink(selectedInvitationDetail.secure_token)}
                    className="!text-xs"
                  >
                    <Copy size={13} className="mr-1.5" /> Salin Link
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: USER DETAIL (Profile, History, Timeline) */}
        {selectedUserDetailId && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl max-h-[90dvh] overflow-y-auto animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-light mb-4">
                <div>
                  <h3 className="font-extrabold text-base text-dark">
                    {userDetail?.profile?.full_name || 'Detail User'}
                  </h3>
                  <p className="text-xs text-muted">
                    {userDetail?.profile?.email} • {userDetail?.profile?.whatsapp || 'No WA'}
                  </p>
                </div>
                <button onClick={() => setSelectedUserDetailId(null)} className="text-muted hover:text-dark">
                  <X size={18} />
                </button>
              </div>

              {userDetailLoading ? (
                <CardSkeleton />
              ) : userDetail?.profile ? (
                <div className="space-y-5 text-xs">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-light p-2.5 rounded-xl border border-border">
                      <span className="text-[10px] text-muted font-bold block uppercase">Akuisisi</span>
                      <AcquisitionBadge type={userDetail.profile.acquisition_type} />
                    </div>
                    <div className="bg-light p-2.5 rounded-xl border border-border">
                      <span className="text-[10px] text-muted font-bold block uppercase">Login Terakhir</span>
                      <strong className="text-dark block">{formatDateTime(userDetail.profile.last_login_at)}</strong>
                    </div>
                    <div className="bg-light p-2.5 rounded-xl border border-border">
                      <span className="text-[10px] text-muted font-bold block uppercase">Task Terakhir</span>
                      <strong className="text-dark block">{formatDateTime(userDetail.profile.last_task_activity_at)}</strong>
                    </div>
                    <div className="bg-light p-2.5 rounded-xl border border-border">
                      <span className="text-[10px] text-muted font-bold block uppercase">Total Saldo Reward</span>
                      <strong className="text-primary money block">Rp{(userDetail.profile.credit_balance || 0).toLocaleString('id-ID')}</strong>
                    </div>
                  </div>

                  {/* Acquisition Info if invited */}
                  {userDetail.profile.invitation && (
                    <div className="bg-purple-50 p-3 rounded-2xl border border-purple-200 text-purple-950">
                      <p className="font-extrabold text-xs mb-1">Informasi Undangan</p>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>ID: <b>{userDetail.profile.invitation.invitation_code}</b></div>
                        <div>Recruiter: <b>{userDetail.profile.recruiter?.full_name || 'Admin'}</b></div>
                        <div>Campaign: <b>{userDetail.profile.campaign?.campaign_name || '-'}</b></div>
                        <div>Terdaftar: <b>{formatDateTime(userDetail.profile.invitation.registered_at)}</b></div>
                      </div>
                    </div>
                  )}

                  {/* Task History Table */}
                  <div>
                    <h4 className="font-extrabold text-dark uppercase tracking-wider text-[11px] mb-2">
                      Riwayat Aktivitas Task ({userDetail.assignments.length})
                    </h4>
                    {userDetail.assignments.length === 0 ? (
                      <p className="text-muted text-xs italic bg-light p-3 rounded-xl text-center">
                        Pengguna ini belum pernah mengambil atau mengerjakan task.
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto border border-border rounded-xl">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-light font-bold text-muted border-b border-border">
                            <tr>
                              <th className="p-2">Task</th>
                              <th className="p-2">Waktu Ambil</th>
                              <th className="p-2">Status</th>
                              <th className="p-2 text-right">Reward</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {userDetail.assignments.map((a: any) => (
                              <tr key={a.id}>
                                <td className="p-2 font-medium text-dark line-clamp-1">{a.task?.title || a.task_id}</td>
                                <td className="p-2 text-muted">{formatDateTime(a.created_at)}</td>
                                <td className="p-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    a.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                                    a.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'
                                  }`}>
                                    {a.status}
                                  </span>
                                </td>
                                <td className="p-2 text-right font-bold text-primary money">
                                  Rp{(a.task?.reward_amount || 0).toLocaleString('id-ID')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Login Logs */}
                  <div>
                    <h4 className="font-extrabold text-dark uppercase tracking-wider text-[11px] mb-2">
                      Riwayat Login ({userDetail.loginLogs.length})
                    </h4>
                    {userDetail.loginLogs.length === 0 ? (
                      <p className="text-muted text-xs italic bg-light p-3 rounded-xl text-center">
                        Belum ada riwayat login tercatat.
                      </p>
                    ) : (
                      <div className="max-h-36 overflow-y-auto border border-border rounded-xl">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-light font-bold text-muted border-b border-border">
                            <tr>
                              <th className="p-2">Waktu</th>
                              <th className="p-2">Device</th>
                              <th className="p-2">Browser / OS</th>
                              <th className="p-2">Metode</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {userDetail.loginLogs.map((l: any) => (
                              <tr key={l.id}>
                                <td className="p-2 text-dark font-medium">{formatDateTime(l.created_at)}</td>
                                <td className="p-2 uppercase font-bold text-[10px] text-muted">{l.device_type || 'desktop'}</td>
                                <td className="p-2 text-muted">{l.browser || '-'} / {l.operating_system || '-'}</td>
                                <td className="p-2 text-muted">{l.login_method || 'password'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* MODAL: CREATE FOLLOW-UP */}
        {showFollowupModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-light mb-4">
                <h3 className="font-extrabold text-base text-dark">Tugaskan Follow-up Pengguna</h3>
                <button onClick={() => setShowFollowupModal(false)} className="text-muted hover:text-dark">
                  <X size={18} />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!followupForm.assignedTo) {
                    toast.error('Pilih recruiter / admin yang ditugaskan');
                    return;
                  }
                  createFollowupMutation.mutate();
                }}
                className="space-y-3.5 text-xs"
              >
                <div>
                  <label className="block font-bold text-dark mb-1">Pilih Member / Calon</label>
                  <select
                    value={followupForm.userId}
                    onChange={(e) => setFollowupForm({ ...followupForm, userId: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                  >
                    <option value="">Pilih dari User Terdaftar</option>
                    {(userMonitoring?.users || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} ({u.activity_status}) - {u.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-dark mb-1">Ditugaskan Kepada *</label>
                    <select
                      value={followupForm.assignedTo}
                      onChange={(e) => setFollowupForm({ ...followupForm, assignedTo: e.target.value })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                    >
                      <option value="">Pilih Recruiter (Ghina / Admin)</option>
                      {recruiters.map((r) => (
                        <option key={r.recruiter_id} value={r.recruiter_id}>
                          {r.recruiter_name} ({r.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-dark mb-1">Kategori Masalah</label>
                    <select
                      value={followupForm.category}
                      onChange={(e) => setFollowupForm({ ...followupForm, category: e.target.value as any })}
                      className="w-full bg-light border border-border rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary font-semibold"
                    >
                      <option value="not_started">Not Started (Belum Login)</option>
                      <option value="logged_in_no_task">Logged In - No Task</option>
                      <option value="at_risk">At Risk (Mulai Pasif 4-7 Hari)</option>
                      <option value="inactive">Inactive (&gt; 7 Hari Pasif)</option>
                      <option value="new_registration">New Registration</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-dark mb-1">Instruksi & Catatan Follow-up</label>
                  <textarea
                    rows={2}
                    placeholder="Contoh: Chat via WA, tanyakan kendala kenapa belum mengerjakan task pertama..."
                    value={followupForm.notes}
                    onChange={(e) => setFollowupForm({ ...followupForm, notes: e.target.value })}
                    className="w-full bg-light border border-border rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="pt-3 border-t border-light flex justify-end gap-2">
                  <Button variant="outline" size="sm" type="button" onClick={() => setShowFollowupModal(false)}>
                    Batal
                  </Button>
                  <Button variant="primary" size="sm" type="submit" loading={createFollowupMutation.isPending}>
                    Tugaskan Follow-up
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
