import { spath } from '../lib/path';
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
  AlertOctagon,
  PauseCircle,
  Pause,
  Play,
  FileText,
  Download,
  FileSpreadsheet,
  Eye,
  X,
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
  updateOrderDetail,
  clientPauseOrder,
  clientResumeOrder,
  getOrderDeliveryProofs,
  getOrderCancellationPreview,
  type OrderDeliveryProof,
} from '../lib/api';
import { MessageBubble } from './admin/AdminTickets';
import { ReviewRequestModal } from '../components/ReviewRequestModal';
import { InvoiceModal } from '../components/InvoiceModal';
import { EmailWhitelistNotice } from '../components/EmailWhitelistNotice';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { cleanInternalText } from '../../../lib/internalText';

const CANCEL_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

function getClientCancelState(order: RedditOrderRecord) {
  if (order.status === 'cancelled') {
    return { cancelable: false, remainingMs: 0, reason: 'Order already cancelled' };
  }
  if (order.status === 'completed') {
    return { cancelable: false, remainingMs: 0, reason: 'Order already completed' };
  }
  if (order.delivered_upvotes >= order.requested_upvotes) {
    return { cancelable: false, remainingMs: 0, reason: 'Order already fully delivered' };
  }
  const elapsed = Date.now() - new Date(order.created_at).getTime();
  const remaining = CANCEL_WINDOW_MS - elapsed;
  if (remaining <= 0) {
    return { cancelable: false, remainingMs: 0, reason: 'Cancellation window closed (6 hours)' };
  }
  return { cancelable: true, remainingMs: remaining, reason: '' };
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${m}m ${s}s`;
}

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
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  notes: string | null;
  delivery_proof_text?: string | null;
  delivery_proof_url?: string | null;
  drip_interval_hours?: number | null;
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
  paused: {
    label: 'Order paused',
    class: 'bg-purple-50 text-purple-700 ring-purple-200',
    icon: PauseCircle,
    desc: 'This order is currently paused. Delivery is on hold until you or our team resume it.',
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
    desc: 'Order was cancelled and unused credits were automatically refunded.',
  },
};

function parseOrderNotes(raw: string | null) {
  if (!raw) return { clientNote: '', commentText: '', useSuggested: false, sourceKeyword: '', brand: '', youtubeMeta: null as { title?: string; description?: string; tags?: string; privacy?: string; video_url?: string } | null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.service === 'forum_comment') {
      return {
        clientNote: cleanInternalText(parsed.client_notes || ''),
        commentText: parsed.comment_text || '',
        useSuggested: !!parsed.use_suggested_comment,
        sourceKeyword: parsed.source_keyword || '',
        brand: parsed.brand_name || parsed.brand_domain || '',
        youtubeMeta: null,
      };
    }
    if (parsed?.service === 'youtube_upload') {
      return {
        clientNote: cleanInternalText(parsed.client_notes || ''),
        commentText: '',
        useSuggested: false,
        sourceKeyword: '',
        brand: '',
        youtubeMeta: {
          title: parsed.title || '',
          description: parsed.description || '',
          tags: parsed.tags || '',
          privacy: parsed.privacy || 'unlisted',
          video_url: parsed.video_url || '',
        },
      };
    }
  } catch {
    return { clientNote: cleanInternalText(raw), commentText: '', useSuggested: false, sourceKeyword: '', brand: '', youtubeMeta: null };
  }
  return { clientNote: cleanInternalText(raw), commentText: '', useSuggested: false, sourceKeyword: '', brand: '', youtubeMeta: null };
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
        cancelled: 'Order was cancelled and unused credits were automatically refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'youtube_upload') {
    return {
      name: 'YouTube video upload',
      targetLabel: 'Video source',
      quantityLabel: 'Upload',
      progress: '1 video upload ordered',
      statusDesc: {
        pending: 'Our team is reviewing your upload details.',
        processing: 'We are uploading your video to a YouTube channel.',
        completed: 'Video upload is complete. You will receive the YouTube URL as proof.',
        cancelled: 'Order was cancelled and unused credits were automatically refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'preferred_source') {
    return {
      name: 'Google Preferred Source',
      targetLabel: 'Button URL',
      quantityLabel: 'Selections',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} selections`,
      statusDesc: {
        pending: 'We are reviewing your button URL and preparing the selection campaign.',
        processing: 'Real people are selecting your site as their Preferred Source on Google.',
        completed: 'All selections are done. Check the proof below for every selection.',
        cancelled: 'Order was cancelled and unused credits were automatically refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'linkedin_like') {
    return {
      name: 'LinkedIn post likes',
      targetLabel: 'Post URL',
      quantityLabel: 'Likes',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} likes`,
      statusDesc: {
        pending: 'Reviewing your post and queuing workers.',
        processing: 'Real people are liking your LinkedIn post.',
        completed: 'All likes delivered. Proof and profiles verified below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'linkedin_follow') {
    return {
      name: 'LinkedIn company followers',
      targetLabel: 'Company page URL',
      quantityLabel: 'Followers',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} followers`,
      statusDesc: {
        pending: 'Reviewing your company page and queuing workers.',
        processing: 'Real people are following your LinkedIn company page.',
        completed: 'All followers delivered. Proof and profiles verified below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'linkedin_comment') {
    return {
      name: 'LinkedIn post comments',
      targetLabel: 'Post URL',
      quantityLabel: 'Comments',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} comments`,
      statusDesc: {
        pending: 'Reviewing your comment brief/drafts.',
        processing: 'Real people are posting comments on your LinkedIn post.',
        completed: 'All comments delivered. Check comment links and screenshots below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'trustpilot_review') {
    return {
      name: 'Trustpilot reviews',
      targetLabel: 'Trustpilot profile URL',
      quantityLabel: 'Reviews',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} reviews`,
      statusDesc: {
        pending: 'Reviewing your Trustpilot target and review guidelines.',
        processing: 'Real people are writing 5-star reviews on your Trustpilot profile.',
        completed: 'All reviews delivered. Check review details and screenshots below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'google_maps_review') {
    return {
      name: 'Google Maps reviews',
      targetLabel: 'Google Maps business URL',
      quantityLabel: 'Reviews',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} reviews`,
      statusDesc: {
        pending: 'Reviewing your Google Maps target and guidelines.',
        processing: 'Real people are writing 5-star reviews on your Google Maps business profile.',
        completed: 'All reviews delivered. Check review details and screenshots below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'quora_upvote') {
    return {
      name: 'Quora up votes',
      targetLabel: 'Quora URL',
      quantityLabel: 'Upvotes',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} upvotes`,
      statusDesc: {
        pending: 'Queuing your Quora post for upvotes.',
        processing: 'Real people are upvoting your Quora post.',
        completed: 'All upvotes delivered. Check details below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'yelp_review') {
    return {
      name: 'Yelp reviews',
      targetLabel: 'Yelp business URL',
      quantityLabel: 'Reviews',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} reviews`,
      statusDesc: {
        pending: 'Reviewing your Yelp business page and guidelines.',
        processing: 'Real people are submitting 5-star reviews on your Yelp page.',
        completed: 'All reviews delivered. Check review details and screenshots below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'clutch_review') {
    return {
      name: 'Clutch.co B2B reviews',
      targetLabel: 'Clutch company URL',
      quantityLabel: 'Reviews',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} reviews`,
      statusDesc: {
        pending: 'Reviewing your Clutch profile and project scope.',
        processing: 'Verified reviewers are submitting structured 5-star B2B reviews on Clutch.',
        completed: 'All reviews submitted. Check verification details below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
      } as Record<string, string>,
    };
  }
  if ((order.target_type || 'upvote') === 'reseller_order') {
    return {
      name: order.subreddit ? `${order.subreddit} Service` : 'Social Engagement',
      targetLabel: 'Target URL',
      quantityLabel: 'Units',
      progress: `${order.delivered_upvotes || 0} / ${order.requested_upvotes} units`,
      statusDesc: {
        pending: 'Reviewing your target and queuing authentic human delivery.',
        processing: 'Real engagement is actively being delivered to your target link.',
        completed: 'All requested units delivered. Check details below.',
        cancelled: 'Order was cancelled; unfulfilled credits refunded.',
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
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState(0);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [proofs, setProofs] = useState<OrderDeliveryProof[]>([]);
  const [activeLightboxImg, setActiveLightboxImg] = useState<string | null>(null);
  const [cancellationPreview, setCancellationPreview] = useState<{
    ok: boolean;
    order_id: number;
    requested_units: number;
    delivered_units: number;
    locked_active_units: number;
    total_committed: number;
    refundable_units: number;
    refund_amount: number;
    can_cancel: boolean;
  } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; fullName?: string }>({ email: '' });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const cancelState = order ? getClientCancelState(order) : { cancelable: false, remainingMs: 0, reason: '' };

  useEffect(() => {
    if (!cancelState.cancelable) return;
    setCancelCountdown(cancelState.remainingMs);
    const timer = setInterval(() => {
      setCancelCountdown((prev) => {
        const next = prev - 1000;
        return next > 0 ? next : 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cancelState.cancelable, cancelState.remainingMs]);

  const handleExportCSV = () => {
    if (!order) return;
    const rows = [
      ['Order ID', 'Service', 'Target URL', 'Unit #', 'Live Public Link', 'Screenshot URL', 'Status', 'Verified At'],
      ...proofs.map((p, idx) => [
        String(order.id),
        order.subreddit || order.target_type || 'Engagement',
        order.thread_url,
        String(idx + 1),
        p.proof_url || '',
        p.proof_image_url || '',
        p.status,
        p.approved_at ? new Date(p.approved_at).toISOString() : '',
      ]),
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      rows
        .map((r) =>
          r
            .map((field) => `"${String(field).replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `straight-order-${order.id}-report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('CSV delivery report downloaded!');
  };

  const handleCancelOrder = async () => {
    if (!order || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      await updateOrderDetail(order.id, {
        status: 'cancelled',
        cancel_reason: cancelReason.trim(),
      });
      toast.success('Order cancelled — unused credits have been refunded');
      setShowCancelModal(false);
      setCancelReason('');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  };

  const handlePauseOrder = async () => {
    if (!order) return;
    setPausing(true);
    try {
      await clientPauseOrder(order.id, pauseReason.trim() || 'Client requested pause');
      toast.success('Order paused. Delivery is on hold.');
      setShowPauseModal(false);
      setPauseReason('');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to pause order');
    } finally {
      setPausing(false);
    }
  };

  const handleResumeOrder = async () => {
    if (!order) return;
    setResuming(true);
    try {
      await clientResumeOrder(order.id);
      toast.success('Order resumed! Delivery is active again.');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume order');
    } finally {
      setResuming(false);
    }
  };

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
        navigate(spath('/orders'));
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

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser({
          email: user.email || '',
          fullName: user.user_metadata?.full_name || '',
        });
      }

      const p = await getOrderDeliveryProofs(parseInt(orderId));
      setProofs(p);

      const cancelPrev = await getOrderCancellationPreview(parseInt(orderId));
      setCancellationPreview(cancelPrev);
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

  // Realtime: refresh when new messages arrive, order updates, or deliverables added
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
  useRealtimeRefresh(
    { table: 'order_deliverables', event: '*', filter: orderId ? `order_id=eq.${orderId}` : undefined },
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
          onClick={() => navigate(spath('/orders'))}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft size={14} /> All orders
        </button>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Order #{order.id}</h1>
            <p className="text-slate-600 mt-1">
              {service.name} · {order.subreddit && !['comment', 'preferred_source', 'linkedin_like', 'linkedin_follow', 'linkedin_comment', 'trustpilot_review', 'google_maps_review', 'quora_upvote'].includes(order.target_type || 'upvote') && order.subreddit !== 'LinkedIn' && order.subreddit !== 'Google' && order.subreddit !== 'Google Maps' && order.subreddit !== 'Trustpilot' && order.subreddit !== 'Quora' ? `r/${order.subreddit}` : order.thread_url}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {order.status === 'paused' ? (
              <button
                type="button"
                onClick={handleResumeOrder}
                disabled={resuming}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition shadow-sm"
              >
                {resuming ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-white" />}
                Resume Order
              </button>
            ) : order.status === 'processing' || order.status === 'pending' ? (
              <button
                type="button"
                onClick={() => setShowPauseModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 ring-1 ring-purple-200 text-sm font-semibold transition"
              >
                <Pause size={14} />
                Pause Order
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowInvoiceModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold transition"
            >
              <FileText size={14} className="text-slate-500" />
              Receipt
            </button>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
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
                Want $10 more? <Link to={spath('/reviews?tab=trustpilot')} className="font-semibold underline">Submit a Trustpilot review</Link>
              </p>
            </div>
          </div>
        )}

        {/* Verified Deliverables (Relational Multi-Item Delivery Proofs) */}
        {proofs.length > 0 ? (
          <div className="mb-6 p-5 rounded-2xl bg-white ring-1 ring-emerald-200 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-emerald-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={18} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Verified Deliverables ({proofs.length} of {order.requested_upvotes})
                  </h3>
                  <p className="text-xs text-slate-500">Live review URLs & screenshot proofs verified by our team</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold ring-1 ring-emerald-200 transition shrink-0"
                title="Download full deliverables as spreadsheet"
              >
                <FileSpreadsheet size={14} />
                Export CSV Report
              </button>
            </div>

            <div className="space-y-3">
              {proofs.map((p, idx) => (
                <div
                  key={p.assignment_id || idx}
                  className="p-3.5 rounded-xl bg-slate-50 ring-1 ring-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-100/60 transition"
                >
                  <div className="flex items-start md:items-center gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      #{p.item_index || idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900">
                          {p.submitted_username || 'Verified Reviewer'}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          Verified ✓
                        </span>
                      </div>
                      {p.proof_url ? (
                        <a
                          href={p.proof_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 text-xs text-orange-600 hover:text-orange-700 hover:underline inline-flex items-center gap-1 font-medium break-all"
                        >
                          {p.proof_url}
                          <ExternalLink size={11} className="shrink-0" />
                        </a>
                      ) : (
                        <p className="mt-0.5 text-xs text-slate-500 italic">Direct platform verification</p>
                      )}
                      {p.approved_at && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Delivered on {new Date(p.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Screenshot Thumbnail */}
                  {p.proof_image_url && (
                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                      <button
                        type="button"
                        onClick={() => setActiveLightboxImg(p.proof_image_url)}
                        className="group relative rounded-lg overflow-hidden ring-1 ring-slate-300 hover:ring-orange-400 transition"
                        title="Click to view full screenshot"
                      >
                        <img
                          src={p.proof_image_url}
                          alt={`Proof #${p.item_index || idx + 1}`}
                          className="w-16 h-12 object-cover"
                        />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                          <Eye size={14} />
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveLightboxImg(p.proof_image_url)}
                        className="text-xs font-semibold text-slate-600 hover:text-orange-600 inline-flex items-center gap-1"
                      >
                        View Proof <Eye size={12} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (order.delivery_proof_text || order.delivery_proof_url) ? (
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
        ) : null}

        {/* Live Verified Delivery Proofs (Phase 4) */}
        {proofs.length > 0 && (
          <div className="mb-6 p-6 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Verified Delivery Proofs</h3>
                  <p className="text-xs text-slate-500">
                    {proofs.length} completed submission{proofs.length === 1 ? '' : 's'} recorded & verified
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold self-start sm:self-auto transition"
              >
                <Download size={13} /> Export Report (CSV)
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold uppercase">
                    <th className="py-2.5 px-3">Unit</th>
                    <th className="py-2.5 px-3">Live Link / Public URL</th>
                    <th className="py-2.5 px-3">Proof Screenshot</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {proofs.map((p, idx) => (
                    <tr key={p.assignment_id || idx} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3 font-bold text-slate-900">#{idx + 1}</td>
                      <td className="py-3 px-3 font-mono">
                        {p.proof_url ? (
                          <a
                            href={p.proof_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-600 hover:underline inline-flex items-center gap-1 break-all max-w-xs md:max-w-md truncate"
                          >
                            {p.proof_url} <ExternalLink size={10} className="shrink-0" />
                          </a>
                        ) : (
                          <span className="text-slate-400">Verified in screenshot</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {p.proof_image_url ? (
                          <a
                            href={p.proof_image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-medium"
                          >
                            <img
                              src={p.proof_image_url}
                              alt="Proof thumb"
                              className="w-7 h-7 object-cover rounded ring-1 ring-slate-200"
                            />
                            <span>View proof</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-500">
                        {p.approved_at ? new Date(p.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                          <CheckCircle2 size={10} /> Verified
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            {order.drip_interval_hours && order.drip_interval_hours > 0 ? (
              <div className="bg-indigo-50/80 rounded-2xl ring-1 ring-indigo-200 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={16} className="text-indigo-600" />
                  <h3 className="font-bold text-indigo-950 text-sm">Drip Feed Active</h3>
                </div>
                <p className="text-xs text-indigo-900 leading-relaxed">
                  Pacing: <strong>1 review every {order.drip_interval_hours} hours</strong>. Workers are dispatched on a gradual schedule to keep your profile natural and prevent platform review filters.
                </p>
                <div className="mt-3 pt-3 border-t border-indigo-200/60 flex items-center justify-between text-xs">
                  <span className="text-indigo-700 font-medium">Delivered</span>
                  <span className="font-bold text-indigo-950">
                    {order.delivered_upvotes} of {order.requested_upvotes} reviews
                  </span>
                </div>
              </div>
            ) : null}

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
                {order.status === 'cancelled' && order.cancelled_at && (
                  <div>
                    <p className="text-xs text-slate-500">Cancelled</p>
                    <p className="font-medium">{new Date(order.cancelled_at).toLocaleString('en-US')}</p>
                  </div>
                )}
                {order.status === 'cancelled' && order.cancel_reason && (
                  <div className="pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-500">Cancellation reason</p>
                    <p className="text-sm text-slate-700 italic mt-0.5">"{order.cancel_reason}"</p>
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
                {parsedNotes.youtubeMeta && (
                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <p className="text-xs text-slate-500">YouTube upload details</p>
                    <p className="text-sm text-slate-900 font-semibold">{parsedNotes.youtubeMeta.title}</p>
                    {parsedNotes.youtubeMeta.description && (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{parsedNotes.youtubeMeta.description}</p>
                    )}
                    {parsedNotes.youtubeMeta.tags && (
                      <p className="text-xs text-slate-500">Tags: {parsedNotes.youtubeMeta.tags}</p>
                    )}
                    <p className="text-xs text-slate-500 capitalize">Privacy: {parsedNotes.youtubeMeta.privacy}</p>
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

            {/* Pause / Resume action card */}
            {order.status === 'paused' && (
              <div className="p-5 rounded-2xl bg-purple-50 ring-1 ring-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <PauseCircle size={18} className="text-purple-600" />
                  <h3 className="font-semibold text-sm text-purple-950">Order is paused</h3>
                </div>
                <p className="text-xs text-purple-900 mb-3 leading-relaxed">
                  Worker assignments are on hold. Whenever you are ready, click resume to continue delivery seamlessly.
                </p>
                <button
                  type="button"
                  onClick={handleResumeOrder}
                  disabled={resuming}
                  className="w-full px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition"
                >
                  {resuming ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-white" />}
                  Resume delivery now
                </button>
              </div>
            )}

            {(order.status === 'pending' || order.status === 'processing') && (
              <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
                <h3 className="font-semibold text-sm text-slate-900 mb-1">Need to pause this order?</h3>
                <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                  Temporarily hold delivery (e.g. while making site updates or waiting for listings). No credits lost.
                </p>
                <button
                  type="button"
                  onClick={() => setShowPauseModal(true)}
                  className="w-full px-4 py-2 rounded-lg bg-white ring-1 ring-slate-300 text-slate-700 hover:bg-slate-100 font-semibold text-sm inline-flex items-center justify-center gap-2"
                >
                  <Pause size={14} />
                  Pause order
                </button>
              </div>
            )}

            {/* Client self-cancellation window */}
            {cancelState.cancelable && (
              <div className="p-5 rounded-2xl bg-rose-50 ring-1 ring-rose-200">
                <h3 className="font-semibold text-sm text-slate-900 mb-1">Want to cancel this order?</h3>
                <p className="text-xs text-slate-600 mb-3">
                  You can cancel automatically within <strong className="text-slate-900">6 hours</strong> of placing the order.
                  {cancellationPreview && cancellationPreview.locked_active_units > 0
                    ? ` ${cancellationPreview.locked_active_units} unit(s) are actively in progress by our delivery team and protected from cancellation. The remaining ${cancellationPreview.refundable_units} uncommitted unit(s) will be refunded.`
                    : order.requested_upvotes > 1
                    ? ' Unused credits will be refunded pro-rata based on what has not been delivered.'
                    : ' Your payment will be fully refunded as long as nothing has been delivered.'}
                </p>
                {cancellationPreview && !cancellationPreview.can_cancel ? (
                  <div className="p-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-800 text-xs font-medium mb-3">
                    All units are actively in progress or completed. Cancellation is no longer available.
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-medium text-rose-700 mb-3">
                      Window closes in: {formatCountdown(cancelCountdown)}
                    </p>
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="w-full px-4 py-2 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 font-semibold text-sm inline-flex items-center justify-center gap-2"
                    >
                      <AlertOctagon size={14} />
                      Cancel order
                    </button>
                  </>
                )}
              </div>
            )}
            {!cancelState.cancelable && order.status !== 'cancelled' && order.status !== 'completed' && (
              <div className="p-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
                <p className="text-xs text-slate-500">
                  <strong className="text-slate-700">Cancellation window closed.</strong> {cancelState.reason}
                  Contact support if you still need help.
                </p>
              </div>
            )}

            <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
              <h3 className="font-semibold text-sm text-slate-900 mb-2">Need help?</h3>
              <p className="text-xs text-slate-600">
                Use the conversation panel to message our team. We respond fast — typically within 90 minutes.
              </p>
              <Link
                to={spath('/new-order')}
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

      {showPauseModal && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPauseModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                <PauseCircle size={20} className="text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Pause order #{order.id}?</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Delivery will be paused immediately. No worker will be assigned until you resume.
                </p>
              </div>
            </div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Reason / note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              rows={3}
              placeholder="e.g. Waiting for listing to reappear, site updates in progress..."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-slate-900 bg-white mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowPauseModal(false)}
                disabled={pausing}
                className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold text-sm"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handlePauseOrder}
                disabled={pausing}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white font-semibold text-sm inline-flex items-center gap-2"
              >
                {pausing ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
                Confirm pause
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelModal && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCancelModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertOctagon size={20} className="text-rose-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Cancel order #{order.id}?</h3>
                <p className="text-sm text-slate-600 mt-1">
                  {order.requested_upvotes > 1
                    ? 'Unused credits will be refunded pro-rata based on undelivered work.'
                    : 'Your payment will be fully refunded as long as nothing has been delivered.'}
                </p>
              </div>
            </div>

            {cancellationPreview && cancellationPreview.locked_active_units > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-xs text-amber-900">
                <p className="font-bold">Cancellation Lock Notice:</p>
                <p className="mt-0.5">
                  <b>{cancellationPreview.locked_active_units} unit(s)</b> are actively in progress by our delivery team and will complete as scheduled.
                  Your account will receive a refund of <b>{formatUSD(cancellationPreview.refund_amount)}</b> for the {cancellationPreview.refundable_units} uncommitted unit(s).
                </p>
              </div>
            )}

            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Reason for cancellation <span className="text-rose-600">*</span>
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="e.g. Changed my mind, ordered the wrong URL, etc."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none text-slate-900 bg-white mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100 font-semibold text-sm"
              >
                Back
              </button>
              <button
                onClick={handleCancelOrder}
                disabled={!cancelReason.trim() || cancelling}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-semibold text-sm inline-flex items-center gap-2"
              >
                {cancelling ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                Confirm cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvoiceModal && order && (
        <InvoiceModal
          order={order}
          serviceName={service.name}
          client={currentUser}
          onClose={() => setShowInvoiceModal(false)}
        />
      )}

      {/* Screenshot Lightbox Modal */}
      {activeLightboxImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            onClick={() => setActiveLightboxImg(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-4 z-10 w-full">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Eye size={16} className="text-orange-600" /> Screenshot Delivery Proof
              </h4>
              <div className="flex items-center gap-2">
                <a
                  href={activeLightboxImg}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                >
                  Open Original <ExternalLink size={12} />
                </a>
                <button
                  type="button"
                  onClick={() => setActiveLightboxImg(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="overflow-auto p-2 flex items-center justify-center max-h-[75vh]">
              <img
                src={activeLightboxImg}
                alt="Full screenshot"
                className="rounded-lg object-contain max-h-[72vh] w-auto max-w-full ring-1 ring-slate-200 shadow"
              />
            </div>
          </div>
        </div>
      )}
    </RedditLayout>
  );
}
