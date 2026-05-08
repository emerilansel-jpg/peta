import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Target, TrendingUp, Sparkles, Lock, Unlock, RefreshCw,
  AlertTriangle, ExternalLink, Trophy, Heart, Camera, MessageSquare, Film,
  ShieldQuestion,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ConfettiBurst } from '../components/Confetti';
import { supabase } from '../lib/supabase';
import {
  getMaxRedditKarma, hasClaimedKarmaMilestone, claimKarmaMilestone,
  updateRedditAccountKarma,
} from '../lib/api';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import { toast } from '../components/Toast';

const KARMA_GOAL = 10;

const SUBREDDIT_LINKS = [
  { name: 'r/dogs',          url: 'https://www.reddit.com/r/dogs/',         tag: '🐶 anabul' },
  { name: 'r/cats',          url: 'https://www.reddit.com/r/cats/',         tag: '🐱 anabul' },
  { name: 'r/aww',           url: 'https://www.reddit.com/r/aww/',          tag: '🥰 cute' },
  { name: 'r/gaming',        url: 'https://www.reddit.com/r/gaming/',       tag: '🎮 gaming' },
  { name: 'r/Kpop',          url: 'https://www.reddit.com/r/kpop/',         tag: '🎤 kpop' },
  { name: 'r/motorcycles',   url: 'https://www.reddit.com/r/motorcycles/',  tag: '🏍️ motor' },
  { name: 'r/streetwear',    url: 'https://www.reddit.com/r/streetwear/',   tag: '👟 fashion' },
  { name: 'r/food',          url: 'https://www.reddit.com/r/food/',         tag: '🍜 food' },
  { name: 'r/indonesia_real',url: 'https://www.reddit.com/r/indonesia_real/', tag: '🇮🇩 lokal' },
];

export function KarmaMission() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [claiming, setClaiming] = React.useState(false);
  const [confettiActive, setConfettiActive] = React.useState(false);
  // True after the most recent sync attempt fell back (Reddit blocked the
  // server-side fetch). Surfaces the admin-handoff CTA. Reset on next attempt.
  const [syncFallback, setSyncFallback] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  const { data: karmaInfo, refetch: refetchKarma } = useQuery({
    queryKey: ['maxKarma', user?.id],
    queryFn: () => getMaxRedditKarma(user!.id),
    enabled: !!user?.id,
  });

  const { data: alreadyClaimed, refetch: refetchClaimed } = useQuery({
    queryKey: ['karmaClaimed', user?.id],
    queryFn: () => hasClaimedKarmaMilestone(user!.id),
    enabled: !!user?.id,
  });

  const karma = karmaInfo?.karma ?? 0;
  const username = karmaInfo?.username;
  const accountId = karmaInfo?.accountId;
  const progress = Math.min((karma / KARMA_GOAL) * 100, 100);
  const remaining = Math.max(KARMA_GOAL - karma, 0);
  const goalReached = karma >= KARMA_GOAL;

  const handleRefreshKarma = async () => {
    if (!username || !accountId) {
      toast.error('Belum ada akun Reddit. Selesain onboarding dulu ya.');
      return;
    }
    setRefreshing(true);
    setSyncFallback(false);
    try {
      const res = await updateRedditAccountKarma(accountId, username);
      await refetchKarma();
      if (res.fallback) {
        setSyncFallback(true);
        toast.error('Reddit memblokir auto-sync — minta admin verify manual');
      } else {
        toast.success('Karma di-refresh ✅');
      }
    } catch (e: any) {
      setSyncFallback(true);
      toast.error('Gagal sync — coba lagi atau lapor admin di bawah');
    } finally {
      setRefreshing(false);
    }
  };

  const adminWaMessage = (() => {
    const lines = [
      `Halo admin PeTa, mau lapor karma manual:`,
      `• Akun Reddit: u/${username || '<isi username kamu>'}`,
      `• Link profile: https://www.reddit.com/user/${username || ''}`,
      `• Alasan: auto-sync gagal (Reddit memblokir server)`,
      ``,
      `Mohon di-verify & update karma. Makasih 🙏`,
    ];
    return encodeURIComponent(lines.join('\n'));
  })();
  const adminWaUrl = `${WHATSAPP_GROUP_URL}?text=${adminWaMessage}`;

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const result = await claimKarmaMilestone();
      if (result.awarded) {
        setConfettiActive(true);
        toast.success('🎉 +Rp5.000 masuk saldo!');
        await refetchClaimed();
      } else if (result.reason === 'already_claimed') {
        toast.success('Bonus sudah pernah diklaim sebelumnya.');
        await refetchClaimed();
      } else {
        toast.error(`Karma masih ${result.karma}. Butuh minimal ${KARMA_GOAL}.`);
      }
    } catch (e: any) {
      toast.error('Gagal klaim — coba lagi sebentar.');
    } finally {
      setClaiming(false);
    }
  };

  if (!user) {
    return (
      <Layout userRole="army">
        <div className="h-32 bg-light rounded-2xl shimmer" />
      </Layout>
    );
  }

  return (
    <Layout userRole="army">
      <ConfettiBurst active={confettiActive} onDone={() => setConfettiActive(false)} />

      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/tasks')}
          className="flex items-center gap-1 text-sm font-semibold text-muted hover:text-dark mb-3"
        >
          <ArrowLeft size={16} /> Kembali
        </button>

        {/* HERO — status + progress */}
        <Card className="mb-3 bg-gradient-to-br from-primary via-[#FF8B6B] to-secondary text-white border-0 ring-0 overflow-hidden relative">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 bg-white/20 backdrop-blur rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide">
                <Target size={12} /> Misi Wajib #1
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-1">
              Bangun Karma Reddit Dulu
            </h1>
            <p className="text-sm opacity-95 mb-4">
              Karma = kunci buka misi cuan. Makin tinggi karma, makin gede bayaran per komen.
            </p>

            {/* Big karma number */}
            <div className="bg-white/15 backdrop-blur rounded-xl p-4 mb-3">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <p className="text-[11px] uppercase font-bold tracking-wide opacity-90">Karma kamu sekarang</p>
                  <p className="text-4xl font-extrabold money leading-none mt-1">
                    {karma}
                    <span className="text-base font-semibold opacity-80"> / {KARMA_GOAL}</span>
                  </p>
                  {username && (
                    <p className="text-[11px] opacity-80 mt-1">u/{username}</p>
                  )}
                </div>
                <button
                  onClick={handleRefreshKarma}
                  disabled={refreshing}
                  className="bg-white/20 hover:bg-white/30 disabled:opacity-50 transition-all rounded-lg px-3 py-2 text-xs font-bold flex items-center gap-1.5 shrink-0"
                >
                  <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Sync…' : 'Cek karma'}
                </button>
              </div>
              <div className="w-full h-2.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yellow-300 to-green-300 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs opacity-95 mt-2">
                {goalReached
                  ? <>🎉 Target {KARMA_GOAL} karma kelar — klaim bonus di bawah!</>
                  : <>Butuh <b>{remaining} karma lagi</b> buat unlock semua misi cuan + bonus Rp5.000.</>
                }
              </p>
            </div>

            {/* CTA — claim or progress */}
            {goalReached && !alreadyClaimed && (
              <Button
                onClick={handleClaim}
                loading={claiming}
                fullWidth
                size="lg"
                className="!bg-yellow-300 !text-dark hover:!bg-yellow-200 !rounded-2xl font-extrabold"
              >
                <Unlock size={18} /> Klaim Bonus Rp5.000 Sekarang
              </Button>
            )}
            {alreadyClaimed && (
              <div className="bg-success/30 ring-1 ring-success/50 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <Trophy size={16} className="text-yellow-200 shrink-0" />
                <p className="text-sm font-bold">Bonus Rp5.000 sudah masuk saldo. Lanjut naikkan karma — level up = reward task lebih gede.</p>
              </div>
            )}
            {!goalReached && (
              <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2.5 text-sm">
                <p className="font-bold flex items-center gap-1.5">
                  <Lock size={14} /> Misi cuan terkunci sampai karma ≥ {KARMA_GOAL}
                </p>
                <p className="text-xs opacity-90 mt-0.5">Lakuin 3 cara di bawah → balik sini → klik "Cek karma".</p>
              </div>
            )}
          </div>
        </Card>

        {/* Reddit-blocked fallback — surfaces the admin handoff path so users
            don't get stuck at karma=0 forever when Reddit's bot wall hits. */}
        {syncFallback && (
          <Card className="mb-3 bg-warning/10 ring-warning/30" padding="md">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 bg-warning/20 text-warning rounded-xl grid place-items-center shrink-0">
                <ShieldQuestion size={20} />
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-base">Reddit memblokir auto-sync</p>
                <p className="text-sm text-muted mt-1">
                  Reddit lagi anti-bot ke server kami. Bukan dari kamu — admin biasa update manual dalam {' '}
                  <b>kurang dari 24 jam</b>. Kirim username kamu via WA grup biar diprioritasin.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              {username && (
                <a
                  href={`https://www.reddit.com/user/${username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white ring-1 ring-black/10 rounded-xl px-3 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 hover:ring-primary"
                >
                  <ExternalLink size={14} /> Buka profilku di Reddit
                </a>
              )}
              <a
                href={adminWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-success text-white rounded-xl px-3 py-2.5 text-sm font-extrabold flex items-center justify-center gap-1.5 hover:brightness-95"
              >
                <MessageSquare size={14} /> Lapor admin via WA
              </a>
            </div>
            <p className="text-[11px] text-muted mt-2">
              Pesan WA udah pre-filled — tinggal kirim. Admin akan cek profile-mu & update karma.
            </p>
          </Card>
        )}

        {/* WHY (the CRO anchor) */}
        <Card className="mb-3 bg-light/50" padding="sm">
          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2 flex items-center gap-1.5">
            <Sparkles size={12} className="text-primary" /> Kenapa karma penting?
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <TrendingUp size={16} className="text-success shrink-0 mt-0.5" />
              <span><b>Reward naik per level.</b> Karma ↑ = level ↑ = bayaran per komen <b>Rp5K → Rp20K</b>.</span>
            </li>
            <li className="flex items-start gap-2">
              <Unlock size={16} className="text-primary shrink-0 mt-0.5" />
              <span><b>Buka misi premium.</b> Task bayaran tinggi minta minimum karma. Tanpa karma = ke-skip.</span>
            </li>
            <li className="flex items-start gap-2">
              <Heart size={16} className="text-danger shrink-0 mt-0.5" />
              <span><b>Akun ga di-shadow ban.</b> Akun karma rendah cenderung dianggap spam Reddit — komen ga keliatan.</span>
            </li>
          </ul>
        </Card>

        {/* 3 CARA CEPAT — actionable */}
        <h2 className="text-lg font-extrabold mt-5 mb-2 px-1 flex items-center gap-2">
          🎯 3 Cara Cepat Dapat Karma
        </h2>

        <Card className="mb-2" padding="md">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-yellow-200 text-yellow-900 rounded-xl grid place-items-center shrink-0">
              <Camera size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Cara 1 — paling cepet</p>
              <p className="font-extrabold text-base">Post hobby / passion content</p>
              <p className="text-sm text-muted mt-1">
                Cari konten viral sesuai hobi: foto anjing/kucing lucu, gaming clip, motor, streetwear, foto food.
                Post di subreddit hobby internasional — audience global = karma cepet masuk.
              </p>
              <p className="text-xs text-warning font-semibold mt-2">
                ⚠️ Hindari posting cuma di r/Indonesia — audience kecil, karma naiknya lambat.
              </p>
            </div>
          </div>
        </Card>

        <Card className="mb-2" padding="md">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-secondary/20 text-secondary rounded-xl grid place-items-center shrink-0">
              <MessageSquare size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Cara 2 — paling sustainable</p>
              <p className="font-extrabold text-base">Komentar tulus di subreddit passion</p>
              <p className="text-sm text-muted mt-1">
                Buka subreddit hobby kamu → urutin <b>Hot</b>. Kasih komentar yang nambah value:
                pengalaman pribadi, info berguna, atau humor relevan.
              </p>
              <p className="text-xs text-success font-semibold mt-2">
                ✅ 5–10 komentar tulus per hari = <b>karma 50–200 dalam seminggu</b>.
              </p>
            </div>
          </div>
        </Card>

        <Card className="mb-3" padding="md">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-primary/15 text-primary rounded-xl grid place-items-center shrink-0">
              <Film size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Cara 3 — kalau bingung</p>
              <p className="font-extrabold text-base">Repost meme dari TikTok / IG</p>
              <p className="text-sm text-muted mt-1">
                Screen-record video TikTok / Reels lucu (tanpa watermark), atau bikin meme dari konten populer.
                Upload ke <span className="font-semibold">r/indonesia_real</span> atau <span className="font-semibold">r/IndonesiaSubs</span>.
              </p>
              <p className="text-xs text-muted mt-2">
                💡 Sertain kredit creator — komunitas Reddit sensitif soal repost ga ber-attribusi.
              </p>
            </div>
          </div>
        </Card>

        {/* Subreddit quick links */}
        <Card className="mb-3 bg-light/40" padding="sm">
          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">Mulai dari sini — pilih sesuai passion:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUBREDDIT_LINKS.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 bg-white ring-1 ring-black/10 rounded-full px-2.5 py-1 text-xs font-semibold hover:ring-primary hover:text-primary transition-all"
              >
                <span>{s.tag}</span>
                <span className="text-muted">{s.name}</span>
                <ExternalLink size={10} className="opacity-60" />
              </a>
            ))}
          </div>
        </Card>

        {/* Step-by-step */}
        <Card className="mb-3" padding="md">
          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-3 flex items-center gap-1.5">
            📋 Langkah praktis (5 menit setup)
          </p>
          <ol className="space-y-2.5 text-sm">
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-primary text-white rounded-full grid place-items-center text-xs font-extrabold shrink-0">1</span>
              <span>Pilih 2-3 subreddit sesuai hobi (lihat chip di atas).</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-primary text-white rounded-full grid place-items-center text-xs font-extrabold shrink-0">2</span>
              <span>Post 1 konten passion kamu — foto anabul, gaming clip, review gear, cerita personal.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-primary text-white rounded-full grid place-items-center text-xs font-extrabold shrink-0">3</span>
              <span>Komentari 5 post populer (Hot) — kasih info berguna atau pengalaman nyata.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-primary text-white rounded-full grid place-items-center text-xs font-extrabold shrink-0">4</span>
              <span>Upvote 10+ post menarik tiap sesi — bantu komunitas, akun keliatan natural.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-primary text-white rounded-full grid place-items-center text-xs font-extrabold shrink-0">5</span>
              <span>Tunggu 1-2 hari → balik ke page ini → klik <b>"Cek karma"</b> di hero atas.</span>
            </li>
          </ol>
        </Card>

        {/* Hindari */}
        <Card className="mb-4 bg-danger/5 ring-danger/30" padding="md">
          <p className="text-xs uppercase font-bold tracking-wide text-danger mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} /> 🚫 Hindari — bikin akun di-shadowban
          </p>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              <span>Spam promosi atau link afiliasi tanpa konteks.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              <span>Copy-paste caption TikTok tanpa atribusi kredit creator.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              <span>Post cuma di r/Indonesia — audience kecil, karma naik lambat.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-danger mt-1">•</span>
              <span>Komentar generik ("nice!", "good post!") — ga nambah karma.</span>
            </li>
          </ul>
        </Card>

        {/* Bottom CTA — recheck */}
        <Card className="mb-3 bg-gradient-to-br from-yellow-50 to-orange-50 ring-yellow-200" padding="md">
          <div className="text-center">
            <p className="text-2xl mb-1">🎉</p>
            <p className="font-extrabold mb-1">
              {goalReached
                ? 'Karma kamu udah cukup — klaim bonus di atas!'
                : `Tinggal ${remaining} karma lagi`}
            </p>
            <p className="text-sm text-muted mb-3">
              Setelah karma ≥ {KARMA_GOAL}: <b>semua misi cuan auto-unlock</b> + bonus <b>Rp5.000</b> langsung masuk saldo.
            </p>
            <Button
              onClick={handleRefreshKarma}
              loading={refreshing}
              variant="primary"
              fullWidth
              size="lg"
              className="!rounded-2xl"
            >
              <RefreshCw size={18} /> Cek Karma Saya Sekarang
            </Button>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
