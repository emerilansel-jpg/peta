import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, Target, TrendingUp, Sparkles, Lock, Unlock, RefreshCw,
  AlertTriangle, ExternalLink, Trophy, Heart, Camera, MessageSquare, Film,
  ShieldQuestion, Clock, Send, Shield, Check, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ConfettiBurst } from '../components/Confetti';
import { supabase } from '../lib/supabase';
import {
  getMaxRedditKarma, hasClaimedKarmaMilestone, claimKarmaMilestone,
  updateRedditAccountKarma, submitKarmaClaim,
} from '../lib/api';
import { WHATSAPP_GROUP_URL } from '../lib/config';
import { toast } from '../components/Toast';

const KARMA_GOAL = 100;

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
  const pendingKarma = karmaInfo?.pendingKarma ?? null;
  const pendingSubmittedAt = karmaInfo?.pendingSubmittedAt ?? null;
  const hasPending = pendingKarma !== null && pendingSubmittedAt !== null;
  const progress = Math.min((karma / KARMA_GOAL) * 100, 100);
  const remaining = Math.max(KARMA_GOAL - karma, 0);
  const goalReached = karma >= KARMA_GOAL;

  // Honor-system claim input — used when auto-sync is blocked. Admin
  // verifies the value against the user's actual Reddit profile before
  // approving via /admin/accounts.
  const [claimInput, setClaimInput] = React.useState('');
  const claimMutation = useMutation({
    mutationFn: (n: number) => submitKarmaClaim(accountId!, n),
    onSuccess: () => {
      toast.success('Karma claim dikirim ke admin — verify dalam ≤ 24 jam');
      setClaimInput('');
      refetchKarma();
    },
    onError: (e: any) => toast.error(`Gagal kirim claim: ${e.message || e}`),
  });
  const handleSubmitClaim = () => {
    const n = parseInt(claimInput.trim(), 10);
    if (isNaN(n) || n < 0) {
      toast.error('Masukkan angka karma yang valid (≥ 0)');
      return;
    }
    if (n > 1_000_000) {
      toast.error('Angka kebesaran — cek lagi profile-mu');
      return;
    }
    if (!accountId) {
      toast.error('Akun Reddit belum siap');
      return;
    }
    claimMutation.mutate(n);
  };

  const handleRefreshKarma = async () => {
    if (!username || !accountId) {
      toast.error('Belum ada akun Reddit. Selesain onboarding dulu ya.');
      return;
    }
    setRefreshing(true);
    setSyncFallback(false);
    // Capture pre-sync karma so we can detect a delta and celebrate the win.
    // Confetti + toast fires only when karma actually increases — flat sync
    // gets a quiet "no change" toast instead.
    const beforeKarma = karma;
    try {
      const res = await updateRedditAccountKarma(accountId, username);
      await refetchKarma();
      if (res.fallback) {
        setSyncFallback(true);
        toast.error('Reddit memblokir auto-sync — minta admin verify manual');
      } else if (res.karma > beforeKarma) {
        const delta = res.karma - beforeKarma;
        setConfettiActive(true);
        toast.success(`🎉 Karma +${delta} — total ${res.karma}!`);
      } else if (res.karma < beforeKarma) {
        toast.success(`Karma diupdate: ${res.karma} (turun dari ${beforeKarma})`);
      } else {
        toast.success('Karma sama, belum nambah. Komen 2-3 thread lagi yuk!');
      }
    } catch (e: any) {
      setSyncFallback(true);
      toast.error('Gagal sync — coba lagi atau lapor admin di bawah');
    } finally {
      setRefreshing(false);
    }
  };

  // Step 0 — Cloudflare WARP. Persists "dismissed" flag in localStorage so
  // users who already installed don't keep seeing the nudge. Shown as the
  // very first action because Reddit blocks many Indo ISP ranges, and
  // unblocking takes 5 min — biggest unlock-vs-effort ratio on this page.
  const [warpDismissed, setWarpDismissed] = React.useState<boolean>(() => {
    try { return localStorage.getItem('peta_warp_installed') === '1'; }
    catch { return false; }
  });
  const [warpExpanded, setWarpExpanded] = React.useState<boolean>(!warpDismissed);
  const handleMarkWarpDone = () => {
    try { localStorage.setItem('peta_warp_installed', '1'); } catch {}
    setWarpDismissed(true);
    setWarpExpanded(false);
    setConfettiActive(true);
    toast.success('🎉 Beres! Sekarang Reddit kebuka. Lanjut bangun karma 👇');
  };

  const adminWaMessage = (() => {
    // 4-byte emoji escaped (\u{1F64F} = 🙏) — Vite build on Windows was
    // corrupting literal supplementary-plane emoji in source.
    const lines = [
      `Halo admin PeTa, mau lapor karma manual:`,
      `• Akun Reddit: u/${username || '<isi username kamu>'}`,
      `• Link profile: https://www.reddit.com/user/${username || ''}`,
      `• Alasan: auto-sync gagal (Reddit memblokir server)`,
      ``,
      `Mohon di-verify & update karma. Makasih \u{1F64F}`,
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

        {/* STEP 0 — CLOUDFLARE WARP
            First action above everything else. Reddit blocks many Indo ISPs;
            WARP routes traffic via Cloudflare so Reddit pages load reliably.
            Collapsible so people who already installed don't get nagged. */}
        <Card
          className={`mb-3 ${warpDismissed
            ? 'bg-success/5 ring-success/30'
            : 'bg-gradient-to-br from-blue-50 to-cyan-50 ring-cyan-300'
          }`}
          padding="md"
        >
          <button
            onClick={() => setWarpExpanded((v) => !v)}
            className="w-full flex items-center gap-3 text-left tap-shrink"
          >
            <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
              warpDismissed ? 'bg-success/20 text-success' : 'bg-cyan-500 text-white'
            }`}>
              {warpDismissed ? <Check size={20} /> : <Shield size={20} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold tracking-wide text-muted">
                Step 0 — Wajib dulu
              </p>
              <p className="font-extrabold text-base leading-tight">
                {warpDismissed
                  ? 'WARP terpasang ✓ — Reddit kebuka'
                  : 'Pasang Cloudflare WARP (5 menit, gratis)'}
              </p>
            </div>
            {warpExpanded
              ? <ChevronUp size={18} className="text-muted shrink-0" />
              : <ChevronDown size={18} className="text-muted shrink-0" />
            }
          </button>

          {warpExpanded && (
            <div className="mt-3 pt-3 border-t border-cyan-200">
              <p className="text-sm text-dark/80 mb-3">
                Reddit suka blokir IP Indonesia (Indihome / Telkomsel / dll).
                <b> Cloudflare WARP</b> ngubah rute internet kamu lewat server Cloudflare
                yang gratis & cepat → Reddit kebuka & karma bisa nambah.
              </p>

              <div className="bg-white rounded-xl p-3 mb-3 ring-1 ring-cyan-200">
                <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2">
                  3 langkah aja:
                </p>
                <ol className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="w-5 h-5 bg-cyan-500 text-white rounded-full grid place-items-center text-[10px] font-extrabold shrink-0 mt-0.5">1</span>
                    <span>
                      Download <b>"1.1.1.1 Cloudflare WARP"</b> di{' '}
                      <a href="https://1.1.1.1/" target="_blank" rel="noopener noreferrer" className="text-primary font-bold underline">
                        1.1.1.1
                      </a>{' '}
                      (Android / iOS / desktop).
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 bg-cyan-500 text-white rounded-full grid place-items-center text-[10px] font-extrabold shrink-0 mt-0.5">2</span>
                    <span>Buka app → geser toggle ke <b>ON</b>. Selesai — udah aktif.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 bg-cyan-500 text-white rounded-full grid place-items-center text-[10px] font-extrabold shrink-0 mt-0.5">3</span>
                    <span>Buka <b>reddit.com</b> — sekarang harus kebuka tanpa error.</span>
                  </li>
                </ol>
              </div>

              <div className="flex gap-2">
                <a
                  href="https://1.1.1.1/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white font-bold text-sm rounded-xl py-2.5 px-3 text-center flex items-center justify-center gap-1.5 tap-shrink"
                >
                  <ExternalLink size={14} /> Download WARP
                </a>
                <Button
                  onClick={handleMarkWarpDone}
                  variant={warpDismissed ? 'outline' : 'success'}
                  size="md"
                >
                  <Check size={14} /> {warpDismissed ? 'Done' : 'Sudah pasang'}
                </Button>
              </div>
              {!warpDismissed && (
                <p className="text-[11px] text-muted mt-2 text-center">
                  Klik "Sudah pasang" kalau WARP udah ON di HP/laptop kamu.
                </p>
              )}
            </div>
          )}
        </Card>

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

        {/* Pending claim — already submitted, waiting on admin verify */}
        {hasPending && (
          <Card className="mb-3 bg-primary/5 ring-primary/30" padding="md">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-primary/15 text-primary rounded-xl grid place-items-center shrink-0">
                <Clock size={20} />
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-base">
                  Claim kamu lagi diverifikasi
                </p>
                <p className="text-sm text-muted mt-1">
                  Kamu lapor karma <b>{pendingKarma!.toLocaleString('id-ID')}</b> pada{' '}
                  <b>
                    {new Date(pendingSubmittedAt!).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </b>. Admin verify ke profile Reddit-mu — biasa &lt; 24 jam. Pastikan profile public (bukan private).
                </p>
                {username && (
                  <a
                    href={`https://www.reddit.com/user/${username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary font-bold hover:underline mt-2"
                  >
                    <ExternalLink size={12} /> Buka profilmu di Reddit (cek public)
                  </a>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Reddit-blocked fallback — show honor-system karma claim form so
            users don't get stuck at karma=0 forever when Reddit's bot wall
            hits. Admin verifies the claim via /admin/accounts before
            approving — they open the user's Reddit profile and confirm the
            number matches. */}
        {syncFallback && !hasPending && (
          <Card className="mb-3 bg-warning/10 ring-warning/30" padding="md">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 bg-warning/20 text-warning rounded-xl grid place-items-center shrink-0">
                <ShieldQuestion size={20} />
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-base">Reddit memblokir auto-sync</p>
                <p className="text-sm text-muted mt-1">
                  Bukan kesalahan kamu — Reddit lagi anti-bot ke server kami.
                  Lapor karma manual aja, admin verify dalam &lt; 24 jam.
                </p>
              </div>
            </div>

            <ol className="space-y-1.5 text-sm mb-3 list-decimal list-inside">
              <li>
                Buka{' '}
                {username ? (
                  <a
                    href={`https://www.reddit.com/user/${username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-primary inline-flex items-center gap-0.5 hover:underline"
                  >
                    profile Reddit kamu <ExternalLink size={11} />
                  </a>
                ) : (
                  'profile Reddit kamu'
                )}
                {' '}di tab baru
              </li>
              <li>Cari angka <b>karma</b> (di samping avatar / nama)</li>
              <li>Paste angkanya di bawah & submit — admin verify</li>
            </ol>

            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={claimInput}
                onChange={(e) => setClaimInput(e.target.value)}
                placeholder="Contoh: 142"
                className="flex-1 px-3 py-2.5 rounded-xl ring-1 ring-black/10 bg-white text-sm font-bold tabular-nums focus:ring-2 focus:ring-primary outline-none"
              />
              <Button
                onClick={handleSubmitClaim}
                loading={claimMutation.isPending}
                size="md"
              >
                <Send size={14} /> Submit
              </Button>
            </div>
            <p className="text-[11px] text-muted mt-2">
              Jangan kasih angka kebesaran — admin bakal cek profile-mu langsung. Salah angka = ditolak.
            </p>

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-warning/20">
              <a
                href={adminWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs text-success font-bold hover:underline flex items-center justify-center gap-1"
              >
                <MessageSquare size={12} /> Atau lapor via WA grup admin
              </a>
            </div>
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
