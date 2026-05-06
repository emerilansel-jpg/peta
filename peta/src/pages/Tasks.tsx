import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Lock, Flame, Bell, Wallet, Users, Star, MessageCircle,
  Sparkles, TrendingUp, Trophy, Clock, UserPlus, Banknote, Gift,
  Target, Unlock, ArrowRight,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { supabase } from '../lib/supabase';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import {
  getCommunityStats, getCommunityFeed, type CommunityEvent,
  getMaxRedditKarma, hasClaimedKarmaMilestone,
} from '../lib/api';

// Realistic-feeling preview tasks — visible but locked, to create FOMO
const PREVIEW_TASKS = [
  { type: 'comment', title: 'Comment di thread crypto trending',  reward: 18000, slots: 5,  hot: true },
  { type: 'upvote',  title: 'Upvote 5 post pilihan',               reward: 1500,  slots: 20 },
  { type: 'comment', title: 'Comment di thread populer minggu ini', reward: 15000, slots: 8 },
  { type: 'upvote',  title: 'Upvote thread niche',                 reward: 1000,  slots: 15 },
  { type: 'comment', title: 'Comment di r/IndonesiaSemua',         reward: 12000, slots: 10 },
  { type: 'comment', title: 'Comment thread tech (level 4+)',      reward: 20000, slots: 3,  premium: true },
  { type: 'upvote',  title: 'Upvote 10 thread niche',              reward: 2000,  slots: 12 },
  { type: 'comment', title: 'Comment review produk',               reward: 10000, slots: 7 },
] as const;

const STREAK_KEY = 'peta_streak';
const today = () => new Date().toISOString().slice(0, 10);
const ymdMinusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// 4-tier streak rewards — concrete, escalating goals
const STREAK_MILESTONES = [
  { days: 3,  bonus: 5000,  label: 'Streak Pemula',  emoji: '🌱' },
  { days: 7,  bonus: 10000, label: 'Streak Konsisten', emoji: '🔥' },
  { days: 14, bonus: 25000, label: 'Streak Pejuang',  emoji: '⚔️' },
  { days: 30, bonus: 75000, label: 'Streak Legend',   emoji: '👑' },
];

function useDailyStreak(uid?: string) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!uid) return;
    const key = `${STREAK_KEY}:${uid}`;
    const raw = localStorage.getItem(key);
    let { count: c = 0, last = '' } = raw ? JSON.parse(raw) : {};
    const t = today();
    if (last === t) {
      // already counted today
    } else if (last === ymdMinusDays(1)) {
      c = c + 1; last = t;
      localStorage.setItem(key, JSON.stringify({ count: c, last }));
    } else {
      c = 1; last = t;
      localStorage.setItem(key, JSON.stringify({ count: c, last }));
    }
    setCount(c);
  }, [uid]);
  return count;
}

// Rotate through whatever real items are passed in
function useTickerIndex(length: number) {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % length), 3500);
    return () => clearInterval(id);
  }, [length]);
  return Math.min(idx, Math.max(0, length - 1));
}

export function Tasks() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [waJoined, setWaJoined] = React.useState<boolean>(() =>
    localStorage.getItem('peta_wa_joined') === '1'
  );

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  const streak = useDailyStreak(user?.id);

  const { data: stats } = useQuery({
    queryKey: ['communityStats'],
    queryFn: getCommunityStats,
    refetchInterval: 60_000, // refresh once a minute
  });

  const { data: feed = [] } = useQuery({
    queryKey: ['communityFeed'],
    queryFn: () => getCommunityFeed(12),
    refetchInterval: 60_000,
  });

  // Karma mission state — drives the "Misi Wajib #1" banner
  const { data: karmaInfo } = useQuery({
    queryKey: ['maxKarma', user?.id],
    queryFn: () => getMaxRedditKarma(user!.id),
    enabled: !!user?.id,
  });
  const { data: karmaClaimed } = useQuery({
    queryKey: ['karmaClaimed', user?.id],
    queryFn: () => hasClaimedKarmaMilestone(user!.id),
    enabled: !!user?.id,
  });
  const currentKarma = karmaInfo?.karma ?? 0;
  const KARMA_GOAL = 10;
  const karmaProgress = Math.min((currentKarma / KARMA_GOAL) * 100, 100);
  const karmaRemaining = Math.max(KARMA_GOAL - currentKarma, 0);
  const karmaGoalReached = currentKarma >= KARMA_GOAL;

  const tickerIdx = useTickerIndex(feed.length);
  const ticker: CommunityEvent | undefined = feed[tickerIdx];

  const nextMilestone = STREAK_MILESTONES.find((m) => m.days > streak) || STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
  const milestoneProgress = Math.min((streak / nextMilestone.days) * 100, 100);
  const daysToGo = Math.max(nextMilestone.days - streak, 0);

  const handleJoinWa = () => {
    localStorage.setItem('peta_wa_joined', '1');
    setWaJoined(true);
    window.open(WHATSAPP_GROUP_URL, '_blank');
  };

  if (!user) {
    return (
      <Layout userRole="army">
        <div className="space-y-3"><div className="h-32 bg-light rounded-2xl shimmer" /></div>
      </Layout>
    );
  }

  return (
    <Layout userRole="army">
      <div className="max-w-2xl mx-auto">
        {/* HERO — real community stats, no fake numbers */}
        <Card className="mb-3 bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary text-white border-0 ring-0 overflow-hidden relative">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">
            <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-1">
              Task buka random sepanjang hari
            </h1>
            <p className="text-sm opacity-95 mb-4">
              Slot terbatas — yang notif WA-nya aktif tahu duluan. Bookmark page ini.
            </p>

            {/* Real community stats */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold opacity-90">
                  <Users size={11} /> Komunitas
                </div>
                <p className="text-xl font-extrabold money">
                  {stats?.totalMembers ?? '–'} <span className="text-xs font-normal opacity-90">member</span>
                </p>
              </div>
              <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold opacity-90">
                  <Banknote size={11} /> Dibayar
                </div>
                <p className="text-xl font-extrabold money">
                  Rp{stats ? (stats.totalPaid / 1000).toFixed(0) : '–'}K
                </p>
              </div>
            </div>

            {/* Real activity ticker — only render if we have actual events */}
            {ticker ? (
              <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2.5 flex items-center gap-3 animate-fade-in" key={ticker.at}>
                <div className="shrink-0">
                  {ticker.kind === 'signup'   && <UserPlus size={16} className="text-green-300" />}
                  {ticker.kind === 'payout'   && <Banknote size={16} className="text-yellow-300" />}
                  {ticker.kind === 'referral' && <Gift size={16} className="text-pink-200" />}
                </div>
                <div className="flex-1 min-w-0 text-sm">
                  <p className="leading-tight">
                    <span className="font-bold">{ticker.who}</span>
                    {ticker.kind === 'signup'   && <span className="opacity-90"> baru gabung 👋</span>}
                    {ticker.kind === 'payout'   && (
                      <span className="opacity-90"> cair <b className="font-extrabold">Rp{ticker.amount?.toLocaleString('id-ID')}</b> 💸</span>
                    )}
                    {ticker.kind === 'referral' && (
                      <span className="opacity-90"> dapat bonus referral <b className="font-extrabold">Rp{ticker.amount?.toLocaleString('id-ID')}</b> 🎁</span>
                    )}
                  </p>
                  <p className="text-[11px] opacity-75">{ticker.rel}</p>
                </div>
              </div>
            ) : (
              <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2.5 text-sm">
                <p className="font-semibold">Komunitas baru dimulai 🚀</p>
                <p className="text-xs opacity-90">Kamu termasuk member awal — task pertama akan dialokasikan ke yang aktif.</p>
              </div>
            )}
          </div>
        </Card>

        {/* MISI WAJIB #1 — Karma builder. Top priority above streak so users
            see it immediately after onboarding. State adapts to progress. */}
        {!karmaClaimed ? (
          <Card
            onClick={() => navigate('/karma-mission')}
            className={`mb-3 cursor-pointer hover:ring-primary/40 transition-all ${
              karmaGoalReached
                ? 'bg-gradient-to-br from-success/10 to-secondary/10 ring-success/30'
                : 'bg-gradient-to-br from-primary/5 to-secondary/5 ring-primary/30'
            }`}
            padding="md"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                karmaGoalReached ? 'bg-success/20 text-success' : 'bg-primary/15 text-primary'
              }`}>
                <Target size={11} /> Misi Wajib #1
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wide text-muted">
                {karmaGoalReached ? '✅ Siap klaim' : 'Buka misi cuan'}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-base sm:text-lg leading-tight">
                  {karmaGoalReached
                    ? 'Karma kamu udah cukup — klaim Rp5K!'
                    : 'Bangun karma Reddit dulu — dapat Rp5K + unlock cuan'}
                </p>
                <p className="text-xs text-muted mt-1">
                  {karmaGoalReached
                    ? 'Klik buat klaim bonus + lihat tips lanjutan biar level naik.'
                    : `Tinggal ${karmaRemaining} karma lagi. Tap buat panduan + cek karma.`}
                </p>
              </div>
              <div className={`shrink-0 w-12 h-12 rounded-xl grid place-items-center ${
                karmaGoalReached ? 'bg-success text-white' : 'bg-primary text-white'
              }`}>
                {karmaGoalReached ? <Unlock size={20} /> : <Target size={20} />}
              </div>
            </div>
            {/* Progress bar */}
            <div className="flex items-center gap-2 text-xs mb-1">
              <span className="font-bold text-dark">{currentKarma}</span>
              <div className="flex-1 h-2 bg-white rounded-full overflow-hidden ring-1 ring-black/5">
                <div
                  className={`h-full rounded-full transition-all ${
                    karmaGoalReached
                      ? 'bg-gradient-to-r from-success to-secondary'
                      : 'bg-gradient-to-r from-primary to-secondary'
                  }`}
                  style={{ width: `${karmaProgress}%` }}
                />
              </div>
              <span className="font-bold text-muted">{KARMA_GOAL} karma</span>
            </div>
            <div className="flex items-center justify-end gap-1 mt-2 text-xs text-primary font-bold">
              Buka panduan <ArrowRight size={12} />
            </div>
          </Card>
        ) : (
          <Card padding="sm" className="mb-3 bg-success/5 ring-success/30 flex items-center gap-3">
            <div className="w-9 h-9 bg-success/20 text-success rounded-lg grid place-items-center shrink-0">
              <Trophy size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">Misi karma kelar ✅ — Rp5K masuk saldo</p>
              <p className="text-xs text-muted">Karma kamu sekarang {currentKarma}. Lanjut naikin biar reward task makin gede.</p>
            </div>
            <button
              onClick={() => navigate('/karma-mission')}
              className="text-xs text-success font-bold hover:underline shrink-0"
            >
              Tips →
            </button>
          </Card>
        )}

        {/* STREAK + MILESTONE — concrete reward, no clock */}
        <Card className="mb-3 bg-gradient-to-br from-yellow-50 to-orange-50 ring-yellow-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-yellow-300 text-yellow-900 rounded-xl grid place-items-center shrink-0 shadow-md shadow-yellow-300/30">
              <Flame size={26} className={streak >= 3 ? 'animate-pulse' : ''} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase font-bold tracking-wide text-yellow-900/80">Streak harian</p>
              <p className="text-2xl font-extrabold leading-tight">
                {streak} hari{streak >= 3 ? ' 🔥' : ''}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Berikut</p>
              <p className="text-sm font-extrabold">{nextMilestone.emoji} +Rp{(nextMilestone.bonus / 1000).toFixed(0)}K</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted font-semibold">{nextMilestone.label}</span>
            <span className="font-bold">
              {streak} / {nextMilestone.days} hari
            </span>
          </div>
          <div className="w-full h-2.5 bg-white/70 rounded-full overflow-hidden ring-1 ring-yellow-200">
            <div
              className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full transition-all"
              style={{ width: `${milestoneProgress}%` }}
            />
          </div>
          {daysToGo > 0 ? (
            <p className="text-xs text-muted mt-2">
              ⚡ {daysToGo} hari lagi — datang besok jangan sampai putus, kalau lewat 1 hari streak reset ke 0.
            </p>
          ) : (
            <p className="text-xs text-success font-bold mt-2">
              🎉 Bonus Rp{nextMilestone.bonus.toLocaleString('id-ID')} unlocked! Hubungi admin di grup WA.
            </p>
          )}
        </Card>

        {/* WA GROUP CTA */}
        {!waJoined ? (
          <Card className="mb-3 bg-success/10 ring-success/40">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 bg-success text-white rounded-xl grid place-items-center shrink-0">
                <MessageCircle size={22} />
              </div>
              <div className="flex-1">
                <p className="font-extrabold">Notif task baru via WhatsApp</p>
                <p className="text-sm text-muted mt-0.5">
                  Kami kabarin pas task baru muncul. Yang ga di grup = ketinggalan slot terbatas.
                </p>
              </div>
            </div>
            <Button onClick={handleJoinWa} variant="success" fullWidth size="lg">
              <MessageCircle size={18} /> Aktifkan Notif (Gabung Grup)
            </Button>
          </Card>
        ) : (
          <Card className="mb-3 bg-success/5 ring-success/30 flex items-center gap-3" padding="sm">
            <div className="w-9 h-9 bg-success/20 text-success rounded-lg grid place-items-center shrink-0">
              <Bell size={18} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm">Notif aktif ✅</p>
              <p className="text-xs text-muted">Update task akan masuk ke grup WhatsApp.</p>
            </div>
            <button
              onClick={() => window.open(WHATSAPP_GROUP_URL, '_blank')}
              className="text-xs text-success font-bold hover:underline shrink-0"
            >
              Buka grup
            </button>
          </Card>
        )}

        {/* Section divider */}
        <div className="flex items-baseline justify-between mb-2 mt-5 px-1">
          <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2">
            <Lock size={16} className="text-muted" /> Preview task umum
          </h2>
          <span className="text-xs text-muted">Berputar setiap hari</span>
        </div>
        <p className="text-xs text-muted mb-3 px-1">
          Inilah jenis task & bayaran yang biasanya muncul. Yang real akan diumumkan di grup 👇
        </p>

        {/* Locked preview cards — bait, not lie */}
        <div className="space-y-2 mb-5">
          {PREVIEW_TASKS.map((task, idx) => (
            <Card key={idx} padding="sm" className="relative overflow-hidden select-none">
              <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] z-10 flex items-center justify-center pointer-events-none">
                <div className="bg-white/95 ring-1 ring-black/10 rounded-full px-3 py-1 flex items-center gap-1.5 shadow-sm">
                  <Lock size={12} className="text-muted" />
                  <span className="text-[11px] font-bold text-dark">
                    {(task as any).hot ? 'Slot habis cepat' : 'Akan dialokasikan'}
                  </span>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                      {task.type === 'upvote' ? '👍 Upvote' : '💬 Komentar'}
                    </span>
                    {(task as any).premium && (
                      <span className="text-[9px] font-extrabold uppercase tracking-wide bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded">
                        Premium
                      </span>
                    )}
                    {(task as any).hot && (
                      <span className="text-[9px] font-extrabold uppercase tracking-wide bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                        🔥 Hot
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-sm sm:text-base leading-snug truncate blur-[3px]">
                    {task.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {task.type === 'upvote' ? '<1 min' : '3-5 min'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star size={11} className="fill-yellow-400 text-yellow-400" /> 4,8
                    </span>
                    <span>{task.slots} slot</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg sm:text-2xl font-extrabold text-primary money leading-none">
                    Rp{task.reward.toLocaleString('id-ID')}
                  </p>
                  <p className="text-[10px] text-muted">/task</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Why-stay-active explainer (replaces clock pressure with logic) */}
        <Card className="mb-3" padding="sm">
          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2 flex items-center gap-1.5">
            <Sparkles size={12} className="text-primary" /> Cara dapat task duluan
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Trophy size={16} className="text-primary shrink-0 mt-0.5" />
              <span><b>Streak harian.</b> Member dengan streak 7+ otomatis dapat prioritas slot.</span>
            </li>
            <li className="flex items-start gap-2">
              <Bell size={16} className="text-success shrink-0 mt-0.5" />
              <span><b>Notif WA aktif.</b> Tau task baru dalam hitungan detik, bukan jam.</span>
            </li>
            <li className="flex items-start gap-2">
              <TrendingUp size={16} className="text-warning shrink-0 mt-0.5" />
              <span><b>Karma Reddit naik.</b> Level naik → reward per task naik (Rp5K → Rp20K).</span>
            </li>
          </ul>
        </Card>

        {/* Productive nudges */}
        <div className="space-y-2">
          <Card padding="sm" onClick={() => navigate('/earnings')} className="flex items-center gap-3 hover:ring-primary/30">
            <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl grid place-items-center shrink-0">
              <Wallet size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">Saldo bonusmu udah aman</p>
              <p className="text-xs text-muted">Cek total — siap cair kalau ≥ Rp150K.</p>
            </div>
            <span className="text-primary font-bold text-sm">→</span>
          </Card>

          <Card padding="sm" onClick={() => navigate('/account')} className="flex items-center gap-3 hover:ring-primary/30">
            <div className="w-10 h-10 bg-yellow-200 text-yellow-900 rounded-xl grid place-items-center shrink-0">
              <Users size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">+Rp20K tiap teman yang ikut</p>
              <p className="text-xs text-muted">Bagikan link sambil nunggu — earning ga harus dari task aja.</p>
            </div>
            <span className="text-primary font-bold text-sm">→</span>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
