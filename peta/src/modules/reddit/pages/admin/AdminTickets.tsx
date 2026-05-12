import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Send,
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import {
  getAdminAllTickets,
  getTicketMessages,
  sendTicketMessage,
  markTicketRead,
  formatUSD,
} from '../../lib/api';
import { supabase } from '../../../../lib/supabase';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

const STATUS_LABEL: Record<string, { label: string; class: string }> = {
  open: { label: 'Open', class: 'bg-emerald-100 text-emerald-700' },
  closed: { label: 'Closed', class: 'bg-slate-100 text-slate-600' },
  pending_user: { label: 'Awaiting client', class: 'bg-blue-100 text-blue-700' },
  pending_admin: { label: 'Needs reply', class: 'bg-rose-100 text-rose-700' },
};

export function AdminTickets() {
  const { ticketId } = useParams();
  return ticketId ? <AdminTicketDetail ticketId={parseInt(ticketId)} /> : <AdminTicketsList />;
}

function AdminTicketsList() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'pending_admin' | 'open' | 'closed'>('pending_admin');
  const [query, setQuery] = useState('');

  const loadTickets = async () => {
    setLoading(true);
    try {
      const data = await getAdminAllTickets();
      setTickets(data);
    } catch {
      toast.error('Failed to load tickets');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTickets();
  }, []);

  useRealtimeRefresh({ table: 'order_tickets' }, () => loadTickets());
  useRealtimeRefresh({ table: 'ticket_messages', event: 'INSERT' }, () => loadTickets());

  const filtered = tickets.filter((t) => {
    if (filter === 'unread' && t.unread_admin === 0) return false;
    if (filter !== 'all' && filter !== 'unread' && t.status !== filter) return false;
    if (query) {
      const q = query.toLowerCase();
      const matches =
        t.user?.email?.toLowerCase().includes(q) ||
        t.user?.full_name?.toLowerCase().includes(q) ||
        t.subject?.toLowerCase().includes(q) ||
        t.order_id.toString().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const stats = {
    all: tickets.length,
    unread: tickets.filter((t) => t.unread_admin > 0).length,
    pending_admin: tickets.filter((t) => t.status === 'pending_admin').length,
    open: tickets.filter((t) => t.status === 'open').length,
    closed: tickets.filter((t) => t.status === 'closed').length,
  };

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Messages' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Messages</h1>
            <p className="text-slate-600 mt-1">Talk to clients. One conversation per order.</p>
          </div>
          <button
            onClick={loadTickets}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Filter + search */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-4 flex flex-col md:flex-row gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { key: 'pending_admin', label: 'Needs reply', count: stats.pending_admin },
              { key: 'unread', label: 'Unread', count: stats.unread },
              { key: 'open', label: 'Open', count: stats.open },
              { key: 'closed', label: 'Closed', count: stats.closed },
              { key: 'all', label: 'All', count: stats.all },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key as any)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                  filter === f.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {f.label}
                <span className="ml-1.5 text-xs opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
          <div className="md:ml-auto relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search client, order #, subject..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full md:w-72 pl-9 pr-3 py-1.5 rounded-lg ring-1 ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-12 text-center text-slate-500">Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-3" />
              <p className="font-semibold text-slate-900">Inbox zero</p>
              <p className="text-sm text-slate-500 mt-1">Nothing matches this filter</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/reddit/admin/tickets/${t.id}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50"
                  >
                    {/* Unread indicator */}
                    <div className="w-2.5 shrink-0">
                      {t.unread_admin > 0 && <span className="block w-2.5 h-2.5 rounded-full bg-rose-500" />}
                    </div>

                    {/* Client info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm ${t.unread_admin > 0 ? 'font-bold' : 'font-semibold'} text-slate-900 truncate`}>
                          {t.user?.full_name || t.user?.email}
                        </p>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_LABEL[t.status]?.class}`}>
                          {STATUS_LABEL[t.status]?.label || t.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {t.subject}
                      </p>
                    </div>

                    {/* Order info */}
                    <div className="hidden md:block text-right text-xs text-slate-500 shrink-0">
                      <p className="font-semibold text-slate-900">
                        {t.order?.requested_upvotes} upvotes
                      </p>
                      <p>{formatUSD(t.order?.cost_credits || 0)}</p>
                    </div>

                    {/* Time */}
                    <div className="text-right text-xs text-slate-500 shrink-0 w-16">
                      {t.last_message_at && formatRelativeTime(t.last_message_at)}
                    </div>

                    {/* Unread count */}
                    {t.unread_admin > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold min-w-[20px] text-center">
                        {t.unread_admin}
                      </span>
                    )}

                    <ChevronRight size={16} className="text-slate-400 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function AdminTicketDetail({ ticketId }: { ticketId: number }) {
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const loadData = async () => {
    try {
      const { data: t, error } = await supabase
        .from('order_tickets')
        .select('*, order:reddit_upvote_orders!order_id(*)')
        .eq('id', ticketId)
        .single();
      if (error) throw error;

      // Fetch user separately to avoid FK ambiguity
      const { data: user } = await supabase
        .from('users')
        .select('id, email, full_name, credit_balance, created_at')
        .eq('id', t.user_id)
        .maybeSingle();

      setTicket({ ...t, user });
      const msgs = await getTicketMessages(ticketId);
      setMessages(msgs);

      // Mark as read
      await markTicketRead(ticketId, 'admin');
    } catch (err: any) {
      console.error('Ticket load error:', err);
      toast.error(err.message || 'Failed to load conversation');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [ticketId]);

  useRealtimeRefresh(
    { table: 'ticket_messages', event: 'INSERT', filter: `ticket_id=eq.${ticketId}` },
    () => loadData(),
    [ticketId]
  );

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;

    setSending(true);
    try {
      await sendTicketMessage(ticketId, body.trim(), true);
      setBody('');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading || !ticket) {
    return (
      <AdminLayout>
        <div className="p-6 md:p-10">
          <p className="text-slate-500">Loading conversation...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        <AdminBreadcrumb
          items={[
            { label: 'Admin', href: '/reddit/admin' },
            { label: 'Messages', href: '/reddit/admin/tickets' },
            { label: `#${ticket.id}` },
          ]}
        />

        <button
          onClick={() => navigate('/reddit/admin/tickets')}
          className="md:hidden inline-flex items-center gap-1 text-sm text-slate-600 mb-4"
        >
          <ArrowLeft size={14} /> Back to inbox
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Conversation */}
          <div className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-slate-200 flex flex-col h-[70vh] md:h-[75vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-900">{ticket.user?.full_name || ticket.user?.email}</p>
                <p className="text-xs text-slate-500">{ticket.subject}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_LABEL[ticket.status]?.class}`}>
                {STATUS_LABEL[ticket.status]?.label}
              </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 ? (
                <p className="text-center text-slate-500 text-sm py-12">No messages yet</p>
              ) : (
                messages.map((msg) => <MessageBubble key={msg.id} message={msg} isAdminView />)
              )}
            </div>

            {/* Composer */}
            <form onSubmit={handleSend} className="p-4 border-t border-slate-200 bg-slate-50">
              <div className="flex gap-2 items-end">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Reply to client..."
                  rows={2}
                  className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900 bg-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handleSend(e as any);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={!body.trim() || sending}
                  className="px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 text-white font-semibold inline-flex items-center gap-2 self-stretch"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">Press Ctrl/Cmd + Enter to send</p>
            </form>
          </div>

          {/* Sidebar — order context */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
              <h3 className="font-bold text-slate-900 mb-3">Client</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="font-medium">{ticket.user?.full_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="font-medium break-all">{ticket.user?.email}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Credit balance</p>
                  <p className="font-bold text-emerald-600">{formatUSD(ticket.user?.credit_balance || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Member since</p>
                  <p className="font-medium">{new Date(ticket.user?.created_at).toLocaleDateString('en-US')}</p>
                </div>
              </div>
              <Link
                to={`/reddit/admin/clients/${ticket.user_id}`}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                View profile <ChevronRight size={12} />
              </Link>
            </div>

            {ticket.order && (
              <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
                <h3 className="font-bold text-slate-900 mb-3">Order #{ticket.order.id}</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Thread URL</p>
                    <a
                      href={ticket.order.thread_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-600 hover:underline break-all text-xs flex items-center gap-1"
                    >
                      {ticket.order.thread_url.substring(0, 30)}... <ExternalLink size={10} />
                    </a>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Upvotes</p>
                    <p className="font-medium">
                      {ticket.order.delivered_upvotes || 0} / {ticket.order.requested_upvotes}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Revenue</p>
                    <p className="font-medium">{formatUSD(ticket.order.cost_credits)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Status</p>
                    <p className="font-medium capitalize">{ticket.order.status}</p>
                  </div>
                </div>
                <Link
                  to={`/reddit/admin/orders?focus=${ticket.order.id}`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
                >
                  Manage order <ChevronRight size={12} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

export function MessageBubble({ message, isAdminView }: { message: any; isAdminView?: boolean }) {
  const isUser = message.sender_role === 'user';
  const isSystem = message.sender_role === 'system';
  const isAdmin = message.sender_role === 'admin';

  // In admin view, admin messages are on the right (their own)
  // In client view, user messages are on the right (their own)
  const isMine = isAdminView ? isAdmin : isUser;

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="px-3 py-1.5 rounded-full bg-slate-100 text-xs text-slate-600">
          {message.body}
          <span className="ml-2 text-slate-400">· {formatRelativeTime(message.created_at)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
      {!isMine && (
        <div className={`w-8 h-8 rounded-full ${isAdmin ? 'bg-slate-900 text-white' : 'bg-orange-500 text-white'} flex items-center justify-center text-xs font-bold shrink-0`}>
          {isAdmin ? 'A' : (message.sender_role === 'user' ? 'C' : '?')}
        </div>
      )}
      <div className={`max-w-[75%] ${isMine ? 'order-first' : ''}`}>
        <div className={`px-4 py-2.5 rounded-2xl ${
          isMine
            ? 'bg-orange-500 text-white rounded-br-sm'
            : 'bg-slate-100 text-slate-900 rounded-bl-sm'
        }`}>
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        </div>
        <p className={`text-[10px] text-slate-400 mt-1 ${isMine ? 'text-right' : 'text-left'}`}>
          {new Date(message.created_at).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          })}
        </p>
      </div>
      {isMine && (
        <div className={`w-8 h-8 rounded-full ${isAdmin ? 'bg-slate-900 text-white' : 'bg-orange-500 text-white'} flex items-center justify-center text-xs font-bold shrink-0`}>
          {isAdmin ? 'A' : 'You'}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const now = new Date().getTime();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
