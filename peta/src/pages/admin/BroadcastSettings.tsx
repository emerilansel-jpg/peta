// Admin → Broadcast Settings
//
// Configures the anti-ban guidelines that gate every WA blast. Settings are
// enforced server-side by the `send-broadcast-whatsapp` edge function before
// any message goes out — admin can't accidentally bypass them.
//
// Guidelines source: WhatsApp Bulk Sender best practices for warm-up,
// volume, delay, batch, target, and red-flag handling.
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import {
  Clock, Calendar, Zap, Layers, MessageSquare,
  AlertTriangle, PauseCircle, PlayCircle, RotateCcw, Save, Info,
} from 'lucide-react';

type Settings = {
  id: number;
  daily_limit: number;
  speed_per_minute: number;
  delay_min_seconds: number;
  delay_max_seconds: number;
  send_hours_start: number;
  send_hours_end: number;
  skip_friday: boolean;
  batch_size: number;
  batch_pause_minutes: number;
  max_recipients_per_blast: number;
  require_opt_out_text: boolean;
  opt_out_keyword: string;
  max_links_per_message: number;
  use_spintax: boolean;
  dedup_window_days: number;
  is_paused: boolean;
  pause_reason: string | null;
  paused_until: string | null;
  daily_counter_date: string;
  total_sent_today: number;
  total_sent_lifetime: number;
  last_sent_at: string | null;
  updated_at: string;
};

const PRESETS: Record<string, Partial<Settings>> = {
  // Warm-up (hari 1-3): new burner
  warmup_day_1_3: {
    daily_limit: 30, speed_per_minute: 3,
    delay_min_seconds: 5, delay_max_seconds: 15,
    batch_size: 10, batch_pause_minutes: 20,
    max_recipients_per_blast: 30,
  },
  // Hari 4-7
  warmup_day_4_7: {
    daily_limit: 100, speed_per_minute: 4,
    delay_min_seconds: 4, delay_max_seconds: 12,
    batch_size: 25, batch_pause_minutes: 25,
    max_recipients_per_blast: 100,
  },
  // Minggu 2+
  steady_state: {
    daily_limit: 500, speed_per_minute: 5,
    delay_min_seconds: 3, delay_max_seconds: 10,
    batch_size: 50, batch_pause_minutes: 30,
    max_recipients_per_blast: 200,
  },
  // Conservative (default ban-safe)
  conservative: {
    daily_limit: 200, speed_per_minute: 5,
    delay_min_seconds: 3, delay_max_seconds: 10,
    batch_size: 50, batch_pause_minutes: 30,
    max_recipients_per_blast: 200,
  },
};

function fmtTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}d lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.floor(h / 24)}h lalu`;
}

export function AdminBroadcastSettings() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['broadcastSettings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_broadcast_settings');
      if (error) throw error;
      return data as Settings;
    },
  });

  const [form, setForm] = React.useState<Partial<Settings>>({});
  React.useEffect(() => { if (settings) setForm({ ...settings }); }, [settings]);

  const update = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const params: Record<string, any> = {};
      // Map form fields → RPC param names (prefixed with p_)
      const keys: (keyof Settings)[] = [
        'daily_limit', 'speed_per_minute', 'delay_min_seconds', 'delay_max_seconds',
        'send_hours_start', 'send_hours_end', 'skip_friday',
        'batch_size', 'batch_pause_minutes', 'max_recipients_per_blast',
        'require_opt_out_text', 'opt_out_keyword', 'max_links_per_message',
        'use_spintax', 'dedup_window_days',
      ];
      keys.forEach(k => {
        if (patch[k] !== undefined) params[`p_${k}`] = patch[k];
      });
      const { data, error } = await supabase.rpc('admin_update_broadcast_settings', params);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['broadcastSettings'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const togglePause = useMutation({
    mutationFn: async (pause: boolean) => {
      const { data, error } = await supabase.rpc('admin_pause_blast', {
        p_pause: pause,
        p_reason: pause ? prompt('Alasan pause? (opsional)') || 'Manual pause by admin' : null,
        p_until: pause
          ? prompt('Pause sampai kapan? Format: YYYY-MM-DD HH:MM atau kosong')?.trim() || null
          : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(settings?.is_paused ? 'Blast resumed' : 'Blast paused');
      qc.invalidateQueries({ queryKey: ['broadcastSettings'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const applyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    if (!confirm(`Apply preset "${presetKey}"? Will overwrite current values.`)) return;
    setForm(f => ({ ...f, ...preset }));
    toast.success(`Preset "${presetKey}" loaded — klik Save untuk apply`);
  };

  if (isLoading || !settings || !form) {
    return <Layout userRole="admin"><div className="p-8 text-center text-muted">Loading...</div></Layout>;
  }

  const dirty = JSON.stringify(form) !== JSON.stringify({
    ...settings,
    // exclude computed / non-form fields
  }) ? Object.keys(form).some(k => (form as any)[k] !== (settings as any)[k]) : false;

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">WA Blast — Anti-Ban Settings</h1>
        <p className="text-sm text-muted">
          Parameter ini di-enforce server-side setiap kali blast jalan. Lihat <a href="/admin/broadcast" className="text-primary underline">/admin/broadcast</a> untuk compose blast.
        </p>
      </div>

      {/* ===== STATUS & STATS ===== */}
      <Card className="mb-4" padding="md">
        <div className="grid sm:grid-cols-4 gap-3 mb-3">
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-muted">Status</p>
            <p className={`text-sm font-extrabold ${settings.is_paused ? 'text-danger' : 'text-success'}`}>
              {settings.is_paused ? '🔴 PAUSED' : '🟢 ACTIVE'}
            </p>
            {settings.pause_reason && (
              <p className="text-[10px] text-muted truncate" title={settings.pause_reason}>
                {settings.pause_reason}
              </p>
            )}
          </div>
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-muted">Sent today (Jakarta)</p>
            <p className="text-sm font-extrabold">
              {settings.total_sent_today} <span className="text-muted font-normal">/ {settings.daily_limit}</span>
            </p>
          </div>
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-muted">Lifetime sent</p>
            <p className="text-sm font-extrabold">{settings.total_sent_lifetime.toLocaleString('id-ID')}</p>
          </div>
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-muted">Last sent</p>
            <p className="text-sm font-extrabold">{fmtTimeAgo(settings.last_sent_at)}</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={settings.is_paused ? 'primary' : 'outline'}
            onClick={() => togglePause.mutate(!settings.is_paused)}
            loading={togglePause.isPending}
            size="sm"
          >
            {settings.is_paused ? <><PlayCircle size={14} /> Resume Blast</> : <><PauseCircle size={14} /> Pause Blast</>}
          </Button>
        </div>
      </Card>

      {/* ===== PRESETS ===== */}
      <Card className="mb-4" padding="md">
        <h2 className="font-extrabold text-lg mb-2 flex items-center gap-2"><Zap size={18} /> Quick Presets</h2>
        <p className="text-xs text-muted mb-3">
          Apply rekomendasi parameter sesuai stage burner. Klik preset, review, lalu Save.
        </p>
        <div className="grid sm:grid-cols-4 gap-2">
          <button onClick={() => applyPreset('warmup_day_1_3')} className="text-left p-3 bg-warning/10 hover:bg-warning/20 ring-1 ring-warning/30 rounded-lg text-xs">
            <p className="font-extrabold text-warning">🥚 Warmup hari 1-3</p>
            <p className="text-muted mt-1">30/hari, 3 msg/min, batch 10</p>
          </button>
          <button onClick={() => applyPreset('warmup_day_4_7')} className="text-left p-3 bg-warning/10 hover:bg-warning/20 ring-1 ring-warning/30 rounded-lg text-xs">
            <p className="font-extrabold text-warning">🐣 Warmup hari 4-7</p>
            <p className="text-muted mt-1">100/hari, 4 msg/min, batch 25</p>
          </button>
          <button onClick={() => applyPreset('steady_state')} className="text-left p-3 bg-success/10 hover:bg-success/20 ring-1 ring-success/30 rounded-lg text-xs">
            <p className="font-extrabold text-success">🚀 Steady (minggu 2+)</p>
            <p className="text-muted mt-1">500/hari, 5 msg/min, batch 50</p>
          </button>
          <button onClick={() => applyPreset('conservative')} className="text-left p-3 bg-primary/10 hover:bg-primary/20 ring-1 ring-primary/30 rounded-lg text-xs">
            <p className="font-extrabold text-primary">🛡️ Conservative default</p>
            <p className="text-muted mt-1">200/hari, 5 msg/min, batch 50</p>
          </button>
        </div>
      </Card>

      {/* ===== VOLUME LIMITS ===== */}
      <Card className="mb-4" padding="md">
        <h2 className="font-extrabold text-lg mb-3 flex items-center gap-2"><Layers size={18} /> Volume & Speed</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <NumberField
            label="Daily limit (msg/hari)" value={form.daily_limit ?? 0}
            onChange={(v) => setForm(f => ({ ...f, daily_limit: v }))}
            hint="Max 30 untuk burner baru. 200-500 untuk steady."
            min={1} max={2000}
          />
          <NumberField
            label="Speed per minute (msg/menit)" value={form.speed_per_minute ?? 0}
            onChange={(v) => setForm(f => ({ ...f, speed_per_minute: v }))}
            hint="Max 5/menit. Rate limit di-enforce server-side."
            min={1} max={60}
          />
          <NumberField
            label="Max recipients/blast" value={form.max_recipients_per_blast ?? 0}
            onChange={(v) => setForm(f => ({ ...f, max_recipients_per_blast: v }))}
            hint="Pisah jadi batch lebih kecil kalau audience besar."
            min={1} max={2000}
          />
          <NumberField
            label="Dedup window (hari)" value={form.dedup_window_days ?? 0}
            onChange={(v) => setForm(f => ({ ...f, dedup_window_days: v }))}
            hint="Min interval antar blast ke user yg sama."
            min={0} max={30}
          />
        </div>
      </Card>

      {/* ===== DELAY & BATCH ===== */}
      <Card className="mb-4" padding="md">
        <h2 className="font-extrabold text-lg mb-3 flex items-center gap-2"><Clock size={18} /> Delay & Batch Pause</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <NumberField
            label="Delay min (detik)" value={form.delay_min_seconds ?? 0}
            onChange={(v) => setForm(f => ({ ...f, delay_min_seconds: v }))}
            hint="Random delay antar msg. Jangan terlalu cepat."
            min={0} max={120}
          />
          <NumberField
            label="Delay max (detik)" value={form.delay_max_seconds ?? 0}
            onChange={(v) => setForm(f => ({ ...f, delay_max_seconds: v }))}
            hint="Max random delay. 3-10 detik default."
            min={0} max={120}
          />
          <NumberField
            label="Batch size" value={form.batch_size ?? 0}
            onChange={(v) => setForm(f => ({ ...f, batch_size: v }))}
            hint="Jumlah msg sebelum long-pause."
            min={1} max={500}
          />
          <NumberField
            label="Batch pause (menit)" value={form.batch_pause_minutes ?? 0}
            onChange={(v) => setForm(f => ({ ...f, batch_pause_minutes: v }))}
            hint="Pause antar batch. 30 menit default."
            min={0} max={120}
          />
        </div>
      </Card>

      {/* ===== SEND WINDOW ===== */}
      <Card className="mb-4" padding="md">
        <h2 className="font-extrabold text-lg mb-3 flex items-center gap-2"><Calendar size={18} /> Jadwal Kirim (Asia/Jakarta)</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <NumberField
            label="Jam mulai (0-23)" value={form.send_hours_start ?? 0}
            onChange={(v) => setForm(f => ({ ...f, send_hours_start: v }))}
            hint="Sebaiknya 08 pagi. Skip tengah malam."
            min={0} max={23}
          />
          <NumberField
            label="Jam selesai (0-23)" value={form.send_hours_end ?? 0}
            onChange={(v) => setForm(f => ({ ...f, send_hours_end: v }))}
            hint="Sebaiknya 20 (8 malam). Window: jam mulai - jam selesai."
            min={1} max={23}
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer mt-3">
          <input
            type="checkbox" checked={form.skip_friday || false}
            onChange={(e) => setForm(f => ({ ...f, skip_friday: e.target.checked }))}
          />
          <span>Skip Hari Jumat (Friday)</span>
        </label>
      </Card>

      {/* ===== CONTENT RULES ===== */}
      <Card className="mb-4" padding="md">
        <h2 className="font-extrabold text-lg mb-3 flex items-center gap-2"><MessageSquare size={18} /> Konten</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <NumberField
            label="Max links per message" value={form.max_links_per_message ?? 0}
            onChange={(v) => setForm(f => ({ ...f, max_links_per_message: v }))}
            hint="Pesan multi-link sering kena spam filter WA."
            min={0} max={10}
          />
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-muted block mb-1">
              Opt-out keyword
            </label>
            <input
              type="text" value={form.opt_out_keyword || ''}
              onChange={(e) => setForm(f => ({ ...f, opt_out_keyword: e.target.value }))}
              className="w-full min-h-[40px] px-3 py-2 text-sm bg-light border-2 border-transparent rounded-lg focus:outline-none focus:border-primary focus:bg-white"
            />
            <p className="text-[11px] text-muted mt-1">Default: STOP. Recipient balas keyword ini → opt-out (manual handling).</p>
          </div>
        </div>
        <div className="space-y-2 mt-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox" checked={form.require_opt_out_text || false}
              onChange={(e) => setForm(f => ({ ...f, require_opt_out_text: e.target.checked }))}
            />
            <span>Require opt-out text di setiap pesan (block kalau gada)</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox" checked={form.use_spintax || false}
              onChange={(e) => setForm(f => ({ ...f, use_spintax: e.target.checked }))}
            />
            <span>Enable Spintax — varian otomatis pakai <code>{'{a|b|c}'}</code> syntax</span>
          </label>
        </div>
      </Card>

      {/* ===== WARNING / SAVE ===== */}
      <Card className="mb-4" padding="md">
        <div className="bg-warning/10 ring-1 ring-warning/30 rounded-lg p-3 mb-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-warning/90">
            <p className="font-bold text-warning">Red Flags — kalau muncul, sistem auto-pause 48 jam:</p>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>Fonnte response: "restricted" atau "banned"</li>
              <li>Report rate {'>'} 1% dari penerima (manual monitor)</li>
              <li>Notif WhatsApp "akun dibatasi" di burner phone</li>
            </ul>
            <p className="mt-2">
              Kalau salah satu kejadian: turunkan daily_limit 50%, pause 2-3 hari, warm-up ulang.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => update.mutate(form)}
            loading={update.isPending}
            variant="primary"
            disabled={!dirty}
            fullWidth
          >
            <Save size={16} /> Save Settings
          </Button>
          <Button
            onClick={() => setForm({ ...settings })}
            variant="outline"
            disabled={!dirty}
          >
            <RotateCcw size={14} /> Reset
          </Button>
        </div>
      </Card>

      {/* ===== HOW IT WORKS ===== */}
      <Card className="mb-4" padding="md">
        <details>
          <summary className="font-extrabold text-sm cursor-pointer select-none flex items-center justify-between">
            <span className="flex items-center gap-2"><Info size={14} /> Gimana enforcement-nya?</span>
            <span className="text-muted font-normal text-xs">▸ tap</span>
          </summary>
          <div className="mt-3 space-y-2 text-xs text-muted border-t border-border pt-3">
            <p>Setiap blast jalan via <code>send-broadcast-whatsapp</code> edge fn. Sebelum kirim msg pertama, fn check:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Apa blast lagi paused? (manual atau auto)</li>
              <li>Apa jam Jakarta dalam send window?</li>
              <li>Apa hari ini Jumat (kalau skip_friday)?</li>
              <li>Recipient count ≤ max_recipients_per_blast?</li>
              <li>Total today + recipient ≤ daily_limit?</li>
              <li>Body ada ≤ max_links?</li>
              <li>Body ada opt-out keyword (kalau required)?</li>
            </ol>
            <p>Kalau ada violation → blast di-block, admin liat error spesifik.</p>
            <p>Kalau lolos → fn kirim msg satu-satu dengan:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Random delay {`{delay_min...delay_max}`} detik antar msg</li>
              <li>Cap speed_per_minute via rolling 60s window</li>
              <li>Pause batch_pause_minutes setiap batch_size msg (kalau ≤90s, kalau lebih → split blast)</li>
              <li>Auto-pause + 48h cooldown kalau Fonnte balas "restricted"</li>
              <li>Spintax + {`{name}`} replace per recipient</li>
            </ul>
          </div>
        </details>
      </Card>
    </Layout>
  );
}

function NumberField({
  label, value, onChange, hint, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void;
  hint?: string; min?: number; max?: number;
}) {
  return (
    <div>
      <label className="text-xs font-bold uppercase tracking-wide text-muted block mb-1">{label}</label>
      <input
        type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full min-h-[40px] px-3 py-2 text-sm bg-light border-2 border-transparent rounded-lg focus:outline-none focus:border-primary focus:bg-white"
      />
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}
