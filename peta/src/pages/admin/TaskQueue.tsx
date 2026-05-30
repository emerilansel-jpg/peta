import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Download, ExternalLink, Zap, Pencil, Calendar, ClipboardList, ShieldCheck, Clock3, Users } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from '../../components/Toast';
import { listPendingRedditOrders, importRedditOrder, adminUpdateTask } from '../../lib/api';
import { cleanInternalText } from '../../lib/internalText';

// Convert ISO timestamp to local-datetime input format (YYYY-MM-DDTHH:mm).
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Local-datetime input value (YYYY-MM-DDTHH:mm) to ISO string. Empty means null.
function localInputToIso(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const COMMENT_PRESETS = [5000, 8000, 11000, 14000, 17000, 20000];
const UPVOTE_PRESETS  = [500, 1000, 1500, 2000];
// LEVEL_OPTIONS removed; gates now use min_karma + min_age directly.

type FilterKey = 'all' | 'draft' | 'active' | 'paused';
type TaskStatus = 'draft' | 'active' | 'paused' | 'completed';
type TaskCategory = 'reddit_upvote' | 'reddit_comment' | 'reddit_post_thread' | 'forum_comment';

const TASK_CATEGORY_OPTIONS: Array<[TaskCategory, string, string, number]> = [
  ['reddit_upvote', 'Upvote', 'Rp500-2K', 1000],
  ['reddit_comment', 'Reddit comment', 'Rp5K-20K', 8000],
  ['forum_comment', 'Forum comment', 'Rp5K-20K', 5000],
  ['reddit_post_thread', 'Post thread', 'Rp10K-25K', 15000],
];

type TaskRow = {
  id: string;
  title: string | null;
  description: string | null;
  brief: string | null;
  post_to_wa_group: boolean | null;
  wa_group_draft: string | null;
  target_url: string | null;
  task_type: 'upvote' | 'comment' | string | null;
  task_category: TaskCategory | null;
  reward_amount: number;
  current_assignments: number | null;
  max_assignments: number | null;
  per_account_limit: number | null;
  min_level: number | null;
  min_karma: number | null;
  min_account_age_days: number | null;
  start_at: string | null;
  end_at: string | null;
  status: TaskStatus;
  source_order_id?: number | null;
};

const FILTERS: Array<[FilterKey, string, (tasks: TaskRow[], stats: { draft: number; active: number; paused: number }) => number]> = [
  ['all', 'Semua', (tasks) => tasks.length],
  ['draft', 'Draft', (_tasks, stats) => stats.draft],
  ['active', 'Aktif', (_tasks, stats) => stats.active],
  ['paused', 'Paused', (_tasks, stats) => stats.paused],
];

export function AdminTaskQueue() {
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<User | null>(null);
  const [showSheet, setShowSheet] = React.useState(false);
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [bulkImporting, setBulkImporting] = React.useState(false);
  // Edit-sheet state, pre-populated when admin clicks "Edit" on a task row.
  const [editingTask, setEditingTask] = React.useState<TaskRow | null>(null);
  const [editForm, setEditForm] = React.useState({
    title: '',
    description: '',
    brief: '',
    post_to_wa_group: false,
    wa_group_draft: '',
    target_url: '',
    task_category: 'reddit_comment' as TaskCategory,
    reward_amount: '0',
    max_assignments: '1',
    per_account_limit: '1',
    min_karma: '',
    min_account_age_days: '',
    start_at: '',
    end_at: '',
    status: 'draft' as 'draft' | 'active' | 'paused' | 'completed',
  });

  // Use string state for number inputs so users on mobile can delete the
  // leading 0 and type freely. Parsed to int on submit. Empty = 0.
  const [form, setForm] = React.useState({
    title: '',
    description: '',
    brief: '',
    post_to_wa_group: false,
    wa_group_draft: '',
    target_url: '',
    task_category: 'reddit_comment' as TaskCategory,
    reward_amount: '8000',
    max_assignments: '5',
    per_account_limit: '1',
    min_karma: '',
    min_account_age_days: '',
  });

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ['adminTasks'],
    queryFn: async () => {
      const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
      return (data || []) as TaskRow[];
    },
  });

  // Map task_category back to legacy task_type column (kept for compat).
  const categoryToType = (c: string): 'upvote' | 'comment' => c === 'reddit_upvote' ? 'upvote' : 'comment';

  // Parse string state to int with sensible defaults. Empty = 0.
  const parseInt0 = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const parseInt1 = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) || n < 1 ? 1 : n;
  };

  const create = useMutation({
    mutationFn: async (publishStatus: 'draft' | 'active') => {
      const { error } = await supabase.from('tasks').insert({
        title: form.title,
        description: form.description,
        brief: form.brief,
        post_to_wa_group: form.post_to_wa_group,
        wa_group_draft: form.wa_group_draft || null,
        target_url: form.target_url,
        task_category: form.task_category,
        task_type: categoryToType(form.task_category),
        reward_amount: parseInt0(form.reward_amount),
        max_assignments: parseInt1(form.max_assignments),
        per_account_limit: parseInt1(form.per_account_limit),
        min_karma: parseInt0(form.min_karma),
        min_account_age_days: parseInt0(form.min_account_age_days),
        created_by: user?.id,
        status: publishStatus,
      });
      if (error) throw error;
    },
    onSuccess: (_data, publishStatus) => {
      toast.success(publishStatus === 'draft' ? 'Disimpan sebagai draft' : 'Task aktif & visible buat army');
      setForm({ title: '', description: '', brief: '', post_to_wa_group: false, wa_group_draft: '', target_url: '', task_category: 'reddit_comment', reward_amount: '8000', max_assignments: '5', per_account_limit: '1', min_karma: '', min_account_age_days: '' });
      setShowSheet(false);
      refetch();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, 'Gagal membuat task')),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'paused' }) => {
      const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Status diupdate'); refetch(); },
  });

  // Straight Ltd order queue import into PeTa tasks. The list shows
  // pending orders that haven't been imported yet; admin can one-click
  // import each, or batch-import all at once.
  const { data: pendingOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['pendingRedditOrders'],
    queryFn: listPendingRedditOrders,
  });

  const importOrderMutation = useMutation({
    mutationFn: (orderId: number) => importRedditOrder({ orderId }),
    onSuccess: () => {
      toast.success('Order di-import sebagai task');
      queryClient.invalidateQueries({ queryKey: ['pendingRedditOrders'] });
      queryClient.invalidateQueries({ queryKey: ['adminTasks'] });
    },
    onError: (e: unknown) => toast.error(`Import gagal: ${errorMessage(e, 'Unknown error')}`),
  });

  // Open Edit sheet for a task and pre-populate form with current values.
  const openEdit = (t: TaskRow) => {
    setEditForm({
      title: t.title || '',
      description: t.description || '',
      brief: t.brief || '',
      post_to_wa_group: Boolean(t.post_to_wa_group),
      wa_group_draft: t.wa_group_draft || '',
      target_url: t.target_url || '',
      task_category: (t.task_category ||
        (t.task_type === 'upvote' ? 'reddit_upvote' : 'reddit_comment')) as TaskCategory,
      reward_amount: String(t.reward_amount ?? 0),
      max_assignments: String(t.max_assignments ?? 1),
      per_account_limit: String(t.per_account_limit ?? 1),
      // Empty string when 0 so user can clearly type from scratch.
      min_karma: t.min_karma ? String(t.min_karma) : '',
      min_account_age_days: t.min_account_age_days ? String(t.min_account_age_days) : '',
      start_at: isoToLocalInput(t.start_at),
      end_at: isoToLocalInput(t.end_at),
      status: t.status || 'draft',
    });
    setEditingTask(t);
  };

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editingTask) throw new Error('No task selected');
      return adminUpdateTask({
        taskId: editingTask.id,
        title: editForm.title,
        description: editForm.description,
        brief: editForm.brief,
        post_to_wa_group: editForm.post_to_wa_group,
        wa_group_draft: editForm.wa_group_draft,
        target_url: editForm.target_url,
        task_category: editForm.task_category,
        reward_amount: parseInt0(editForm.reward_amount),
        max_assignments: parseInt1(editForm.max_assignments),
        per_account_limit: parseInt1(editForm.per_account_limit),
        min_karma: parseInt0(editForm.min_karma),
        min_account_age_days: parseInt0(editForm.min_account_age_days),
        start_at: localInputToIso(editForm.start_at),
        end_at: localInputToIso(editForm.end_at),
        status: editForm.status,
      });
    },
    onSuccess: () => {
      toast.success('Task updated');
      setEditingTask(null);
      refetch();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, 'Task update failed')),
  });

  const importAll = async () => {
    if (bulkImporting) return;
    if (pendingOrders.length === 0) return;
    if (!confirm(`Import ${pendingOrders.length} order jadi PeTa task?`)) return;
    setBulkImporting(true);
    let ok = 0, fail = 0;
    for (const order of pendingOrders) {
      try {
        await importRedditOrder({ orderId: order.id });
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkImporting(false);
    queryClient.invalidateQueries({ queryKey: ['pendingRedditOrders'] });
    queryClient.invalidateQueries({ queryKey: ['adminTasks'] });
    toast.success(`Import selesai: ${ok} sukses Â· ${fail} gagal`);
  };

  const filtered = tasks.filter((t) => filter === 'all' || t.status === filter);
  const activeCount = tasks.filter((t) => t.status === 'active').length;
  const draftCount = tasks.filter((t) => t.status === 'draft').length;
  const pausedCount = tasks.filter((t) => t.status === 'paused').length;
  const openSlots = tasks.reduce((sum, t) => sum + Math.max(0, Number(t.max_assignments || 0) - Number(t.current_assignments || 0)), 0);

  const applyStandardBrief = (mode: 'create' | 'edit') => {
    if (mode === 'create') {
      const parts = splitForumBrief(form.brief);
      setForm({
        ...form,
        brief: combineForumBrief(parts.commentPost, standardBriefForPlatform(platformForUrl(form.target_url, form.task_category), form.target_url)),
      });
      return;
    }
    const parts = splitForumBrief(editForm.brief);
    setEditForm({
      ...editForm,
      brief: combineForumBrief(parts.commentPost, standardBriefForPlatform(platformForUrl(editForm.target_url, editForm.task_category), editForm.target_url)),
    });
  };

  return (
    <Layout userRole="admin">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide font-bold text-primary">Operations Control</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold">Task Queue</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Review client orders, set reward economics, and publish only tasks that are ready for PeTa members.
          </p>
        </div>
        <Button onClick={() => setShowSheet(true)} variant="primary" size="md">
          <Plus size={18} /> Task Baru
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
        <QueueStat icon={ShieldCheck} label="Active" value={activeCount} tone="success" />
        <QueueStat icon={Clock3} label="Draft review" value={draftCount} tone="muted" />
        <QueueStat icon={Users} label="Open slots" value={openSlots} tone="primary" />
        <QueueStat icon={ClipboardList} label="Client orders" value={pendingOrders.length} tone="warning" />
      </div>

      {/* Straight Ltd order queue import-as-task panel. Only shown when
          there are pending orders so it doesn't add visual noise. */}
      {!ordersLoading && pendingOrders.length > 0 && (
        <Card className="mb-5 bg-warning/5 ring-warning/30">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide font-bold text-warning">Client Order Intake</p>
              <h2 className="text-lg sm:text-xl font-extrabold">
                {pendingOrders.length} order needs task review
              </h2>
              <p className="text-xs text-muted">
                Import creates a paused PeTa task from each Straight Ltd order. Review the brief, payout, slots, and account gates before activating.
              </p>
            </div>
            <Button
              onClick={importAll}
              loading={bulkImporting}
              disabled={pendingOrders.length === 0}
              variant="primary"
              size="sm"
            >
              <Zap size={14} /> Import all ({pendingOrders.length})
            </Button>
          </div>

          <div className="space-y-2">
            {pendingOrders.map((o) => (
              <div
                key={o.id}
                className="bg-white rounded-xl ring-1 ring-warning/30 p-3 flex items-start justify-between gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] uppercase font-bold bg-warning/10 text-warning px-2 py-0.5 rounded-full">
                      #{o.id}
                    </span>
                    <span className="text-[10px] uppercase font-bold bg-light text-muted px-2 py-0.5 rounded-full">
                      {o.target_type}
                    </span>
                    {o.subreddit && (
                      <span className="text-xs text-muted">r/{o.subreddit}</span>
                    )}
                    <span className="text-xs font-bold">x{o.requested_upvotes}</span>
                  </div>
                  <a
                    href={o.thread_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline truncate flex items-center gap-1"
                  >
                    {o.thread_url.replace(/^https?:\/\//, '').slice(0, 70)} <ExternalLink size={11} />
                  </a>
                  {o.client_email && (
                    <p className="text-[11px] text-muted truncate">Client: {o.client_email}</p>
                  )}
                </div>
                <Button
                  onClick={() => importOrderMutation.mutate(o.id)}
                  loading={importOrderMutation.isPending && importOrderMutation.variables === o.id}
                  variant="primary"
                  size="sm"
                >
                  <Download size={14} /> Import
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
        {FILTERS.map(([k, l, getCount]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`tap-shrink shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${
              filter === k ? 'bg-primary text-white' : 'bg-white ring-1 ring-border text-muted'
            }`}
          >
            {l} ({getCount(tasks, { draft: draftCount, active: activeCount, paused: pausedCount })})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-10">
          <ClipboardList size={44} className="mx-auto mb-3 text-muted" />
          <p className="font-bold">Belum ada task</p>
          <p className="text-sm text-muted mb-4">Klik "Task Baru" untuk mulai.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card key={t.id} padding="sm">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide font-bold bg-light text-muted px-2 py-0.5 rounded-full">
                      {formatTaskCategory(t)}
                    </span>
                    <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${
                      t.status === 'active' ? 'bg-success/15 text-success' :
                      t.status === 'paused' ? 'bg-warning/15 text-warning' :
                      t.status === 'completed' ? 'bg-light text-dark' : 'bg-light text-muted'
                    }`}>
                      {formatStatus(t.status)}
                    </span>
                  </div>
                  <p className="font-bold leading-snug">
                    {t.title}
                  </p>
                  <p className="text-xs text-muted line-clamp-1">{formatTaskDescription(t)}</p>
                  {t.brief && t.brief.trim() && (
                    // Brief preview, collapsible details so admin can scan + expand to verify
                    // what army members are seeing. Important for comment/post tasks where
                    // instructions need to be exactly right.
                    <details className="mt-1.5">
                      <summary className="text-[11px] font-bold text-warning bg-warning/10 px-2 py-0.5 rounded-full inline-flex items-center gap-1 cursor-pointer hover:bg-warning/20 list-none">
                        Brief lengkap - klik buka
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div className="p-2.5 bg-yellow-50 ring-1 ring-yellow-200 rounded-lg text-xs whitespace-pre-line leading-relaxed text-yellow-950">
                          <p className="font-extrabold uppercase text-[10px] mb-1">Comment/Post</p>
                          {cleanInternalText(splitForumBrief(t.brief).commentPost || '-')}
                        </div>
                        <div className="p-2.5 bg-sky-50 ring-1 ring-sky-200 rounded-lg text-xs whitespace-pre-line leading-relaxed text-sky-950">
                          <p className="font-extrabold uppercase text-[10px] mb-1">Standard Brief</p>
                          {cleanInternalText(splitForumBrief(t.brief).standardBrief || '-')}
                        </div>
                        {(t.post_to_wa_group || Boolean(t.wa_group_draft?.trim())) && (
                          <div className="p-2.5 bg-green-50 ring-1 ring-green-200 rounded-lg text-xs whitespace-pre-line leading-relaxed text-green-950">
                            <p className="font-extrabold uppercase text-[10px] mb-1">
                              Draft WA Group {t.post_to_wa_group ? '(siap dipost manual)' : '(preview)'}
                            </p>
                            {cleanInternalText(t.wa_group_draft || '-')}
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
                <p className="text-lg font-extrabold text-primary money shrink-0">
                  Rp{t.reward_amount.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="mb-2">
                <div className="h-1.5 rounded-full bg-light overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, Math.round((Number(t.current_assignments || 0) / Math.max(1, Number(t.max_assignments || 1))) * 100))}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-muted flex-wrap">
                  <span>{t.current_assignments}/{t.max_assignments} slots filled</span>
                  <span>-</span>
                  <span>{formatGate(t)}</span>
                  {(t.start_at || t.end_at) && (
                    <span className="text-[10px] bg-light px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                      <Calendar size={10} />
                      {t.start_at ? new Date(t.start_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}
                      {' to '}
                      {t.end_at ? new Date(t.end_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}
                    </span>
                  )}
                  {t.source_order_id && (
                    <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded-full font-bold">
                      #B2B-{t.source_order_id}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openEdit(t)}
                    className="text-primary font-bold hover:underline flex items-center gap-1"
                    title="Edit semua parameter"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    onClick={() => toggleStatus.mutate({ id: t.id, status: t.status === 'active' ? 'paused' : 'active' })}
                    className="text-primary font-bold hover:underline"
                  >
                    {t.status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Bottom sheet: create task */}
      {showSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSheet(false)} />
          <div className="relative bg-white w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-extrabold">Buat Task Baru</h3>
                <button onClick={() => setShowSheet(false)} className="p-2 -mr-2 text-muted hover:text-dark">
                  <X size={22} />
                </button>
              </div>

              <div className="space-y-3">
                <Field label="Kategori Task">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TASK_CATEGORY_OPTIONS.map(([cat, label, range, defaultReward]) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          const next = { ...form, task_category: cat, reward_amount: String(defaultReward) };
                          if (cat === 'forum_comment' && !form.brief.trim()) {
                            next.brief = buildStandardBriefTemplate(platformForUrl(form.target_url, cat), form.target_url);
                            next.wa_group_draft = buildWaGroupDraft({
                              title: form.title,
                              platform: platformForUrl(form.target_url, cat),
                              reward: Number(defaultReward),
                              commentPost: splitForumBrief(next.brief).commentPost,
                            });
                          }
                          setForm(next);
                        }}
                        className={`tap-shrink min-h-[68px] rounded-xl px-2 py-2 text-left ${
                          form.task_category === cat
                            ? 'bg-primary text-white shadow-md shadow-primary/30'
                            : 'bg-light ring-1 ring-border'
                        }`}
                      >
                        <p className="font-extrabold text-sm leading-tight">{label}</p>
                        <p className={`text-[10px] ${form.task_category === cat ? 'text-white/80' : 'text-muted'}`}>{range}</p>
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Judul">
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder={form.task_category === 'reddit_upvote' ? 'Contoh: Upvote thread tentang AI' : form.task_category === 'reddit_post_thread' ? 'Contoh: Post thread baru di r/Indonesia' : form.task_category === 'forum_comment' ? 'Contoh: Comment di Quora/HubSpot/Facebook Group' : 'Contoh: Comment di r/Indonesia tentang AI'}
                    className={inputCls}
                  />
                </Field>

                <Field label="Deskripsi">
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Penjelasan singkat task & instruksi..."
                    className={inputCls + ' min-h-[100px] resize-none'}
                    rows={4}
                  />
                </Field>

                <Field label={form.task_category === 'forum_comment' ? 'Target URL forum/community' : 'Target URL (Reddit thread)'}>
                  <input
                    type="url"
                    value={form.target_url}
                    onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                    placeholder={form.task_category === 'forum_comment' ? 'https://www.quora.com/... atau https://www.facebook.com/groups/...' : 'https://reddit.com/r/...'}
                    className={inputCls}
                  />
                </Field>

                <Field label="Brief lengkap: comment/post + standard brief (editable)">
                  {form.task_category !== 'reddit_upvote' && (
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-[11px] text-muted">
                        Format wajib: comment/post yang harus diisi + standard brief sesuai platform.
                      </p>
                      <button
                        type="button"
                        onClick={() => applyStandardBrief('create')}
                        className="shrink-0 text-[11px] font-bold text-primary hover:underline"
                      >
                        Isi standard brief
                      </button>
                    </div>
                  )}
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-dark">Comment/post yang harus diisi</p>
                    <textarea
                      value={splitForumBrief(form.brief).commentPost}
                      onChange={(e) => setForm({ ...form, brief: combineForumBrief(e.target.value, splitForumBrief(form.brief).standardBrief) })}
                      placeholder={form.task_category === 'reddit_upvote'
                        ? 'Untuk upvote: cukup link thread di atas. Brief opsional.'
                        : 'Comment/post final dari client, atau instruksi inti yang wajib dikerjakan army.'}
                      className={inputCls + ' min-h-[110px] resize-y'}
                      rows={5}
                    />
                    {form.task_category !== 'reddit_upvote' && (
                      <>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-dark">Standard brief platform</p>
                        <textarea
                          value={splitForumBrief(form.brief).standardBrief}
                          onChange={(e) => setForm({ ...form, brief: combineForumBrief(splitForumBrief(form.brief).commentPost, e.target.value) })}
                          placeholder="STANDARD BRIEF UNIVERSAL + platform-specific brief..."
                          className={inputCls + ' min-h-[160px] resize-y'}
                          rows={7}
                        />
                      </>
                    )}
                  </div>
                </Field>

                {form.task_category !== 'reddit_upvote' && (
                  <Field label="Draft WA Group (manual post)">
                    <label className="flex items-start gap-3 p-3 rounded-xl bg-light ring-1 ring-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.post_to_wa_group}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm({
                            ...form,
                            post_to_wa_group: checked,
                            wa_group_draft: checked && !form.wa_group_draft.trim()
                              ? buildWaGroupDraft({
                                title: form.title,
                                platform: platformForUrl(form.target_url, form.task_category),
                                reward: parseInt0(form.reward_amount),
                                commentPost: splitForumBrief(form.brief).commentPost,
                              })
                              : form.wa_group_draft,
                          });
                        }}
                        className="mt-1"
                      />
                      <span className="text-sm">
                        <b>Tandai untuk diposting ke WA group.</b>
                        <span className="block text-xs text-muted">Sistem tidak auto-post. Draft di bawah tinggal dicopy manual.</span>
                      </span>
                    </label>
                    <div className="mt-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted leading-snug">
                          Draft WA selalu bisa diedit di sini. Checkbox hanya penanda task ini akan dipost manual ke grup.
                        </p>
                        <div className="shrink-0 flex gap-3">
                          <button
                            type="button"
                            onClick={() => setForm({
                              ...form,
                              wa_group_draft: buildWaGroupDraft({
                                title: form.title,
                                platform: platformForUrl(form.target_url, form.task_category),
                                reward: parseInt0(form.reward_amount),
                                commentPost: splitForumBrief(form.brief).commentPost,
                              }),
                            })}
                            className="text-[11px] font-bold text-primary hover:underline"
                          >
                            Generate draft
                          </button>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(form.wa_group_draft).then(() => toast.success('Draft WA dicopy'))}
                            className="text-[11px] font-bold text-primary hover:underline"
                          >
                            Copy draft WA
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={form.wa_group_draft}
                        onChange={(e) => setForm({ ...form, wa_group_draft: e.target.value })}
                        placeholder="Draft pesan WA untuk admin copy-paste manual ke grup."
                        className={inputCls + ' min-h-[150px] resize-y'}
                        rows={6}
                      />
                    </div>
                  </Field>
                )}

                <Field label="Reward per task (Rp)">
                  <div className={`grid ${form.task_category === 'reddit_upvote' ? 'grid-cols-4' : 'grid-cols-3'} gap-2 mb-2`}>
                    {(form.task_category === 'reddit_upvote' ? UPVOTE_PRESETS : COMMENT_PRESETS).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm({ ...form, reward_amount: String(v) })}
                        className={`tap-shrink min-h-[40px] rounded-lg text-sm font-bold ${
                          parseInt0(form.reward_amount) === v ? 'bg-primary text-white' : 'bg-light text-dark ring-1 ring-border'
                        }`}
                      >
                        Rp{v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.reward_amount}
                      onChange={(e) => setForm({ ...form, reward_amount: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls + ' pl-10'}
                      placeholder="0"
                    />
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max Total Slot">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.max_assignments}
                      onChange={(e) => setForm({ ...form, max_assignments: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                      placeholder="1"
                    />
                  </Field>
                  <Field label="Per akun Reddit (default 1)">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.per_account_limit}
                      onChange={(e) => setForm({ ...form, per_account_limit: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                      placeholder="1"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min Karma (kosong = semua)">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.min_karma}
                      onChange={(e) => setForm({ ...form, min_karma: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                      placeholder="kosong = semua"
                    />
                  </Field>
                  <Field label="Min Age hari (kosong = semua)">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.min_account_age_days}
                      onChange={(e) => setForm({ ...form, min_account_age_days: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                      placeholder="kosong = semua"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => {
                      if (!form.title.trim()) { toast.error('Judul wajib diisi'); return; }
                      create.mutate('draft');
                    }}
                    variant="outline"
                    size="lg"
                    loading={create.isPending}
                    fullWidth
                  >
                    Save Draft
                  </Button>
                  <Button
                    onClick={() => {
                      if (!form.title.trim()) { toast.error('Judul wajib diisi'); return; }
                      create.mutate('active');
                    }}
                    variant="primary"
                    size="lg"
                    loading={create.isPending}
                    fullWidth
                  >
                    Publish Active
                  </Button>
                </div>
                <p className="text-[11px] text-muted text-center">
                  Draft tidak terlihat oleh army. Publish Active = langsung visible buat army yang memenuhi min karma/age.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom sheet: edit task, pre-populated with current values for the
          row admin clicked. Same field set as create + adds status,
          start_at, end_at scheduling. */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditingTask(null)} />
          <div className="relative bg-white w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-extrabold truncate">Edit Task</h3>
                  <p className="text-xs text-muted truncate">{editingTask.title}</p>
                </div>
                <button onClick={() => setEditingTask(null)} className="p-2 -mr-2 text-muted hover:text-dark">
                  <X size={22} />
                </button>
              </div>

              <div className="space-y-3">
                <Field label="Status">
                  <div className="grid grid-cols-4 gap-2">
                    {(['draft', 'paused', 'active', 'completed'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, status: s })}
                        className={`tap-shrink min-h-[44px] rounded-xl text-xs font-bold ${
                          editForm.status === s
                            ? s === 'active' ? 'bg-success text-white'
                              : s === 'paused' ? 'bg-warning text-white'
                              : s === 'draft' ? 'bg-muted text-white'
                              : 'bg-light text-dark ring-1 ring-border'
                            : 'bg-light text-dark ring-1 ring-border'
                        }`}
                      >
                        {s === 'draft' ? 'Draft' : s === 'paused' ? 'Pause' : s === 'active' ? 'Active' : 'Done'}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Kategori">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TASK_CATEGORY_OPTIONS.map(([cat, label]) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setEditForm({
                          ...editForm,
                          task_category: cat,
                          brief: cat === 'forum_comment' && !editForm.brief.trim()
                            ? buildStandardBriefTemplate(platformForUrl(editForm.target_url, cat), editForm.target_url)
                            : editForm.brief,
                          wa_group_draft: cat === 'forum_comment' && !editForm.wa_group_draft.trim()
                            ? buildWaGroupDraft({
                              title: editForm.title,
                              platform: platformForUrl(editForm.target_url, cat),
                              reward: parseInt0(editForm.reward_amount),
                              commentPost: splitForumBrief(editForm.brief).commentPost,
                            })
                            : editForm.wa_group_draft,
                        })}
                        className={`tap-shrink min-h-[44px] rounded-xl text-xs font-bold ${
                          editForm.task_category === cat
                            ? 'bg-primary text-white' : 'bg-light text-dark ring-1 ring-border'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Judul">
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className={inputCls}
                  />
                </Field>

                <Field label="Deskripsi">
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className={inputCls + ' min-h-[80px] resize-none'}
                    rows={3}
                  />
                </Field>

                <Field label={editForm.task_category === 'forum_comment' ? 'Target URL forum/community' : 'Target URL'}>
                  <input
                    type="url"
                    value={editForm.target_url}
                    onChange={(e) => setEditForm({ ...editForm, target_url: e.target.value })}
                    className={inputCls}
                  />
                </Field>

                <Field label="Brief lengkap: comment/post + standard brief (editable)">
                  {editForm.task_category !== 'reddit_upvote' && (
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-[11px] text-muted">
                        Bagian atas untuk comment/post. Bagian bawah standard brief sesuai forum.
                      </p>
                      <button
                        type="button"
                        onClick={() => applyStandardBrief('edit')}
                        className="shrink-0 text-[11px] font-bold text-primary hover:underline"
                      >
                        Refill standard brief
                      </button>
                    </div>
                  )}
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-dark">Comment/post yang harus diisi</p>
                    <textarea
                      value={splitForumBrief(editForm.brief).commentPost}
                      onChange={(e) => setEditForm({ ...editForm, brief: combineForumBrief(e.target.value, splitForumBrief(editForm.brief).standardBrief) })}
                      placeholder={editForm.task_category === 'reddit_upvote'
                        ? 'Untuk upvote: cukup link thread. Brief opsional.'
                        : 'Comment/post final dari client, atau instruksi inti yang wajib dikerjakan army.'}
                      className={inputCls + ' min-h-[110px] resize-y'}
                      rows={5}
                    />
                    {editForm.task_category !== 'reddit_upvote' && (
                      <>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-dark">Standard brief platform</p>
                        <textarea
                          value={splitForumBrief(editForm.brief).standardBrief}
                          onChange={(e) => setEditForm({ ...editForm, brief: combineForumBrief(splitForumBrief(editForm.brief).commentPost, e.target.value) })}
                          placeholder="STANDARD BRIEF UNIVERSAL + platform-specific brief..."
                          className={inputCls + ' min-h-[160px] resize-y'}
                          rows={7}
                        />
                      </>
                    )}
                  </div>
                </Field>

                {editForm.task_category !== 'reddit_upvote' && (
                  <Field label="Draft WA Group (manual post)">
                    <label className="flex items-start gap-3 p-3 rounded-xl bg-light ring-1 ring-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.post_to_wa_group}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setEditForm({
                            ...editForm,
                            post_to_wa_group: checked,
                            wa_group_draft: checked && !editForm.wa_group_draft.trim()
                              ? buildWaGroupDraft({
                                title: editForm.title,
                                platform: platformForUrl(editForm.target_url, editForm.task_category),
                                reward: parseInt0(editForm.reward_amount),
                                commentPost: splitForumBrief(editForm.brief).commentPost,
                              })
                              : editForm.wa_group_draft,
                          });
                        }}
                        className="mt-1"
                      />
                      <span className="text-sm">
                        <b>Tandai untuk diposting ke WA group.</b>
                        <span className="block text-xs text-muted">Sistem tidak auto-post. Draft di bawah tinggal dicopy manual.</span>
                      </span>
                    </label>
                    <div className="mt-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted leading-snug">
                          Draft WA selalu bisa diedit di sini. Checkbox hanya penanda task ini akan dipost manual ke grup.
                        </p>
                        <div className="shrink-0 flex gap-3">
                          <button
                            type="button"
                            onClick={() => setEditForm({
                              ...editForm,
                              wa_group_draft: buildWaGroupDraft({
                                title: editForm.title,
                                platform: platformForUrl(editForm.target_url, editForm.task_category),
                                reward: parseInt0(editForm.reward_amount),
                                commentPost: splitForumBrief(editForm.brief).commentPost,
                              }),
                            })}
                            className="text-[11px] font-bold text-primary hover:underline"
                          >
                            Generate draft
                          </button>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(editForm.wa_group_draft).then(() => toast.success('Draft WA dicopy'))}
                            className="text-[11px] font-bold text-primary hover:underline"
                          >
                            Copy draft WA
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={editForm.wa_group_draft}
                        onChange={(e) => setEditForm({ ...editForm, wa_group_draft: e.target.value })}
                        placeholder="Draft pesan WA untuk admin copy-paste manual ke grup."
                        className={inputCls + ' min-h-[150px] resize-y'}
                        rows={6}
                      />
                    </div>
                  </Field>
                )}

                <Field label="Reward per task (Rp)">
                  <div className={`grid ${editForm.task_category === 'reddit_upvote' ? 'grid-cols-4' : 'grid-cols-3'} gap-2 mb-2`}>
                    {(editForm.task_category === 'reddit_upvote' ? UPVOTE_PRESETS : COMMENT_PRESETS).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, reward_amount: String(v) })}
                        className={`tap-shrink min-h-[40px] rounded-lg text-sm font-bold ${
                          parseInt0(editForm.reward_amount) === v ? 'bg-primary text-white' : 'bg-light text-dark ring-1 ring-border'
                        }`}
                      >
                        Rp{v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.reward_amount}
                      onChange={(e) => setEditForm({ ...editForm, reward_amount: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls + ' pl-10'}
                    />
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max Total Slot">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.max_assignments}
                      onChange={(e) => setEditForm({ ...editForm, max_assignments: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Per akun Reddit">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.per_account_limit}
                      onChange={(e) => setEditForm({ ...editForm, per_account_limit: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min Karma (kosong = semua)">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.min_karma}
                      onChange={(e) => setEditForm({ ...editForm, min_karma: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                      placeholder="kosong = semua"
                    />
                  </Field>
                  <Field label="Min Age hari (kosong = semua)">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.min_account_age_days}
                      onChange={(e) => setEditForm({ ...editForm, min_account_age_days: e.target.value.replace(/[^0-9]/g, '') })}
                      className={inputCls}
                      placeholder="kosong = semua"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start (optional)">
                    <input
                      type="datetime-local"
                      value={editForm.start_at}
                      onChange={(e) => setEditForm({ ...editForm, start_at: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="End (optional)">
                    <input
                      type="datetime-local"
                      value={editForm.end_at}
                      onChange={(e) => setEditForm({ ...editForm, end_at: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                </div>

                <p className="text-[11px] text-muted leading-snug">
                  Set <b>Start</b> di masa depan biar task auto-mulai. <b>End</b> akan auto-pause task setelah tanggal lewat (admin tetap bisa manual toggle).
                  Default new auto-import dari B2B order = <b>paused</b> - review dulu sebelum aktifkan.
                </p>

                <Button
                  onClick={() => {
                    if (!editForm.title.trim()) { toast.error('Judul wajib diisi'); return; }
                    if (editForm.end_at && editForm.start_at && editForm.end_at < editForm.start_at) {
                      toast.error('End date harus setelah Start date'); return;
                    }
                    editMutation.mutate();
                  }}
                  variant="primary"
                  size="lg"
                  loading={editMutation.isPending}
                  fullWidth
                >
                  Simpan Perubahan
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

const inputCls =
  'w-full min-h-[44px] px-4 py-2.5 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function QueueStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  tone: 'primary' | 'success' | 'warning' | 'muted';
}) {
  const toneClass = {
    primary: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/10',
    muted: 'text-muted bg-light',
  }[tone];

  return (
    <div className="bg-white ring-1 ring-border rounded-2xl p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${toneClass}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide font-bold text-muted">{label}</p>
        <p className="text-xl font-extrabold text-dark">{value.toLocaleString('id-ID')}</p>
      </div>
    </div>
  );
}

function formatTaskCategory(t: TaskRow) {
  const category = t.task_category || (t.task_type === 'upvote' ? 'reddit_upvote' : 'reddit_comment');
  if (category === 'reddit_upvote') return 'Upvote';
  if (category === 'reddit_post_thread') return 'Post thread';
  if (category === 'forum_comment') return 'Forum comment';
  return 'Comment';
}

function formatStatus(status: string) {
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  if (status === 'completed') return 'Done';
  return 'Draft';
}

function formatGate(t: TaskRow) {
  const gates: string[] = [];
  if (Number(t.min_karma || 0) > 0) gates.push(`${Number(t.min_karma).toLocaleString('id-ID')} karma`);
  if (Number(t.min_account_age_days || 0) > 0) gates.push(`${Number(t.min_account_age_days).toLocaleString('id-ID')}d age`);
  return gates.length ? `Gate: ${gates.join(' + ')}` : 'Gate: all eligible members';
}

function formatTaskDescription(t: TaskRow) {
  const raw = t.description || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.service === 'forum_comment') {
      const pieces = [
        'Forum comment order',
        parsed.platform ? `Platform: ${parsed.platform}` : '',
        parsed.brand_name || parsed.brand_domain ? `Brand: ${parsed.brand_name || parsed.brand_domain}` : '',
        parsed.source_keyword ? `Keyword: ${parsed.source_keyword}` : '',
      ].filter(Boolean);
      return pieces.join(' Â· ');
    }
  } catch {
    // Non-JSON descriptions are regular PeTa task copy.
  }
  return cleanInternalText(raw);
}

function platformForUrl(url: string, category?: TaskCategory) {
  const text = url.toLowerCase();
  if (category === 'reddit_comment' || category === 'reddit_upvote' || text.includes('reddit.com')) return 'Reddit';
  if (text.includes('quora.com')) return 'Quora';
  if (text.includes('facebook.com/groups') || text.includes('fb.com/groups')) return 'Facebook Groups';
  if (text.includes('hubspot.com')) return 'HubSpot Community';
  if (text.includes('indiehackers.com')) return 'Indie Hackers';
  if (text.includes('stackoverflow.com')) return 'Stack Overflow';
  if (text.includes('stackexchange.com')) return 'Stack Exchange';
  if (text.includes('producthunt.com')) return 'Product Hunt';
  if (text.includes('discord.com') || text.includes('discord.gg')) return 'Discord Community';
  return category === 'forum_comment' ? 'Forum' : 'Reddit';
}

function buildStandardBriefTemplate(platform: string, targetUrl: string) {
  const lower = platform.toLowerCase();
  const platformSpecific =
    lower.includes('reddit') ? [
      'Platform-specific Reddit:',
      '- Wajib nyalakan Cloudflare WARP/VPN kalau Reddit terblokir dari jaringan kamu.',
      '- Login dengan akun Reddit yang dipakai untuk task.',
      '- Baca rules subreddit dan tone thread sebelum comment.',
      '- Jangan langsung drop link di akun baru. Plain mention lebih aman.',
      '- Copy permalink komentar kalau bisa, lalu submit URL + username + screenshot optional.',
    ] : lower.includes('quora') ? [
      'Platform-specific Quora:',
      '- Jawaban harus helpful dan cukup lengkap, bukan komentar pendek.',
      '- Mulai dengan konteks/pendapat, lalu beri alasan atau langkah praktis.',
      '- Hindari link di awal jawaban. Mention brand natural di tengah/akhir kalau relevan.',
      '- Copy URL answer/reply dan screenshot nama profil + jawaban.',
    ] : lower.includes('facebook') ? [
      'Platform-specific Facebook Groups:',
      '- Join group dulu jika belum member dan jawab pertanyaan onboarding secara normal.',
      '- Baca rules group, terutama aturan promo/link.',
      '- Jangan posting link kecuali rules memperbolehkan.',
      '- Komentar harus seperti member asli: singkat, relevan, dan tidak hard-selling.',
      '- Screenshot harus menunjukkan group/post, komentar, dan nama profil jika memungkinkan.',
    ] : lower.includes('hubspot') ? [
      'Platform-specific HubSpot Community:',
      '- Login / Join Community dengan email aktif.',
      '- Lengkapi profil secukupnya supaya tidak terlihat kosong.',
      '- Baca thread dan reply sebelumnya sebelum komentar.',
      '- Jawab seperti praktisi: beri insight singkat, contoh, atau caveat.',
      '- Mention brand hanya jika relevan dengan problem di thread.',
    ] : [
      `Platform-specific ${platform}:`,
      '- Login atau daftar akun jika dibutuhkan.',
      '- Baca rules, pinned thread, dan gaya bahasa member lain.',
      '- Jangan drop link kalau belum jelas diperbolehkan.',
      '- Komentar harus menjawab konteks thread, bukan promosi lepas.',
      '- Screenshot harus menunjukkan komentar sudah tampil dan username jika memungkinkan.',
    ];

  return [
    'COMMENT/POST YANG HARUS DIISI:',
    'Tulis instruksi atau komentar final dari client di sini. Edit bagian ini sebelum task diaktifkan.',
    '',
    'DETAIL ORDER:',
    `- Platform: ${platform}`,
    `- Target URL: ${targetUrl || '-'}`,
    '- Brand/client mention: isi brand/client di sini',
    '',
    'LANGKAH KERJA UNTUK NEWBIE:',
    '1. Buka target URL.',
    '2. Login atau daftar akun kalau platform meminta.',
    '3. Baca thread/post dan aturan komunitas.',
    '4. Tulis komentar/post sesuai instruksi di atas.',
    '5. Publish, lalu submit URL komentar/thread dan username yang dipakai.',
    '',
    ...platformSpecific,
  ].join('\n');
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
  const detailStart = text.indexOf(detailMarker);
  const standardStart = text.indexOf(standardMarker);
  const platformStart = text.indexOf(platformMarker);
  const standardBrief = platformStart >= 0
    ? text.slice(platformStart).trim()
    : standardStart >= 0
      ? text.slice(standardStart).trim()
      : detailStart >= 0 ? text.slice(detailStart).trim() : '';
  return { commentPost, standardBrief };
}

function combineForumBrief(commentPost: string, standardBrief: string) {
  return [
    'COMMENT/POST YANG HARUS DIISI:',
    commentPost.trim(),
    '',
    standardBrief.trim(),
  ].join('\n');
}

function standardBriefForPlatform(platform: string, targetUrl: string) {
  return splitForumBrief(buildStandardBriefTemplate(platform, targetUrl)).standardBrief;
}

function buildWaGroupDraft({
  title,
  platform,
  reward,
  commentPost,
}: {
  title: string;
  platform: string;
  reward: number;
  commentPost: string;
}) {
  return [
    'Task baru tersedia',
    '',
    `Platform: ${platform}`,
    `Task: ${title || 'Forum comment task'}`,
    `Reward: Rp${Number(reward || 5000).toLocaleString('id-ID')}`,
    '',
    'Yang dikerjakan:',
    commentPost.trim() || 'Buka target, baca konteks thread/post, lalu tulis komentar natural sesuai brief.',
    '',
    'Bukti submit:',
    '- URL komentar/thread setelah komentar tampil',
    '- Username yang dipakai di platform',
    '- Screenshot optional tapi disarankan',
    '',
    'Ambil task dari dashboard PeTa. Jangan spam dan ikuti rules platform.',
  ].join('\n');
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
