import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lock, Flame, Bell, Users, MessageCircle,
  Sparkles, TrendingUp, Trophy, Clock, Gift,
  Target, ArrowRight, Copy, Share2, ChevronDown, ChevronUp, X,
  HelpCircle, Lightbulb, Award, Zap,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { supabase } from '../lib/supabase';
import { WHATSAPP_GROUP_URL, FOUNDING_LIMIT } from '../lib/config';
import {
  getCommunityFeed, type CommunityEvent,
  getMaxRedditKarma, getReferralStats, getWaDismissed, dismissWaGroup,
  getFoundingMembers,
} from '../lib/api';
import { LEVELS, getLevelInfo } from '../lib/levels';
import { toast } from '../components/Toast';

// Preview of task TYPES (rate ranges are real, per src/lib/levels.ts).
// No fake metadata like star ratings or "X slots remaining" — those
// pretend social proof we cannot verify.
const PREVIEW_TASKS = [
  { type: 'comment', title: 'Komen di thread populer',           reward: 18000, premium: false },
  { type: 'upvote',  title: 'Upvote post pilihan',               reward: 1500,  premium: false },
  { type: 'comment', title: 'Komen di thread niche',             reward: 15000, premium: false },
  { type: 'upvote',  title: 'Upvote thread niche',               reward: 1000,  premium: false },
  { type: 'comment', title: 'Komen di komunitas global',         reward: 12000, premium: false },
  { type: 'comment', title: 'Komen thread tech (level 4+)',      reward: 20000, premium: true  },
] as const;

const STREAK_KEY = 'peta_streak';
const today = () => new Date().toISOString().slice(0, 10);
const ymdMinusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

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

function useTickerIndex(length: number) {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % length), 3500);
    return () => clearInterval(id);
  }, [length]);
  return Math.min(idx, Math.max(0, length - 1));
}

const SITE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://penghasilantambahan.com';
const buildReferralLink = (code?: string) =>
  code ? `${SITE_URL}/register?ref=${code}` : SITE_URL;

// Pre-filled WhatsApp share — pure ASCII + Latin-1 punctuation only.
//
// We tried emojis (👀 💸 ✅ ⚡ 👉 ⚠️) and verified end-to-end that the
// bytes were correct in the bundle, encodeURIComponent produced valid
// percent-encoded UTF-8, and Chrome canvas rendered the glyphs. Yet
// when the share-link was opened the recipient consistently saw the
// U+FFFD replacement character — even for 3-byte BMP icons like ✅
// and ⚡, which have universal font support.
//
// Conclusion: at least one common WhatsApp Web build along the share
// path strips supplementary-plane emoji from URL-prefilled text. We
// cannot detect or work around it client-side, and a referral message
// that prints `?` to ANY recipient is worse than one without icons.
// Em-dash / en-dash render fine in their environment (Latin-1 General
// Punctuation block), so we keep typography but lose icons.
const buildWhatsAppShare = (link: string) => {
  const msg =
    `Kamu tau nggak ada platform yang bayar kamu cuma buat komentar?\n\n` +
    `Aku baru dapat Rp50K dari komentar internet. Literally cuma komentar doang.\n\n` +
    `Platform-nya PeTa — bayar Rp5K–Rp20K per komen, cair ke e-wallet dalam 24 jam.\n\n` +
    `Sekarang lagi buka Founding 100. Artinya cuma 100 orang bisa masuk — dan udah hampir penuh.\n\n` +
    `Kalau kamu mau coba, pakai link aku biar dapet bonus Rp25K ekstra langsung:\n` +
    `${link}\n\n` +
    `PERHATIAN: kalau slot habis, tutup permanen. Aku nggak bisa janjiin kamu masih bisa masuk.`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
};

export function Tasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<any>(null);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  const streak = useDailyStreak(user?.id);

  const { data: feed = [] } = useQuery({
    queryKey: ['communityFeed'],
    queryFn: () => getCommunityFeed(8),
    refetchInterval: 60_000,
  });

  const { data: referralStats } = useQuery({
    queryKey: ['referralStats', user?.id],
    queryFn: () => getReferralStats(user!.id),
    enabled: !!user?.id,
  });

  const { data: founding } = useQuery({
    queryKey: ['foundingMembers'],
    queryFn: getFoundingMembers,
    refetchInterval: 60_000,
  });

  const { data: karmaInfo } = useQuery({
    queryKey: ['maxKarma', user?.id],
    queryFn: () => getMaxRedditKarma(user!.id),
    enabled: !!user?.id,
  });

  const { data: waDismissed = false } = useQuery({
    queryKey: ['waDismissed', user?.id],
    queryFn: () => getWaDismissed(user!.id),
    enabled: !!user?.id,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissWaGroup,
    onSuccess: () => {
      toast.success('Oke — link grup ga muncul lagi');
      queryClient.invalidateQueries({ queryKey: ['waDismissed', user?.id] });
    },
    onError: () => toast.error('Gagal hide. Coba lagi.'),
  });

  const tickerIdx = useTickerIndex(feed.length);
  const ticker: CommunityEvent | undefined = feed[tickerIdx];

  const nextMilestone = STREAK_MILESTONES.find((m) => m.days > streak) || STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
  const milestoneProgress = Math.min((streak / nextMilestone.days) * 100, 100);
  const daysToGo = Math.max(nextMilestone.days - streak, 0);

  if (!user) {
    return (
      <Layout userRole="army">
        <div className="space-y-3"><div className="h-32 bg-light rounded-2xl shimmer" /></div>
      </Layout>
    );
  }

  return (
    <Layout userRole="army">
      <div className="max-w-2xl mx-auto pb-8">
        {/* ============================================================
            PRIORITY #1 — REFERRAL HERO
            Highest CRO leverage: every share compounds. Big, friendly,
            with social-proof counters (already-earned + already-invited)
            so the user feels rewarded for past effort and motivated to
            do more.
        ============================================================= */}
        <ReferralHero
          code={referralStats?.code}
          invitedCount={referralStats?.invitedCount ?? 0}
          totalBonus={referralStats?.totalBonus ?? 0}
          slotsLeft={founding?.slotsLeft ?? FOUNDING_LIMIT}
          totalFounding={founding?.count ?? 0}
          isFull={founding?.isFull ?? false}
          ticker={ticker}
        />

        {/* ============================================================
            PRIORITY #2 — KARMA 101
            Newbies don't know what Reddit/karma is. Educate first
            (Apa → Why → Gimana), then show progress to next level.
            Collapsible so power users skip it.
        ============================================================= */}
        <KarmaSection
          karma={karmaInfo?.karma ?? 0}
          level={karmaInfo?.level ?? 0}
          accountAgeDays={karmaInfo?.accountAgeDays ?? 0}
          onCta={() => navigate('/karma-mission')}
        />

        {/* ============================================================
            PRIORITY #3 — STREAK + WHATSAPP
            Habit nudge + notification opt-in. WhatsApp dismissable
            so users who already joined aren't nagged forever.
        ============================================================= */}
        <StreakSection
          streak={streak}
          nextMilestone={nextMilestone}
          milestoneProgress={milestoneProgress}
          daysToGo={daysToGo}
        />

        {!waDismissed && (
          <WhatsAppSection
            onDismiss={() => dismissMutation.mutate()}
            dismissing={dismissMutation.isPending}
          />
        )}

        {/* ============================================================
            BELOW THE FOLD — task previews + helper cards
            FOMO mechanism stays. No fake numbers; locked overlay is
            honest ("Akan dialokasikan").
        ============================================================= */}
        <div className="flex items-baseline justify-between mb-2 mt-6 px-1">
          <h2 className="text-lg sm:text-xl font-extrabold flex items-center gap-2">
            <Lock size={16} className="text-muted" /> Preview task umum
          </h2>
          <span className="text-xs text-muted">Berputar tiap hari</span>
        </div>
        <p className="text-xs text-muted mb-3 px-1">
          Inilah jenis task & bayaran yang biasanya muncul. Yang real diumumkan di grup 👇
        </p>

        <div className="space-y-2 mb-5">
          {PREVIEW_TASKS.map((task, idx) => (
            <Card key={idx} padding="sm" className="relative overflow-hidden select-none">
              <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] z-10 flex items-center justify-center pointer-events-none">
                <div className="bg-white/95 ring-1 ring-black/10 rounded-full px-3 py-1 flex items-center gap-1.5 shadow-sm">
                  <Lock size={12} className="text-muted" />
                  <span className="text-[11px] font-bold text-dark">Diumumkan di grup WA</span>
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
                        Level 4+
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

        <Card className="mb-3" padding="sm">
          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2 flex items-center gap-1.5">
            <Sparkles size={12} className="text-primary" /> Cara dapat task duluan
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Trophy size={16} className="text-primary shrink-0 mt-0.5" />
              <span><b>Streak harian.</b> PeTa Army dengan streak 7+ otomatis dapat prioritas slot.</span>
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
      </div>
    </Layout>
  );
}

// ============================================================
// REFERRAL HERO — priority #1
// ============================================================
function ReferralHero({
  code, invitedCount, totalBonus, slotsLeft, totalFounding, isFull, ticker,
}: {
  code?: string;
  invitedCount: number;
  totalBonus: number;
  slotsLeft: number;
  totalFounding: number;
  isFull: boolean;
  ticker?: CommunityEvent;
}) {
  const link = buildReferralLink(code);
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Link tersalin — paste di chat / story');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Browser ga support copy. Tahan & copy manual.');
    }
  };

  const onShareWa = () => {
    window.open(buildWhatsAppShare(link), '_blank');
  };

  const slotsPct = Math.min((totalFounding / FOUNDING_LIMIT) * 100, 100);

  return (
    <Card className="mb-3 bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary text-white border-0 ring-0 overflow-hidden relative">
      <div className="absolute -top-10 -right-10 w-44 h-44 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/20 backdrop-blur px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
            <Zap size={11} /> Cuan tercepat
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-300/95 text-[#1A1D1F] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
            <Lock size={10} /> {isFull
              ? 'Founding penuh'
              : <>Sisa <span className="tabular-nums">{slotsLeft}</span> slot founding</>}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-1">
          Ajak teman = +Rp20K masuk saldo
        </h1>
        <p className="text-sm opacity-95 mb-3">
          Tiap teman daftar pakai kode kamu, <b>kamu dapat Rp20K, dia dapat Rp25K</b>.
          Berlaku selama slot founding 100 belum penuh.
        </p>

        {/* Mini scarcity bar — replaces fake "live activity" claims */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] mb-1 opacity-95">
            <span className="font-semibold">Founding terisi</span>
            <span className="font-extrabold tabular-nums">{totalFounding} / {FOUNDING_LIMIT}</span>
          </div>
          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-300 rounded-full transition-all" style={{ width: `${slotsPct}%` }} />
          </div>
        </div>

        {/* Counters: social proof of own progress */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold opacity-90">
              <Users size={11} /> Udah ajak
            </div>
            <p className="text-xl font-extrabold money">
              {invitedCount} <span className="text-xs font-normal opacity-90">teman</span>
            </p>
          </div>
          <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold opacity-90">
              <Gift size={11} /> Dapet
            </div>
            <p className="text-xl font-extrabold money">
              Rp{(totalBonus / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}K
            </p>
          </div>
        </div>

        {/* The code itself — tap to copy is the hero CTA */}
        <button
          onClick={onCopy}
          className="w-full bg-white text-dark rounded-xl px-3 py-3 mb-2 flex items-center gap-3 hover:scale-[1.02] active:scale-[0.99] transition-transform shadow-md"
        >
          <div className="text-left flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-bold text-muted">Kode kamu</p>
            <p className="font-extrabold text-lg tracking-wider truncate">{code ?? '—'}</p>
          </div>
          <div className="flex items-center gap-1 text-primary font-bold text-sm shrink-0">
            <Copy size={14} /> {copied ? 'Tersalin!' : 'Salin link'}
          </div>
        </button>

        <Button
          onClick={onShareWa}
          variant="success"
          size="md"
          fullWidth
        >
          <Share2 size={16} /> Share ke WhatsApp
        </Button>

        {/* Live community ticker — small, only shown when real activity exists */}
        {ticker && (
          <div className="mt-3 bg-white/10 backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2 text-xs animate-fade-in" key={ticker.at}>
            <div className="shrink-0 opacity-90">
              {ticker.kind === 'signup' && '👋'}
              {ticker.kind === 'payout' && '💸'}
              {ticker.kind === 'referral' && '🎁'}
            </div>
            <p className="leading-tight flex-1 min-w-0 truncate">
              <b>{ticker.who}</b>
              {ticker.kind === 'signup' && ' baru gabung'}
              {ticker.kind === 'payout' && ` cair Rp${ticker.amount?.toLocaleString('id-ID')}`}
              {ticker.kind === 'referral' && ` dapat referral Rp${ticker.amount?.toLocaleString('id-ID')}`}
              <span className="opacity-70"> · {ticker.rel}</span>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// KARMA 101 — priority #2
// ============================================================
function KarmaSection({
  karma, level, accountAgeDays, onCta,
}: {
  karma: number;
  level: number;
  accountAgeDays: number;
  onCta: () => void;
}) {
  const [openSection, setOpenSection] = React.useState<string | null>('what');

  const currentLvl = getLevelInfo(level);
  const nextLvl = LEVELS[Math.min(level + 1, LEVELS.length - 1)];
  const isMaxLevel = level >= LEVELS.length - 1;

  const karmaTarget = isMaxLevel ? currentLvl.minKarma : nextLvl.minKarma;
  const karmaPct = isMaxLevel
    ? 100
    : Math.min((karma / Math.max(karmaTarget, 1)) * 100, 100);

  const ageTarget = isMaxLevel ? currentLvl.minDays : nextLvl.minDays;
  const agePct = isMaxLevel
    ? 100
    : Math.min((accountAgeDays / Math.max(ageTarget, 1)) * 100, 100);

  return (
    <Card className="mb-3" padding="md">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 text-secondary px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
          <Target size={11} /> Cuan #2
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wide text-muted">
          Naik level = naik bayaran
        </span>
      </div>

      <h2 className="text-xl font-extrabold leading-tight mb-1">
        Bangun Karma Reddit
      </h2>
      <p className="text-sm text-muted mb-3">
        Karma = "skor reputasi" kamu di Reddit. Makin tinggi → reward per task makin gede.
      </p>

      {/* Current status — hero number */}
      <div className="bg-gradient-to-br from-secondary/10 to-primary/10 rounded-xl p-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{currentLvl.emoji}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Level kamu</p>
            <p className="text-lg font-extrabold leading-tight">{currentLvl.name}</p>
            <p className="text-xs text-muted">
              Reward sekarang: <b className="text-dark">Rp{currentLvl.reward.toLocaleString('id-ID')}</b>/task
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-extrabold money">{karma}</p>
            <p className="text-[10px] text-muted">karma kamu</p>
          </div>
        </div>

        {!isMaxLevel ? (
          <>
            <div className="mt-3 space-y-2">
              <ProgressRow
                label="Karma"
                current={karma}
                target={karmaTarget}
                pct={karmaPct}
              />
              <ProgressRow
                label="Umur akun"
                current={accountAgeDays}
                target={ageTarget}
                pct={agePct}
                unit="hari"
              />
            </div>
            <p className="text-xs text-muted mt-2">
              Capai keduanya → unlock <b>{nextLvl.emoji} {nextLvl.name}</b> (Rp{nextLvl.reward.toLocaleString('id-ID')}/task)
            </p>
          </>
        ) : (
          <p className="text-sm font-bold text-success mt-3">
            🏆 Top tier — kamu di level tertinggi.
          </p>
        )}
      </div>

      {/* 101 — collapsible, default opens "Apa" for newbies */}
      <div className="space-y-1.5 mb-3">
        <FaqItem
          icon={<HelpCircle size={16} className="text-primary" />}
          title="Apa itu karma?"
          isOpen={openSection === 'what'}
          onToggle={() => setOpenSection(openSection === 'what' ? null : 'what')}
        >
          <p>
            Reddit itu kayak forum gede. Tiap kamu komen / posting, member lain bisa kasih
            👍 (upvote) atau 👎 (downvote).
          </p>
          <p className="mt-2">
            <b>Karma</b> = total upvote yang pernah kamu dapet. Kayak "skor kepercayaan".
            Akun yang karma-nya tinggi dianggap lebih kredibel — komennya ga kena spam filter.
          </p>
        </FaqItem>

        <FaqItem
          icon={<Lightbulb size={16} className="text-warning" />}
          title="Kenapa karma penting buat kamu?"
          isOpen={openSection === 'why'}
          onToggle={() => setOpenSection(openSection === 'why' ? null : 'why')}
        >
          <p>3 alasan langsung pengaruh ke saldo:</p>
          <ul className="mt-2 space-y-1.5">
            <li className="flex gap-2"><b className="text-primary shrink-0">1.</b> Reward per task naik. Level 0 = Rp5K. Level 5 = Rp20K. Selisih 4×.</li>
            <li className="flex gap-2"><b className="text-primary shrink-0">2.</b> Task premium (Rp20K+) cuma buka buat level 4+.</li>
            <li className="flex gap-2"><b className="text-primary shrink-0">3.</b> Komen dari akun karma rendah sering kena auto-remove. Karma tinggi = aman.</li>
          </ul>
        </FaqItem>

        <FaqItem
          icon={<Award size={16} className="text-success" />}
          title="Gimana cara naikin karma?"
          isOpen={openSection === 'how'}
          onToggle={() => setOpenSection(openSection === 'how' ? null : 'how')}
        >
          <p>Newbie banget? Ikutin step ini, target 50–100 karma di minggu pertama:</p>
          <ol className="mt-2 space-y-2">
            <li className="flex gap-2">
              <b className="text-primary shrink-0">1.</b>
              <span>
                Login ke Reddit pakai akun yang udah kamu register di onboarding.
                Pasang foto profil + bio singkat (akun kosong = sus).
              </span>
            </li>
            <li className="flex gap-2">
              <b className="text-primary shrink-0">2.</b>
              <span>
                Join 5–10 subreddit yang kamu suka (r/IndonesiaSemua, r/AskReddit, r/explainlikeimfive).
                Subreddit = komunitas berdasar topik.
              </span>
            </li>
            <li className="flex gap-2">
              <b className="text-primary shrink-0">3.</b>
              <span>
                Lihat thread populer hari ini, komen yang <b>natural & helpful</b> (jangan promo, jangan
                copy-paste). 1–2 kalimat aja udah cukup.
              </span>
            </li>
            <li className="flex gap-2">
              <b className="text-primary shrink-0">4.</b>
              <span>
                Tunggu 1–2 jam. Komen yang bagus dapet upvote = karma naik. Konsisten 3–5 komen/hari
                = +50 karma dalam 1 minggu.
              </span>
            </li>
          </ol>
          <div className="mt-3 bg-warning/10 ring-1 ring-warning/30 rounded-lg p-2 text-xs">
            <b>⚠️ Hindari:</b> komen "Nice", "Up", emoji doang, atau iklan. Itu ga dapet karma + bisa banned.
          </div>
        </FaqItem>
      </div>

      <Button onClick={onCta} variant="primary" fullWidth size="md">
        <Target size={16} /> Buka Misi Karma + Cek Karma Sekarang
        <ArrowRight size={14} />
      </Button>
    </Card>
  );
}

function ProgressRow({
  label, current, target, pct, unit = '',
}: {
  label: string;
  current: number;
  target: number;
  pct: number;
  unit?: string;
}) {
  const done = current >= target;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-semibold text-muted">{label}</span>
        <span className="font-bold">
          {current.toLocaleString('id-ID')} / {target.toLocaleString('id-ID')} {unit}
          {done && ' ✓'}
        </span>
      </div>
      <div className="h-2 bg-white rounded-full overflow-hidden ring-1 ring-black/5">
        <div
          className={`h-full rounded-full transition-all ${
            done ? 'bg-gradient-to-r from-success to-secondary' : 'bg-gradient-to-r from-primary to-secondary'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FaqItem({
  icon, title, isOpen, onToggle, children,
}: {
  icon: React.ReactNode;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl ring-1 ring-black/5 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-light transition-colors"
      >
        <div className="shrink-0">{icon}</div>
        <span className="flex-1 font-bold text-sm">{title}</span>
        {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-0 text-sm text-dark/85 leading-relaxed border-t border-black/5">
          <div className="pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// STREAK — priority #3a
// ============================================================
function StreakSection({
  streak, nextMilestone, milestoneProgress, daysToGo,
}: {
  streak: number;
  nextMilestone: typeof STREAK_MILESTONES[number];
  milestoneProgress: number;
  daysToGo: number;
}) {
  return (
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
        <span className="font-bold">{streak} / {nextMilestone.days} hari</span>
      </div>
      <div className="w-full h-2.5 bg-white/70 rounded-full overflow-hidden ring-1 ring-yellow-200">
        <div
          className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full transition-all"
          style={{ width: `${milestoneProgress}%` }}
        />
      </div>
      {daysToGo > 0 ? (
        <p className="text-xs text-muted mt-2">
          ⚡ {daysToGo} hari lagi — datang besok jangan sampai putus, lewat 1 hari = streak reset.
        </p>
      ) : (
        <p className="text-xs text-success font-bold mt-2">
          🎉 Bonus Rp{nextMilestone.bonus.toLocaleString('id-ID')} unlocked! Hubungi admin di grup WA.
        </p>
      )}
    </Card>
  );
}

// ============================================================
// WHATSAPP — priority #3b — dismissable forever
// ============================================================
function WhatsAppSection({
  onDismiss, dismissing,
}: {
  onDismiss: () => void;
  dismissing: boolean;
}) {
  return (
    <Card className="mb-3 bg-success/10 ring-success/40 relative">
      <button
        onClick={onDismiss}
        disabled={dismissing}
        title="Sudah join — sembunyikan selamanya"
        aria-label="Sembunyikan link grup selamanya"
        className="absolute top-2 right-2 w-8 h-8 grid place-items-center rounded-full text-success/70 hover:bg-success/15 hover:text-success transition-colors disabled:opacity-50"
      >
        <X size={16} />
      </button>
      <div className="flex items-start gap-3 mb-3 pr-8">
        <div className="w-11 h-11 bg-success text-white rounded-xl grid place-items-center shrink-0">
          <MessageCircle size={22} />
        </div>
        <div className="flex-1">
          <p className="font-extrabold">Notif task baru via WhatsApp</p>
          <p className="text-sm text-muted mt-0.5">
            Yang ga di grup = ketinggalan slot. Task baru kami kabarin di sana real-time.
          </p>
        </div>
      </div>
      <Button
        onClick={() => window.open(WHATSAPP_GROUP_URL, '_blank')}
        variant="success"
        fullWidth
        size="lg"
      >
        <MessageCircle size={18} /> Gabung Grup WhatsApp
      </Button>
      <button
        onClick={onDismiss}
        disabled={dismissing}
        className="w-full text-xs text-success/80 hover:text-success font-bold mt-2 py-1 disabled:opacity-50"
      >
        Udah join? Klik di sini biar ga muncul lagi
      </button>
    </Card>
  );
}
