import { useEffect, useState } from 'react';
import { Star, X, Loader2, Sparkles, Award, CheckCircle2, Camera } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { submitInternalReview } from '../lib/api';
import { ImageUploadWithPaste } from './ImageUploadWithPaste';
import { WebsiteFieldCRO } from './WebsiteFieldCRO';
import { supabase } from '../../../lib/supabase';

interface ReviewRequestModalProps {
  orderId: number;
  defaultName?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const ROLE_OPTIONS = [
  'Founder',
  'CEO',
  'Entrepreneur',
  'Marketing Director',
  'Growth Lead',
  'SEO Manager',
  'Content Manager',
  'Affiliate Marketer',
  'Agency Owner',
  'Consultant',
  'Other',
];

export function ReviewRequestModal({ orderId, defaultName, onClose, onSubmitted }: ReviewRequestModalProps) {
  // Pre-fill from user profile
  const [profileFullName, setProfileFullName] = useState(defaultName || '');
  const [profileRole, setProfileRole] = useState('');
  const [profileWebsite, setProfileWebsite] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // Editable fields — pre-filled from profile, user can override if blank
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerRole, setReviewerRole] = useState('');
  const [reviewerWebsite, setReviewerWebsite] = useState('');

  // Profile photo consent
  const [photoConsent, setPhotoConsent] = useState<'yes' | 'upload' | 'no' | ''>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Load user profile on mount
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users')
        .select('full_name, role_title, website')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setProfileFullName(data.full_name || defaultName || '');
        setProfileRole(data.role_title || '');
        setProfileWebsite(data.website || '');

        setReviewerName(data.full_name || defaultName || '');
        setReviewerRole(data.role_title || '');
        setReviewerWebsite(data.website || '');
      }
      setProfileLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (rating < 1 || rating > 5) {
      toast.error('Please pick a star rating');
      return;
    }
    if (!title.trim()) {
      toast.error('Please add a headline');
      return;
    }
    if (body.trim().length < 10) {
      toast.error('Description must be at least 10 characters');
      return;
    }
    if (!reviewerName.trim()) {
      toast.error('Your name is required');
      return;
    }
    if (!photoConsent) {
      toast.error('Please choose a profile photo option');
      return;
    }

    setSubmitting(true);
    try {
      await submitInternalReview({
        orderId,
        rating,
        reviewerName: reviewerName.trim(),
        reviewerRole: reviewerRole.trim() || undefined,
        reviewerWebsite: reviewerWebsite.trim() || undefined,
        profilePicConsent: photoConsent === 'yes',
        profilePicFile: photoConsent === 'upload' ? photoFile || undefined : undefined,
        dofollowLinkRequested: !!reviewerWebsite.trim(),
        title: title.trim(),
        body: body.trim(),
      });

      // Save role + website to profile if user filled them here for the first time
      const { data: { user } } = await supabase.auth.getUser();
      if (user && (!profileRole || !profileWebsite)) {
        const updates: any = {};
        if (!profileRole && reviewerRole.trim()) updates.role_title = reviewerRole.trim();
        if (!profileWebsite && reviewerWebsite.trim()) updates.website = reviewerWebsite.trim();
        if (Object.keys(updates).length > 0) {
          await supabase.from('users').update(updates).eq('id', user.id);
        }
      }

      toast.success('Review submitted! $5 credit pending admin approval.');
      onSubmitted();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (!profileLoaded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
        <div className="relative bg-white rounded-2xl shadow-2xl p-8">
          <Loader2 size={20} className="animate-spin text-orange-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-orange-500 to-amber-500 text-white p-6 rounded-t-2xl">
          <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded hover:bg-white/10">
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Order delivered!</h2>
              <p className="text-sm text-orange-50">Leave a review · earn $5 credit</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Reward + dofollow upsell */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 ring-1 ring-emerald-100">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <Award size={18} />
              </div>
              <div>
                <p className="font-bold text-slate-900">Earn $5 + featured testimonial</p>
                <p className="text-sm text-slate-700 mt-0.5">
                  Top reviews get featured on our homepage with a <strong>dofollow link</strong> back to your site.
                </p>
                <p className="text-xs text-slate-600 mt-1.5">
                  💡 You can earn up to <strong>$25 total</strong> — this review ($5) + <strong>Trustpilot</strong> ($10) + <strong>advise.so</strong> ($10).
                </p>
              </div>
            </div>
          </div>

          {/* Star rating */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              How would you rate this order?
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    size={36}
                    className={
                      (hoverRating || rating) >= star
                        ? 'fill-amber-400 text-amber-400'
                        : 'fill-slate-200 text-slate-300'
                    }
                  />
                </button>
              ))}
              <span className="ml-3 text-lg font-bold text-slate-900">{rating}/5</span>
            </div>
          </div>

          {/* Headline */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Headline <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="E.g. Best Reddit growth tool we've used"
              required
              maxLength={120}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Description <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What did you like? How did delivery go? Tell us..."
              rows={4}
              required
              minLength={10}
              maxLength={1000}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900"
            />
            <p className="text-xs text-slate-500 mt-1">{body.length}/1000 (min 10)</p>
          </div>

          {/* Profile fields — pre-filled from signup */}
          <div className="p-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 space-y-3">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Your testimonial info</p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 text-sm"
              />
              {profileFullName && reviewerName === profileFullName && (
                <p className="text-xs text-slate-500 mt-0.5">✓ From your account</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
              <select
                value={reviewerRole}
                onChange={(e) => setReviewerRole(e.target.value)}
                className="w-full px-3 py-2 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white text-slate-900 text-sm"
              >
                <option value="">Select...</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              {profileRole && reviewerRole === profileRole && (
                <p className="text-xs text-slate-500 mt-0.5">✓ From your account</p>
              )}
            </div>
          </div>

          <WebsiteFieldCRO value={reviewerWebsite} onChange={setReviewerWebsite} variant="review" />

          {/* Photo permission */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <Camera size={14} />
              Profile photo for testimonial?
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Reviews with photos look authentic and get featured first.
            </p>

            <div className="space-y-2">
              <label className="flex items-start gap-2 p-3 rounded-lg ring-1 ring-slate-200 hover:ring-orange-300 cursor-pointer">
                <input
                  type="radio"
                  name="photoConsent"
                  checked={photoConsent === 'yes'}
                  onChange={() => setPhotoConsent('yes')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                    ✅ Yes — pull from my public profile
                  </div>
                  <p className="text-xs text-slate-600">
                    We'll grab your professional headshot from LinkedIn/Twitter/Gravatar/company site. Recommended.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2 p-3 rounded-lg ring-1 ring-slate-200 hover:ring-orange-300 cursor-pointer">
                <input
                  type="radio"
                  name="photoConsent"
                  checked={photoConsent === 'upload'}
                  onChange={() => setPhotoConsent('upload')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-semibold text-sm text-slate-900">📤 I'll upload or paste my photo</div>
                  <p className="text-xs text-slate-600">Square photos work best · Max 5MB</p>
                </div>
              </label>

              <label className="flex items-start gap-2 p-3 rounded-lg ring-1 ring-slate-200 hover:ring-orange-300 cursor-pointer">
                <input
                  type="radio"
                  name="photoConsent"
                  checked={photoConsent === 'no'}
                  onChange={() => setPhotoConsent('no')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-semibold text-sm text-slate-900">❌ No photo</div>
                  <p className="text-xs text-slate-600">Skip the photo · Will use initials instead</p>
                </div>
              </label>
            </div>

            {photoConsent === 'upload' && (
              <div className="mt-3">
                <ImageUploadWithPaste
                  value={photoFile}
                  onChange={setPhotoFile}
                  label="Upload your profile photo"
                  helperText="Drop, click, or paste (Ctrl+V) · Square works best"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
            >
              Maybe later
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || body.trim().length < 10 || !reviewerName.trim() || !photoConsent}
              className="flex-1 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold inline-flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Submit & earn $5
                </>
              )}
            </button>
          </div>

          <p className="text-xs text-center text-slate-500">
            By submitting, you allow us to publish this review with your name, role, and website on our homepage if approved.
          </p>
        </form>
      </div>
    </div>
  );
}
