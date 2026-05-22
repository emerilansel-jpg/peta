// Admin → WA Bot
//
// One-stop UI for managing the WhatsApp verifier bot:
//   1. Show connection status (open / connecting / close)
//   2. Show QR code when not connected — admin scans with burner WA
//   3. Show / save webhook URL pointing to N8N
//   4. Show / pick the PeTa group JID (after bot joins the group)
//   5. Show the webhook secret (for N8N HTTP node config)
//   6. List unverified army members + give bulk-DM CTA (Phase 1 closing path)
//
// All Evolution calls go through the SECURITY DEFINER edge function
// `wa-bot-proxy` so EVOLUTION_API_KEY never leaks to the browser.
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { RefreshCw, QrCode, LinkIcon, Users, Copy, CheckCircle2, AlertCircle, Power } from 'lucide-react';

async function callProxy(action: string, payload: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('wa-bot-proxy', {
    body: { action, ...payload },
  });
  if (error) throw error;
  return data;
}

function copyToClipboard(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

export function AdminWaBot() {
  const qc = useQueryClient();

  // === Config (URL + group JID + secret presence) ===
  const { data: config } = useQuery({
    queryKey: ['waBotConfig'],
    queryFn: () => callProxy('get_config'),
  });

  // === Status + QR (polling) ===
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['waBotStatus'],
    queryFn: () => callProxy('status'),
    refetchInterval: 5_000,
  });
  const connState: string = status?.body?.instance?.state || status?.body?.state || 'unknown';
  const isConnected = connState === 'open';

  const { data: qrData, refetch: refetchQR } = useQuery({
    queryKey: ['waBotQR'],
    queryFn: () => callProxy('qr'),
    enabled: !isConnected,
    refetchInterval: isConnected ? false : 10_000,
  });
  const qrBase64: string | undefined =
    qrData?.body?.base64 || qrData?.body?.qrcode?.base64 || qrData?.body?.qr;
  const pairingCode: string | undefined = qrData?.body?.code || qrData?.body?.pairingCode;

  // === Unverified army list (for Phase 1 broadcast) ===
  const { data: unverified = [] } = useQuery({
    queryKey: ['waUnverified'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_wa_unverified');
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // === Mutations ===
  const createInstance = useMutation({
    mutationFn: () => callProxy('create'),
    onSuccess: () => { toast.success('Instance dibuat / di-reset'); qc.invalidateQueries({ queryKey: ['waBotStatus'] }); qc.invalidateQueries({ queryKey: ['waBotQR'] }); },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });
  const restart = useMutation({
    mutationFn: () => callProxy('restart'),
    onSuccess: () => { toast.success('Restart sent'); refetchStatus(); refetchQR(); },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });
  const disconnect = useMutation({
    mutationFn: () => callProxy('disconnect'),
    onSuccess: () => { toast.success('Disconnected'); qc.invalidateQueries({ queryKey: ['waBotStatus'] }); },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const [webhookUrl, setWebhookUrl] = React.useState('');
  React.useEffect(() => { if (config?.webhook_url) setWebhookUrl(config.webhook_url); }, [config?.webhook_url]);
  const saveWebhook = useMutation({
    mutationFn: () => callProxy('set_webhook', { url: webhookUrl }),
    onSuccess: () => { toast.success('Webhook saved'); qc.invalidateQueries({ queryKey: ['waBotConfig'] }); },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const [groupSearchOpen, setGroupSearchOpen] = React.useState(false);
  const { data: groups, refetch: refetchGroups } = useQuery({
    queryKey: ['waBotGroups'],
    queryFn: () => callProxy('list_groups'),
    enabled: groupSearchOpen,
  });
  const setGroupJid = useMutation({
    mutationFn: (jid: string) => callProxy('set_group_jid', { jid }),
    onSuccess: () => { toast.success('Group JID saved'); qc.invalidateQueries({ queryKey: ['waBotConfig'] }); setGroupSearchOpen(false); },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  const stateBadge = (() => {
    if (connState === 'open') return { color: 'bg-success/15 text-success ring-success/30', label: '🟢 CONNECTED' };
    if (connState === 'connecting') return { color: 'bg-warning/15 text-warning ring-warning/30', label: '🟡 CONNECTING' };
    if (connState === 'close') return { color: 'bg-danger/15 text-danger ring-danger/30', label: '🔴 DISCONNECTED' };
    return { color: 'bg-light text-muted ring-border', label: connState };
  })();

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">WhatsApp Bot Verifier</h1>
        <p className="text-sm text-muted">Verifikasi army yang join grup WA — auto-credit Rp5.000 saat ketik <code>peta</code></p>
      </div>

      {/* ===== STATUS + QR ===== */}
      <Card className="mb-4" padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-extrabold text-lg flex items-center gap-2"><QrCode size={18} /> Bot Connection</h2>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ring-1 ${stateBadge.color}`}>{stateBadge.label}</span>
        </div>

        {!isConnected && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted mb-2">Scan QR di WhatsApp burner phone → Settings → Linked Devices → Link a Device.</p>
              {qrBase64 ? (
                <img src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`} alt="QR" className="w-64 h-64 rounded-lg ring-1 ring-border" />
              ) : (
                <div className="w-64 h-64 bg-light rounded-lg ring-1 ring-border grid place-items-center text-xs text-muted text-center px-4">
                  {qrData ? 'Loading QR…' : 'Klik "Create / Reset Instance" dulu kalau belum pernah'}
                </div>
              )}
              {pairingCode && (
                <p className="text-xs text-muted mt-2">Pairing code (alternatif scan): <code className="font-bold">{pairingCode}</code></p>
              )}
            </div>
            <div className="space-y-2">
              <Button onClick={() => createInstance.mutate()} loading={createInstance.isPending} variant="primary" size="md" fullWidth>
                <Power size={16} /> Create / Reset Instance
              </Button>
              <Button onClick={() => refetchQR()} variant="outline" size="md" fullWidth>
                <RefreshCw size={16} /> Refresh QR
              </Button>
              <Button onClick={() => restart.mutate()} loading={restart.isPending} variant="outline" size="md" fullWidth>
                <RefreshCw size={16} /> Restart Connection
              </Button>
            </div>
          </div>
        )}

        {isConnected && (
          <div className="bg-success/10 ring-1 ring-success/30 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle2 size={24} className="text-success shrink-0" />
            <div className="flex-1">
              <p className="font-extrabold text-success">Bot tersambung ke WhatsApp ✅</p>
              <p className="text-xs text-success/90 mt-1">
                Setiap army ketik <code>peta</code> di grup → auto-credit Rp5.000.
                Pastikan group JID di bawah sudah di-set.
              </p>
              <div className="flex gap-2 mt-3">
                <Button onClick={() => disconnect.mutate()} loading={disconnect.isPending} variant="outline" size="sm" className="!border-danger !text-danger">
                  <Power size={14} /> Disconnect
                </Button>
                <Button onClick={() => restart.mutate()} loading={restart.isPending} variant="outline" size="sm">
                  <RefreshCw size={14} /> Restart
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ===== CONFIG ===== */}
      <Card className="mb-4" padding="md">
        <h2 className="font-extrabold text-lg mb-3 flex items-center gap-2"><LinkIcon size={18} /> Konfigurasi</h2>
        <div className="space-y-3 text-sm">
          {/* N8N Webhook URL */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-muted block mb-1">N8N Webhook URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://n8n.46-250-239-138.sslip.io/webhook/wa-incoming"
                className="flex-1 min-h-[40px] px-3 py-2 text-sm bg-light border-2 border-transparent rounded-lg focus:outline-none focus:border-primary focus:bg-white"
              />
              <Button onClick={() => saveWebhook.mutate()} loading={saveWebhook.isPending} variant="primary" size="md">Save</Button>
            </div>
            <p className="text-[11px] text-muted mt-1">Webhook URL dari N8N flow "PeTa WA Verifier". Save → auto-set di Evolution.</p>
          </div>

          {/* Group JID */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-muted block mb-1">PeTa WA Group JID</label>
            <div className="flex gap-2 items-center">
              <code className="flex-1 px-3 py-2 bg-light rounded-lg text-xs truncate">{config?.group_jid || '— belum di-set —'}</code>
              {config?.group_jid && (
                <button onClick={() => copyToClipboard(config.group_jid)} className="p-2 text-muted hover:text-dark"><Copy size={14} /></button>
              )}
              <Button onClick={() => { setGroupSearchOpen(true); refetchGroups(); }} variant="outline" size="md">Pilih dari list</Button>
            </div>
            <p className="text-[11px] text-muted mt-1">Bot harus udah join grup PeTa dulu — terus pilih dari list di bawah.</p>
          </div>

          {/* Group picker (collapsible) */}
          {groupSearchOpen && (
            <div className="bg-light rounded-lg p-3">
              <p className="text-xs font-bold mb-2">Pilih PeTa group:</p>
              {!groups ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(groups?.body || []).map((g: any) => (
                    <button
                      key={g.id}
                      onClick={() => setGroupJid.mutate(g.id)}
                      className="w-full text-left p-2 bg-white rounded hover:bg-primary/5 ring-1 ring-border text-xs"
                    >
                      <p className="font-bold">{g.subject || g.id}</p>
                      <p className="text-muted text-[10px]"><code>{g.id}</code> · {g.size || '?'} members</p>
                    </button>
                  ))}
                  {(!groups?.body || groups.body.length === 0) && (
                    <p className="text-xs text-muted">Bot belum join grup mana pun. Invite ke grup PeTa dulu.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Webhook secret indicator */}
          <div className="flex items-center gap-2 text-xs">
            {config?.webhook_secret_set ? (
              <><CheckCircle2 size={14} className="text-success" /> <span>Webhook secret tersimpan ✅</span></>
            ) : (
              <><AlertCircle size={14} className="text-warning" /> <span>Webhook secret belum di-set di app_secrets</span></>
            )}
          </div>
        </div>
      </Card>

      {/* ===== UNVERIFIED ARMY LIST ===== */}
      <Card className="mb-4" padding="md">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-extrabold text-lg flex items-center gap-2"><Users size={18} /> Army Belum Verified</h2>
          <span className="text-xs text-muted">{unverified.length} orang</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Army yang belum ketik <code>peta</code> di grup. DM mereka satu-satu pakai broadcast tool, atau biarin sampai mereka type sendiri.
        </p>
        {unverified.length === 0 ? (
          <p className="text-xs text-success">Semua army udah verified 🎉</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {unverified.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between text-xs p-2 bg-light rounded">
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{u.full_name}</p>
                  <p className="text-muted text-[10px]"><code>{u.normalized_phone || u.whatsapp}</code> · {u.email}</p>
                </div>
                <a
                  href={`https://wa.me/${u.normalized_phone || u.whatsapp}?text=${encodeURIComponent('Hai! Untuk unlock bonus Rp5.000 dari PeTa, join grup WhatsApp ini lalu ketik "peta" — saldo langsung masuk otomatis. Link grup: [paste link grup]')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="shrink-0 text-primary font-bold ml-2 hover:underline"
                >DM →</a>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Layout>
  );
}
