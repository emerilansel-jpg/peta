import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail, MessageCircle, Send, Inbox as InboxIcon, Archive, Plus,
  ArrowLeft, Check, X, AlertCircle, Clock, User, RefreshCw,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import {
  listInboxThreads, getThreadMessages, sendInboxReply, createInboxThread,
  archiveInboxThread, logInboundMessage, pollInboxEmail,
  type InboxThreadRow, type InboxMessageRow, type InboxChannel,
} from '../../lib/api';

function formatRel(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((now - d.getTime()) / 60_000);
  if (diffMin < 1) return 'baru aja';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function AdminInbox() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<InboxChannel | 'all'>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showNewModal, setShowNewModal] = React.useState(false);
  const [showInboundModal, setShowInboundModal] = React.useState(false);
  const [replyDraft, setReplyDraft] = React.useState('');

  const threadsQuery = useQuery({
    queryKey: ['inbox-threads', filter],
    queryFn: () => listInboxThreads({
      channel: filter === 'all' ? undefined : filter,
      limit: 200,
    }),
    refetchInterval: 20_000,
  });

  const threads = threadsQuery.data || [];
  const selected = React.useMemo(
    () => threads.find((t) => t.id === selectedId) || null,
    [threads, selectedId]
  );

  const messagesQuery = useQuery({
    queryKey: ['inbox-messages', selectedId],
    queryFn: () => getThreadMessages(selectedId!),
    enabled: !!selectedId,
    refetchInterval: selectedId ? 15_000 : false,
  });

  const messages = messagesQuery.data || [];

  // Total unread badge (across all threads, regardless of channel filter)
  const totalUnread = threads.reduce((sum, t) => sum + (t.unread_count || 0), 0);

  const replyMutation = useMutation({
    mutationFn: () => sendInboxReply(selectedId!, replyDraft.trim()),
    onSuccess: (data: any) => {
      const ok = !!data?.sendResult?.success;
      if (ok) {
        toast.success('Pesan terkirim ✅');
      } else {
        toast.error(`Gagal kirim: ${data?.sendResult?.error || 'unknown'}`);
      }
      setReplyDraft('');
      queryClient.invalidateQueries({ queryKey: ['inbox-messages', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
    },
    onError: (e: any) => toast.error(`Gagal kirim: ${e.message || e}`),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveInboxThread(id, true),
    onSuccess: () => {
      toast.success('Diarsipkan');
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
    },
    onError: () => toast.error('Gagal mengarsipkan'),
  });

  // Poll Spacemail IMAP for new emails. Runs on demand via the inbox icon
  // button + auto every 5 min when the page is mounted. WhatsApp uses webhook
  // push, doesn't need polling.
  //
  // Error UX: track last IMAP status in state. Only toast on MANUAL click —
  // auto-poll failures are silent (just update the indicator) so an outage
  // upstream doesn't spam the admin every minute.
  const [imapStatus, setImapStatus] = React.useState<{
    ok: boolean; error: string | null; lastChecked: number;
  }>({ ok: true, error: null, lastChecked: 0 });
  const manualPollRef = React.useRef(false);

  const pollMutation = useMutation({
    mutationFn: () => pollInboxEmail(),
    onSuccess: (r) => {
      const failed = !!r.error || !r.ok;
      setImapStatus({
        ok: !failed,
        error: failed ? (r.error || r.errors?.[0] || 'unknown') : null,
        lastChecked: Date.now(),
      });
      if (manualPollRef.current) {
        if (failed) {
          toast.error(`IMAP fetch gagal: ${r.error || (r.errors?.[0] || 'unknown')}`);
        } else if (r.processed > 0) {
          toast.success(`+${r.processed} email baru${r.skipped ? ` (${r.skipped} skip)` : ''}`);
        } else {
          toast.success('Inbox up-to-date');
        }
        manualPollRef.current = false;
      }
      queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
    },
    onError: (e: any) => {
      setImapStatus({ ok: false, error: e?.message || String(e), lastChecked: Date.now() });
      if (manualPollRef.current) {
        toast.error(`Poll failed: ${e.message || e}`);
        manualPollRef.current = false;
      }
    },
  });

  const triggerManualPoll = () => {
    manualPollRef.current = true;
    pollMutation.mutate();
  };

  React.useEffect(() => {
    // Auto-poll every 5 min when on Email/All tab — silent failures.
    if (filter === 'all' || filter === 'email') {
      pollMutation.mutate();
      const id = setInterval(() => pollMutation.mutate(), 300_000);
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <Layout userRole="admin">
      <div className="flex flex-col h-[calc(100dvh-80px)] md:h-[calc(100dvh-64px)] -mx-2 md:-mx-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 md:px-0 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <InboxIcon size={20} className="text-primary shrink-0" />
            <h1 className="text-xl md:text-2xl font-extrabold truncate">Inbox</h1>
            {totalUnread > 0 && (
              <span className="bg-danger text-white text-xs font-bold rounded-full px-2 py-0.5 shrink-0">
                {totalUnread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={triggerManualPoll}
              disabled={pollMutation.isPending}
              title={imapStatus.ok ? 'Fetch dari Spacemail (IMAP)' : `IMAP error: ${imapStatus.error}`}
              className={`relative p-2 rounded-lg tap-shrink disabled:opacity-50 ${
                imapStatus.ok ? 'text-muted hover:bg-light' : 'text-danger hover:bg-danger/10'
              }`}
            >
              <Mail size={16} className={pollMutation.isPending ? 'animate-pulse text-primary' : ''} />
              {!imapStatus.ok && imapStatus.lastChecked > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-danger rounded-full ring-2 ring-white" />
              )}
            </button>
            <button
              onClick={() => threadsQuery.refetch()}
              title="Refresh list"
              className="p-2 rounded-lg text-muted hover:bg-light tap-shrink"
            >
              <RefreshCw size={16} className={threadsQuery.isFetching ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setShowInboundModal(true)}
              title="Log inbound manual"
              className="p-2 rounded-lg text-muted hover:bg-light tap-shrink"
            >
              <Plus size={16} />
            </button>
            <Button onClick={() => setShowNewModal(true)} variant="primary" size="sm">
              <Plus size={14} /> Thread Baru
            </Button>
          </div>
        </div>

        {/* Channel filter chips */}
        <div className="flex items-center gap-2 px-3 md:px-0 pb-3 overflow-x-auto">
          <FilterChip
            label="Semua"
            count={threads.length}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          <FilterChip
            label="📧 Email"
            count={threads.filter((t) => t.channel === 'email').length}
            active={filter === 'email'}
            onClick={() => setFilter('email')}
          />
          <FilterChip
            label="💬 WhatsApp"
            count={threads.filter((t) => t.channel === 'whatsapp').length}
            active={filter === 'whatsapp'}
            onClick={() => setFilter('whatsapp')}
          />
        </div>

        {/* Main 2-column layout */}
        <div className="flex-1 flex min-h-0 ring-1 ring-black/5 rounded-2xl overflow-hidden bg-white">
          {/* Thread list (left) */}
          <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-border min-h-0`}>
            <div className="flex-1 overflow-y-auto">
              {threadsQuery.isLoading ? (
                <div className="p-4 text-sm text-muted">Loading…</div>
              ) : threads.length === 0 ? (
                <EmptyInbox
                  onLogInbound={() => setShowInboundModal(true)}
                  onNewThread={() => setShowNewModal(true)}
                />
              ) : (
                <ul>
                  {threads.map((t) => (
                    <ThreadListItem
                      key={t.id}
                      thread={t}
                      active={t.id === selectedId}
                      onClick={() => setSelectedId(t.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Thread detail (right / full on mobile) */}
          <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-h-0 min-w-0`}>
            {!selected ? (
              <div className="flex-1 grid place-items-center p-6 text-center">
                <div>
                  <InboxIcon size={32} className="mx-auto text-muted/40 mb-2" />
                  <p className="text-sm text-muted">Pilih thread untuk membuka percakapan</p>
                </div>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="md:hidden p-1 -ml-1 text-muted hover:text-dark"
                    aria-label="Back"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
                    selected.channel === 'email'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-success/15 text-success'
                  }`}>
                    {selected.channel === 'email' ? <Mail size={20} /> : <MessageCircle size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold leading-tight truncate">
                      {selected.matched_user_name
                        || selected.participant_name
                        || selected.participant_email
                        || (selected.participant_phone ? `+${selected.participant_phone}` : 'Anonim')}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {selected.channel === 'email'
                        ? (selected.participant_email || '—')
                        : (selected.participant_phone ? `+${selected.participant_phone}` : '—')}
                      {selected.matched_user_name && (
                        <span className="ml-2 inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full">
                          <User size={9} /> Army
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Arsipkan thread ini?')) archiveMutation.mutate(selected.id);
                    }}
                    title="Arsipkan"
                    className="p-2 rounded-lg text-muted hover:bg-light tap-shrink"
                  >
                    <Archive size={16} />
                  </button>
                </div>

                {/* Messages scroll area */}
                <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2 bg-light/50">
                  {messagesQuery.isLoading ? (
                    <p className="text-sm text-muted text-center">Loading messages…</p>
                  ) : messagesQuery.isError ? (
                    <div className="bg-danger/10 ring-1 ring-danger/30 rounded-lg p-3 text-xs text-danger">
                      <p className="font-bold mb-1">⚠ Gagal load pesan</p>
                      <p className="break-all">{(messagesQuery.error as any)?.message || String(messagesQuery.error)}</p>
                      <button
                        onClick={() => messagesQuery.refetch()}
                        className="mt-2 text-primary font-bold hover:underline"
                      >
                        Coba lagi
                      </button>
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-muted text-center">Belum ada pesan.</p>
                  ) : (
                    messages.map((m) => <MessageBubble key={m.id} message={m} />)
                  )}
                </div>

                {/* Reply input */}
                <div className="border-t border-border p-3 bg-white">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder={selected.channel === 'email'
                        ? 'Tulis balasan email…'
                        : 'Tulis balasan WhatsApp…'}
                      rows={2}
                      className="flex-1 px-3 py-2 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition resize-none text-sm"
                      onKeyDown={(e) => {
                        // Cmd/Ctrl + Enter to send
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          if (replyDraft.trim() && !replyMutation.isPending) {
                            replyMutation.mutate();
                          }
                        }
                      }}
                    />
                    <Button
                      onClick={() => replyMutation.mutate()}
                      loading={replyMutation.isPending}
                      disabled={!replyDraft.trim()}
                      variant="primary"
                      size="md"
                    >
                      <Send size={16} />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted mt-1.5">
                    Cmd/Ctrl+Enter untuk kirim · Email via Spacemail SMTP · WA via Fonnte
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* New thread modal */}
      {showNewModal && (
        <NewThreadModal
          onClose={() => setShowNewModal(false)}
          onCreated={(id) => {
            setShowNewModal(false);
            setSelectedId(id);
            queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
          }}
        />
      )}

      {/* Log inbound modal (manual entry for testing — webhooks bypass this) */}
      {showInboundModal && (
        <LogInboundModal
          onClose={() => setShowInboundModal(false)}
          onLogged={() => {
            setShowInboundModal(false);
            queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
          }}
        />
      )}
    </Layout>
  );
}

// ============================================================
// Subcomponents
// ============================================================

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void; }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold tap-shrink ${
        active
          ? 'bg-primary text-white'
          : 'bg-white ring-1 ring-black/10 text-dark hover:ring-primary/40'
      }`}
    >
      {label}
      <span className={`text-[10px] font-bold tabular-nums ${active ? 'opacity-90' : 'text-muted'}`}>
        ({count})
      </span>
    </button>
  );
}

function ThreadListItem({ thread, active, onClick }: { thread: InboxThreadRow; active: boolean; onClick: () => void; }) {
  const unread = (thread.unread_count || 0) > 0;
  const display = thread.matched_user_name
    || thread.participant_name
    || thread.participant_email
    || (thread.participant_phone ? `+${thread.participant_phone}` : 'Anonim');
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full px-3 py-3 text-left border-b border-border tap-shrink ${
          active ? 'bg-primary/5' : 'hover:bg-light'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${
            thread.channel === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-success/15 text-success'
          }`}>
            {thread.channel === 'email' ? <Mail size={16} /> : <MessageCircle size={16} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <p className={`text-sm truncate ${unread ? 'font-extrabold' : 'font-semibold'}`}>
                {display}
              </p>
              <p className="text-[10px] text-muted shrink-0 tabular-nums">
                {formatRel(thread.last_message_at)}
              </p>
            </div>
            {thread.subject && (
              <p className="text-xs text-muted/90 truncate">{thread.subject}</p>
            )}
            <p className={`text-xs truncate mt-0.5 ${unread ? 'text-dark font-semibold' : 'text-muted'}`}>
              {thread.last_message_direction === 'outbound' ? '↪ ' : ''}
              {thread.last_message_preview || '—'}
            </p>
          </div>
          {unread && (
            <span className="bg-danger text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] grid place-items-center px-1 shrink-0">
              {thread.unread_count}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function MessageBubble({ message }: { message: InboxMessageRow }) {
  const isOutbound = message.direction === 'outbound';
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 ${
        isOutbound ? 'bg-primary text-white' : 'bg-white ring-1 ring-black/5'
      }`}>
        {message.subject && (
          <p className={`text-[10px] uppercase font-bold tracking-wide mb-1 ${
            isOutbound ? 'text-white/80' : 'text-muted'
          }`}>
            {message.subject}
          </p>
        )}
        <p className={`text-sm whitespace-pre-wrap break-words ${isOutbound ? 'text-white' : 'text-dark'}`}>
          {message.body}
        </p>
        <div className={`flex items-center gap-1.5 mt-1.5 text-[10px] ${
          isOutbound ? 'text-white/70' : 'text-muted'
        }`}>
          <span>{formatFullDate(message.created_at)}</span>
          {isOutbound && (
            <span className="flex items-center gap-0.5">
              {message.delivery_status === 'pending' && <><Clock size={10} /> Pending</>}
              {message.delivery_status === 'sent' && <><Check size={10} /> Sent</>}
              {message.delivery_status === 'delivered' && <><Check size={10} /> Delivered</>}
              {message.delivery_status === 'failed' && <><AlertCircle size={10} /> Failed</>}
            </span>
          )}
        </div>
        {message.delivery_status === 'failed' && message.delivery_error && (
          <p className={`text-[10px] mt-1 ${isOutbound ? 'text-yellow-200' : 'text-danger'}`}>
            ⚠ {message.delivery_error}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyInbox({ onLogInbound, onNewThread }: { onLogInbound: () => void; onNewThread: () => void; }) {
  return (
    <div className="p-5 text-center">
      <InboxIcon size={36} className="mx-auto text-muted/30 mb-2" />
      <p className="font-bold text-sm mb-1">Inbox kosong</p>
      <p className="text-xs text-muted mb-4">
        Inbound webhooks belum dipasang? Coba mulai conversation manual.
      </p>
      <div className="space-y-2">
        <Button onClick={onNewThread} variant="primary" size="sm" fullWidth>
          <Plus size={14} /> Mulai thread (outbound)
        </Button>
        <Button onClick={onLogInbound} variant="outline" size="sm" fullWidth>
          <Mail size={14} /> Log inbound manual
        </Button>
      </div>
      <details className="mt-5 text-left text-xs text-muted">
        <summary className="cursor-pointer font-bold hover:text-dark">
          🔧 Setup webhook auto-receive
        </summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            <b>WhatsApp (Fonnte):</b> Login ke fonnte.com → Device → Set Webhook URL ke:
            <code className="block bg-light rounded p-1.5 mt-1 text-[10px] break-all">
              {`${window.location.origin}/functions/v1/inbox-receive-whatsapp`}
            </code>
          </p>
          <p>
            <b>Email:</b> Setup forwarding di Spacemail / Cloudflare Email Workers ke:
            <code className="block bg-light rounded p-1.5 mt-1 text-[10px] break-all">
              {`${window.location.origin}/functions/v1/inbox-receive-email`}
            </code>
          </p>
          <p className="italic text-muted/80">
            (Edge functions di-deploy nanti — sementara pakai manual entry.)
          </p>
        </div>
      </details>
    </div>
  );
}

function NewThreadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void; }) {
  const [channel, setChannel] = React.useState<InboxChannel>('whatsapp');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');

  const createMut = useMutation({
    mutationFn: () => createInboxThread({
      channel,
      email: channel === 'email' ? email : null,
      phone: channel === 'whatsapp' ? phone : null,
      name,
      subject,
    }),
    onSuccess: (id) => {
      toast.success('Thread dibuat');
      onCreated(id);
    },
    onError: (e: any) => toast.error(e.message || 'Gagal'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-extrabold">Thread Baru</h3>
            <button onClick={onClose} className="p-2 -mr-2 text-muted hover:text-dark">
              <X size={22} />
            </button>
          </div>

          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Channel</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => setChannel('whatsapp')}
              className={`p-3 rounded-xl ring-2 text-sm font-bold flex items-center gap-2 tap-shrink ${
                channel === 'whatsapp' ? 'ring-success bg-success/5 text-success' : 'ring-border text-muted'
              }`}
            >
              <MessageCircle size={16} /> WhatsApp
            </button>
            <button
              onClick={() => setChannel('email')}
              className={`p-3 rounded-xl ring-2 text-sm font-bold flex items-center gap-2 tap-shrink ${
                channel === 'email' ? 'ring-blue-500 bg-blue-50 text-blue-700' : 'ring-border text-muted'
              }`}
            >
              <Mail size={16} /> Email
            </button>
          </div>

          {channel === 'whatsapp' ? (
            <>
              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Nomor WhatsApp</p>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxx atau 62xxxx"
                className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-3"
              />
            </>
          ) : (
            <>
              <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Email</p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@example.com"
                className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-3"
              />
            </>
          )}

          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Nama (opsional)</p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Budi"
            className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-3"
          />

          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Subject (opsional)</p>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Topik percakapan"
            className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-4"
          />

          <Button
            onClick={() => createMut.mutate()}
            loading={createMut.isPending}
            variant="primary"
            size="lg"
            fullWidth
            disabled={channel === 'whatsapp' ? phone.replace(/\D/g, '').length < 9 : !email.includes('@')}
          >
            <Plus size={16} /> Buat Thread
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogInboundModal({ onClose, onLogged }: { onClose: () => void; onLogged: () => void; }) {
  const [channel, setChannel] = React.useState<InboxChannel>('whatsapp');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');

  const logMut = useMutation({
    mutationFn: () => logInboundMessage({
      channel,
      email: channel === 'email' ? email : null,
      phone: channel === 'whatsapp' ? phone : null,
      name,
      subject,
      body,
    }),
    onSuccess: () => {
      toast.success('Inbound dicatat');
      onLogged();
    },
    onError: (e: any) => toast.error(e.message || 'Gagal'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-extrabold">Log Pesan Masuk</h3>
            <button onClick={onClose} className="p-2 -mr-2 text-muted hover:text-dark">
              <X size={22} />
            </button>
          </div>

          <p className="text-xs text-muted mb-3 bg-warning/10 ring-1 ring-warning/30 rounded-lg p-2">
            Buat testing manual atau catat pesan yang masuk via channel lain.
            Webhook otomatis dari Fonnte / email forwarder akan ngisi langsung tanpa form ini.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => setChannel('whatsapp')}
              className={`p-2.5 rounded-xl ring-2 text-sm font-bold flex items-center gap-2 tap-shrink ${
                channel === 'whatsapp' ? 'ring-success bg-success/5 text-success' : 'ring-border text-muted'
              }`}
            >
              <MessageCircle size={16} /> WhatsApp
            </button>
            <button
              onClick={() => setChannel('email')}
              className={`p-2.5 rounded-xl ring-2 text-sm font-bold flex items-center gap-2 tap-shrink ${
                channel === 'email' ? 'ring-blue-500 bg-blue-50 text-blue-700' : 'ring-border text-muted'
              }`}
            >
              <Mail size={16} /> Email
            </button>
          </div>

          {channel === 'whatsapp' ? (
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Nomor pengirim"
              className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-2"
            />
          ) : (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email pengirim"
              className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-2"
            />
          )}

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama pengirim (opsional)"
            className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-2"
          />

          {channel === 'email' && (
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject email"
              className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition mb-2"
            />
          )}

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Isi pesan…"
            rows={5}
            className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition resize-none mb-4"
          />

          <Button
            onClick={() => logMut.mutate()}
            loading={logMut.isPending}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!body.trim() || (channel === 'whatsapp' ? phone.replace(/\D/g, '').length < 9 : !email.includes('@'))}
          >
            <Mail size={16} /> Catat Pesan Masuk
          </Button>
        </div>
      </div>
    </div>
  );
}
