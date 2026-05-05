import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

const COMMENT_PRESETS = [5000, 8000, 11000, 14000, 17000, 20000];
const UPVOTE_PRESETS  = [500, 1000, 1500, 2000];
const LEVEL_OPTIONS = [
  { v: 0, label: '🥚 Pemula (semua)' },
  { v: 1, label: '🦴 Bocil+' },
  { v: 2, label: '🔥 Aktif+' },
  { v: 3, label: '⚔️ Pejuang+' },
  { v: 4, label: '🏙️ Senior+' },
  { v: 5, label: '👑 Legend' },
];

export function AdminTaskQueue() {
  const [user, setUser] = React.useState<any>(null);
  const [showSheet, setShowSheet] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'active' | 'paused'>('all');

  const [form, setForm] = React.useState({
    title: '',
    description: '',
    target_url: '',
    task_type: 'comment' as 'comment' | 'upvote',
    reward_amount: 8000,
    max_assignments: 5,
    min_level: 0,
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

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tasks').insert({
        ...form,
        created_by: user?.id,
        status: 'active',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Task dibuat ✅');
      setForm({ title: '', description: '', target_url: '', task_type: 'comment', reward_amount: 8000, max_assignments: 5, min_level: 0 });
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

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
        {[
          ['all',     'Semua', tasks.length],
          ['active',  'Aktif', tasks.filter(t => t.status === 'active').length],
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
                </div>
                <p className="text-lg font-extrabold text-primary money shrink-0">
                  Rp{t.reward_amount.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-muted">
                  <span>{t.current_assignments}/{t.max_assignments}</span>
                  <span>•</span>
                  <span>min lvl {t.min_level}</span>
                  <span>•</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${
                    t.status === 'active' ? 'bg-success/15 text-success' :
                    t.status === 'paused' ? 'bg-warning/15 text-warning' : 'bg-light text-muted'
                  }`}>{t.status}</span>
                </div>
                <button
                  onClick={() => toggleStatus.mutate({ id: t.id, status: t.status === 'active' ? 'paused' : 'active' })}
                  className="text-primary font-bold hover:underline"
                >
                  {t.status === 'active' ? 'Pause' : 'Activate'}
                </button>
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
                <Field label="Jenis Task">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, task_type: 'comment', reward_amount: 8000 })}
                      className={`tap-shrink min-h-[60px] rounded-xl px-3 py-2 text-left ${
                        form.task_type === 'comment'
                          ? 'bg-primary text-white shadow-md shadow-primary/30'
                          : 'bg-light ring-1 ring-border'
                      }`}
                    >
                      <p className="font-extrabold flex items-center gap-1">💬 Komentar</p>
                      <p className={`text-[11px] ${form.task_type === 'comment' ? 'text-white/80' : 'text-muted'}`}>Rp5K–20K</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, task_type: 'upvote', reward_amount: 1000 })}
                      className={`tap-shrink min-h-[60px] rounded-xl px-3 py-2 text-left ${
                        form.task_type === 'upvote'
                          ? 'bg-primary text-white shadow-md shadow-primary/30'
                          : 'bg-light ring-1 ring-border'
                      }`}
                    >
                      <p className="font-extrabold flex items-center gap-1">👍 Upvote/Like</p>
                      <p className={`text-[11px] ${form.task_type === 'upvote' ? 'text-white/80' : 'text-muted'}`}>Rp500–2K</p>
                    </button>
                  </div>
                </Field>

                <Field label="Judul">
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder={form.task_type === 'upvote' ? 'Contoh: Upvote thread tentang AI' : 'Contoh: Comment di r/Indonesia tentang AI'}
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

                <Field label="Reward (Rp)">
                  <div className={`grid ${form.task_type === 'upvote' ? 'grid-cols-4' : 'grid-cols-3'} gap-2 mb-2`}>
                    {(form.task_type === 'upvote' ? UPVOTE_PRESETS : COMMENT_PRESETS).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm({ ...form, reward_amount: v })}
                        className={`tap-shrink min-h-[40px] rounded-lg text-sm font-bold ${
                          form.reward_amount === v
                            ? 'bg-primary text-white'
                            : 'bg-light text-dark ring-1 ring-border'
                        }`}
                      >
                        {v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    value={form.reward_amount}
                    onChange={(e) => setForm({ ...form, reward_amount: parseInt(e.target.value) || 0 })}
                    className={inputCls}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max Slot">
                    <input
                      type="number"
                      value={form.max_assignments}
                      onChange={(e) => setForm({ ...form, max_assignments: parseInt(e.target.value) || 1 })}
                      min={1}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Min Level">
                    <select
                      value={form.min_level}
                      onChange={(e) => setForm({ ...form, min_level: parseInt(e.target.value) })}
                      className={inputCls}
                    >
                      {LEVEL_OPTIONS.map((o) => (
                        <option key={o.v} value={o.v}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Button
                  onClick={() => {
                    if (!form.title.trim()) { toast.error('Judul wajib diisi'); return; }
                    create.mutate();
                  }}
                  variant="primary"
                  size="lg"
                  loading={create.isPending}
                  fullWidth
                >
                  ✅ Publish Task
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
