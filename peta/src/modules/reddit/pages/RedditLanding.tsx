import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Shield,
  Zap,
  TrendingUp,
  Globe,
  Users,
  Check,
  Star,
  Lock,
  Clock,
  BarChart3,
  Headphones,
  Sparkles,
  MessagesSquare,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';

export function RedditLanding() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, []);

  const handleCTA = () => {
    if (isLoggedIn) {
      navigate('/reddit/dashboard');
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
            <span className="text-xs text-slate-500 ml-1">Pro</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900">Features</a>
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
                  onClick={() => navigate('/reddit/signup')}
                  className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600"
                >
                  Start free
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
          {/* Trust badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-100 border border-orange-200 text-sm text-orange-900 font-medium">
              <Star size={14} className="fill-orange-500 text-orange-500" />
              Trusted by 1,200+ agencies and operators
            </div>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-center max-w-5xl mx-auto leading-[1.05]">
            The Reddit growth engine for{' '}
            <span className="bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
              serious operators
            </span>
          </h1>

          <p className="mt-6 text-xl text-slate-600 text-center max-w-2xl mx-auto leading-relaxed">
            Scale visibility on Reddit with high-retention upvotes from real, aged accounts. Built for digital agencies and growth teams who need results that hold.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleCTA}
              className="group flex items-center gap-2 px-8 py-4 rounded-xl bg-orange-500 text-white text-base font-semibold hover:bg-orange-600 shadow-lg shadow-orange-500/20 transition-all"
            >
              {isLoggedIn ? 'Go to dashboard' : 'Start with $25 credit'}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-6 py-4 rounded-xl text-slate-700 text-base font-semibold hover:bg-slate-100"
            >
              See how it works →
            </button>
          </div>

          <p className="mt-6 text-sm text-slate-500 text-center">
            No subscription. Pay only for what you use. PayPal secure checkout.
          </p>

          {/* Hero metrics */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {[
              { label: 'Upvotes delivered', value: '12.4M+' },
              { label: 'Active accounts', value: '47K+' },
              { label: 'Avg. delivery time', value: '< 6 hrs' },
              { label: 'Retention rate', value: '98.2%' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-slate-900">{stat.value}</div>
                <div className="text-sm text-slate-600 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="py-12 border-y border-slate-100 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-xs uppercase tracking-widest text-slate-500 font-semibold mb-8">
            Built for the workflows of high-output teams
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 items-center justify-items-center opacity-60">
            {['Agencies', 'SaaS Founders', 'Affiliate Pros', 'eCom Brands', 'Crypto Teams'].map((label) => (
              <div key={label} className="text-slate-700 font-bold text-sm md:text-base tracking-tight">
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
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Three steps. Hours, not days.</h2>
            <p className="mt-4 text-lg text-slate-600">
              Top up via PayPal, paste your Reddit URL, hit confirm. We handle the rest with full delivery transparency.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Top up with PayPal',
                desc: 'Buy credits securely. No subscription, no auto-renewal. Credits never expire.',
                icon: Lock,
              },
              {
                step: '02',
                title: 'Submit your Reddit URL',
                desc: 'Paste the thread or comment URL. Set how many upvotes. Hit confirm to deduct credits instantly.',
                icon: TrendingUp,
              },
              {
                step: '03',
                title: 'Watch delivery in dashboard',
                desc: 'Real-time status. Average delivery starts under 6 hours. Track every order with full audit trail.',
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

      {/* Features */}
      <section id="features" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Built for pros</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Everything operators need.<br />Nothing they don't.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: 'High-retention accounts',
                desc: 'Aged accounts with karma history. 98%+ retention after 7 days. We replace any drops, free.',
              },
              {
                icon: Zap,
                title: 'Fast, paced delivery',
                desc: 'Natural pacing that mimics organic discovery. No suspicious spikes that trip Reddit\'s automod.',
              },
              {
                icon: Lock,
                title: 'PayPal-secured payments',
                desc: 'Top up via PayPal. We never store card data. Refunds processed within 24 hours when warranted.',
              },
              {
                icon: Globe,
                title: 'Global subreddit coverage',
                desc: 'Works across NSFW, regional, niche, and major subreddits. No restrictions on topic.',
              },
              {
                icon: Clock,
                title: 'No subscriptions',
                desc: 'Pay-as-you-go credits. Top up $25 or $2,500. Credits never expire. Use them when you need them.',
              },
              {
                icon: Headphones,
                title: 'Direct operator support',
                desc: 'Real humans on email + chat. Average first response under 90 minutes. No bots, no tier 1 scripts.',
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
                <Sparkles size={12} />
                New — Private beta
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                Beyond Reddit.<br />
                Get mentioned where{' '}
                <span className="text-orange-400">Google and AI look.</span>
              </h2>
              <p className="mt-4 text-slate-300 leading-relaxed">
                Quora, HubSpot Community, and niche forums still rank in Google's top 10 — and
                they're what AI assistants read when answering your customers' questions.
                We find those pages and place helpful, on-context mentions of your brand.
              </p>
              <ul className="mt-5 space-y-2.5">
                {[
                  'You give one keyword — we build the full keyword list',
                  "We surface forum pages already in Google's top 10",
                  'You write the comment or we do — you approve first',
                  'Live proof + check if AI assistants mention you',
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
                  <MessagesSquare size={26} className="text-orange-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Join the waitlist</h3>
                <p className="mt-2 text-slate-400 text-sm leading-relaxed">
                  Tell us your topic. We'll prepare your first keyword list
                  before your spot opens up — free.
                </p>
                <button
                  onClick={() => navigate('/reddit/waitlist')}
                  className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold shadow-lg shadow-orange-500/20 transition-all"
                >
                  Get early access
                  <ArrowRight size={17} />
                </button>
                <p className="mt-3 text-xs text-slate-500">No spam. Early access only.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Simple, usage-based pricing</h2>
            <p className="mt-4 text-lg text-slate-600">
              One price per upvote. No tiers, no contracts, no surprises.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200">
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Starter</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-5xl font-bold">$25</span>
                <span className="text-slate-500">credit</span>
              </div>
              <p className="text-sm text-slate-600 mt-1">≈ 50 upvotes</p>
              <ul className="mt-8 space-y-3 text-sm">
                {['Same-day delivery start', 'Email support', 'No subscription'].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-slate-700">
                    <Check size={16} className="text-orange-500" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative p-8 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-900/20 -translate-y-4">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-orange-500 text-white text-xs font-bold uppercase tracking-wide">
                Most popular
              </div>
              <p className="text-sm font-semibold text-orange-400 uppercase tracking-wide">Operator</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-5xl font-bold">$100</span>
                <span className="text-slate-400">credit</span>
              </div>
              <p className="text-sm text-slate-300 mt-1">≈ 200 upvotes</p>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  'Priority delivery queue',
                  'Live chat support',
                  'Free drop replacements',
                  'Order history exports',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-slate-100">
                    <Check size={16} className="text-orange-400" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200">
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Agency</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-5xl font-bold">$500+</span>
              </div>
              <p className="text-sm text-slate-600 mt-1">≈ 1,000+ upvotes</p>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  '10% bonus credit',
                  'Dedicated account manager',
                  'White-label invoices',
                  'API access (early Q3)',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-slate-700">
                    <Check size={16} className="text-orange-500" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-10 p-6 rounded-2xl bg-slate-50 ring-1 ring-slate-200 text-center">
            <p className="text-slate-700">
              <span className="font-bold text-slate-900">$0.50 per upvote</span> across all packages. Credits roll over. No expiry. No subscription lock-in.
            </p>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Customer stories</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Loved by teams who ship</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                quote: "Cut our Reddit campaign turnaround from 4 days to under 24 hours. Retention is real — we tracked a 96% hold rate over 30 days.",
                name: 'Marcus K.',
                role: 'Growth Lead, B2B SaaS Agency',
              },
              {
                quote: "We tested 6 competitors. Straight Ltd was the only one where my client's post actually stayed up. Now it's our default tool.",
                name: 'Sasha P.',
                role: 'Founder, Affiliate Marketing Studio',
              },
              {
                quote: "Top-up with PayPal, paste URL, done. No vague packages or hidden fees. Refreshing to find a tool built like a real product.",
                name: 'Daniel L.',
                role: 'Director of Growth, eCommerce Brand',
              },
            ].map((t) => (
              <div key={t.name} className="p-8 rounded-2xl bg-white ring-1 ring-slate-200">
                <div className="flex gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} size={16} className="fill-orange-400 text-orange-400" />
                  ))}
                </div>
                <p className="text-slate-700 leading-relaxed">"{t.quote}"</p>
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <p className="font-bold text-sm text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">FAQ</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Questions we get a lot</h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: 'Are the upvotes from real accounts?',
                a: 'Yes. We use aged Reddit accounts with karma history and posting activity. No throwaways, no bots, no recently-created accounts. Each account has subreddit history that matches their voting behavior.',
              },
              {
                q: 'Will Reddit penalize my post or account?',
                a: 'We use natural pacing patterns to avoid the vote manipulation triggers in Reddit\'s anti-spam system. We\'ve delivered 12M+ upvotes with no account suspensions reported by our customers. That said, no service can guarantee Reddit\'s policies won\'t change.',
              },
              {
                q: 'What happens if upvotes drop?',
                a: 'If retention falls below our 95% guarantee in the first 7 days, we replace the drops for free. Just open a ticket with the order ID — no questions, no haggling.',
              },
              {
                q: 'Can I get a refund?',
                a: 'Yes. Unused credits are refundable within 30 days of purchase. Completed orders are non-refundable unless we fail to deliver. Refunds process to your original PayPal within 24 business hours.',
              },
              {
                q: 'Do you offer an API?',
                a: 'API access is rolling out in early Q3 for Agency-tier customers. Reach out if you want early access.',
              },
              {
                q: 'Is my account safe?',
                a: 'Our service never asks for your Reddit credentials. You just submit the public URL of the thread you want upvoted. Your Reddit account is never touched.',
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
            Ready to scale Reddit?
          </h2>
          <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto">
            Top up $25 and submit your first order in under 5 minutes. No credit card. PayPal checkout.
          </p>
          <button
            onClick={handleCTA}
            className="mt-10 group inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-orange-500 text-white text-base font-semibold hover:bg-orange-400 shadow-xl shadow-orange-500/30 transition-all"
          >
            {isLoggedIn ? 'Go to dashboard' : 'Get started — free to sign up'}
            <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <Shield size={16} />
              SSL secured
            </div>
            <div className="flex items-center gap-2">
              <Lock size={16} />
              PayPal verified
            </div>
            <div className="flex items-center gap-2">
              <Users size={16} />
              1,200+ active operators
            </div>
            <div className="flex items-center gap-2">
              <Clock size={16} />
              24/7 support
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-600 text-sm">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-6 h-6 rounded object-cover" />
            <span>Straight Ltd Pro · © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-500">
            <a href="#" className="hover:text-slate-900">Terms</a>
            <a href="#" className="hover:text-slate-900">Privacy</a>
            <a href="#" className="hover:text-slate-900">Refunds</a>
            <a href="#" className="hover:text-slate-900">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
