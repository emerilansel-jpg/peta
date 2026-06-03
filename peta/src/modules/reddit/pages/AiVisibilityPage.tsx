import { useState } from 'react';
import type { ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  Search,
  Loader2,
  Check,
  X,
  ExternalLink,
  ArrowRight,
  Bot,
  Globe,
  AlertCircle,
} from 'lucide-react';
import { RedditLayout } from '../components/RedditLayout';
import { checkAiVisibility } from '../lib/api';
import type { AiVisibilityResult } from '../lib/api';

export function AiVisibilityPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [brand, setBrand] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AiVisibilityResult | null>(null);

  const canRun = keyword.trim().length > 1 && (brand.trim() || domain.trim());

  const run = async () => {
    if (!canRun) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await checkAiVisibility({ keyword, brand: brand || null, domain: domain || null });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const unavailable = result?.provider === 'unavailable';

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-100 text-xs font-bold uppercase tracking-wider mb-3">
            <Eye size={12} />
            AI Visibility
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Are you mentioned where Google & AI look?</h1>
          <p className="text-slate-600 mt-2 max-w-2xl">
            Check whether your brand shows up in Google's top 10 and in Google's AI Overview for a keyword.
            If you're not there yet, placing helpful forum mentions is how you get cited.
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 md:p-7">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-3">
              <label className="block text-sm font-semibold text-slate-900 mb-1.5">Keyword</label>
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
                  placeholder="e.g. best crm for small business"
                  className="w-full pl-10 pr-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-900 mb-1.5">Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Your brand"
                className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                Domain <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="yourdomain.com"
                className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
              />
            </div>
          </div>
          <button
            onClick={run}
            disabled={!canRun || loading}
            className="mt-4 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
            {loading ? 'Checking...' : 'Check visibility'}
          </button>
          <p className="mt-2 text-xs text-slate-500">Enter a keyword plus your brand or domain.</p>
        </div>

        {error && (
          <div className="mt-5 p-4 rounded-xl bg-rose-50 ring-1 ring-rose-100 text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-6">
            {unavailable ? (
              <div className="p-5 rounded-xl bg-amber-50 ring-1 ring-amber-100 text-sm text-amber-800">
                Live visibility data is temporarily unavailable. Please try again in a moment.
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-3">
                  Results for <span className="font-semibold text-slate-700">"{result.keyword}"</span>
                  {result.brand ? <> · brand <span className="font-semibold text-slate-700">{result.brand}</span></> : null}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ResultCard
                    icon={Globe}
                    title="Google organic (top 10)"
                    found={result.google_organic.found}
                    foundLabel={result.google_organic.position ? `Found at position #${result.google_organic.position}` : 'Found in top 10'}
                    missingLabel="Not in the top 10 yet"
                    url={result.google_organic.url}
                  />
                  <ResultCard
                    icon={Bot}
                    title="Google AI Overview"
                    found={result.ai_overview.present && result.ai_overview.brand_mentioned}
                    foundLabel="Mentioned in the AI answer"
                    missingLabel={result.ai_overview.present ? 'AI Overview shown, but you are not cited' : 'No AI Overview / not cited'}
                  />
                </div>

                {/* CTA to act on the gap */}
                {(!result.google_organic.found || !(result.ai_overview.present && result.ai_overview.brand_mentioned)) && (
                  <div className="mt-5 p-5 rounded-2xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-bold">There's a visibility gap to close.</p>
                      <p className="text-sm text-slate-300 mt-0.5">
                        Place helpful, on-context mentions on forums ranking for this keyword to start getting cited.
                      </p>
                    </div>
                    <button
                      onClick={() => navigate(`/reddit/ranking-forum`)}
                      className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-bold"
                    >
                      Start a campaign
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </RedditLayout>
  );
}

function ResultCard({
  icon: Icon,
  title,
  found,
  foundLabel,
  missingLabel,
  url,
}: {
  icon: ElementType;
  title: string;
  found: boolean;
  foundLabel: string;
  missingLabel: string;
  url?: string | null;
}) {
  return (
    <div className={`p-5 rounded-2xl ring-1 ${found ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200'}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${found ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          <Icon size={18} />
        </div>
        <h3 className="font-bold text-slate-900">{title}</h3>
      </div>
      <div className="flex items-center gap-2">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center ${found ? 'bg-emerald-500 text-white' : 'bg-rose-100 text-rose-500'}`}>
          {found ? <Check size={14} /> : <X size={14} />}
        </span>
        <span className={`text-sm font-semibold ${found ? 'text-emerald-800' : 'text-slate-600'}`}>
          {found ? foundLabel : missingLabel}
        </span>
      </div>
      {found && url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 break-all"
        >
          <ExternalLink size={12} className="shrink-0" />
          {url}
        </a>
      )}
    </div>
  );
}
