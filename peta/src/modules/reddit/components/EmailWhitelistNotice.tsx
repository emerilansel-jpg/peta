import { Mail, AlertCircle, CheckCircle2, X, ArrowRight } from 'lucide-react';
import { useState } from 'react';

const SUPPORT_EMAIL = 'care@straight.ltd';
const SUPPORT_NAME = 'Straight Ltd';

/**
 * EmailWhitelistNotice — explains email deliverability to clients.
 *
 * Variants:
 *   - "modal":   full-screen modal shown right after a delivery-critical action
 *                (e.g. order submitted) — high attention, blocks until dismissed
 *   - "banner":  sticky inline banner shown on the page (e.g. after sending a
 *                ticket reply) — visible but not blocking
 *   - "compact": small two-line notice for nested forms / footers
 */
export type EmailWhitelistNoticeVariant = 'modal' | 'banner' | 'compact';

interface Props {
  variant: EmailWhitelistNoticeVariant;
  /** Optional headline override. Defaults to a context-appropriate one. */
  headline?: string;
  /** Optional sub-context (e.g. "for order #142 updates") to personalise the body. */
  context?: string;
  /** Modal only: confirmation button label */
  primaryLabel?: string;
  /** Modal/banner: dismiss handler */
  onDismiss?: () => void;
}

function buildGmailAddContactUrl() {
  // Gmail "Add Contact" deep link
  return `https://contacts.google.com/new?firstName=${encodeURIComponent(SUPPORT_NAME)}&email=${encodeURIComponent(SUPPORT_EMAIL)}`;
}

function buildMailtoSaveUrl() {
  // Sending an email TO the contact gets Gmail/Outlook to auto-suggest saving
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Adding Straight Ltd to my contacts')}&body=${encodeURIComponent('Hi Straight Ltd — saving you in my contacts so your order updates land in inbox.')}`;
}

export function EmailWhitelistNotice({
  variant,
  headline,
  context,
  primaryLabel = 'Got it, take me to my orders',
  onDismiss,
}: Props) {
  if (variant === 'modal') {
    return (
      <ModalNotice
        headline={headline || 'One quick thing — watch your Spam folder'}
        context={context}
        primaryLabel={primaryLabel}
        onDismiss={onDismiss}
      />
    );
  }
  if (variant === 'banner') {
    return (
      <BannerNotice
        headline={headline || 'Reply sent. Check your inbox (and Spam folder)'}
        context={context}
        onDismiss={onDismiss}
      />
    );
  }
  return <CompactNotice headline={headline} />;
}

function ModalNotice({
  headline,
  context,
  primaryLabel,
  onDismiss,
}: {
  headline: string;
  context?: string;
  primaryLabel: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header gradient with check icon */}
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-5 text-white">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Order placed</p>
              <h2 className="text-xl font-bold mt-0.5">{headline}</h2>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            We'll email you when your order ships, when delivery starts, and when it completes
            {context ? ` ${context}` : ''}. Our emails come from <strong className="text-slate-900">{SUPPORT_EMAIL}</strong>.
          </p>

          {/* Spam folder warning — strongest visual */}
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4">
            <div className="flex gap-3">
              <AlertCircle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-900 text-sm">
                  First email might land in Spam
                </p>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  We're a new domain to your provider. If you don't see our email in your Inbox within 5 minutes:
                </p>
                <ol className="text-xs text-amber-900 mt-2 space-y-1 list-decimal list-inside font-medium">
                  <li>Open <span className="font-bold">Spam</span> folder</li>
                  <li>Find email from <span className="font-bold">{SUPPORT_EMAIL}</span></li>
                  <li>Click <span className="font-bold">"Not Spam"</span> or "Report not spam"</li>
                </ol>
                <p className="text-xs text-amber-700 mt-2">
                  Future order updates will then land straight in your Inbox.
                </p>
              </div>
            </div>
          </div>

          {/* Whitelist actions */}
          <div className="rounded-xl bg-orange-50 ring-1 ring-orange-200 p-4">
            <div className="flex items-start gap-3">
              <Mail size={18} className="text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-orange-900 text-sm">
                  Even better: save us as a contact now
                </p>
                <p className="text-xs text-orange-800 mt-1">
                  Takes 10 seconds. Email providers trust senders saved in your contacts.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={buildGmailAddContactUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-orange-300 hover:ring-orange-400 text-xs font-semibold text-orange-900"
                  >
                    Add to Gmail contacts
                    <ArrowRight size={11} />
                  </a>
                  <a
                    href={buildMailtoSaveUrl()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-orange-300 hover:ring-orange-400 text-xs font-semibold text-orange-900"
                  >
                    Save via mail app
                    <ArrowRight size={11} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={onDismiss}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold shadow-md shadow-orange-500/20 transition"
          >
            {primaryLabel}
            <ArrowRight size={14} />
          </button>
          <p className="text-center text-xs text-slate-500 mt-3">
            You can also track everything in your dashboard at any time.
          </p>
        </div>
      </div>
    </div>
  );
}

function BannerNotice({
  headline,
  context,
  onDismiss,
}: {
  headline: string;
  context?: string;
  onDismiss?: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="rounded-xl bg-gradient-to-r from-orange-50 to-amber-50 ring-1 ring-orange-200 px-4 py-3 flex items-start gap-3">
      <Mail size={18} className="text-orange-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-orange-900 text-sm">{headline}</p>
        <p className="text-xs text-orange-800 mt-0.5 leading-relaxed">
          We replied from <strong>{SUPPORT_EMAIL}</strong>
          {context ? ` ${context}` : ''}. New sender = often filtered.
          <span className="hidden sm:inline"> Check </span>
          <span className="sm:hidden">Check </span>
          <strong>Spam folder</strong> and click <strong>"Not Spam"</strong> so the next reply lands in Inbox.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={buildGmailAddContactUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white ring-1 ring-orange-300 hover:ring-orange-400 text-[11px] font-semibold text-orange-900"
          >
            Add to Gmail contacts
            <ArrowRight size={10} />
          </a>
        </div>
      </div>
      <button
        onClick={() => {
          setHidden(true);
          onDismiss?.();
        }}
        className="p-1 rounded hover:bg-orange-100 text-orange-600 flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function CompactNotice({ headline }: { headline?: string }) {
  return (
    <p className="text-xs text-slate-500 inline-flex items-start gap-1.5">
      <Mail size={12} className="mt-0.5 flex-shrink-0 text-orange-500" />
      <span>
        {headline || (
          <>
            Updates come from <strong className="text-slate-700">{SUPPORT_EMAIL}</strong>.
            Check Spam folder if you don't see them in Inbox.
          </>
        )}
      </span>
    </p>
  );
}
