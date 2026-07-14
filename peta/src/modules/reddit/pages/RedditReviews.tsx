import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Star,
  ExternalLink,
  Loader2,
  Send,
  Image as ImageIcon,
  Clock,
  XCircle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Trophy,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { RedditLayout } from '../components/RedditLayout';
import { ImageUploadWithPaste } from '../components/ImageUploadWithPaste';
import { getMyReviews, submitProofReview, formatUSD } from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../../../lib/supabase';

const TRUSTPILOT_URL = 'https://www.trustpilot.com/review/straight.ltd';
const ADVISE_URL = 'https://advise.so';

type TabKey = 'my-reviews' | 'trustpilot' | 'advise';

export function RedditReviews() {
  const [params, setParams] = useSearchParams();
  const initialTab = (params.get('tab') as TabKey) || 'my-reviews';
  const [tab, setTab] = useState<TabKey>(initialTab);

  const setTabAndUrl = (t: TabKey) => {
    setTab(t);
    params.set('tab', t);
    setParams(params, { replace: true });
  };

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        {/* Earn $25 hero — CRO upsell */}
        <div className="mb-6 p-6 rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700 text-white relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-amber-300/20 rounded-full blur-3xl" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs font-bold uppercase tracking-wider mb-3">
                <Trophy size={12} />
                Rewards program
              </div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Earn up to <span className="text-amber-300">$25 in free credits</span>
              </h1>
              <p className="mt-2 text-emerald-50 text-sm md:text-base">
                3 reviews · 3 simple steps · stacks with future orders
              </p>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <RewardBadge label="In-app review" amount="$5" />
              <RewardBadge label="Trustpilot review" amount="$10" />
              <RewardBadge label="advise.so / Slack" amount="$10" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-1 mb-6 inline-flex gap-1 overflow-x-auto">
          <TabButton active={tab === 'my-reviews'} onClick={() => setTabAndUrl('my-reviews')} label="My Reviews" />
          <TabButton active={tab === 'trustpilot'} onClick={() => setTabAndUrl('trustpilot')} label="Trustpilot" reward="$10" />
          <TabButton active={tab === 'advise'} onClick={() => setTabAndUrl('advise')} label="advise.so" reward="$10" />
        </div>

        {tab === 'my-reviews' && <MyReviewsTab />}
        {tab === 'trustpilot' && (
          <ProofReviewTab
            type="trustpilot"
            title="Trustpilot Review"
            reward="$10"
            externalUrl={TRUSTPILOT_URL}
            externalLabel="trustpilot.com/review/straight.ltd"
            urlPlaceholder="https://www.trustpilot.com/reviews/abc123..."
            urlHelp="Find the URL by clicking the date/time of your review on Trustpilot."
          />
        )}
        {tab === 'advise' && (
          <ProofReviewTab
            type="advise"
            title="advise.so Slack Review"
            reward="$10"
            externalUrl={ADVISE_URL}
            externalLabel="advise.so Slack community"
            urlPlaceholder="Slack message permalink, screenshot, or post URL"
            urlHelp="Paste a link to your Slack message recommending Straight Ltd — OR upload a screenshot below."
            customCopy={{
              headline: 'Recommend us inside the advise.so community',
              description: 'Are you an advise.so member? Share a good word about Straight Ltd in their Slack (or any other forum/community where operators hang out). Submit proof here for $10 credit.',
            }}
          />
        )}
      </div>
    </RedditLayout>
  );
}

function RewardBadge({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm ring-1 ring-white/20 flex items-center justify-between gap-2">
      <span>{label}</span>
      <strong className="text-amber-300">{amount}</strong>
    </div>
  );
}

function TabButton({ active, onClick, label, reward }: { active: boolean; onClick: () => void; label: string; reward?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 whitespace-nowrap ${
        active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
      {reward && (
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
          active ? 'bg-orange-500 text-white' : 'bg-emerald-100 text-emerald-700'
        }`}>
          +{reward}
        </span>
      )}
    </button>
  );
}

// ============================================================
// Tab: My Reviews
// ============================================================
function MyReviewsTab() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getMyReviews();
      setReviews(data);
    } catch {
      toast.error('Failed to load reviews');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh({ table: 'reviews' }, load);

  if (loading) return <p className="text-center text-slate-500 py-12">Loading...</p>;

  if (reviews.length === 0) {
    return (
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-12 text-center">
        <Star size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="font-semibold text-slate-900">No reviews yet</p>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          Complete your first order, then leave a review to earn $5. Stack with Trustpilot & advise.so for up to $25.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
    </div>
  );
}

function ReviewCard({ review }: { review: any }) {
  const statusConfig: Record<string, { label: string; class: string; icon: any }> = {
    pending: { label: 'Pending review', class: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock },
    approved: { label: 'Approved', class: 'bg-blue-50 text-blue-700 ring-blue-200', icon: CheckCircle2 },
    credit_awarded: { label: `+${formatUSD(review.credit_awarded_cents)} credited`, class: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: Sparkles },
    rejected: { label: 'Rejected', class: 'bg-rose-50 text-rose-700 ring-rose-200', icon: XCircle },
  };
  const status = statusConfig[review.status] || statusConfig.pending;
  const StatusIcon = status.icon;

  const typeLabel = {
    internal: '⭐ Internal Review',
    trustpilot: '🌟 Trustpilot',
    advise: '💬 advise.so',
  }[review.type as string] || review.type;

  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5">
      <div className="flex flex-col md:flex-row md:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {typeLabel}
            </span>
            {review.order_id && (
              <span className="text-xs text-slate-400">· Order #{review.order_id}</span>
            )}
          </div>

          {review.rating && (
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={16} className={s <= review.rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-300'} />
              ))}
            </div>
          )}

          {review.title && <p className="font-bold text-slate-900 mb-1">{review.title}</p>}
          {review.body && <p className="text-sm text-slate-700 leading-relaxed">{review.body}</p>}

          {review.trustpilot_url && (
            <a href={review.trustpilot_url} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-600 hover:underline inline-flex items-center gap-1 mt-1">
              View proof <ExternalLink size={10} />
            </a>
          )}
          {review.trustpilot_screenshot_url && (
            <a href={review.trustpilot_screenshot_url} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-600 hover:underline inline-flex items-center gap-1 mt-1">
              <ImageIcon size={12} /> View screenshot
            </a>
          )}

          <p className="text-xs text-slate-400 mt-2">
            Submitted {new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </p>
        </div>

        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ring-1 shrink-0 ${status.class}`}>
          <StatusIcon size={12} />
          {status.label}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Proof Review Tab (used for Trustpilot + advise.so)
// ============================================================
interface ProofReviewTabProps {
  type: 'trustpilot' | 'advise';
  title: string;
  reward: string;
  externalUrl: string;
  externalLabel: string;
  urlPlaceholder: string;
  urlHelp: string;
  customCopy?: { headline: string; description: string };
}

function ProofReviewTab({ type, title, reward, externalUrl, externalLabel, urlPlaceholder, urlHelp, customCopy }: ProofReviewTabProps) {
  const [reviewerName, setReviewerName] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle();
        if (data?.full_name) setReviewerName(data.full_name);
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewerName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    if (!proofUrl.trim() && !screenshotFile) {
      toast.error('Provide either a URL or a screenshot');
      return;
    }
    setSubmitting(true);
    try {
      await submitProofReview({
        type,
        reviewerName: reviewerName.trim(),
        proofUrl: proofUrl.trim() || undefined,
        screenshotFile: screenshotFile || undefined,
      });
      toast.success(`Submitted! ${reward} credit added within 24 hours after verification.`);
      setSubmitted(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <CheckCircle2 size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Submission received</h2>
        <p className="text-slate-600 mt-2 max-w-md mx-auto">
          We're verifying your review. Once confirmed, <span className="font-semibold text-emerald-700">{reward} credit</span> appears in your account.
        </p>
        <p className="text-xs text-slate-500 mt-2">Typical verification: under 24 hours.</p>
        <button
          onClick={() => {
            setSubmitted(false);
            setProofUrl('');
            setScreenshotFile(null);
          }}
          className="mt-6 text-sm font-semibold text-orange-600 hover:text-orange-700"
        >
          Submit another →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white p-6">
        <div className="flex items-start gap-4">
          <div className="text-4xl">⭐</div>
          <div>
            <h2 className="text-xl font-bold">{customCopy?.headline || `Earn ${reward} credit for a ${title}`}</h2>
            <p className="text-sm text-orange-50 mt-1">
              {customCopy?.description || `Help other operators discover Straight Ltd. We add ${reward} credit to your account within 24 hours after verification.`}
            </p>
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-sm font-semibold text-sm transition"
            >
              <Star size={14} className="fill-white" />
              Open {externalLabel}
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
        <h3 className="font-bold text-slate-900 mb-4">How to claim your {reward} credit</h3>
        <ol className="space-y-3 text-sm text-slate-700">
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <div>
              <p className="font-semibold text-slate-900">Post your review on {type === 'trustpilot' ? 'Trustpilot' : externalLabel}</p>
              <p className="text-slate-600 text-xs mt-0.5">
                <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">{externalUrl}</a>
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
            <div>
              <p className="font-semibold text-slate-900">Submit proof below</p>
              <p className="text-slate-600 text-xs mt-0.5">Paste the URL OR upload/paste a screenshot</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
            <div>
              <p className="font-semibold text-slate-900">Get {reward} credit</p>
              <p className="text-slate-600 text-xs mt-0.5">Verified within 24 hours · Credits added automatically</p>
            </div>
          </li>
        </ol>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 space-y-5">
        <h3 className="font-bold text-slate-900">Submit your review proof</h3>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Your name <span className="text-rose-500">*</span></label>
          <input
            type="text"
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
            placeholder={`As it appears on ${type === 'trustpilot' ? 'Trustpilot' : 'the platform'}`}
            required
            className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Review URL <span className="text-slate-400 font-normal">(option A)</span>
          </label>
          <input
            type="url"
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            placeholder={urlPlaceholder}
            className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
          />
          <p className="text-xs text-slate-500 mt-1">{urlHelp}</p>
        </div>

        <div className="relative flex items-center gap-2 py-1">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">OR</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Screenshot of your review <span className="text-slate-400 font-normal">(option B)</span>
          </label>
          <ImageUploadWithPaste
            value={screenshotFile}
            onChange={setScreenshotFile}
            label="Upload your review screenshot"
            helperText="PNG, JPG, WebP, GIF · Max 5MB · Drag, click, or paste (Ctrl+V)"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !reviewerName.trim() || (!proofUrl.trim() && !screenshotFile)}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold shadow-lg shadow-orange-500/20"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send size={14} />
              Submit & earn {reward}
              <ArrowRight size={14} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
