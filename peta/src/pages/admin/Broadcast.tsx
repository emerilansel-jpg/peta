import { useState } from 'react';
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
  sendTestBroadcast,
  buildWhatsappLink,
} from '../../lib/api';
import type { BroadcastChannel } from '../../lib/api';
import { Beaker } from 'lucide-react';
import { toast } from '../../components/Toast';

export function AdminBroadcast() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWA, setSendWA] = useState(true);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<string | null>(null);
  // Test broadcast — admin can override which email/phone receives the test
  // (defaults to whatever's on their user row server-side).
  const [testEmail, setTestEmail] = useState('');
  const [testWhatsapp, setTestWhatsapp] = useState('');
  const [showTestOverride, setShowTestOverride] = useState(false);

  const { data: broadcasts = [], isLoading: listLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => listBroadcasts(50),
  });

  const { data: recipients = [], isLoading: recipientsLoading } = useQuery({
    queryKey: ['broadcast-recipients', selectedBroadcastId],
    queryFn: () => (selectedBroadcastId ? getBroadcastRecipients(selectedBroadcastId) : Promise.resolve([])),
    enabled: !!selectedBroadcastId,
  });

  // Create broadcast → automatically trigger email send.
  const createMutation = useMutation({
    mutationFn: async () => {
      const channels: BroadcastChannel[] = [];
      if (sendEmail) channels.push('email');
      if (sendWA) channels.push('whatsapp');
      if (channels.length === 0) throw new Error('Pilih minimal 1 channel');

      const id = await createBroadcast(subject.trim(), body.trim(), channels);

      // Kick off email send if requested
      if (sendEmail) {
        try {
          const res = await sendBroadcastEmails(id);
          if (!res.resend_configured) {
            toast.error('Email belum aktif — set RESEND_API_KEY di Supabase secrets');
          }
        } catch (e: any) {
          toast.error(`Email send error: ${e.message || e}`);
        }
      }
      return id;
    },
    onSuccess: (id) => {
      toast.success('Broadcast dibuat — buka detail untuk distribusi WhatsApp');
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
      const lines = ['Test terkirim ✅'];
      if (res.email_test) {
        lines.push(res.email_test.sent ? '· Email: sent' : `· Email: ${res.email_test.error || 'gagal'}`);
      }
      if (res.whatsapp_test?.link) {
        lines.push('· WhatsApp: buka link');
        window.open(res.whatsapp_test.link, '_blank', 'noopener,noreferrer');
      }
      toast.success(lines.join(' '));
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

  const selectedBroadcast = broadcasts.find((b) => b.id === selectedBroadcastId);
  const waRecipients = recipients.filter((r) => r.channel === 'whatsapp');
  const emailRecipients = recipients.filter((r) => r.channel === 'email');
  const waPending = waRecipients.filter((r) => r.status === 'pending').length;

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold flex items-center gap-2">
          <Megaphone size={28} className="text-primary" /> Kirim Pesan
        </h1>
        <p className="text-sm text-muted">
          Pesan terdistribusi ke email (otomatis via Resend) + WhatsApp (manual per recipient via wa.me).
        </p>
      </div>

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
              <button
                onClick={() => setShowTestOverride((s) => !s)}
                className="text-[11px] text-muted hover:text-dark underline"
              >
                {showTestOverride ? '× hide' : 'Kirim ke alamat lain →'}
              </button>
            </div>
            {showTestOverride && (
              <div className="grid sm:grid-cols-2 gap-2 mb-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="Email test (kosong = email saya)"
                  className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-warning/40 rounded-lg focus:outline-none focus:border-warning"
                />
                <input
                  type="tel"
                  value={testWhatsapp}
                  onChange={(e) => setTestWhatsapp(e.target.value)}
                  placeholder="WA test (kosong = WA saya)"
                  className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-warning/40 rounded-lg focus:outline-none focus:border-warning"
                />
              </div>
            )}
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
                    className={`cursor-pointer transition ${isSelected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/40'}`}
                  >
                    <button
                      onClick={() => setSelectedBroadcastId(isSelected ? null : b.id)}
                      className="block text-left w-full"
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
              <h2 className="text-xl font-extrabold truncate">{selectedBroadcast.subject}</h2>
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

          {recipientsLoading ? (
            <CardSkeleton />
          ) : (
            <>
              {/* WhatsApp distribution panel — manual click-through */}
              {waRecipients.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h3 className="text-sm font-extrabold flex items-center gap-1.5">
                      <MessageCircle size={16} className="text-success" /> WhatsApp ({waPending} pending)
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={async () => {
                          const message = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}\n\n— PeTa Team\nhttps://www.penghasilantambahan.com`;
                          const pending = waRecipients.filter((r) => r.status === 'pending' && r.whatsapp_snapshot);
                          if (pending.length === 0) { toast.error('Tidak ada pending'); return; }
                          const limit = pending.length;
                          if (!confirm(`Buka ${limit} WhatsApp chat sekaligus + tandai sent?\n\n💡 Pertama kali, browser akan minta izin "Allow popups". Klik Allow, lalu klik tombol ini lagi.\n\nKalau jumlah besar (>30), browser mungkin batasi popup — pakai "Open Batch 10" gantian.`)) return;
                          let opened = 0;
                          for (const r of pending) {
                            const link = buildWhatsappLink(r.whatsapp_snapshot!, message);
                            const w = window.open(link, '_blank', 'noopener,noreferrer');
                            if (w) opened++;
                            await markRecipientSent(r.id);
                            await new Promise((res) => setTimeout(res, 200));
                          }
                          queryClient.invalidateQueries({ queryKey: ['broadcast-recipients', selectedBroadcastId] });
                          queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
                          toast.success(`${opened}/${pending.length} WA dibuka${opened < pending.length ? ' (sisa diblok popup — coba batch lebih kecil)' : ''}`);
                        }}
                        className="text-xs font-bold bg-success text-white px-3 py-1.5 rounded-full flex items-center gap-1 hover:brightness-110"
                      >
                        <Zap size={12} /> Buka SEMUA ({waPending})
                      </button>
                      <button
                        onClick={async () => {
                          const message = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}\n\n— PeTa Team\nhttps://www.penghasilantambahan.com`;
                          const pending = waRecipients.filter((r) => r.status === 'pending' && r.whatsapp_snapshot).slice(0, 10);
                          if (pending.length === 0) { toast.error('Tidak ada pending'); return; }
                          let opened = 0;
                          for (const r of pending) {
                            const link = buildWhatsappLink(r.whatsapp_snapshot!, message);
                            const w = window.open(link, '_blank', 'noopener,noreferrer');
                            if (w) opened++;
                            await markRecipientSent(r.id);
                            await new Promise((res) => setTimeout(res, 200));
                          }
                          queryClient.invalidateQueries({ queryKey: ['broadcast-recipients', selectedBroadcastId] });
                          queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
                          toast.success(`${opened}/${pending.length} WA dibuka`);
                        }}
                        className="text-xs font-bold bg-success/15 text-success px-3 py-1.5 rounded-full flex items-center gap-1 ring-1 ring-success/40 hover:bg-success/25"
                      >
                        <Zap size={12} /> Batch 10
                      </button>
                      <button
                        onClick={async () => {
                          const phones = waRecipients
                            .filter((r) => r.status === 'pending' && r.whatsapp_snapshot)
                            .map((r) => {
                              let p = (r.whatsapp_snapshot || '').replace(/[^0-9]/g, '');
                              if (p.startsWith('0')) p = '62' + p.slice(1);
                              return p;
                            })
                            .filter((p) => p.length >= 8);
                          if (phones.length === 0) { toast.error('Tidak ada nomor pending'); return; }
                          try {
                            await navigator.clipboard.writeText(phones.join(', '));
                            toast.success(`${phones.length} nomor disalin (62...)`);
                          } catch {
                            toast.error('Browser block clipboard');
                          }
                        }}
                        className="text-xs font-bold bg-light text-dark px-3 py-1.5 rounded-full flex items-center gap-1 ring-1 ring-border hover:ring-primary"
                      >
                        <Copy size={12} /> Copy Nomor
                      </button>
                      <button
                        onClick={async () => {
                          const message = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}\n\n— PeTa Team\nhttps://www.penghasilantambahan.com`;
                          try {
                            await navigator.clipboard.writeText(message);
                            toast.success('Pesan disalin');
                          } catch { toast.error('Browser block clipboard'); }
                        }}
                        className="text-xs font-bold bg-light text-dark px-3 py-1.5 rounded-full flex items-center gap-1 ring-1 ring-border hover:ring-primary"
                      >
                        <Copy size={12} /> Copy Pesan
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted mb-2 leading-snug">
                    💡 Opsi: <b>"Buka 5 WA Sekaligus"</b> = otomatis open 5 chat baru + tandai sent (allow popup di browser settings dulu). <b>"Copy Nomor"</b> = paste ke WA Business Broadcast List buat blast bareng. <b>"Open WA"</b> per row = 1-by-1 manual.
                  </p>
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                    {waRecipients.map((r) => {
                      const message = `*${selectedBroadcast.subject}*\n\n${selectedBroadcast.body}\n\n— PeTa Team\nhttps://www.penghasilantambahan.com`;
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
