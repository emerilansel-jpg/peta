import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Shield,
  Zap,
  Globe,
  Users,
  Check,
  Star,
  Lock,
  Clock,
  BarChart3,
  Headphones,
  RefreshCcw,
  ArrowUpCircle,
  MessagesSquare,
  PlayCircle,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
  getStraightRegistrationMode,
  getStraightPublicStats,
  straightPrice,
  type StraightPublicStats,
} from '../lib/api';
import { useStraightPricing } from '../hooks/useStraightPricing';

// Only show real usage numbers once there are enough completed orders to be
// meaningful. Below that, the hero falls back to policy-based trust chips —
// we never invent numbers.
const MIN_ORDERS_FOR_STATS = 20;

export function RedditLanding() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [regMode, setRegMode] = useState<'signup' | 'waitlist'>('signup');
  const [stats, setStats] = useState<StraightPublicStats | null>(null);
  const pricing = useStraightPricing();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
    getStraightRegistrationMode()
      .then((mode) => setRegMode(mode))
      .catch(() => setRegMode('signup'));
    getStraightPublicStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const showStats = !!stats && stats.completed_orders >= MIN_ORDERS_FOR_STATS;

  // Live price-list values with safe fallbacks (all in USD cents).
  const upvotePrice = straightPrice(pricing, 'reddit_upvote', 50);
  const commentPrice = straightPrice(pricing, 'reddit_comment_plain', 500);
  const youtubePrice = straightPrice(pricing, 'youtube_upload', 500);
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const handleCTA = () => {
    if (isLoggedIn) {
      navigate('/reddit/dashboard');
    } else if (regMode === 'waitlist') {
      navigate('/reddit/waitlist');
    } else {
      navigate('/reddit/signup');
    }
  };

  return (
    <div className="min-h-dvh bg-white text-slate-900 font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-8 h-8 rounded-lg object-cover" />
            <span className="font-bold text-lg">Straight Ltd</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#how" className="hover:text-slate-900">How it works</a>
            <a href="#pricing" className="hover:text-slate-900">Pricing</a>
            <a href="#faq" className="hover:text-slate-900">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <button
                onClick={() => navigate('/reddit/dashboard')}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Dashboard
              </button>
            ) : (
              <>
                <button
                  onClick={() => navigate('/reddit/login')}
                  className="text-sm font-semibold text-slate-700 hover:text-slate-900"
                >
                  Sign in
                </button>
                <button
                  onClick={() => navigate(regMode === 'waitlist' ? '/reddit/waitlist' : '/reddit/signup')}
                  className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600"
                >
                  {regMode === 'waitlist' ? 'Join waitlist' : 'Start now'}
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50 via-white to-white pointer-events-none" />
        <div className="absolute top-20 -right-20 w-96 h-96 bg-orange-200/30 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-center max-w-5xl mx-auto leading-[1.05]">
            Grow on Reddit and big forums —{' '}
            <span className="bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
              the easy way
            </span>
          </h1>

          <p className="mt-6 text-xl text-slate-600 text-center max-w-2xl mx-auto leading-relaxed">
            Get real upvotes, helpful comments about your brand, and YouTube uploads — all from one
            simple dashboard. Pay with PayPal. Watch every order live.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleCTA}
              className="group flex items-center gap-2 px-8 py-4 rounded-xl bg-orange-500 text-white text-base font-semibold hover:bg-orange-600 shadow-lg shadow-orange-500/20 transition-all"
            >
              {isLoggedIn ? 'Go to dashboard' : regMode === 'waitlist' ? 'Join the waitlist' : 'Start your first order'}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-6 py-4 rounded-xl text-slate-700 text-base font-semibold hover:bg-slate-100"
            >
              See how it works
            </button>
          </div>

          <p className="mt-6 text-sm text-slate-500 text-center">
            Free to sign up &middot; Top up from $25 with PayPal &middot; No subscription &middot; Credits never expire
          </p>

          {/* Real usage stats (hidden until there are enough real orders) */}
          {showStats ? (
            <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-slate-900">{stats!.completed_orders.toLocaleString('en-US')}</div>
                <div className="text-sm text-slate-600 mt-1">Orders delivered</div>
              </div>
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-slate-900">{stats!.delivered_units.toLocaleString('en-US')}</div>
                <div className="text-sm text-slate-600 mt-1">Upvotes &amp; comments placed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-slate-900">{stats!.total_clients.toLocaleString('en-US')}</div>
                <div className="text-sm text-slate-600 mt-1">Businesses served</div>
              </div>
            </div>
          ) : (
            <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-slate-700 max-w-3xl mx-auto">
              <span className="inline-flex items-center gap-2"><Users size={16} className="text-orange-500" /> Real people, real accounts</span>
              <span className="inline-flex items-center gap-2"><Lock size={16} className="text-orange-500" /> We never ask for your passwords</span>
              <span className="inline-flex items-center gap-2"><Shield size={16} className="text-orange-500" /> 30-day refund on unused credits</span>
              <span className="inline-flex items-center gap-2"><BarChart3 size={16} className="text-orange-500" /> Proof with every order</span>
            </div>
          )}
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-12 border-y border-slate-100 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-xs uppercase tracking-widest text-slate-500 font-semibold mb-8">
            Who uses Straight
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 items-center justify-items-center opacity-70">
            {['Agencies', 'SaaS founders', 'E-commerce brands', 'Affiliate marketers', 'Local businesses'].map((label) => (
              <div key={label} className="text-slate-700 font-bold text-sm md:text-base tracking-tight text-center">
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Three steps. Minutes, not days.</h2>
            <p className="mt-4 text-lg text-slate-600">
              No calls, no contracts, no learning curve. If you can paste a link, you can do this.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Top up your credits',
                desc: 'Add credits with PayPal, from $25. No subscription and credits never expire.',
                icon: Lock,
              },
              {
                step: '02',
                title: 'Pick a service, paste your link',
                desc: 'Upvotes, comments, or a YouTube upload. Point us at your post or page — that\'s it.',
                icon: ArrowUpCircle,
              },
              {
                step: '03',
                title: 'Watch it happen',
                desc: 'Your order enters the queue immediately. Follow every step and see the proof right in your dashboard.',
                icon: BarChart3,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="relative p-8 rounded-2xl bg-white ring-1 ring-slate-200 hover:ring-orange-300 hover:shadow-lg transition-all">
                  <div className="absolute -top-3 -left-3 w-10 h-10 rounded-lg bg-slate-900 text-white text-sm font-bold flex items-center justify-center">
                    {item.step}
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center mb-6">
                    <Icon size={24} className="text-orange-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                  <p className="text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Services & pricing */}
      <section id="pricing" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Services &amp; pricing</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Pay only for what you order</h2>
            <p className="mt-4 text-lg text-slate-600">
              One clear price per item. Top up once, order as much or as little as you want.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Upvotes */}
            <div className="relative p-8 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-900/20 md:-translate-y-4">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-orange-500 text-white text-xs font-bold uppercase tracking-wide">
                Most popular
              </div>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-orange-500/20 flex items-center justify-center">
                  <ArrowUpCircle size={22} className="text-orange-400" />
                </div>
                <p className="text-sm font-semibold text-orange-400 uppercase tracking-wide">Reddit Upvotes</p>
              </div>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-5xl font-bold">{usd(upvotePrice)}</span>
                <span className="text-slate-400">per upvote</span>
              </div>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  'Real, aged accounts with karma',
                  'Natural, paced delivery',
                  'Free replacement if upvotes drop below 95% in 7 days',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-100">
                    <Check size={16} className="text-orange-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleCTA}
                className="mt-8 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold transition-all"
              >
                Boost my post
                <ArrowRight size={17} />
              </button>
            </div>

            {/* Comments */}
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center">
                  <MessagesSquare size={22} className="text-blue-600" />
                </div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Forum &amp; Reddit Comments</p>
              </div>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-5xl font-bold">from {usd(commentPrice)}</span>
                <span className="text-slate-500">per comment</span>
              </div>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  'Helpful comments that mention your brand',
                  'Reddit, Quora, HubSpot, and niche forums',
                  'You can write it — or our AI drafts it for you',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-700">
                    <Check size={16} className="text-orange-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleCTA}
                className="mt-8 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all"
              >
                Get mentioned
                <ArrowRight size={17} />
              </button>
            </div>

            {/* YouTube */}
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center">
                  <PlayCircle size={22} className="text-red-600" />
                </div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">YouTube Upload</p>
              </div>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-5xl font-bold">{usd(youtubePrice)}</span>
                <span className="text-slate-500">per video</span>
              </div>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  'Your video on a real YouTube channel',
                  'Your title, description, and tags',
                  'Link delivered as proof when it\'s live',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-slate-700">
                    <Check size={16} className="text-orange-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleCTA}
                className="mt-8 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all"
              >
                Upload my video
                <ArrowRight size={17} />
              </button>
            </div>
          </div>

          <div className="mt-10 p-6 rounded-2xl bg-white ring-1 ring-slate-200 text-center">
            <p className="text-slate-700">
              <span className="font-bold text-slate-900">No subscription, no lock-in.</span> Top up from $25 with
              PayPal. Unused credits are refundable within 30 days.
            </p>
          </div>
        </div>
      </section>

      {/* Why Straight */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Why Straight</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Simple to use.<br />Honest about what you get.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Users,
                title: 'Real people, real accounts',
                desc: 'Every upvote and comment comes from a real, aged account with karma and posting history. No bots.',
              },
              {
                icon: Zap,
                title: 'Delivery that looks natural',
                desc: 'Upvotes and comments arrive spread out over time, not in one suspicious spike. You watch live progress the whole way.',
              },
              {
                icon: BarChart3,
                title: 'Proof with every order',
                desc: 'Track status live. When the work is done, you see it: the comment text, the link, and a screenshot.',
              },
              {
                icon: RefreshCcw,
                title: 'Free replacements',
                desc: 'For upvote orders, if more than 5% drop within 7 days, we replace them at no cost. Just send us your order ID.',
              },
              {
                icon: Shield,
                title: 'Safe payments, easy refunds',
                desc: 'Checkout is through PayPal — we never see or store your card. Unused credits are refundable within 30 days.',
              },
              {
                icon: Headphones,
                title: 'Support from real humans',
                desc: 'Message us in your dashboard or email care@straight.ltd. A real person reads and replies — no bots, no scripts.',
              },
            ].map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="p-8 rounded-2xl bg-white ring-1 ring-slate-200">
                  <div className="w-11 h-11 rounded-lg bg-slate-900 flex items-center justify-center mb-5">
                    <Icon size={20} className="text-white" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                  <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Forum Mentions / GEO — New product teaser */}
      <section className="py-20 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/30 text-xs font-bold uppercase tracking-wider text-orange-300 mb-5">
                <Star size={12} className="fill-orange-400 text-orange-400" />
                New
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                Get mentioned where{' '}
                <span className="text-orange-400">Google and AI look.</span>
              </h2>
              <p className="mt-4 text-slate-300 leading-relaxed">
                Sites like Quora and niche forums still rank high in Google — and AI assistants read them
                when answering your customers. Give us one keyword about your business. We find the pages
                that already rank, and place helpful comments that mention your brand.
              </p>
              <ul className="mt-5 space-y-2.5">
                {[
                  'You give one keyword — we build the full keyword list',
                  'We find forum pages already in Google\'s top 10',
                  'You write the comment, or our AI drafts it for you to approve',
                  'You see live proof for every placed comment',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-slate-300 text-sm">
                    <Check size={16} className="text-orange-400 shrink-0 mt-0.5" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:pl-6">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
                <div className="w-14 h-14 mx-auto rounded-xl bg-orange-500/20 flex items-center justify-center mb-5">
                  <Globe size={26} className="text-orange-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Want in early?</h3>
                <p className="mt-2 text-slate-400 text-sm leading-relaxed">
                  Tell us your topic. We'll prepare your first keyword list before your spot opens up — free.
                </p>
                <button
                  onClick={() => navigate('/reddit/waitlist')}
                  className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold shadow-lg shadow-orange-500/20 transition-all"
                >
                  Join the waitlist
                  <ArrowRight size={17} />
                </button>
                <p className="mt-3 text-xs text-slate-500">No spam. Early access only.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">FAQ</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Straight answers</h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: 'Are the upvotes and comments from real accounts?',
                a: 'Yes. Every action comes from a real, aged Reddit account with karma and posting history. No bots, no recently created accounts.',
              },
              {
                q: 'Do you need my Reddit password?',
                a: 'Never. You only paste a public link to the post or page you want. Your own accounts stay 100% in your control.',
              },
              {
                q: 'What happens if upvotes drop later?',
                a: 'For upvote orders, if more than 5% drop within 7 days, we replace the drops for free. Message us with your order ID — no questions asked.',
              },
              {
                q: 'Can I get a refund?',
                a: 'Yes. Unused credits are refundable within 30 days of purchase. You can also cancel an order for a full refund any time before work starts. Refunds go back to your PayPal.',
              },
              {
                q: 'How do I know the work was actually done?',
                a: 'Every completed order shows proof in your dashboard: what was posted, where, and a screenshot or link. Nothing is hidden.',
              },
              {
                q: 'How fast does delivery start?',
                a: 'Your order enters the queue the moment you place it, and delivery is spread out naturally over the following days — a sudden spike of 100 upvotes in one minute helps no one. You can watch live progress in your dashboard at any time.',
              },
            ].map((item) => (
              <details
                key={item.q}
                className="group rounded-xl ring-1 ring-slate-200 bg-white open:ring-orange-300 open:shadow-md transition-all"
              >
                <summary className="cursor-pointer p-6 font-semibold text-slate-900 list-none flex items-center justify-between">
                  <span>{item.q}</span>
                  <span className="text-orange-500 text-2xl font-light group-open:rotate-45 transition-transform">+</span>
                </summary>
                <div className="px-6 pb-6 text-slate-600 leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
            Ready to get seen?
          </h2>
          <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto">
            Create your free account, top up with PayPal, and place your first order in minutes.
            Cancel any time before work starts.
          </p>
          <button
            onClick={handleCTA}
            className="mt-10 group inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-orange-500 text-white text-base font-semibold hover:bg-orange-400 shadow-xl shadow-orange-500/30 transition-all"
          >
            {isLoggedIn ? 'Go to dashboard' : regMode === 'waitlist' ? 'Join the waitlist' : 'Start now — free to sign up'}
            <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <Lock size={16} />
              Secure PayPal checkout
            </div>
            <div className="flex items-center gap-2">
              <Shield size={16} />
              30-day refund on unused credits
            </div>
            <div className="flex items-center gap-2">
              <Clock size={16} />
              Live tracking on every order
            </div>
            <div className="flex items-center gap-2">
              <Headphones size={16} />
              Human support
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-6 h-6 rounded object-cover" />
            <span>Straight Ltd &middot; &copy; {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-500">
            <Link to="/reddit/terms" className="hover:text-slate-900">Terms</Link>
            <Link to="/reddit/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link to="/reddit/refunds" className="hover:text-slate-900">Refunds</Link>
            <Link to="/reddit/contact" className="hover:text-slate-900">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
