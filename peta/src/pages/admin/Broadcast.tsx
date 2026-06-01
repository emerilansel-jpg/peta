import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { Send, Mail, MessageCircle, ExternalLink, Check, AlertTriangle, RotateCcw, Megaphone, Zap, Copy } from 'lucide-react';
import {
  createBroadcast,
  listBroadcasts,
  getBroadcastRecipients,
  markRecipientSent,
  sendBroadcastEmails,
  sendBroadcastWhatsapp,
  retryPendingWhatsapp,
  sendTestBroadcast,
  deleteBroadcast,
  buildWhatsappLink,
} from '../../lib/api';
import type { BroadcastChannel } from '../../lib/api';
import { Beaker, Trash2, Settings as SettingsIcon } from 'lucide-react';
import { toast } from '../../components/Toast';

export function AdminBroadcast() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWA, setSendWA] = useState(true);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState(() =>
    localStorage.getItem('peta_test_email') ?? 'n311311@gmail.com'
  );
  const [testWhatsapp, setTestWhatsapp] = useState(() =>
    localStorage.getItem('peta_test_whatsapp') ?? '081290401240'
  );

  useEffect(() => { localStorage.setItem('peta_test_email', testEmail); }, [testEmail]);
  useEffect(() => { localStorage.setItem('peta_test_whatsapp', testWhatsapp); }, [testWhatsapp]);

  const { data: broadcasts = [], isLoading: listLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => listBroadcasts(50),
  });

  // Recipients query — auto-polls every 3s while there are still pending
  // rows so the admin can watch the blast progress in real time without
  // manually refreshing. Stops polling once everything is sent/failed/skipped,
  // so we don't waste API calls on idle broadcasts.
  const { data: recipients = [], isLoading: recipientsLoading } = useQuery({
    queryKey: ['broadcast-recipients', selectedBroadcastId],
    queryFn: () => (selectedBroadcastId ? getBroadcastRecipients(selectedBroadcastId) : Promise.resolve([])),
    enabled: !!selectedBroadcastId,
    refetchInterval: (query) => {
      const data = (query.state.data as any[]) || [];
      const hasPending = data.some((r) => r.status === 'pending');
      return hasPending ? 3_000 : false;
    },
    refetchOnWindowFocus: true,
  });

  // Create broadcast → automatically trigger BOTH email + WA blast. One
  // click = full distribution. No need for the admin to remember to go into
  // the detail panel and click "Blast via Fonnte" separately — that was the
  // root cause of the "WA never got sent" bug user reported.
  //
  // WhatsApp strip_urls is auto-set when Fonnte is on Free plan (URL block),
  // so the blast doesn't silently fail with "invalid message request on
  // free package".
  const createMutation = useMutation({
    mutationFn: async () => {
      const channels: BroadcastChannel[] = [];
      if (sendEmail) channels.push('email');
      if (sendWA) channels.push('whatsapp');
      if (channels.length === 0) throw new Error('Pilih minimal 1 channel');

      const id = await createBroadcast(subject.trim(), body.trim(), channels);

      // Fire email + WA in parallel — both run server-side, admin doesn't
      // wait. Errors are surfaced via toast, partial success is OK because
      // the detail panel shows live progress and retry buttons.
      const fonnteFree = String(fonntStatus.data?.device?.package || '').toLowerCase() === 'free';
      const shouldStripUrls = stripUrls || fonnteFree;

      const tasks: Promise<any>[] = [];
      if (sendEmail) {
        tasks.push(
          sendBroadcastEmails(id).then((res) => {
            if (!res.resend_configured && !(res as any).smtp_configured) {
              toast.error('Email belum aktif — set RESEND_API_KEY di Secrets');
            }
            return { channel: 'email', ...res };
          }).catch((e) => ({ channel: 'email', error: e.message || String(e) }))
        );
      }
      if (sendWA) {
        tasks.push(
          sendBroadcastWhatsapp(id, { stripUrls: shouldStripUrls }).then((res) => ({
            channel: 'whatsapp', ...res,
          })).catch((e) => ({ channel: 'whatsapp', error: e.message || String(e) }))
        );
      }
      await Promise.allSettled(tasks);
      return id;
    },
    onSuccess: (id) => {
      toast.success('Broadcast dibuat & blast jalan — track progress di Riwayat 👇');
      setSubject('');
      setBody('');
      setSelectedBroadcastId(id);
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const markSentMutation = useMutation({
    mutationFn: (recipientId: string) => markRecipientSent(recipientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcast-recipients', selectedBroadcastId] });
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  // Test-send to the admin's own email + WA. Shows the WA link in a toast
  // so admin can click and immediately verify the message in WhatsApp.
  const testMutation = useMutation({
    mutationFn: async () => {
      const channels: BroadcastChannel[] = [];
      if (sendEmail) channels.push('email');
      if (sendWA) channels.push('whatsapp');
      if (channels.length === 0) throw new Error('Pilih minimal 1 channel');
      const res = await sendTestBroadcast({
        subject: subject.trim(),
        body: body.trim(),
        channels,
        testEmail: testEmail.trim() || null,
        testWhatsapp: testWhatsapp.trim() || null,
      });
      return res;
    },
    onSuccess: (res) => {
      const lines: string[] = [];
      const emailOk = res.email_test?.sent;
      const waOk = res.whatsapp_test?.sent;
      if (res.email_test) {
        lines.push(emailOk ? '📧 Email: terkirim' : `📧 Email: ${res.email_test.error || 'gagal'}`);
      }
      if (res.whatsapp_test) {
        lines.push(waOk ? '💬 WA: terkirim via Fonnte' : `💬 WA: ${res.whatsapp_test.error || 'gagal'}`);
      }
      const allOk = (!res.email_test || emailOk) && (!res.whatsapp_test || waOk);
      if (allOk) {
        toast.success(`Test terkirim ✅\n${lines.join('\n')}`);
      } else {
        toast.error(`Test ada yang gagal:\n${lines.join('\n')}`);
      }
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e: any) => toast.error(`Test gagal: ${e.message || e}`),
  });

  const retryEmailMutation = useMutation({
    mutationFn: (broadcastId: string) => sendBroadcastEmails(broadcastId),
    onSuccess: (res) => {
      toast.success(`Email retry: ${res.sent} sent · ${res.failed} failed · ${res.skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ['broadcast-recipients', selectedBroadcastId] });
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  // "Tanpa Link" mode = workaround for Fonnte Free plan which blocks any
  // message containing URLs ("invalid message request on free package").
  // When enabled, the edge fn replaces every URL with "(cek di email atau
  // buka app PeTa)" so the message slides through. Use this if you can't
  // upgrade Fonnte to Personal/Business immediately.
  const [stripUrls, setStripUrls] = React.useState(false);

  // Background WhatsApp blast via Fonnte gateway. Edge fn handles the loop
  // server-side + reports back free-package rejections so we can warn the
  // admin to either toggle stripUrls or upgrade their Fonnte plan.
  const blastWaMutation = useMutation({
    mutationFn: (broadcastId: string) => sendBroadcastWhatsapp(broadcastId, { stripUrls }),
    onSuccess: (res) => {
      if (res.status === 'not_configured') {
        toast.error('Fonnte belum di-setup — FONNTE_TOKEN kosong.');
      } else if (res.status === 'no_recipients') {
        toast.error('Tidak ada penerima WA yang pending.');
      } else if (res.free_package_blocked && res.free_package_blocked > 0) {
        toast.error(
          `${res.free_package_blocked} pesan diblokir Fonnte Free (karena ada link). ` +
          `Aktifkan "Tanpa Link" atau upgrade Fonnte Personal plan.`
        );
      } else {
        toast.success(`WA blast selesai: ${res.sent} terkirim${res.failed ? ` · ${res.failed} gagal` : ''}`);
      }
      queryClient.invalidateQueries({ queryKey: ['broadcast-recipients', selectedBroadcastId] });
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  // On-demand retry for stale-pending WA recipients (manual escape hatch).
  // The pg_cron job already auto-runs every 5 min via the same edge fn — this
  // button just lets the admin trigger NOW instead of waiting up to 5 min.
  const retryPendingMutation = useMutation({
    mutationFn: () => retryPendingWhatsapp({ olderThanMinutes: 1 }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(`Retry gagal: ${res.error || 'unknown'}`);
        return;
      }
      if (res.retried === 0) {
        toast.success('Nggak ada pending WA buat di-retry');
      } else {
        toast.success(`Retry selesai: ${res.sent} terkirim · ${res.failed} gagal dari ${res.retried} pending`);
      }
      queryClient.invalidateQueries({ queryKey: ['broadcast-recipients'] });
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      queryClient.invalidateQueries({ queryKey: ['adminActiveBroadcasts'] });
    },
    onError: (e: any) => toast.error(`Retry error: ${e.message || e}`),
  });

  // Surface Fonnte device + plan status so the admin can see if WA blast
  // will work BEFORE clicking the button. Runs once on tab open.
  const fonntStatus = useQuery({
    queryKey: ['fonnteDeviceStatus'],
    queryFn: async () => {
      const { getFonnteDeviceStatus } = await import('../../lib/api');
      return getFonnteDeviceStatus();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (broadcastId: string) => deleteBroadcast(broadcastId),
    onSuccess: () => {
      toast.success('Broadcast dihapus');
      if (selectedBroadcastId) setSelectedBroadcastId(null);
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e: any) => toast.error(e.message || String(e)),
  });

  const selectedBroadcast = broadcasts.find((b) => b.id === selectedBroadcastId);
  const waRecipients = recipients.filter((r) => r.channel === 'whatsapp');
  const emailRecipients = recipients.filter((r) => r.channel === 'email');
  const waPending = waRecipients.filter((r) => r.status === 'pending').length;
  const waSentCount = waRecipients.filter((r) => r.status === 'sent').length;
  const waFailedCount = waRecipients.filter((r) => r.status === 'failed').length;
  const emailPending = emailRecipients.filter((r) => r.status === 'pending').length;
  const emailSentCount = emailRecipients.filter((r) => r.status === 'sent').length;
  const emailFailedCount = emailRecipients.filter((r) => r.status === 'failed').length;
  // Live progress drives the inline progress bar + global indicator. Auto-poll
  // kicks in at the recipients query (refetchInterval) so these numbers tick
  // in real time while the admin is on this page.
  const isWaBlasting = waPending > 0 && (waSentCount > 0 || waFailedCount > 0 || blastWaMutation.isPending);
  const isEmailBlasting = emailPending > 0 && (emailSentCount > 0 || emailFailedCount > 0 || retryEmailMutation.isPending);

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold flex items-center gap-2">
              <Megaphone size={28} className="text-primary" /> Kirim Pesan
            </h1>
            <p className="text-sm text-muted">
              Email otomatis via Resend/Spacemail. WhatsApp background blast via Fonnte.
            </p>
          </div>
          <a
            href="/admin/broadcast-settings"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg ring-1 ring-border hover:ring-primary hover:text-primary transition"
          >
            🛡️ Anti-Ban Settings
          </a>
        </div>
      </div>

      {/* Setup instructions panel — renders the same content as the .md handoff doc
          but inline so admin can read it without opening any files. Collapsed by
          default to keep the page clean. */}
      <details className="mb-5">
        <summary className="cursor-pointer bg-white ring-1 ring-border hover:ring-primary/40 rounded-xl px-4 py-3 flex items-center gap-2 list-none">
          <SettingsIcon size={16} className="text-primary" />
          <span className="font-bold text-sm">📖 Cara setup Email + WhatsApp (klik untuk buka)</span>
          <span className="ml-auto text-xs text-muted">setup sekali, dipakai selamanya</span>
        </summary>
        <Card className="mt-2">
          <h3 className="font-extrabold text-base mb-3">📧 Setup Email — pilih SATU provider</h3>

          <details open className="mb-3">
            <summary className="cursor-pointer text-sm font-bold text-primary hover:underline list-none">
              ▸ Opsi A: Spacemail (recommended — sama seperti Straight Ltd)
            </summary>
            <div className="mt-2 pl-3 border-l-2 border-primary/30 space-y-2 text-sm">
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>Login ke <a href="https://www.spaceship.com" target="_blank" rel="noopener noreferrer" className="text-primary font-bold hover:underline">spaceship.com</a> → <b>Mail</b> → klik domain <code>penghasilantambahan.com</code></li>
                <li>Bikin inbox baru: <code>peta@penghasilantambahan.com</code></li>
                <li>Set password yang kuat — catat dulu</li>
                <li>Catat SMTP info Spacemail kasih:
                  <div className="bg-light rounded-lg p-2.5 mt-1.5 text-xs space-y-0.5 font-mono">
                    <div>Host: <b>mail.spacemail.com</b></div>
                    <div>SSL Port: <b>465</b></div>
                    <div>User: <b>peta@penghasilantambahan.com</b></div>
                    <div>Pass: <i>(password yang baru set)</i></div>
                  </div>
                </li>
                <li>Paste kredensial di chat (Claude) — saya set Supabase secrets via MCP dalam 30 detik.</li>
              </ol>
              <p className="text-xs text-muted mt-2">
                💡 Atau set sendiri di Supabase Dashboard → Edge Functions → Manage Secrets dengan key:<br/>
                <code className="text-[11px]">SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, BROADCAST_FROM</code>
              </p>
            </div>
          </details>

          <details className="mb-4">
            <summary className="cursor-pointer text-sm font-bold text-primary hover:underline list-none">
              ▸ Opsi B: Resend (kalo Spacemail ribet)
            </summary>
            <div className="mt-2 pl-3 border-l-2 border-primary/30 space-y-2 text-sm">
              <p>Akun sudah dibuat:</p>
              <div className="bg-light rounded-lg p-2.5 text-xs font-mono">
                <div>URL: <a href="https://resend.com/login" target="_blank" rel="noopener noreferrer" className="text-primary">resend.com/login</a></div>
                <div>Email: <b>n311311@gmail.com</b></div>
                <div>Password: <b>PetaResend!2026SecurePwd</b></div>
              </div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Login → API keys → Create → name "PeTa Prod" → Full access → copy <code>re_...</code> key</li>
                <li>Domains → Add → <code>penghasilantambahan.com</code> → screenshot 3 DNS records</li>
                <li>Paste key + screenshot di chat — saya set semuanya</li>
              </ol>
            </div>
          </details>

          <hr className="my-4 border-border" />

          <h3 className="font-extrabold text-base mb-3">💬 Setup WhatsApp — Fonnte</h3>
          <ol className="list-decimal pl-5 space-y-1.5 text-sm">
            <li>Signup di <a href="https://fonnte.com" target="_blank" rel="noopener noreferrer" className="text-primary font-bold hover:underline">fonnte.com</a> (gratis, ~100 pesan/hari)</li>
            <li>Dashboard → <b>Add Device</b> → scan QR pakai WhatsApp di HP yang mau jadi sender PeTa
              <br/><span className="text-xs text-muted">(saran: pakai akun WA khusus admin, bukan personal)</span>
            </li>
            <li>Copy <b>device API token</b> (string panjang)</li>
            <li>Paste di chat → saya set <code>FONNTE_TOKEN</code> di Supabase staging + prod</li>
          </ol>

          <hr className="my-4 border-border" />

          <h3 className="font-extrabold text-base mb-2">🧪 Tes habis setup</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Klik <b>"Test ke Saya Dulu"</b> (tombol orange di atas)</li>
            <li>Cek inbox + spam folder dalam 30 detik</li>
            <li>Buka broadcast detail → klik <b>"Blast via Fonnte"</b> untuk test WA</li>
          </ol>

          <div className="bg-primary/5 ring-1 ring-primary/20 rounded-xl p-3 mt-4">
            <p className="text-xs font-bold text-primary mb-1">💡 Rekomendasi saya:</p>
            <p className="text-xs leading-snug">
              Pakai <b>Spacemail</b> untuk email — domain sudah di Spaceship, no DNS baru perlu di-set, sama seperti Straight Ltd. Pakai <b>Fonnte</b> untuk WhatsApp — Indonesian, free tier cukup, background blast tanpa popup.
            </p>
          </div>
        </Card>
      </details>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Compose */}
        <Card className="lg:sticky lg:top-4">
          <h2 className="text-lg font-extrabold mb-3">Tulis Pesan Baru</h2>

          <label className="block text-xs uppercase font-bold text-muted tracking-wide mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Misal: Task Baru Diumumkan Hari Ini!"
            className="w-full min-h-[44px] px-3 py-2 mb-3 bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white"
            maxLength={200}
          />

          <label className="block text-xs uppercase font-bold text-muted tracking-wide mb-1">Isi Pesan</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'Halo PeTa Army!\n\nHari ini ada task baru yang...'}
            rows={8}
            className="w-full px-3 py-2 mb-3 bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white font-mono text-sm"
            maxLength={4000}
          />

          <label className="block text-xs uppercase font-bold text-muted tracking-wide mb-2">Channel Distribusi</label>
          <div className="space-y-2 mb-4">
            <label className="flex items-center gap-3 p-3 rounded-xl ring-1 ring-border hover:ring-primary/40 cursor-pointer">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              <Mail size={18} className="text-primary" />
              <div className="flex-1">
                <p className="font-bold text-sm">Email</p>
                <p className="text-xs text-muted">Otomatis via Resend (butuh RESEND_API_KEY)</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-xl ring-1 ring-border hover:ring-primary/40 cursor-pointer">
              <input type="checkbox" checked={sendWA} onChange={(e) => setSendWA(e.target.checked)} />
              <MessageCircle size={18} className="text-success" />
              <div className="flex-1">
                <p className="font-bold text-sm">WhatsApp</p>
                <p className="text-xs text-muted">Manual click-through per recipient (link wa.me)</p>
              </div>
            </label>
          </div>

          {/* TEST FIRST — high-value safety net before blasting to N members.
              Sends the same message to admin's own email + WA so layout/typos
              get caught before the real audience sees them. */}
          <div className="mb-2 p-3 bg-warning/5 ring-1 ring-warning/30 rounded-xl">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
              <span className="text-xs font-bold text-warning flex items-center gap-1.5">
                <Beaker size={14} /> Test dulu sebelum blast
              </span>
              <span className="text-[11px] text-muted">auto-saved</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 mb-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Email test"
                className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-warning/40 rounded-lg focus:outline-none focus:border-warning"
              />
              <input
                type="tel"
                value={testWhatsapp}
                onChange={(e) => setTestWhatsapp(e.target.value)}
                placeholder="WA test"
                className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-warning/40 rounded-lg focus:outline-none focus:border-warning"
              />
            </div>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={!subject.trim() || !body.trim() || (!sendEmail && !sendWA)}
              loading={testMutation.isPending}
              variant="outline"
              size="md"
              fullWidth
              className="!border-warning !text-warning hover:!bg-warning hover:!text-white"
            >
              <Beaker size={16} /> Test ke Saya Dulu
            </Button>
          </div>

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!subject.trim() || !body.trim() || (!sendEmail && !sendWA)}
            loading={createMutation.isPending}
            variant="primary"
            size="lg"
            fullWidth
          >
            <Send size={18} /> Kirim ke Semua Member Aktif
          </Button>
          <p className="text-[11px] text-muted mt-2 text-center">
            Pesan otomatis tersimpan di history. Email dikirim langsung. WA: bisa "Open All in Tabs" sekaligus (allow popup di browser dulu) atau click-through per row.
          </p>
        </Card>

        {/* History */}
        <div>
          <h2 className="text-lg font-extrabold mb-3">Riwayat Broadcast</h2>
          {listLoading ? (
            <div className="space-y-2"><CardSkeleton /><CardSkeleton /></div>
          ) : broadcasts.length === 0 ? (
            <Card className="text-center py-10">
              <div className="text-5xl mb-2">📭</div>
              <p className="font-bold">Belum ada broadcast</p>
              <p className="text-sm text-muted">Pesan pertama kamu akan muncul di sini.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {broadcasts.map((b) => {
                const isSelected = b.id === selectedBroadcastId;
                return (
                  <Card
                    key={b.id}
                    padding="sm"
                    className={`transition ${isSelected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/40'}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => setSelectedBroadcastId(isSelected ? null : b.id)}
                        className="block text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="font-extrabold text-sm flex-1 truncate">{b.subject}</p>
                          <p className="text-[11px] text-muted shrink-0">
                            {new Date(b.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                        <p className="text-xs text-muted line-clamp-2 mb-2">{b.body}</p>
                        <div className="flex items-center gap-2 text-[11px] flex-wrap">
                          <span className="text-muted">{b.total_targets} targets</span>
                          {b.channels.includes('email') && (
                            <span className="bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">
                              📧 {b.email_sent}/{b.email_sent + b.email_failed}
                            </span>
                          )}
                          {b.channels.includes('whatsapp') && (
                            <span className="bg-success/10 text-success font-bold px-2 py-0.5 rounded-full">
                              💬 {b.wa_sent} sent
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Hapus broadcast "${b.subject}"?\nIni juga akan hapus semua recipient records.`)) {
                            deleteMutation.mutate(b.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-muted hover:text-danger hover:bg-danger/10 rounded-lg shrink-0"
                        aria-label="Hapus broadcast"
                        title="Hapus broadcast"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Selected broadcast detail */}
      {selectedBroadcast && (
        <Card className="mt-6">
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide font-bold text-muted">Detail Broadcast</p>
              <h2 className="text-xl font-extrabold">{selectedBroadcast.subject}</h2>
              <p className="text-xs text-muted">
                {new Date(selectedBroadcast.created_at).toLocaleString('id-ID')} · {selectedBroadcast.total_targets} targets
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedBroadcast.channels.includes('email') && (
                <Button
                  onClick={() => retryEmailMutation.mutate(selectedBroadcast.id)}
                  loading={retryEmailMutation.isPending}
                  variant="outline"
                  size="sm"
                >
                  <RotateCcw size={14} /> Retry Email
                </Button>
              )}
            </div>
          </div>

          {/* Full message body — admin often needs to copy verbatim into
              external WA tools (Fonnte test, personal phone, group blast).
              Always visible at the top of the detail panel with a 1-click
              copy button. */}
          <div className="bg-light/60 rounded-xl ring-1 ring-black/5 p-3 mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] uppercase tracking-wide font-bold text-muted">Pesan lengkap</p>
              <button
                onClick={async () => {
                  const fullText = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}`;
                  try {
                    await navigator.clipboard.writeText(fullText);
                    toast.success('Pesan disalin ke clipboard ✅');
                  } catch {
                    toast.error('Browser tidak izinkan auto-copy. Pilih manual aja.');
                  }
                }}
                className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
              >
                📋 Copy semua
              </button>
            </div>
            <pre className="text-xs text-dark whitespace-pre-wrap break-words font-sans leading-relaxed bg-white rounded-lg p-3 ring-1 ring-black/5 max-h-[400px] overflow-y-auto">{selectedBroadcast.body}</pre>
          </div>

          {/* ============================================================
              Live blast progress — shows up the moment there's at least one
              pending recipient and one already-touched recipient (sent or
              failed). Updates every 3s via the recipients query refetch.
              Admin can switch tabs / refresh / come back — bar reflects real
              DB state, not local mutation state. Voids the "is it still
              running?" anxiety.
              ============================================================ */}
          {(isWaBlasting || isEmailBlasting) && (
            <div className="bg-primary/5 ring-1 ring-primary/30 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                </span>
                <p className="font-extrabold text-sm">Blast lagi jalan…</p>
                <span className="text-[11px] text-muted ml-auto">Auto-refresh tiap 3 detik</span>
              </div>

              {isWaBlasting && (
                <ProgressRow
                  label="💬 WhatsApp"
                  sent={waSentCount}
                  failed={waFailedCount}
                  pending={waPending}
                  total={waRecipients.length}
                />
              )}
              {isEmailBlasting && (
                <ProgressRow
                  label="📧 Email"
                  sent={emailSentCount}
                  failed={emailFailedCount}
                  pending={emailPending}
                  total={emailRecipients.length}
                />
              )}

              <p className="text-[11px] text-muted mt-3 leading-snug">
                💡 <b>Boleh tinggalin tab ini</b> — blast jalan di server. Mau kerjain Approval / Task Queue dulu? Silakan, progress di-track otomatis. Banner kecil di pojok bakal nemenin.
              </p>
              {isWaBlasting && (
                <div className="mt-3 pt-3 border-t border-primary/20">
                  <Button
                    onClick={() => retryPendingMutation.mutate()}
                    loading={retryPendingMutation.isPending}
                    variant="outline"
                    size="sm"
                  >
                    <RotateCcw size={14} /> Retry yang pending sekarang
                  </Button>
                  <p className="text-[10px] text-muted mt-1.5 leading-snug">
                    Auto-retry tiap 5 menit by cron — klik kalau ga sabar nunggu, atau session Fonnte habis pulih.
                  </p>
                </div>
              )}
            </div>
          )}

          {recipientsLoading ? (
            <CardSkeleton />
          ) : (
            <>
              {/* WhatsApp distribution panel — manual click-through */}
              {waRecipients.length > 0 && (
                <div className="mb-6">
                  {/* Fonnte plan status banner. Critical for the admin to see
                      BEFORE clicking blast — Free plan blocks URLs which are
                      always in our message body, so blasts will silently fail
                      unless they toggle "Tanpa Link" or upgrade the plan. */}
                  {fonntStatus.data?.device && (
                    <div className={`mb-3 rounded-xl p-3 text-xs ring-1 ${
                      String(fonntStatus.data.device.package || '').toLowerCase() === 'free'
                        ? 'bg-warning/10 ring-warning/30 text-warning'
                        : 'bg-success/10 ring-success/30 text-success'
                    }`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-bold">
                          Fonnte: <span className="uppercase">{fonntStatus.data.device.package}</span> plan ·
                          quota {fonntStatus.data.device.quota} ·
                          device {fonntStatus.data.device.device_status}
                        </div>
                        {String(fonntStatus.data.device.package || '').toLowerCase() === 'free' && (
                          <a
                            href="https://fonnte.com/pricing"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-extrabold underline"
                          >
                            Upgrade →
                          </a>
                        )}
                      </div>
                      {String(fonntStatus.data.device.package || '').toLowerCase() === 'free' && (
                        <p className="mt-1 leading-snug">
                          <b>⚠ Free plan blokir pesan ber-URL.</b> Aktifkan "Tanpa Link" di bawah
                          biar blast lewat, atau upgrade Fonnte ke Personal (Rp35-50K/bln).
                        </p>
                      )}
                    </div>
                  )}

                  {/* "Tanpa Link" toggle — replaces every URL in the message
                      body with "(cek di email atau buka app PeTa)" so Fonnte
                      Free doesn't reject it. Email blast keeps the real URLs. */}
                  <label className="mb-3 flex items-start gap-2 text-xs cursor-pointer select-none p-2 bg-light/60 rounded-lg ring-1 ring-black/5">
                    <input
                      type="checkbox"
                      checked={stripUrls}
                      onChange={(e) => setStripUrls(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <b>Tanpa Link</b> — strip semua URL dari pesan WA (workaround Fonnte Free).
                      Email tetap kirim full body dgn link. Recipient diarahkan ke email/app.
                    </span>
                  </label>

                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h3 className="text-sm font-extrabold flex items-center gap-1.5">
                      <MessageCircle size={16} className="text-success" /> WhatsApp ({waPending} pending)
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        onClick={() => blastWaMutation.mutate(selectedBroadcast.id)}
                        loading={blastWaMutation.isPending}
                        variant="success"
                        size="sm"
                      >
                        <Zap size={14} /> Blast via Fonnte{stripUrls ? ' (Tanpa Link)' : ''}
                      </Button>
                      <button
                        onClick={async () => {
                          // CSV: phone,name,message — admin pastes into any
                          // bulk-WA tool (e.g. WA Business Broadcast, Wablas)
                          const message = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}`;
                          const escaped = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
                          const rows = ['phone,name,message'];
                          for (const r of waRecipients) {
                            if (r.status !== 'pending' || !r.whatsapp_snapshot) continue;
                            let p = r.whatsapp_snapshot.replace(/[^0-9]/g, '');
                            if (p.startsWith('0')) p = '62' + p.slice(1);
                            if (p.length < 8) continue;
                            rows.push(`${p},${escaped(r.full_name || '')},${escaped(message)}`);
                          }
                          if (rows.length === 1) { toast.error('Tidak ada nomor pending'); return; }
                          try {
                            await navigator.clipboard.writeText(rows.join('\n'));
                            toast.success(`${rows.length - 1} baris CSV disalin`);
                          } catch { toast.error('Browser block clipboard'); }
                        }}
                        className="text-xs font-bold bg-light text-dark px-3 py-1.5 rounded-full flex items-center gap-1 ring-1 ring-border hover:ring-primary"
                      >
                        <Copy size={12} /> Copy CSV
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted mb-3 leading-snug">
                    💡 <b>Fonnte</b> blast jalan di background — no popups, no tab spam. Setup sekali: signup di fonnte.com, scan QR, paste token jadi <code>FONNTE_TOKEN</code> di Supabase secrets.
                    <br/>
                    Alt: <b>Copy CSV</b> → paste ke WA Business Broadcast List atau tool lain. Per row tetap bisa click-through manual.
                  </p>
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                    {waRecipients.map((r) => {
                      const message = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}`;
                      const link = r.whatsapp_snapshot ? buildWhatsappLink(r.whatsapp_snapshot, message) : '#';
                      return (
                        <div
                          key={r.id}
                          className={`flex items-center gap-2 p-2 rounded-lg ring-1 ${
                            r.status === 'sent' ? 'bg-success/5 ring-success/30' : 'ring-border'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate">{r.full_name || '—'}</p>
                            <p className="text-xs text-muted truncate">{r.whatsapp_snapshot || 'no number'}</p>
                          </div>
                          {r.status === 'sent' ? (
                            <span className="text-xs font-bold text-success flex items-center gap-1">
                              <Check size={14} /> Sent
                            </span>
                          ) : (
                            <>
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-bold bg-success text-white px-2.5 py-1 rounded-full flex items-center gap-1 hover:brightness-110"
                              >
                                <ExternalLink size={12} /> Open WA
                              </a>
                              <button
                                onClick={() => markSentMutation.mutate(r.id)}
                                disabled={markSentMutation.isPending}
                                className="text-xs font-bold bg-light text-dark px-2 py-1 rounded-full hover:bg-success/10 hover:text-success"
                                title="Tandai sudah dikirim"
                              >
                                <Check size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Email status panel */}
              {emailRecipients.length > 0 && (
                <div>
                  <h3 className="text-sm font-extrabold flex items-center gap-1.5 mb-2">
                    <Mail size={16} className="text-primary" /> Email ({selectedBroadcast.email_sent} sent · {selectedBroadcast.email_failed} failed)
                  </h3>
                  {emailRecipients.some((r) => r.status === 'failed' || r.status === 'skipped') && (
                    <div className="bg-warning/10 ring-1 ring-warning/30 rounded-xl p-3 mb-3 flex items-start gap-2">
                      <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-warning">
                          {emailRecipients.filter((r) => r.status === 'failed' || r.status === 'skipped').length} email gagal
                        </p>
                        <p className="text-[11px] text-muted">
                          Lihat error detail di bawah. Set RESEND_API_KEY di Supabase secrets kalau "skipped" karena Resend belum dikonfigurasi.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {emailRecipients.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg ring-1 ring-border text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">{r.email_snapshot}</p>
                          {r.error && <p className="text-[10px] text-danger truncate">{r.error}</p>}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold ${
                            r.status === 'sent'
                              ? 'bg-success/10 text-success'
                              : r.status === 'failed'
                              ? 'bg-danger/10 text-danger'
                              : r.status === 'skipped'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-light text-muted'
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </Layout>
  );
}

// Single-line progress row for the live blast indicator. Shows a labeled
// progress bar with sent / failed / pending counts so the admin can see at
// a glance how far the blast is. Renders for both WhatsApp + Email channels.
function ProgressRow({
  label, sent, failed, pending, total,
}: { label: string; sent: number; failed: number; pending: number; total: number }) {
  const done = sent + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-dark">{label}</p>
        <p className="text-xs font-bold text-primary tabular-nums">
          {done} / {total} <span className="text-muted font-normal">({pct}%)</span>
        </p>
      </div>
      <div className="h-2 bg-light rounded-full overflow-hidden flex">
        {/* Sent segment — solid green */}
        <div
          className="bg-success transition-all duration-500"
          style={{ width: `${total > 0 ? (sent / total) * 100 : 0}%` }}
        />
        {/* Failed segment — solid red */}
        <div
          className="bg-danger transition-all duration-500"
          style={{ width: `${total > 0 ? (failed / total) * 100 : 0}%` }}
        />
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> {sent} sent</span>
        {failed > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger" /> {failed} failed</span>}
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-light ring-1 ring-border" /> {pending} antri</span>
      </div>
    </div>
  );
}
