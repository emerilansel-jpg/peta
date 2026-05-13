import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Download, ExternalLink, Zap, Pencil, Calendar } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { listPendingRedditOrders, importRedditOrder, adminUpdateTask } from '../../lib/api';

// Convert ISO timestamp → local-datetime input format (YYYY-MM-DDTHH:mm).
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Local-datetime input value (YYYY-MM-DDTHH:mm) → ISO string. Empty → null.
function localInputToIso(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const COMMENT_PRESETS = [5000, 8000, 11000, 14000, 17000, 20000];
const UPVOTE_PRESETS  = [500, 1000, 1500, 2000];
// LEVEL_OPTIONS removed — gates now use min_karma + min_age directly.

export function AdminTaskQueue() {
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<any>(null);
  const [showSheet, setShowSheet] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'draft' | 'active' | 'paused'>('all');
  const [bulkImporting, setBulkImporting] = React.useState(false);
  // Edit-sheet state — pre-populated when admin clicks "Edit" on a task row.
  const [editingTask, setEditingTask] = React.useState<any | null>(null);
  const [editForm, setEditForm] = React.useState({
    title: '',
    description: '',
    brief: '',
    target_url: '',
    task_category: 'reddit_comment' as 'reddit_upvote' | 'reddit_comment' | 'reddit_post_thread',
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
    target_url: '',
    task_category: 'reddit_comment' as 'reddit_upvote' | 'reddit_comment' | 'reddit_post_thread',
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
      return data || [];
    },
  });

  // Map task_category back to legacy task_type column (kept for compat).
  const categoryToType = (c: string): 'upvote' | 'comment' => c === 'reddit_upvote' ? 'upvote' : 'comment';

  // Parse string state → int with sensible defaults. Empty = 0.
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
      toast.success(publishStatus === 'draft' ? 'Disimpan sebagai draft 📝' : 'Task aktif & visible buat army ✅');
      setForm({ title: '', description: '', brief: '', target_url: '', task_category: 'reddit_comment', reward_amount: '8000', max_assignments: '5', per_account_limit: '1', min_karma: '', min_account_age_days: '' });
      setShowSheet(false);
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Gagal membuat task'),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'paused' }) => {
      const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Status diupdate'); refetch(); },
  });

  // Straight Ltd order queue → import into PeTa tasks. The list shows
  // pending orders that haven't been imported yet; admin can one-click
  // import each, or batch-import all at once.
  const { data: pendingOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['pendingRedditOrders'],
    queryFn: listPendingRedditOrders,
  });

  const importOrderMutation = useMutation({
    mutationFn: (orderId: number) => importRedditOrder({ orderId }),
    onSuccess: () => {
      toast.success('Order di-import sebagai task ✅');
      queryClient.invalidateQueries({ queryKey: ['pendingRedditOrders'] });
      queryClient.invalidateQueries({ queryKey: ['adminTasks'] });
    },
    onError: (e: any) => toast.error(`Import gagal: ${e.message || e}`),
  });

  // Open Edit sheet for a task — pre-populate form with current values.
  const openEdit = (t: any) => {
    setEditForm({
      title: t.title || '',
      description: t.description || '',
      brief: t.brief || '',
      target_url: t.target_url || '',
      task_category: (t.task_category ||
        (t.task_type === 'upvote' ? 'reddit_upvote' : 'reddit_comment')) as any,
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
    mutationFn: () => adminUpdateTask({
      taskId: editingTask.id,
      title: editForm.title,
      description: editForm.description,
      brief: editForm.brief,
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
    }),
    onSuccess: () => {
      toast.success('Task updated ✅');
      setEditingTask(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message || String(e)),
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
    toast.success(`Import selesai: ${ok} sukses · ${fail} gagal`);
  };

  const filtered = tasks.filter((t) => filter === 'all' || t.status === filter);

  return (
    <Layout userRole="admin">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold">Task Queue</h1>
        </div>
        <Button onClick={() => setShowSheet(true)} variant="primary" size="md">
          <Plus size={18} /> Task Baru
        </Button>
      </div>

      {/* Straight Ltd order queue — import-as-task panel. Only shown when
          there are pending orders so it doesn't add visual noise. */}
      {!ordersLoading && pendingOrders.length > 0 && (
        <Card className="mb-5 bg-warning/5 ring-warning/30">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide font-bold text-warning">Order Queue · Straight Ltd</p>
              <h2 className="text-lg sm:text-xl font-extrabold">
                {pendingOrders.length} order belum di-import
              </h2>
              <p className="text-xs text-muted">
                Order dari client B2B yang masih nunggu task PeTa dibuat. Klik "Import" buat copy jadi task otomatis.
              </p>
            </div>
            <Button
              onClick={importAll}
              loading={bulkImporting}
              disabled={pendingOrders.length === 0}
              variant="primary"
              size="sm"
            >
              <Zap size={14} /> Import Semua ({pendingOrders.length})
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
                    <span className="text-xs font-bold">×{o.requested_upvotes}</span>
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
        {[
          ['all',     'Semua',  tasks.length],
          ['draft',   'Draft',  tasks.filter(t => t.status === 'draft').length],
          ['active',  'Aktif',  tasks.filter(t => t.status === 'active').length],
          ['paused',  'Paused', tasks.filter(t => t.status === 'paused').length],
        ].map(([k, l, n]) => (
          <button
            key={k as string}
            onClick={() => setFilter(k as any)}
            className={`tap-shrink shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${
              filter === k ? 'bg-primary text-white' : 'bg-white ring-1 ring-border text-muted'
            }`}
          >
            {l} ({n})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">📋</div>
          <p className="font-bold">Belum ada task</p>
          <p className="text-sm text-muted mb-4">Klik "Task Baru" untuk mulai.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card key={t.id} padding="sm">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="font-bold leading-snug">
                    <span className="mr-1">{t.task_type === 'upvote' ? '👍' : '💬'}</span>
                    {t.title}
                  </p>
                  <p className="text-xs text-muted line-clamp-1">{t.description}</p>
                  {t.brief && t.brief.trim() && (
                    // Brief preview — collapsible details so admin can scan + expand to verify
                    // what army members are seeing. Important for comment/post tasks where
                    // instructions need to be exactly right.
                    <details className="mt-1.5">
                      <summary className="text-[11px] font-bold text-warning bg-warning/10 px-2 py-0.5 rounded-full inline-flex items-center gap-1 cursor-pointer hover:bg-warning/20 list-none">
                        📋 Brief lengkap (klik buka)
                      </summary>
                      <div className="mt-2 p-2.5 bg-yellow-50 ring-1 ring-yellow-200 rounded-lg text-xs whitespace-pre-line leading-relaxed text-yellow-950">
                        {t.brief}
                      </div>
                    </details>
                  )}
                </div>
                <p className="text-lg font-extrabold text-primary money shrink-0">
                  Rp{t.reward_amount.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-muted flex-wrap">
                  <span>{t.current_assignments}/{t.max_assignments}</span>
                  <span>•</span>
                  <span>min lvl {t.min_level}</span>
                  <span>•</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${
                    t.status === 'active' ? 'bg-success/15 text-success' :
                    t.status === 'paused' ? 'bg-warning/15 text-warning' : 'bg-light text-muted'
                  }`}>{t.status}</span>
                  {(t.start_at || t.end_at) && (
                    <span className="text-[10px] bg-light px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                      <Calendar size={10} />
                      {t.start_at ? new Date(t.start_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—'}
                      {' → '}
                      {t.end_at ? new Date(t.end_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—'}
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
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['reddit_upvote',      '👍 Upvote',  'Rp500–2K',  1000],
                      ['reddit_comment',     '💬 Comment', 'Rp5K–20K',  8000],
                      ['reddit_post_thread', '📝 Post',    'Rp10K–25K', 15000],
                    ] as const).map(([cat, label, range, defaultReward]) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setForm({ ...form, task_category: cat, reward_amount: String(defaultReward) })}
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
                    placeholder={form.task_category === 'reddit_upvote' ? 'Contoh: Upvote thread tentang AI' : form.task_category === 'reddit_post_thread' ? 'Contoh: Post thread baru di r/Indonesia' : 'Contoh: Comment di r/Indonesia tentang AI'}
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

                <Field label="Target URL (Reddit thread)">
                  <input
                    type="url"
                    value={form.target_url}
                    onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                    placeholder="https://reddit.com/r/..."
                    className={inputCls}
                  />
                </Field>

                <Field label="Brief Lengkap (komen/post yang harus army tulis)">
                  <textarea
                    value={form.brief}
                    onChange={(e) => setForm({ ...form, brief: e.target.value })}
                    placeholder={form.task_category === 'reddit_upvote'
                      ? 'Untuk upvote: cukup link thread di atas. Brief opsional.'
                      : 'Tulis instruksi lengkap. Contoh:\n\n"Komentar harus bahas pengalaman pribadi pakai produk X. Min 3 kalimat. Sebutkan keyword Y secara natural. Hindari kata Z. Contoh tone: ramah tapi tidak salesy."'}
                    className={inputCls + ' min-h-[110px] resize-y'}
                    rows={5}
                  />
                </Field>

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
                    📝 Save Draft
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
                    ✅ Publish Active
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

      {/* Bottom sheet: edit task — pre-populated with current values for the
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
                        {s === 'draft' ? '📝 Draft' : s === 'paused' ? '⏸ Pause' : s === 'active' ? '▶ Active' : '✓ Done'}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Kategori">
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['reddit_upvote',      '👍 Upvote'],
                      ['reddit_comment',     '💬 Comment'],
                      ['reddit_post_thread', '📝 Post'],
                    ] as const).map(([cat, label]) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, task_category: cat })}
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

                <Field label="Target URL">
                  <input
                    type="url"
                    value={editForm.target_url}
                    onChange={(e) => setEditForm({ ...editForm, target_url: e.target.value })}
                    className={inputCls}
                  />
                </Field>

                <Field label="Brief Lengkap (komen/post yang harus army tulis)">
                  <textarea
                    value={editForm.brief}
                    onChange={(e) => setEditForm({ ...editForm, brief: e.target.value })}
                    placeholder={editForm.task_category === 'reddit_upvote'
                      ? 'Untuk upvote: cukup link thread. Brief opsional.'
                      : 'Tulis instruksi lengkap untuk army…'}
                    className={inputCls + ' min-h-[110px] resize-y'}
                    rows={5}
                  />
                </Field>

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
                  💡 Set <b>Start</b> di masa depan biar task auto-mulai. <b>End</b> akan auto-pause task setelah tanggal lewat (admin tetap bisa manual toggle).
                  Default new auto-import dari B2B order = <b>paused</b> — review dulu sebelum aktifkan.
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
                  💾 Simpan Perubahan
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
