import { spath } from '../lib/path';
import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Shield,
  Globe,
  Users,
  Check,
  Star,
  Lock,
  BarChart3,
  Headphones,
  MessagesSquare,
  TrendingUp,
  Send,
  Wrench,
  Compass,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { getStraightRegistrationMode, getStraightPublicStats, type StraightPublicStats } from '../lib/api';

// Only show real usage numbers once there are enough completed orders to be
// meaningful. Below that, the trust bar shows policy chips only — we never
// invent numbers.
const MIN_ORDERS_FOR_STATS = 20;

export function RedditLanding() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [regMode, setRegMode] = useState<'signup' | 'waitlist'>('signup');
  const [stats, setStats] = useState<StraightPublicStats | null>(null);

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

  const handleCTA = () => {
    if (isLoggedIn) {
      navigate(spath('/dashboard'));
    } else if (regMode === 'waitlist') {
      navigate(spath('/waitlist'));
    } else {
      navigate(spath('/signup'));
    }
  };

  const handleCustomTaskCTA = () => {
    navigate(isLoggedIn ? spath('/new-order') : spath('/signup'));
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
            <a href="#what" className="hover:text-slate-900">What we do</a>
            <a href="#use-cases" className="hover:text-slate-900">Use cases</a>
            <a href="#geo" className="hover:text-slate-900">GEO</a>
            <a href="#faq" className="hover:text-slate-900">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <button
                onClick={() => navigate(spath('/dashboard'))}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Dashboard
              </button>
            ) : (
              <>
                <button
                  onClick={() => navigate(spath('/login'))}
                  className="text-sm font-semibold text-slate-700 hover:text-slate-900"
                >
                  Sign in
                </button>
                <button
                  onClick={() => navigate(regMode === 'waitlist' ? spath('/waitlist') : spath('/signup'))}
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

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-20">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-center max-w-5xl mx-auto leading-[1.05]">
            Real people for the online tasks that{' '}
            <span className="bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
              grow your brand
            </span>
          </h1>

          <p className="mt-6 text-xl text-slate-600 text-center max-w-3xl mx-auto leading-relaxed">
            Straight gives you access to a distributed workforce of real people who can complete
            small online tasks for visibility, discovery, and brand growth.
          </p>

          <p className="mt-4 text-base text-slate-500 text-center max-w-2xl mx-auto">
            Built for GEO, search visibility, and modern brand distribution.
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
              onClick={() => document.getElementById('what')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-6 py-4 rounded-xl text-slate-700 text-base font-semibold hover:bg-slate-100"
            >
              See how it works
            </button>
          </div>

          <p className="mt-6 text-sm text-slate-500 text-center">
            Free to sign up &middot; Top up from USD 25 &middot; No subscription &middot; Credits never expire
          </p>
        </div>
      </section>

      {/* Trust bar */}
      <section className="py-10 border-y border-slate-100 bg-slate-50/50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-700">
            <span className="inline-flex items-center gap-2"><Users size={16} className="text-orange-500" /> Real people</span>
            <span className="inline-flex items-center gap-2"><BarChart3 size={16} className="text-orange-500" /> Live tracking</span>
            <span className="inline-flex items-center gap-2"><Shield size={16} className="text-orange-500" /> Proof on every order</span>
            <span className="inline-flex items-center gap-2"><Headphones size={16} className="text-orange-500" /> Human support</span>
          </div>

          {showStats && (
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-900">{stats!.completed_orders.toLocaleString('en-US')}</div>
                <div className="text-sm text-slate-600 mt-1">Orders delivered</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-900">{stats!.delivered_units.toLocaleString('en-US')}</div>
                <div className="text-sm text-slate-600 mt-1">Upvotes &amp; comments placed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-900">{stats!.total_clients.toLocaleString('en-US')}</div>
                <div className="text-sm text-slate-600 mt-1">Businesses served</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* What Straight Is */}
      <section id="what" className="py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">What Straight is</p>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">A human task network for brand visibility</h2>

          <p className="mt-8 text-lg text-slate-600 leading-relaxed">
            Some online growth tasks need a real person.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-slate-400 font-semibold">
            <span className="line-through">Not a bot.</span>
            <span className="line-through">Not a script.</span>
            <span className="line-through">Not another tool.</span>
          </div>

          <p className="mt-8 text-lg text-slate-600 leading-relaxed">
            Straight helps brands complete manual online tasks at scale through a network of real
            people. That makes it easier to build visibility across search, forums, communities,
            social platforms, and other places where attention and trust are formed.
          </p>

          <p className="mt-6 text-lg text-slate-600 leading-relaxed">
            Our focus is not generic microwork. Our focus is{' '}
            <span className="font-bold text-slate-900">brand visibility and GEO</span> — the kinds of
            tasks that improve how often your brand shows up, gets mentioned, gets noticed, and gets
            discovered online.
          </p>
        </div>
      </section>

      {/* Use cases */}
      <section id="use-cases" className="py-24 bg-slate-50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Use cases</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">What real people can help you do</h2>
            <p className="mt-4 text-lg text-slate-600">
              Straight can support a wide range of small online tasks, including:
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {[
              'Reddit upvotes',
              'Reddit comments',
              'Quora comments and answers',
              'Forum comments and engagement',
              'Brand mentions',
              'Posting tasks',
              'Discussion support',
              'Content seeding',
              'Website research',
              'Target page discovery',
              'Account-based interactions',
              'Manual platform tasks',
              'Custom visibility workflows',
            ].map((item) => (
              <span
                key={item}
                className="px-4 py-2 rounded-full bg-white ring-1 ring-slate-200 text-sm font-medium text-slate-700"
              >
                {item}
              </span>
            ))}
          </div>

          <p className="mt-10 text-center text-lg text-slate-700 font-medium">
            If the task is online, small, and better done by a real person — we can likely help.
          </p>
        </div>
      </section>

      {/* Positioning */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Built for brands</p>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
            Built for brands, not generic task buyers
          </h2>

          <p className="mt-8 text-lg text-slate-600 leading-relaxed">
            Microwork platforms give you access to people. Straight gives you access to people{' '}
            <span className="font-bold text-slate-900">with a clear brand-growth use case</span>.
          </p>
          <p className="mt-6 text-lg text-slate-600 leading-relaxed">
            We are built for teams that want help with visibility, reach, mentions, engagement, and
            GEO-related execution.
          </p>
          <p className="mt-6 text-lg text-slate-600 leading-relaxed">
            So instead of hiring freelancers, managing dozens of tiny tasks manually, or trying to
            automate work that should look human — you can run everything from one dashboard.
          </p>
        </div>
      </section>

      {/* Core services */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Core services</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Start with the most common visibility tasks
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Comments & Mentions */}
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center">
                  <MessagesSquare size={22} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-bold">Comments &amp; Mentions</h3>
              </div>
              <p className="mt-4 text-slate-600 leading-relaxed">
                Place helpful comments and brand mentions across Reddit, Quora, HubSpot, and niche forums.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Good for awareness, credibility, and discovery.
              </p>
              <button
                onClick={handleCTA}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all"
              >
                Get mentioned
                <ArrowRight size={17} />
              </button>
            </div>

            {/* Upvotes & Engagement */}
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center">
                  <TrendingUp size={22} className="text-orange-600" />
                </div>
                <h3 className="text-lg font-bold">Upvotes &amp; Engagement</h3>
              </div>
              <p className="mt-4 text-slate-600 leading-relaxed">
                Give important posts more traction with real engagement delivered at a natural pace.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Good for momentum, visibility, and social proof.
              </p>
              <button
                onClick={handleCTA}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all"
              >
                Boost a post
                <ArrowRight size={17} />
              </button>
            </div>

            {/* Posting & Seeding */}
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <Send size={22} className="text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold">Posting &amp; Seeding</h3>
              </div>
              <p className="mt-4 text-slate-600 leading-relaxed">
                Distribute content, links, or talking points across relevant platforms through manual
                placement and human action.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Good for reach and broader brand presence.
              </p>
              <button
                onClick={handleCTA}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all"
              >
                Start a task
                <ArrowRight size={17} />
              </button>
            </div>

            {/* Custom Human Tasks */}
            <div className="p-8 rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Wrench size={22} className="text-purple-600" />
                </div>
                <h3 className="text-lg font-bold">Custom Human Tasks</h3>
              </div>
              <p className="mt-4 text-slate-600 leading-relaxed">
                Request other manual online jobs that support your growth goals.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Good for platform-specific tasks, research, repetitive actions, and one-off execution needs.
              </p>
              <button
                onClick={handleCustomTaskCTA}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all"
              >
                Request a custom job
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* GEO angle */}
      <section id="geo" className="py-24 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/30 text-xs font-bold uppercase tracking-wider text-orange-300 mb-5">
              <Globe size={12} />
              GEO
            </div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
              Built for the new visibility layer: <span className="text-orange-400">GEO</span>
            </h2>
          </div>

          <p className="text-slate-300 leading-relaxed text-center max-w-2xl mx-auto">
            Brand growth is no longer just about ranking pages. Now it is also about showing up in
            the sources people and AI systems actually use: forums, discussion threads, Q&amp;A
            pages, niche communities, and trusted websites.
          </p>
          <p className="mt-4 text-slate-300 leading-relaxed text-center max-w-2xl mx-auto">
            Straight helps you take action in those places through real people doing real tasks.
            That makes us a practical execution layer for{' '}
            <span className="text-white font-semibold">Generative Engine Optimization</span>:
          </p>

          <ul className="mt-8 space-y-3 max-w-xl mx-auto">
            {[
              'Increase brand mentions',
              'Appear in trusted discussions',
              'Support visibility in ranking communities',
              'Place your brand where AI and search systems are more likely to look',
              'Turn strategy into manual execution',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-slate-200 text-sm">
                <Check size={16} className="text-orange-400 shrink-0 mt-0.5" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* New: Google Preferred Source */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="rounded-2xl bg-white ring-1 ring-orange-200 p-8 md:p-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 border border-orange-200 text-xs font-bold uppercase tracking-wider text-orange-700">
                <Star size={12} className="fill-orange-500 text-orange-500" />
                New
              </span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Google Preferred Source website selection
            </h2>
            <p className="mt-4 text-slate-600 leading-relaxed">
              We now also help brands choose which websites, forums, and pages are most worth
              targeting as <span className="font-semibold text-slate-900">Google Preferred Source</span>{' '}
              opportunities. This helps you identify where your brand should appear first for
              stronger visibility and better GEO outcomes.
            </p>
            <p className="mt-4 text-slate-600 leading-relaxed">
              Instead of guessing where to invest effort, you get a clearer list of:
            </p>
            <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                'Websites worth targeting',
                'Forums worth joining',
                'Pages already ranking in your niche',
                'Sources most likely to matter for trust, search, and AI visibility',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-slate-700 text-sm">
                  <Compass size={16} className="text-orange-500 shrink-0 mt-0.5" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-slate-500">
              This works especially well when combined with comments, mentions, posting, and engagement tasks.
            </p>
            <button
              onClick={handleCTA}
              className="mt-8 inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-lg shadow-orange-500/20 transition-all"
            >
              Order Preferred Source selections
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {/* Why Straight */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Why Straight</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Why brands use Straight</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Users,
                title: 'Real people, not bots',
                desc: 'Tasks are completed by real humans. That matters when the work needs to look natural and credible.',
              },
              {
                icon: Wrench,
                title: 'More flexible than fixed services',
                desc: 'You are not limited to one narrow offer. Straight can support many kinds of online micro tasks.',
              },
              {
                icon: TrendingUp,
                title: 'Built for visibility work',
                desc: 'Unlike generic microwork platforms, Straight is designed around brand growth, visibility, and GEO.',
              },
              {
                icon: BarChart3,
                title: 'Easy to run',
                desc: 'Place tasks from one dashboard, track progress live, and review proof when work is done.',
              },
              {
                icon: Lock,
                title: 'Low-friction to start',
                desc: 'No subscription. No contract. Top up only when you need it.',
              },
              {
                icon: Headphones,
                title: 'Human support',
                desc: 'A real person replies if you need help.',
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

      {/* How it works */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Three simple steps</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: 'Top up your credits',
                desc: 'Add credits with PayPal from USD 25.',
                icon: Lock,
              },
              {
                step: '2',
                title: 'Submit a task',
                desc: 'Choose a common service or request a custom online task.',
                icon: Send,
              },
              {
                step: '3',
                title: 'Track delivery live',
                desc: 'Follow progress and review proof in your dashboard.',
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

      {/* Risk reversal */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <p className="text-sm font-semibold text-orange-500 uppercase tracking-widest mb-3">Easy to try</p>
          <h2 className="text-4xl font-bold tracking-tight mb-8">No passwords. No subscription. No freelancers to manage.</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[
              'You do not need to share passwords.',
              'You do not need a subscription.',
              'You do not need to manage freelancers yourself.',
            ].map((line) => (
              <div key={line} className="p-5 rounded-xl bg-white ring-1 ring-slate-200 text-slate-700 text-sm font-medium">
                {line}
              </div>
            ))}
          </div>

          <p className="text-lg text-slate-600 leading-relaxed">
            Just submit the task, track the work, and review the proof.
          </p>
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
                q: 'What is Straight?',
                a: 'Straight is a human task network for brands. We help businesses complete small online tasks using real people, with a focus on visibility, discovery, and GEO.',
              },
              {
                q: 'Is Straight only for Reddit and forums?',
                a: 'No. Reddit, Quora, and forums are common use cases, but Straight is built for many kinds of manual online tasks.',
              },
              {
                q: 'What kind of tasks can I submit?',
                a: 'Anything small, online, and suitable for real human execution. That includes comments, mentions, posting, engagement, research, targeting, and other custom visibility tasks.',
              },
              {
                q: 'How is Straight different from microwork platforms?',
                a: 'Straight is built specifically for brand visibility and growth use cases, not generic task outsourcing.',
              },
              {
                q: 'What is the GEO use case?',
                a: 'Straight helps brands take manual action in the places that influence search and AI visibility, such as communities, forums, discussions, and trusted websites.',
              },
              {
                q: 'What is the Google Preferred Source service?',
                a: 'It helps you choose which sites, forums, and pages are most worth targeting first for stronger search and AI visibility.',
              },
              {
                q: 'Do I need a subscription?',
                a: 'No. Straight is pay-as-you-go.',
              },
              {
                q: 'How do I know the work is done?',
                a: 'You can track progress live and review proof in your dashboard.',
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
            Real people to execute the online tasks your brand actually needs
          </h2>
          <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto">
            Use Straight for comments, mentions, engagement, research, posting, targeting, and other
            human-powered tasks that support visibility and GEO.
          </p>
          <p className="mt-4 text-slate-400 max-w-2xl mx-auto">
            Create your free account, top up with PayPal, and place your first order in minutes.
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
              Credits never expire
            </div>
            <div className="flex items-center gap-2">
              <BarChart3 size={16} />
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
            <Link to={spath('/terms')} className="hover:text-slate-900">Terms</Link>
            <Link to={spath('/privacy')} className="hover:text-slate-900">Privacy</Link>
            <Link to={spath('/refunds')} className="hover:text-slate-900">Refunds</Link>
            <Link to={spath('/contact')} className="hover:text-slate-900">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
