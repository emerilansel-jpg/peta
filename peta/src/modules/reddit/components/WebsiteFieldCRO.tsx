import { useState } from 'react';
import { Link2, CheckCircle2, Sparkles, TrendingUp, ExternalLink } from 'lucide-react';

interface WebsiteFieldCROProps {
  value: string;
  onChange: (value: string) => void;
  variant?: 'signup' | 'review';
  size?: 'sm' | 'md';
}

/**
 * High-CRO website input that sells the dofollow link benefit aggressively.
 * Pattern: specific value prop · loss-framing · social proof · live preview.
 */
export function WebsiteFieldCRO({ value, onChange, variant = 'signup', size = 'md' }: WebsiteFieldCROProps) {
  const [focused, setFocused] = useState(false);
  const isFilled = value.trim().length > 0;
  const isValidUrl = /^https?:\/\/.+\..+/.test(value.trim());

  return (
    <div className={`relative rounded-xl transition-all ${
      isFilled
        ? 'bg-emerald-50/40 ring-2 ring-emerald-300'
        : focused
        ? 'bg-orange-50/40 ring-2 ring-orange-400'
        : 'bg-gradient-to-br from-emerald-50/50 via-orange-50/30 to-amber-50/50 ring-1 ring-emerald-200/60'
    }`}>
      {/* Highlight banner above field */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
            isFilled ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {isFilled ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}
          </div>
          <div>
            <p className={`font-bold ${size === 'sm' ? 'text-xs' : 'text-sm'} text-slate-900 leading-tight`}>
              {variant === 'signup' ? 'Get a FREE dofollow backlink' : 'Earn a permanent dofollow backlink'}
            </p>
            <p className="text-[10px] text-slate-600">
              {variant === 'signup' ? 'From our DR-32 homepage · worth ~$200/yr in SEO' : 'Your link sits on our homepage testimonials, indexed by Google'}
            </p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition ${
          isFilled
            ? 'bg-emerald-500 text-white animate-pulse'
            : 'bg-orange-500 text-white'
        }`}>
          {isFilled ? '✓ Eligible' : 'Dofollow ↗'}
        </span>
      </div>

      {/* Input */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Link2 size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${
            isFilled ? 'text-emerald-600' : 'text-slate-400'
          }`} />
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="https://yourbusiness.com"
            className={`w-full pl-9 pr-3 py-2.5 rounded-lg ring-1 focus:outline-none focus:ring-2 text-slate-900 bg-white transition ${
              isFilled
                ? 'ring-emerald-300 focus:ring-emerald-500'
                : 'ring-slate-300 focus:ring-orange-500'
            }`}
          />
        </div>

        {value && !isValidUrl && (
          <p className="text-xs text-rose-600 mt-1">Make sure URL starts with https://</p>
        )}

        {isFilled && isValidUrl && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
            <TrendingUp size={12} />
            <span className="font-semibold">Backlink approved.</span>
            <span className="text-emerald-600">Featured testimonials linked to {new URL(value.startsWith('http') ? value : 'https://' + value).hostname}</span>
          </div>
        )}

        {!isFilled && (
          <p className="text-[11px] text-slate-500 mt-1.5">
            💡 Skip = still leave reviews, but{' '}
            <strong className="text-rose-600">no SEO link</strong>.
            See{' '}
            <a
              href="https://www.semrush.com/blog/what-is-dofollow-link/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline inline-flex items-center gap-0.5"
            >
              what dofollow means
              <ExternalLink size={9} />
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
