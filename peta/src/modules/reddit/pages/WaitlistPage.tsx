import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Loader2,
  Search,
  MessagesSquare,
  Sparkles,
  ShieldCheck,
  Bot,
} from 'lucide-react';
import { joinWaitlist } from '../lib/api';

const STEPS = [
  {
    icon: Search,
    title: 'Give us one keyword',
    desc: 'Just a seed topic. We turn it into a full keyword list — no keyword research on your side.',
  },
  {
    icon: MessagesSquare,
    title: 'We find the forums',
    desc: 'Discussion and community pages ranking in Google’s top 10 for those keywords.',
  },
  {
    icon: Sparkles,
    title: 'We place the mention',
    desc: 'A natural, on-context comment that mentions your brand. You write it or we do — you approve first.',
  },
  {
    icon: Bot,
    title: 'You get the proof',
    desc: 'Live link + screenshot, plus a check on whether AI assistants start mentioning you.',
  },
];

export function WaitlistPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [seedKeyword, setSeedKeyword] = useState('');
  const [brand, setBrand] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'joined' | 'already' | null>(null);
  const [error, setError] = useState('');

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!emailValid) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await joinWaitlist({
        email,
        seedKeyword: seedKeyword || null,
        brand: brand || null,
        website: website || null,
        notes: notes || null,
      });
      setDone(res.joined ? 'joined' : 'already');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white text-slate-900 font-sans">
      {/* Nav */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/reddit')} className="flex items-center gap-2">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-8 h-8 rounded-lg object-cover" />
            <span className="font-bold text-lg">Straight Ltd</span>
          </button>
          <button
            onClick={() => navigate('/reddit/login')}
            className="text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            Sign in
          </button>
        </div>
      </nav>

      {/* Hero + form */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50 via-white to-white pointer-events-none" />
        <div className="absolute top-16 -right-24 w-96 h-96 bg-orange-200/30 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: pitch */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 border border-orange-200 text-xs font-bold uppercase tracking-wider text-orange-900 mb-5">
              <Sparkles size={12} />
              Now in private beta
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.08]">
              Get mentioned where{' '}
              <span className="bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
                Google and AI
              </span>{' '}
              actually look
            </h1>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
              Reddit isn’t the only place that matters. Quora, HubSpot Community, and niche forums still rank
              in Google’s top 10 — and they’re what AI assistants read. We find those pages for your topic
              and place helpful, on-context mentions of your brand.
            </p>

            <ul className="mt-6 space-y-2.5">
              {[
                'You give one keyword — we build the keyword list',
                'We surface forum pages already ranking in Google’s top 10',
                'Natural mentions, written by you or by us — approved before they go live',
                'Proof of every placement + a check on AI assistant mentions',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-slate-700">
                  <Check size={18} className="text-orange-500 shrink-0 mt-0.5" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-7 flex items-center gap-2 text-sm text-slate-500">
              <ShieldCheck size={16} className="text-slate-400" />
              No spam. We only email you about early access.
            </div>
          </div>

          {/* Right: waitlist form / success */}
          <div className="lg:pl-4">
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-xl shadow-slate-900/5 p-6 md:p-8">
              {done ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-5">
                    <Check size={28} className="text-emerald-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {done === 'already' ? 'You’re already on the list' : 'You’re on the list'}
                  </h2>
                  <p className="mt-2 text-slate-600">
                    {done === 'already'
                      ? 'This email is already registered. We’ll reach out when your spot opens up.'
                      : 'Thanks for joining. We’ll email you the moment early access opens.'}
                  </p>
                  <button
                    onClick={() => navigate('/reddit')}
                    className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold"
                  >
                    Back to home
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-slate-900">Join the waitlist</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Tell us your topic and we’ll prepare your first keyword list before you’re in.
                  </p>

                  <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Work email <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                        className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Seed keyword / topic <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={seedKeyword}
                        onChange={(e) => setSeedKeyword(e.target.value)}
                        placeholder="e.g. crm software"
                        className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                          Brand <span className="text-slate-400 font-normal">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={brand}
                          onChange={(e) => setBrand(e.target.value)}
                          placeholder="Your brand"
                          className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                          Website <span className="text-slate-400 font-normal">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          placeholder="yourdomain.com"
                          className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Anything else? <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="What are you trying to rank or get mentioned for?"
                        rows={3}
                        className="w-full px-4 py-3 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-slate-900"
                      />
                    </div>

                    {error && (
                      <p className="text-sm text-rose-600">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={!emailValid || submitting}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold shadow-lg shadow-orange-500/20 transition"
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Joining...
                        </>
                      ) : (
                        <>
                          Join the waitlist
                          <ArrowRight size={18} />
                        </>
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">One keyword in. Mentions out.</h2>
            <p className="mt-4 text-lg text-slate-600">
              You stay hands-off. We do the research, the placement, and the proof.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="relative p-6 rounded-2xl bg-white ring-1 ring-slate-200">
                  <div className="absolute -top-3 -left-3 w-9 h-9 rounded-lg bg-slate-900 text-white text-sm font-bold flex items-center justify-center">
                    {i + 1}
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
                    <Icon size={20} className="text-orange-600" />
                  </div>
                  <h3 className="font-bold text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-6 h-6 rounded object-cover" />
            <span>Straight Ltd · © {new Date().getFullYear()}</span>
          </div>
          <button onClick={() => navigate('/reddit')} className="text-sm text-slate-500 hover:text-slate-900">
            Back to home
          </button>
        </div>
      </footer>
    </div>
  );
}
