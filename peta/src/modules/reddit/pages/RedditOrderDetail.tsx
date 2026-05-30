import { type ElementType, useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  Send,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Clock,
  PlayCircle,
  XCircle,
  Star,
  Sparkles,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { RedditLayout } from '../components/RedditLayout';
import { supabase } from '../../../lib/supabase';
import {
  getTicketByOrderId,
  getTicketMessages,
  sendTicketMessage,
  markTicketRead,
  hasReviewedOrder,
  formatUSD,
} from '../lib/api';
import { MessageBubble } from './admin/AdminTickets';
import { ReviewRequestModal } from '../components/ReviewRequestModal';
import { EmailWhitelistNotice } from '../components/EmailWhitelistNotice';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { cleanInternalText } from '../../../lib/internalText';

type RedditOrderRecord = {
  id: number;
  target_type?: string | null;
  status: string;
  thread_url: string;
  subreddit?: string | null;
  requested_upvotes: number;
  delivered_upvotes: number;
  cost_credits: number;
  created_at: string;
  completed_at?: string | null;
  notes: string | null;
  delivery_proof_text?: string | null;
  delivery_proof_url?: string | null;
};

type TicketRecord = {
  id: number;
};

type TicketMessageRecord = {
  id: number;
  [key: string]: unknown;
};

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: ElementType; desc: string }> = {
  pending: {
    label: 'Pending review',
    class: 'bg-amber-50 text-amber-700 ring-amber-200',
    icon: Clock,
    desc: 'Our team is reviewing your order. Delivery typically starts within 6 hours.',
  },
  processing: {
    label: 'In delivery',
    class: 'bg-blue-50 text-blue-700 ring-blue-200',
    icon: PlayCircle,
    desc: 'We are actively delivering upvotes. You can track progress here.',
  },
  completed: {
    label: 'Completed',
    class: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: CheckCircle2,
    desc: 'Delivery complete. Thanks for choosing Straight Ltd.',
  },
  cancelled: {
    label: 'Cancelled',
    class: 'bg-rose-50 text-rose-700 ring-rose-200',
    icon: XCircle,
    desc: 'Order was cancelled. Credits have been refunded if applicable.',
  },
};

function parseOrderNotes(raw: string | null) {
  if (!raw) return { clientNote: '', commentText: '', useSuggested: false, sourceKeyword: '', brand: '' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.service === 'forum_comment') {
      return {
        clientNote: cleanInternalText(parsed.client_notes || ''),
        commentText: parsed.comment_text || '',
        useSuggested: !!parsed.use_suggested_comment,
        sourceKeyword: parsed.source_keyword || '',
        brand: parsed.brand_name || parsed.brand_domain || '',
      };
    }
  } catch {
    return { clientNote: cleanInternalText(raw), commentText: '', useSuggested: false, sourceKeyword: '', brand: '' };
  }
  return { clientNote: cleanInternalText(raw), commentText: '', useSuggested: false, sourceKeyword: '', brand: '' };
}

function serviceMeta(order: RedditOrderRecord) {
  if ((order.target_type || 'upvote') === 'comment') {
    return {
      name: 'Forum comment',
      targetLabel: 'Target page',
      quantityLabel: 'Comment',
      progress: '1 comment ordered',
      statusDesc: {
        pending: 'Our team is reviewing your comment brief and target page.',
        processing: 'We are preparing or placing your forum comment.',
        completed: 'Comment placement is complete. Thanks for choosing Straight Ltd.',
        cancelled: 'Order was cancelled. Credits have been refunded if applicable.',
      } as Record<string, string>,
    };
  }
  return {
    name: 'Reddit upvotes',
    targetLabel: 'Target thread',
    quantityLabel: 'Upvotes',
    progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes}`,
    statusDesc: {} as Record<string, string>,
  };
}

export function RedditOrderDetail() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<RedditOrderRecord | null>(null);
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [messages, setMessages] = useState<TicketMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Show the email-deliverability banner once after the client sends a message — the moment they
  // most care about getting our reply, and the moment our reply is most likely to land in Spam.
  const [showEmailNotice, setShowEmailNotice] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!orderId) return;

    try {
      const { data: o } = await supabase
        .from('reddit_upvote_orders')
        .select('*')
        .eq('id', parseInt(orderId))
        .single();

      if (!o) {
        toast.error('Order not found');
        navigate('/reddit/orders');
        return;
      }
      setOrder(o);

      const t = await getTicketByOrderId(parseInt(orderId));
      setTicket(t);

      if (t) {
        const msgs = await getTicketMessages(t.id);
        setMessages(msgs);
        await markTicketRead(t.id, 'user');
      }

      // Check if user has already reviewed this order
      const reviewed = await hasReviewedOrder(parseInt(orderId), 'internal');
      setHasReviewed(reviewed);
    } catch {
      toast.error('Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Realtime: refresh when new messages arrive or order updates
  useRealtimeRefresh(
    { table: 'ticket_messages', event: 'INSERT', filter: ticket ? `ticket_id=eq.${ticket.id}` : undefined },
    () => load(),
    [ticket?.id]
  );
  useRealtimeRefresh(
    { table: 'reddit_upvote_orders', event: 'UPDATE', filter: orderId ? `id=eq.${orderId}` : undefined },
    () => load(),
    [orderId]
  );

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !ticket) return;

    setSending(true);
    try {
      await sendTicketMessage(ticket.id, body.trim(), false);
      setBody('');
      await load();
      setShowEmailNotice(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <RedditLayout>
        <div className="p-6 md:p-10">
          <p className="text-slate-500">Loading order...</p>
        </div>
      </RedditLayout>
    );
  }

  if (!order) {
    return (
      <RedditLayout>
        <div className="p-6 md:p-10">
          <p className="text-slate-500">Order not found</p>
        </div>
      </RedditLayout>
    );
  }

  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const StatusIcon = status.icon;
  const service = serviceMeta(order);
  const parsedNotes = parseOrderNotes(order.notes);

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        <button
          onClick={() => navigate('/reddit/orders')}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft size={14} /> All orders
        </button>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Order #{order.id}</h1>
            <p className="text-slate-600 mt-1">
              {service.name} · {order.subreddit && (order.target_type || 'upvote') !== 'comment' ? `r/${order.subreddit}` : order.subreddit || order.thread_url}
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {/* Status banner */}
        <div className={`p-5 rounded-2xl ring-1 mb-6 flex items-start gap-3 ${status.class}`}>
          <StatusIcon size={20} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold">{status.label}</p>
            <p className="text-sm opacity-80 mt-0.5">{service.statusDesc[order.status] || status.desc}</p>
          </div>
        </div>

        {/* Review prompt — when completed and not yet reviewed */}
        {order.status === 'completed' && !hasReviewed && (
          <div className="mb-6 p-5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <div className="relative flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Star size={22} className="fill-white" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-lg">Loved the delivery? Earn $5 credit</p>
                <p className="text-sm text-orange-50">
                  Share a quick review · also review on Trustpilot for <strong>+$10 extra</strong>
                </p>
              </div>
              <button
                onClick={() => setShowReviewModal(true)}
                className="px-4 py-2 rounded-lg bg-white text-orange-600 hover:bg-orange-50 font-semibold text-sm inline-flex items-center gap-2 shadow-lg shrink-0"
              >
                <Sparkles size={14} />
                Leave review
              </button>
            </div>
          </div>
        )}

        {/* Review submitted confirmation */}
        {order.status === 'completed' && hasReviewed && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 flex items-center gap-3">
            <Sparkles size={18} className="text-emerald-600 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-emerald-900">Review submitted · awaiting approval</p>
              <p className="text-sm text-emerald-700">
                Want $10 more? <Link to="/reddit/reviews?tab=trustpilot" className="font-semibold underline">Submit a Trustpilot review</Link>
              </p>
            </div>
          </div>
        )}

        {/* Delivery proof (visible when admin uploaded) */}
        {(order.delivery_proof_text || order.delivery_proof_url) && (
          <div className="mb-6 p-5 rounded-2xl bg-white ring-1 ring-emerald-200 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-emerald-600" />
              </div>
              <h3 className="font-bold text-slate-900">Delivery proof</h3>
            </div>
            {order.delivery_proof_text && (
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {order.delivery_proof_text}
              </p>
            )}
            {order.delivery_proof_url && order.delivery_proof_url.match(/\.(png|jpg|jpeg|gif|webp)/i) ? (
              <a href={order.delivery_proof_url} target="_blank" rel="noopener noreferrer" className="block mt-3">
                <img
                  src={order.delivery_proof_url}
                  alt="Delivery proof"
                  className="rounded-lg ring-1 ring-slate-200 max-w-full max-h-80 object-contain"
                />
                <p className="text-xs text-orange-600 mt-2 inline-flex items-center gap-1">
                  Open full size <ExternalLink size={10} />
                </p>
              </a>
            ) : order.delivery_proof_url ? (
              <a
                href={order.delivery_proof_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-orange-600 hover:underline"
              >
                {order.delivery_proof_url}
                <ExternalLink size={12} />
              </a>
            ) : null}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Conversation */}
          <div className="lg:col-span-2 bg-white rounded-2xl ring-1 ring-slate-200 flex flex-col h-[600px]">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">Order conversation</h2>
              <p className="text-xs text-slate-500 mt-0.5">Talk directly to our delivery team</p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 ? (
                <p className="text-center text-slate-500 text-sm py-12">No messages yet. Say hello below.</p>
              ) : (
                messages.map((msg) => <MessageBubble key={msg.id} message={msg} isAdminView={false} />)
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
              {showEmailNotice && (
                <EmailWhitelistNotice
                  variant="banner"
                  headline="Message sent — our reply will come by email too"
                  context="(plus you'll see it here in the dashboard)"
                  onDismiss={() => setShowEmailNotice(false)}
                />
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Type a message to our team..."
                  rows={2}
                  className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900 bg-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      void handleSend(e as unknown as React.FormEvent);
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
              <p className="text-xs text-slate-500">Ctrl/Cmd + Enter to send. We typically reply within 90 minutes during business hours. Email updates come from <strong className="text-slate-700">care@straight.ltd</strong> — save us to skip Spam.</p>
            </form>
          </div>

          {/* Order details sidebar */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
              <h3 className="font-bold text-slate-900 mb-3">Order summary</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">{service.targetLabel}</p>
                  <a
                    href={order.thread_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-600 hover:underline break-all text-xs flex items-center gap-1 mt-0.5"
                  >
                    {order.thread_url.substring(0, 35)}...
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{service.quantityLabel}</p>
                  <p className="font-bold text-slate-900">
                    {service.progress}
                  </p>
                  {(order.target_type || 'upvote') === 'upvote' && order.delivered_upvotes > 0 && order.delivered_upvotes < order.requested_upvotes && (
                    <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-500 transition-all"
                        style={{ width: `${(order.delivered_upvotes / order.requested_upvotes) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500">Cost</p>
                  <p className="font-bold text-slate-900">{formatUSD(order.cost_credits)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Placed</p>
                  <p className="font-medium">{new Date(order.created_at).toLocaleString('en-US')}</p>
                </div>
                {order.completed_at && (
                  <div>
                    <p className="text-xs text-slate-500">Completed</p>
                    <p className="font-medium">{new Date(order.completed_at).toLocaleString('en-US')}</p>
                  </div>
                )}
                {parsedNotes.commentText && (
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-500">Final comment</p>
                    <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{parsedNotes.commentText}</p>
                    <p className="text-xs text-slate-500 mt-2">
                      {parsedNotes.useSuggested ? 'Suggested comment assistant used' : 'Client-written comment'}
                      {parsedNotes.brand ? ` · Brand: ${parsedNotes.brand}` : ''}
                      {parsedNotes.sourceKeyword ? ` · Keyword: ${parsedNotes.sourceKeyword}` : ''}
                    </p>
                  </div>
                )}
                {parsedNotes.clientNote && (
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-500">Your note</p>
                    <p className="text-sm text-slate-700 italic mt-0.5">"{parsedNotes.clientNote}"</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
              <h3 className="font-semibold text-sm text-slate-900 mb-2">Need help?</h3>
              <p className="text-xs text-slate-600">
                Use the conversation panel to message our team. We respond fast — typically within 90 minutes.
              </p>
              <Link
                to="/reddit/new-order"
                className="mt-3 inline-block text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                Place another order →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {showReviewModal && order && (
        <ReviewRequestModal
          orderId={order.id}
          onClose={() => setShowReviewModal(false)}
          onSubmitted={() => {
            setShowReviewModal(false);
            setHasReviewed(true);
          }}
        />
      )}
    </RedditLayout>
  );
}
