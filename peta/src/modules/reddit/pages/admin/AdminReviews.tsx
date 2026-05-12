import { useEffect, useState } from 'react';
import {
  Star,
  ExternalLink,
  Image as ImageIcon,
  Check,
  X,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Sparkles,
  DollarSign,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import {
  getAdminReviews,
  adminApproveReview,
  adminRejectReview,
  formatUSD,
} from '../../lib/api';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: any }> = {
  pending: { label: 'Pending', class: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock },
  approved: { label: 'Approved', class: 'bg-blue-50 text-blue-700 ring-blue-200', icon: CheckCircle2 },
  credit_awarded: { label: 'Credit awarded', class: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: Sparkles },
  rejected: { label: 'Rejected', class: 'bg-rose-50 text-rose-700 ring-rose-200', icon: XCircle },
};

export function AdminReviews() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'internal' | 'trustpilot' | 'awarded'>('pending');
  const [approveModal, setApproveModal] = useState<any>(null);
  const [rejectModal, setRejectModal] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getAdminReviews();
      setReviews(data);
    } catch {
      toast.error('Failed to load reviews');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useRealtimeRefresh({ table: 'reviews' }, () => load());

  const filtered = reviews.filter((r) => {
    if (filter === 'pending') return r.status === 'pending';
    if (filter === 'awarded') return r.status === 'credit_awarded';
    if (filter === 'internal') return r.type === 'internal';
    if (filter === 'trustpilot') return r.type === 'trustpilot';
    return true;
  });

  const stats = {
    pending: reviews.filter((r) => r.status === 'pending').length,
    awarded: reviews.filter((r) => r.status === 'credit_awarded').length,
    internal: reviews.filter((r) => r.type === 'internal').length,
    trustpilot: reviews.filter((r) => r.type === 'trustpilot').length,
  };

  const totalAwarded = reviews
    .filter((r) => r.status === 'credit_awarded')
    .reduce((sum, r) => sum + r.credit_awarded_cents, 0);

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Reviews' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reviews & Testimonials</h1>
            <p className="text-slate-600 mt-1">Approve reviews and award credit</p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatBox label="Pending" value={stats.pending.toString()} color="amber" />
          <StatBox label="Internal reviews" value={stats.internal.toString()} color="blue" />
          <StatBox label="Trustpilot reviews" value={stats.trustpilot.toString()} color="purple" />
          <StatBox label="Total credits awarded" value={formatUSD(totalAwarded)} color="emerald" />
        </div>

        {/* Filter tabs */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-6 inline-flex gap-1 overflow-x-auto">
          {[
            { key: 'pending', label: `Pending (${stats.pending})` },
            { key: 'awarded', label: `Awarded (${stats.awarded})` },
            { key: 'internal', label: `Internal (${stats.internal})` },
            { key: 'trustpilot', label: `Trustpilot (${stats.trustpilot})` },
            { key: 'all', label: `All (${reviews.length})` },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                filter === f.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Reviews list */}
        {loading ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-12 text-center text-slate-500">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-12 text-center">
            <Star size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="font-semibold text-slate-900">No reviews in this filter</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((r) => (
              <AdminReviewCard
                key={r.id}
                review={r}
                onApprove={() => setApproveModal(r)}
                onReject={() => setRejectModal(r)}
              />
            ))}
          </div>
        )}
      </div>

      {approveModal && (
        <ApproveModal
          review={approveModal}
          onClose={() => setApproveModal(null)}
          onApproved={() => {
            setApproveModal(null);
            load();
          }}
        />
      )}

      {rejectModal && (
        <RejectModal
          review={rejectModal}
          onClose={() => setRejectModal(null)}
          onRejected={() => {
            setRejectModal(null);
            load();
          }}
        />
      )}
    </AdminLayout>
  );
}

function AdminReviewCard({
  review,
  onApprove,
  onReject,
}: {
  review: any;
  onApprove: () => void;
  onReject: () => void;
}) {
  const status = STATUS_CONFIG[review.status] || STATUS_CONFIG.pending;
  const StatusIcon = status.icon;
  const isPending = review.status === 'pending';

  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
      <div className="flex flex-col md:flex-row md:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              review.type === 'trustpilot' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {review.type === 'trustpilot' ? '🌟 Trustpilot' : 'Internal'}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${status.class}`}>
              <StatusIcon size={10} />
              {status.label}
            </span>
            {review.credit_awarded_cents > 0 && (
              <span className="text-xs font-bold text-emerald-700">
                +{formatUSD(review.credit_awarded_cents)} awarded
              </span>
            )}
            {review.order_id && (
              <span className="text-xs text-slate-500">· Order #{review.order_id}</span>
            )}
          </div>

          {/* Client info */}
          <div className="text-sm text-slate-600 mb-3">
            <span className="font-medium text-slate-900">{review.users?.full_name || '—'}</span>
            <span className="text-slate-500"> · {review.users?.email}</span>
            {review.reviewer_name && review.reviewer_name !== review.users?.full_name && (
              <span className="text-slate-500"> · Reviewer name: {review.reviewer_name}</span>
            )}
          </div>

          {/* Internal review content */}
          {review.type === 'internal' && (
            <>
              <div className="flex items-center gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={16}
                    className={s <= review.rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-300'}
                  />
                ))}
                <span className="ml-1 text-sm font-semibold text-slate-900">{review.rating}/5</span>
              </div>
              {review.title && <p className="font-bold text-slate-900 mb-1">{review.title}</p>}
              {review.body && <p className="text-sm text-slate-700">{review.body}</p>}
            </>
          )}

          {/* Trustpilot proof */}
          {review.type === 'trustpilot' && (
            <div className="space-y-2">
              {review.trustpilot_url && (
                <a
                  href={review.trustpilot_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-orange-600 hover:underline"
                >
                  <ExternalLink size={12} />
                  Verify on Trustpilot
                </a>
              )}
              {review.trustpilot_screenshot_url && (
                <a
                  href={review.trustpilot_screenshot_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg ring-1 ring-slate-200 hover:ring-orange-300 text-sm">
                    <ImageIcon size={14} className="text-slate-500" />
                    <span className="font-medium text-slate-900">View screenshot</span>
                    <ExternalLink size={10} className="text-slate-400" />
                  </div>
                </a>
              )}
            </div>
          )}

          {review.admin_notes && (
            <div className="mt-3 p-2 rounded bg-slate-50 text-xs text-slate-600">
              <strong className="text-slate-700">Admin note:</strong> {review.admin_notes}
            </div>
          )}

          <p className="text-xs text-slate-400 mt-3">
            Submitted {new Date(review.created_at).toLocaleString('en-US')}
            {review.reviewed_at && ` · Reviewed ${new Date(review.reviewed_at).toLocaleDateString('en-US')}`}
          </p>
        </div>

        {/* Actions */}
        {isPending && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onApprove}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold"
            >
              <Check size={14} />
              Approve
            </button>
            <button
              onClick={onReject}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg ring-1 ring-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-semibold"
            >
              <X size={14} />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ApproveModal({
  review,
  onClose,
  onApproved,
}: {
  review: any;
  onClose: () => void;
  onApproved: () => void;
}) {
  const defaultCredit = review.type === 'trustpilot' ? 1000 : 500; // $10 or $5
  const [creditUSD, setCreditUSD] = useState((defaultCredit / 100).toString());
  const [approving, setApproving] = useState(false);

  const handleApprove = async () => {
    const cents = Math.round(parseFloat(creditUSD) * 100);
    if (isNaN(cents) || cents < 0) {
      toast.error('Invalid credit amount');
      return;
    }
    setApproving(true);
    try {
      await adminApproveReview(review.id, cents);
      toast.success(`Approved · ${formatUSD(cents)} credited to ${review.users?.email}`);
      onApproved();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <Check size={20} className="text-emerald-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">Approve & credit</h3>
            <p className="text-sm text-slate-500">For {review.users?.email}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Credit to award (USD)</label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="number"
                step="0.01"
                value={creditUSD}
                onChange={(e) => setCreditUSD(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 font-semibold"
              />
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setCreditUSD('5.00')} className="px-2 py-1 rounded text-xs ring-1 ring-slate-200 hover:bg-slate-50">$5 (internal)</button>
              <button onClick={() => setCreditUSD('10.00')} className="px-2 py-1 rounded text-xs ring-1 ring-slate-200 hover:bg-slate-50">$10 (Trustpilot)</button>
              <button onClick={() => setCreditUSD('0.00')} className="px-2 py-1 rounded text-xs ring-1 ring-slate-200 hover:bg-slate-50">$0 (no credit)</button>
            </div>
          </div>

          <div className="p-3 rounded bg-blue-50 text-xs text-blue-900">
            Approving will mark this review as <strong>credit_awarded</strong> and add credit to the user's balance. Action is logged in transactions.
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={approving}
            className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold"
          >
            {approving ? 'Approving...' : 'Approve & credit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({
  review,
  onClose,
  onRejected,
}: {
  review: any;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const handleReject = async () => {
    if (!reason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    setRejecting(true);
    try {
      await adminRejectReview(review.id, reason.trim());
      toast.success('Review rejected');
      onRejected();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-xl font-bold text-slate-900 mb-2">Reject review</h3>
        <p className="text-sm text-slate-500 mb-4">From {review.users?.email}</p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (e.g. couldn't verify Trustpilot URL, duplicate, spam...)"
          rows={3}
          className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none text-slate-900"
        />

        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            disabled={rejecting}
            className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleReject}
            disabled={rejecting || !reason.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold"
          >
            {rejecting ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    amber: 'bg-amber-50 ring-amber-200 text-amber-900',
    blue: 'bg-blue-50 ring-blue-200 text-blue-900',
    purple: 'bg-purple-50 ring-purple-200 text-purple-900',
    emerald: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
  };
  return (
    <div className={`p-4 rounded-xl ring-1 ${colors[color]}`}>
      <p className="text-xs uppercase tracking-wider font-semibold opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
