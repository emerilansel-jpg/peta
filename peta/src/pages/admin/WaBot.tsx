// Admin → WA Bot (Chrome Extension flow)
//
// As of 2026-05-22 we pivoted from Evolution API / Baileys on the VPS to a
// Chrome Extension that runs on web.whatsapp.com in the admin's browser. The
// VPS-side Baileys lib couldn't establish a WhatsApp session from a data-center
// IP (WhatsApp blocks data-center signaling), so we route through the admin's
// real WA Web session instead.
//
// This page now:
//   1. Shows the extension token (admin pastes into the extension popup)
//   2. Provides a download link for the packaged extension ZIP
//   3. Shows recent verifications + stats so admin can confirm it's working
//   4. Keeps the unverified army list for manual DM fallback
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import {
  Globe, Download, Copy, RefreshCw, Eye, EyeOff,
  CheckCircle2, AlertCircle, Users, Activity, Shield, Server, Webhook,
} from 'lucide-react';

function copyToClipboard(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}d lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.floor(h / 24)}h lalu`;
}

const REASON_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' }> = {
  user_not_found: { label: 'Belum daftar', tone: 'warn' },
  already_claimed: { label: 'Sudah diklaim', tone: 'warn' },
  invalid_phone: { label: 'Nomor invalid', tone: 'err' },
  rpc_error: { label: 'RPC error', tone: 'err' },
};

export function AdminWaBot() {
  const qc = useQueryClient();
  const [showToken, setShowToken] = React.useState(false);
  const [showFonnteSecret, setShowFonnteSecret] = React.useState(false);

  // === Fonnte webhook (PRIMARY path — server-side, no laptop required) ===
  // RPC returns just the secret; URL is constructed client-side so the
  // same RPC works for both staging and prod without a stored base URL.
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  const { data: fonnteRawSecret } = useQuery({
    queryKey: ['fonnteWebhookSecret'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_fonnte_webhook_secret');
      if (error) throw error;
      return data as string;
    },
  });

  const fonnteWebhook = fonnteRawSecret
    ? { webhook_url: `${supabaseUrl}/functions/v1/wa-fonnte-webhook?secret=${fonnteRawSecret}`, secret: fonnteRawSecret }
    : null;

  const rotateFonnteSecret = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_rotate_fonnte_webhook_secret');
      if (error) throw error;
      return data as string; // new secret
    },
    onSuccess: () => {
      toast.success('Secret di-rotate. Update URL di Fonnte dashboard.');
      qc.invalidateQueries({ queryKey: ['fonnteWebhookSecret'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  // === Extension token ===
  const { data: tokenData, isLoading: tokenLoading } = useQuery({
    queryKey: ['waExtensionToken'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_wa_extension_token');
      if (error) throw error;
      return data as string;
    },
  });

  const rotateToken = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_rotate_wa_extension_token');
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success('Token di-rotate. Extension lama otomatis tidak valid.');
      qc.invalidateQueries({ queryKey: ['waExtensionToken'] });
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  // === Recent verifications log ===
  const { data: verifyLog = [] } = useQuery({
    queryKey: ['waExtensionLog'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_wa_extension_log', { p_limit: 50 });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: 10_000,
  });

  // === Unverified army list (fallback DM tool) ===
  const { data: unverified = [] } = useQuery({
    queryKey: ['waUnverified'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_wa_unverified');
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Stats derived from log
  const verifiedCount = verifyLog.filter(v => v.result_ok).length;
  const lastVerifyAt = verifyLog.find(v => v.result_ok)?.created_at;
  const isHealthy = !!lastVerifyAt && (Date.now() - new Date(lastVerifyAt).getTime()) < 24 * 60 * 60 * 1000;

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">WhatsApp Bot Verifier</h1>
        <p className="text-sm text-muted">
          Auto-credit Rp5.000 saat army ketik <code>peta</code> di grup WhatsApp — via Chrome Extension yang jalan di laptop kamu.
        </p>
      </div>

      {/* ===== FONNTE WEBHOOK (PRIMARY) ===== */}
      <Card className="mb-4" padding="md">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Server size={20} className="text-primary" />
            <h2 className="font-extrabold text-lg">Fonnte Webhook <span className="text-[10px] uppercase tracking-wider bg-success/15 text-success px-2 py-0.5 rounded-full ml-1">Recommended</span></h2>
          </div>
          <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full ring-1 bg-success/15 text-success ring-success/30">
            🟢 24/7 Server-side
          </span>
        </div>

        <p className="text-sm text-muted mb-4">
          Pakai infra Fonnte yang udah dipake buat broadcast. Mereka host burner phone 24/7, kita cuma terima webhook tiap army ketik "peta" di grup. <strong>Ga butuh komputer admin nyala.</strong>
        </p>

        <div className="bg-primary/5 ring-1 ring-primary/20 rounded-xl p-4 mb-4">
          <h3 className="font-extrabold text-sm mb-2 flex items-center gap-2">
            <Webhook size={16} /> Setup (10 menit, browser only)
          </h3>
          <ol className="text-xs space-y-2 list-decimal pl-5">
            <li>Login <a href="https://md.fonnte.com" target="_blank" rel="noopener noreferrer" className="text-primary font-bold underline">md.fonnte.com</a> → cek <strong>My Device</strong> → catat nomor Fonnte</li>
            <li>Invite nomor Fonnte ke grup <strong>PeTa Army</strong> di WhatsApp (kalau belum)</li>
            <li>Fonnte dashboard → <strong>Device Settings</strong> → <strong>Incoming Webhook</strong></li>
            <li>Paste URL di bawah ↓ → enable <strong>"Forward group messages"</strong> → Save</li>
            <li>Klik tombol <strong>Test Webhook</strong> di Fonnte. Expected: 200 OK.</li>
            <li>Test end-to-end: minta army ketik "peta" di grup → cek "Recent Verifications" panel</li>
          </ol>
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted block mb-1">
            <Webhook size={12} className="inline mr-1" /> Webhook URL (paste ke Fonnte dashboard)
          </label>
          <div className="flex gap-2 items-stretch">
            <code className="flex-1 px-3 py-2 bg-light rounded-lg text-[11px] font-mono break-all ring-1 ring-border min-h-[40px] flex items-center">
              {fonnteWebhook
                ? (showFonnteSecret
                    ? fonnteWebhook.webhook_url
                    : fonnteWebhook.webhook_url.replace(/secret=[a-f0-9]+/, 'secret=••••••••••••••••'))
                : 'Loading...'}
            </code>
            <button
              onClick={() => setShowFonnteSecret(s => !s)}
              className="p-2 text-muted hover:text-dark bg-light rounded-lg ring-1 ring-border"
              title={showFonnteSecret ? 'Sembunyikan' : 'Tampilkan'}
            >
              {showFonnteSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={() => fonnteWebhook && copyToClipboard(fonnteWebhook.webhook_url, 'Webhook URL disalin')}
              className="p-2 text-muted hover:text-dark bg-light rounded-lg ring-1 ring-border"
              title="Copy"
            >
              <Copy size={14} />
            </button>
            <Button
              onClick={() => {
                if (confirm('Rotate secret? URL Fonnte lama langsung berhenti — kamu wajib paste URL baru ke Fonnte dashboard setelah ini.')) {
                  rotateFonnteSecret.mutate();
                }
              }}
              loading={rotateFonnteSecret.isPending}
              variant="outline"
              size="sm"
            >
              <RefreshCw size={14} /> Rotate
            </Button>
          </div>
          <p className="text-[11px] text-muted mt-1">
            URL include secret query param. Kalau bocor → klik Rotate.
          </p>
        </div>
      </Card>

      {/* ===== STATUS PANEL — Chrome Extension (BACKUP) ===== */}
      <Card className="mb-4" padding="md">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Globe size={20} className="text-muted" />
            <h2 className="font-extrabold text-lg">Chrome Extension <span className="text-[10px] uppercase tracking-wider bg-warning/15 text-warning px-2 py-0.5 rounded-full ml-1">Backup</span></h2>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ring-1 ${
            isHealthy
              ? 'bg-success/15 text-success ring-success/30'
              : 'bg-warning/15 text-warning ring-warning/30'
          }`}>
            {isHealthy ? '🟢 ACTIVE' : '🟡 NO RECENT ACTIVITY'}
          </span>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-muted">Verified (50 last)</p>
            <p className="text-2xl font-extrabold text-primary">{verifiedCount}</p>
          </div>
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-muted">Last verify</p>
            <p className="text-sm font-extrabold">{lastVerifyAt ? timeAgo(lastVerifyAt) : '—'}</p>
          </div>
          <div className="bg-light rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-muted">Unverified army</p>
            <p className="text-2xl font-extrabold">{unverified.length}</p>
          </div>
        </div>

        {/* ===== Download + Install ===== */}
        <div className="bg-primary/5 ring-1 ring-primary/20 rounded-xl p-4 mb-4">
          <h3 className="font-extrabold text-sm mb-2 flex items-center gap-2">
            <Download size={16} /> Setup Pertama Kali (5 menit)
          </h3>
          <ol className="text-xs space-y-2 list-decimal pl-5">
            <li>
              <a href="/peta-wa-verifier.zip" download className="text-primary font-bold underline">
                Download peta-wa-verifier.zip
              </a>{' '}
              → extract ke folder permanen (contoh: <code>C:\peta-wa-verifier\</code>)
            </li>
            <li>
              Buka Chrome → ketik <code>chrome://extensions</code> → toggle <strong>Developer mode</strong> (kanan atas)
            </li>
            <li>
              Klik <strong>Load unpacked</strong> → pilih folder hasil extract
            </li>
            <li>
              Klik icon puzzle 🧩 di toolbar Chrome → pin extension "PeTa WA Verifier"
            </li>
            <li>
              Klik icon extension → isi <strong>Nama Grup</strong> (contoh: <code>PeTa Army</code>) + <strong>Extension Token</strong> dari kotak di bawah → toggle ON → <strong>Simpan</strong>
            </li>
            <li>
              Buka <a href="https://web.whatsapp.com" target="_blank" rel="noopener noreferrer" className="text-primary font-bold underline">web.whatsapp.com</a> → scan QR pakai burner phone → klik grup PeTa → done!
            </li>
          </ol>
        </div>

        {/* ===== Token ===== */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted block mb-1">
            <Shield size={12} className="inline mr-1" /> Extension Token
          </label>
          <div className="flex gap-2 items-stretch">
            <code className="flex-1 px-3 py-2 bg-light rounded-lg text-xs font-mono truncate ring-1 ring-border">
              {tokenLoading ? 'Loading...' : (showToken ? tokenData : (tokenData || '').replace(/./g, '•'))}
            </code>
            <button
              onClick={() => setShowToken(s => !s)}
              className="p-2 text-muted hover:text-dark bg-light rounded-lg ring-1 ring-border"
              title={showToken ? 'Sembunyikan' : 'Tampilkan'}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={() => tokenData && copyToClipboard(tokenData, 'Token disalin')}
              className="p-2 text-muted hover:text-dark bg-light rounded-lg ring-1 ring-border"
              title="Copy"
            >
              <Copy size={14} />
            </button>
            <Button
              onClick={() => {
                if (confirm('Rotate token? Extension lama akan langsung berhenti kerja sampai token baru di-paste.')) {
                  rotateToken.mutate();
                }
              }}
              loading={rotateToken.isPending}
              variant="outline"
              size="sm"
            >
              <RefreshCw size={14} /> Rotate
            </Button>
          </div>
          <p className="text-[11px] text-muted mt-1">
            Paste ke field "Extension Token" di popup extension. Kalau bocor → klik Rotate (lama langsung invalid).
          </p>
        </div>
      </Card>

      {/* ===== RECENT VERIFICATIONS ===== */}
      <Card className="mb-4" padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-lg flex items-center gap-2">
            <Activity size={18} /> Recent Verifications
          </h2>
          <span className="text-xs text-muted">{verifyLog.length} entries (auto-refresh 10s)</span>
        </div>
        {verifyLog.length === 0 ? (
          <div className="bg-light rounded-lg p-4 text-center">
            <p className="text-sm text-muted">Belum ada verifikasi.</p>
            <p className="text-xs text-muted mt-1">Install extension dulu → minta army ketik "peta" di grup.</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {verifyLog.map((v: any) => {
              const meta = REASON_LABEL[v.result_reason] || (v.result_ok ? { label: 'OK', tone: 'ok' } : { label: v.result_reason || '?', tone: 'err' });
              return (
                <div key={v.id} className="flex items-center justify-between text-xs p-2 bg-light rounded">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold truncate">
                      {v.full_name || <span className="text-muted">[no match]</span>}
                      {' · '}
                      <code className="text-muted">{v.phone}</code>
                    </p>
                    <p className="text-muted text-[10px] truncate">
                      "{v.message_body || '(no body)'}" · {timeAgo(v.created_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 ml-2 text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                    v.result_ok ? 'bg-success/15 text-success' :
                    meta.tone === 'warn' ? 'bg-warning/15 text-warning' :
                    'bg-danger/15 text-danger'
                  }`}>
                    {v.result_ok ? '+Rp5K ✅' : meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ===== UNVERIFIED ARMY LIST ===== */}
      <Card className="mb-4" padding="md">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-extrabold text-lg flex items-center gap-2"><Users size={18} /> Army Belum Verified</h2>
          <span className="text-xs text-muted">{unverified.length} orang</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Army yang belum ketik <code>peta</code> di grup. Tombol DM buka WhatsApp dgn pesan template — atau cukup biarkan, extension auto-credit saat mereka ketik sendiri.
        </p>
        {unverified.length === 0 ? (
          <div className="bg-success/5 ring-1 ring-success/20 rounded-lg p-3 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-success" />
            <p className="text-xs text-success font-bold">Semua army udah verified 🎉</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {unverified.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between text-xs p-2 bg-light rounded">
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{u.full_name}</p>
                  <p className="text-muted text-[10px]">
                    <code>{u.normalized_phone || u.whatsapp}</code> · {u.email}
                  </p>
                </div>
                <a
                  href={`https://wa.me/${u.normalized_phone || u.whatsapp}?text=${encodeURIComponent(
                    'Hai! Untuk unlock bonus Rp5.000 dari PeTa, join grup WhatsApp ini lalu ketik "peta" — saldo langsung masuk otomatis. Link grup: [paste link grup]'
                  )}`}
                  target="_blank" rel="noopener noreferrer"
                  className="shrink-0 text-primary font-bold ml-2 hover:underline"
                >DM →</a>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ===== HOW IT WORKS (collapsed) ===== */}
      <Card className="mb-4" padding="md">
        <details>
          <summary className="font-extrabold text-sm cursor-pointer select-none list-none flex items-center justify-between">
            <span>Gimana cara kerjanya?</span>
            <span className="text-muted font-normal text-xs">▸ tap untuk buka</span>
          </summary>
          <div className="mt-3 space-y-2 text-xs text-muted border-t border-border pt-3">
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold grid place-items-center">1</span>
              <p><strong>Admin pasang Chrome Extension</strong> di laptop sendiri + login WA Web pakai burner phone yang udah join grup PeTa.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold grid place-items-center">2</span>
              <p><strong>Army ketik <code>peta</code></strong> di grup WA. Extension monitor pesan baru tiap 3 detik.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold grid place-items-center">3</span>
              <p><strong>Extension ekstrak nomor sender</strong> dari DOM message → POST ke Supabase edge function dengan extension token.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold grid place-items-center">4</span>
              <p><strong>Edge function validate</strong> → call RPC <code>claim_wa_group_by_phone</code> → credit Rp5.000 + set <code>wa_group_verified=true</code>.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold grid place-items-center">5</span>
              <p><strong>Extension nampil toast hijau</strong> di WA Web: "✅ Bonus Rp5.000 terkirim". Army langsung lihat saldo nambah di app PeTa.</p>
            </div>
            <div className="bg-light rounded-lg p-3 mt-3">
              <p className="font-bold text-dark mb-1">Yang perlu jalan terus:</p>
              <p>• Laptop nyala + Chrome buka tab WA Web (pin tab biar ga accidental close)</p>
              <p>• Burner phone tetap online (jangan logout dari Linked Devices)</p>
              <p>• Extension toggle ON (cek dari popup icon)</p>
            </div>
            <div className="bg-warning/5 ring-1 ring-warning/20 rounded-lg p-3 mt-2 flex items-start gap-2">
              <AlertCircle size={14} className="text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-warning text-xs">Kenapa bukan VPS bot?</p>
                <p className="text-[11px] text-warning/80">
                  WhatsApp blokir login dari IP data-center (sama kaya Reddit). Extension pakai sesi WA Web dari laptop admin — sah, ga bisa di-blokir.
                </p>
              </div>
            </div>
          </div>
        </details>
      </Card>
    </Layout>
  );
}
