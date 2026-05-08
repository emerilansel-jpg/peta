import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, Zap, Wallet, ArrowRight, Check, Lock, AlertTriangle,
  ShieldCheck, Eye, Users,
} from 'lucide-react';
import { getCommunityStats, getFoundingMembers } from '../lib/api';
import { FOUNDING_LIMIT } from '../lib/config';

export function Landing() {
  const navigate = useNavigate();

  const { data: founding } = useQuery({
    queryKey: ['foundingMembers'],
    queryFn: getFoundingMembers,
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['communityStats'],
    queryFn: getCommunityStats,
    refetchInterval: 60_000,
  });

  const foundingCount = founding?.count ?? 0;
  const slotsLeft = founding?.slotsLeft ?? FOUNDING_LIMIT;
  const isFull = founding?.isFull ?? false;
  const slotsPercent = founding?.percent ?? 0;
  const totalPaid = stats?.totalPaid ?? 0;

  const levels = [
    { emoji: '🥚', name: 'Pemula',     reward: 'Rp5.000',  cap: 'Baru gabung' },
    { emoji: '🦴', name: 'Bocil',      reward: 'Rp8.000',  cap: 'Konsisten' },
    { emoji: '🔥', name: 'Aktif',      reward: 'Rp11.000', cap: 'Reguler' },
    { emoji: '⚔️', name: 'Pejuang',    reward: 'Rp14.000', cap: 'Top kontributor' },
    { emoji: '🏙️', name: 'Senior',    reward: 'Rp17.000', cap: 'Pro level' },
    { emoji: '👑', name: 'Legend',     reward: 'Rp20.000', cap: 'Top performer' },
  ];

  return (
    <div className="min-h-dvh bg-white text-dark overflow-x-hidden">
      {/* HERO ---------------------------------------------------- */}
      <section className="relative bg-gradient-to-br from-[#FF6B6B] via-[#FF8B6B] to-[#4ECDC4] text-white overflow-hidden">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-white rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-yellow-200 rounded-full blur-3xl" />
        </div>

        <div className="relative container-custom pt-12 pb-10 sm:pt-20 sm:pb-16 safe-top">
          {/* Real scarcity ribbon — pulled from DB, no inflation */}
          <div className="bg-white/15 backdrop-blur w-fit max-w-full px-3 py-2 rounded-full mb-5 ring-1 ring-white/25 flex items-center gap-2 text-sm">
            <Lock size={14} className="shrink-0" />
            <span className="font-bold whitespace-nowrap">Founding 100</span>
            <span className="opacity-90">·</span>
            <span className="font-semibold tabular-nums">
              {isFull
                ? 'slot habis'
                : <>sisa <span className="font-extrabold tabular-nums">{slotsLeft}</span> slot</>
              }
            </span>
          </div>

          <h1 className="text-[2.5rem] leading-[1.05] sm:text-6xl font-extrabold tracking-tight mb-4">
            Cuma komen.<br/>
            <span className="text-yellow-300">Dibayar tiap hari.</span>
          </h1>
          <p className="text-base sm:text-xl opacity-95 max-w-xl mb-6">
            Mulai dari <b className="text-yellow-200">Rp5.000 per komentar</b> — naik sampai{' '}
            <b className="text-yellow-200">Rp20.000</b> seiring performa kamu.
            Like/upvote juga dibayar Rp500–Rp2.000.
          </p>
          <p className="text-sm sm:text-base opacity-95 max-w-xl mb-7">
            🎁 Founding 100 dapat bonus <b className="text-yellow-200 underline decoration-2 underline-offset-2">Rp50.000</b> + <b className="text-yellow-200">Rp20.000</b> tiap teman yang kamu ajak. Slot ke-101 dst tidak dapat bonus founding.
          </p>

          {/* Visual scarcity bar — replaces fake stars/reviews */}
          <div className="max-w-md mb-7">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold opacity-90">Slot founding terisi</span>
              <span className="font-extrabold tabular-nums">{foundingCount} / {FOUNDING_LIMIT}</span>
            </div>
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden ring-1 ring-white/20">
              <div
                className="h-full bg-gradient-to-r from-yellow-300 to-yellow-200 rounded-full transition-all"
                style={{ width: `${slotsPercent}%` }}
              />
            </div>
            <p className="text-xs opacity-90 mt-2">
              {isFull
                ? 'Pendaftaran founding ditutup. Kamu masuk waitlist untuk gelombang berikutnya.'
                : 'Tiap satu slot terisi, sisa makin sedikit. Tutup permanen begitu nyentuh 100.'}
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-lg">
            <button
              onClick={() => navigate('/register')}
              className="tap-shrink bg-yellow-300 hover:bg-yellow-200 text-[#1A1D1F] font-extrabold rounded-2xl px-6 py-4 text-lg shadow-xl shadow-black/20 flex items-center justify-center gap-2"
            >
              {isFull ? '📝 Masuk Waitlist' : <>💰 Klaim Slot Founding <ArrowRight size={20} /></>}
            </button>
            <button
              onClick={() => navigate('/login')}
              className="tap-shrink border-2 border-white/70 text-white font-bold rounded-2xl px-6 py-4 text-lg hover:bg-white/10"
            >
              Sudah punya akun
            </button>
          </div>

          {/* Real proof, no fake numbers */}
          {totalPaid > 0 && (
            <p className="text-xs opacity-90 mt-4">
              Total dibayar ke PeTa Army sejauh ini: <b>Rp{totalPaid.toLocaleString('id-ID')}</b>
            </p>
          )}
        </div>
      </section>

      {/* TRUST STRIP — fact-based, not pseudo-rating */}
      <section className="border-y border-border bg-white">
        <div className="container-custom py-4 grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
          <div className="flex flex-col items-center gap-1">
            <ShieldCheck size={20} className="text-success" />
            <span className="font-semibold">Tidak akses akun kamu</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Zap size={20} className="text-warning" />
            <span className="font-semibold">Payout 24 jam kerja</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Wallet size={20} className="text-primary" />
            <span className="font-semibold">Min cair Rp150K</span>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS -------------------------------------------- */}
      <section className="container-custom py-12 sm:py-16">
        <p className="text-primary font-bold text-sm tracking-wide mb-2">CARA KERJA</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-8">3 langkah, mulai earning</h2>
        <div className="space-y-4">
          {[
            { n: 1, t: 'Daftar 30 detik', d: 'Email + password aja. Langsung dapat bonus Rp25K masuk saldo.', e: '🚀' },
            { n: 2, t: 'Setup akun 5 menit', d: 'Ikutin panduan singkat. +Rp25K saldo lagi setelah selesai.', e: '🔐' },
            { n: 3, t: 'Ambil task & dibayar', d: 'Tulis komentar atau klik like — kirim, approval, cair ke rekening.', e: '💸' },
          ].map((s) => (
            <div key={s.n} className="flex gap-4 items-start bg-light rounded-2xl p-4 sm:p-5 ring-1 ring-black/5">
              <div className="text-3xl sm:text-4xl">{s.e}</div>
              <div className="flex-1">
                <p className="text-xs font-bold text-primary mb-1">STEP {s.n}</p>
                <h3 className="text-lg sm:text-xl font-bold mb-1">{s.t}</h3>
                <p className="text-sm sm:text-base text-muted">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TASK TYPES ---------------------------------------------- */}
      <section className="bg-light">
        <div className="container-custom py-12 sm:py-16">
          <p className="text-primary font-bold text-sm tracking-wide mb-2">JENIS TASK</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-6">Mau yang cepet atau yang gede?</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl p-5 ring-1 ring-black/5">
              <div className="text-3xl mb-2">💬</div>
              <h3 className="text-xl font-extrabold mb-1">Tulis Komentar</h3>
              <p className="text-sm text-muted mb-3">Komen natural di thread tertentu. Reward terbesar.</p>
              <p className="text-2xl font-extrabold text-primary money">Rp5.000–Rp20.000</p>
              <p className="text-xs text-muted">per komentar</p>
            </div>
            <div className="bg-white rounded-2xl p-5 ring-1 ring-black/5">
              <div className="text-3xl mb-2">👍</div>
              <h3 className="text-xl font-extrabold mb-1">Like / Upvote</h3>
              <p className="text-sm text-muted mb-3">Tinggal klik. Cepet banget, cocok buat yang sibuk.</p>
              <p className="text-2xl font-extrabold text-primary money">Rp500–Rp2.000</p>
              <p className="text-xs text-muted">per like</p>
            </div>
          </div>
        </div>
      </section>

      {/* LEVELS --------------------------------------------------- */}
      <section className="container-custom py-12 sm:py-16">
        <p className="text-primary font-bold text-sm tracking-wide mb-2">SISTEM LEVEL</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-2">Naik level, naik bayaran</h2>
        <p className="text-muted mb-6 sm:mb-8">Performa naik → reward per task naik. Otomatis, transparan.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {levels.map((l) => (
            <div key={l.name} className="bg-light rounded-2xl p-4 ring-1 ring-black/5 text-center">
              <div className="text-3xl mb-1">{l.emoji}</div>
              <div className="font-bold text-sm sm:text-base">{l.name}</div>
              <div className="text-[11px] sm:text-xs text-muted my-1">{l.cap}</div>
              <div className="font-extrabold text-primary money">{l.reward}</div>
            </div>
          ))}
        </div>
      </section>

      {/* TRANSPARENCY — replaces fake testimonials */}
      <section className="bg-gradient-to-br from-primary/5 via-yellow-50 to-secondary/5">
        <div className="container-custom py-12 sm:py-16">
          <p className="text-primary font-bold text-sm tracking-wide mb-2">KENAPA BISA PERCAYA</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">
            Kami transparan, bukan janji manis
          </h2>
          <p className="text-muted text-base sm:text-lg mb-6 max-w-2xl">
            Daripada testimoni karangan, kami kasih liat sistem yang bikin kamu yakin uang ini real.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 max-w-4xl">
            <div className="bg-white rounded-2xl p-5 ring-1 ring-black/5">
              <div className="w-10 h-10 bg-success/15 text-success rounded-xl grid place-items-center mb-3">
                <Eye size={20} />
              </div>
              <h3 className="font-extrabold text-lg mb-1">Saldo & payout transparan</h3>
              <p className="text-sm text-muted">
                Setiap rupiah yang kami bayar ke PeTa Army terlihat di komunitas grup WhatsApp.
                PeTa Army bisa screenshot bukti transfer kapan aja.
              </p>
            </div>
            <div className="bg-white rounded-2xl p-5 ring-1 ring-black/5">
              <div className="w-10 h-10 bg-secondary/15 text-secondary rounded-xl grid place-items-center mb-3">
                <Users size={20} />
              </div>
              <h3 className="font-extrabold text-lg mb-1">Founding 100 = komunitas kecil</h3>
              <p className="text-sm text-muted">
                Kami sengaja batasi 100 PeTa Army founding biar payout cepat & support 1-on-1
                via WA. Nggak ngejar volume, ngejar kepercayaan.
              </p>
            </div>
            <div className="bg-white rounded-2xl p-5 ring-1 ring-black/5">
              <div className="w-10 h-10 bg-primary/15 text-primary rounded-xl grid place-items-center mb-3">
                <Shield size={20} />
              </div>
              <h3 className="font-extrabold text-lg mb-1">Akun kamu aman</h3>
              <p className="text-sm text-muted">
                Kami nggak login, nggak post atas nama kamu, nggak mintain password Reddit-mu.
                Tiap komen = kamu yang nulis & kirim sendiri.
              </p>
            </div>
            <div className="bg-white rounded-2xl p-5 ring-1 ring-black/5">
              <div className="w-10 h-10 bg-warning/15 text-warning rounded-xl grid place-items-center mb-3">
                <AlertTriangle size={20} />
              </div>
              <h3 className="font-extrabold text-lg mb-1">Kalau gagal cair, refund</h3>
              <p className="text-sm text-muted">
                Pernah dijanjiin app lain trus zonk? Kami beda: payout otomatis 24 jam kerja
                setelah saldo cukup. Kalau gagal, balik 100% — bukti di grup.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* REFERRAL ------------------------------------------------ */}
      <section className="container-custom py-12 sm:py-16">
        <div className="max-w-2xl">
          <p className="text-primary font-bold text-sm tracking-wide mb-2">AJAK TEMAN</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">
            Tiap teman yang ikut, kamu dapat <span className="text-primary">Rp20.000</span>
          </h2>
          <p className="text-muted text-base sm:text-lg mb-4">
            Bagikan link referral kamu. Tiap teman yang daftar, <b>kamu dapat Rp20K</b> & <b>mereka dapat Rp25K</b>.
            Sebelum slot founding habis — tutup permanen di angka 100.
          </p>
          <p className="text-sm text-muted">
            Ajak 10 teman = <b className="text-primary money">Rp200.000</b> langsung masuk saldo.
            Cair kalau total ≥ Rp150K.
          </p>
        </div>
      </section>

      {/* FAQ ----------------------------------------------------- */}
      <section className="bg-light">
        <div className="container-custom py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-6">Pertanyaan singkat</h2>
          <div className="space-y-2 max-w-2xl">
            {[
              ['Beneran dibayar?', 'Ya. Min payout Rp150.000, transfer dalam 24 jam kerja ke rekening / e-wallet kamu. Bukti bayar PeTa Army sebelumnya bisa kamu lihat di grup WhatsApp setelah daftar.'],
              ['Butuh skill khusus?', 'Tidak. Kalau bisa baca & nulis komentar sopan dalam Bahasa Indonesia, kamu udah cukup. Reward kecil dulu (Rp5K), naik seiring level.'],
              ['Aman buat akun saya?', 'Aman. Kami tidak login ke akun Reddit kamu, tidak post atas namamu, tidak minta password. Tiap komen kamu ketik & kirim sendiri.'],
              ['Berapa cuan realistis?', 'Tergantung level + jumlah task yang kamu ambil. Reward per komen Rp5.000 (level 0) – Rp20.000 (level 5). Tanpa janji muluk angka mingguan — yang jelas, tiap task selesai = saldo kamu langsung naik.'],
              ['Kenapa cuma 100 founding?', 'Komunitas kecil = payout cepat, support 1-on-1, kontrol kualitas. Slot 101 dst akan dibuka di gelombang berikutnya tanpa bonus founding.'],
              ['Bonus referral berapa?', 'Rp20.000 untuk kamu DAN Rp25.000 untuk teman yang kamu ajak. Tanpa batas selama slot founding masih ada.'],
            ].map(([q, a]) => (
              <details key={q} className="group bg-white rounded-xl ring-1 ring-black/5 p-4">
                <summary className="font-bold cursor-pointer flex items-center justify-between list-none">
                  {q}
                  <span className="text-primary transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="text-sm text-muted mt-2">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA ---------------------------------------------- */}
      <section className="bg-gradient-to-br from-primary to-secondary text-white">
        <div className="container-custom py-14 sm:py-20 text-center">
          <h2 className="text-3xl sm:text-5xl font-extrabold mb-3">
            {isFull ? 'Founding 100 udah penuh' : 'Sisa ' + slotsLeft + ' slot founding'}
          </h2>
          <p className="text-base sm:text-xl opacity-95 mb-6 max-w-xl mx-auto">
            {isFull
              ? 'Masuk waitlist gelombang berikutnya — dikabarin via email + WA pas slot baru buka.'
              : 'Daftar gratis sekarang. Bonus founding Rp50K cuma buat 100 pertama. Cair 24 jam.'}
          </p>
          <button
            onClick={() => navigate('/register')}
            className="tap-shrink bg-yellow-300 hover:bg-yellow-200 text-[#1A1D1F] font-extrabold rounded-2xl px-7 py-4 text-lg shadow-2xl flex items-center justify-center gap-2 mx-auto"
          >
            {isFull ? '📝 Masuk Waitlist' : '💰 Klaim Slot Founding'} <ArrowRight size={20} />
          </button>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <li className="flex items-center gap-1"><Check size={16}/> Gratis selamanya</li>
            <li className="flex items-center gap-1"><Check size={16}/> Akun kamu aman</li>
            <li className="flex items-center gap-1"><Check size={16}/> Payout 24 jam</li>
          </ul>
        </div>
      </section>

      <footer className="bg-dark text-white/70 text-xs py-10 text-center">
        <img
          src="/logo-horizontal.png"
          alt="PeTa · PenghasilanTambahan.com"
          className="h-12 w-auto mx-auto mb-3"
          style={{ filter: 'invert(1) brightness(2)' }}
        />
        <p>© 2026 PenghasilanTambahan.com (PeTa) · Komunitas PeTa Army</p>
        <p className="opacity-60 mt-1">Komentar · Hasilkan · Tambahan</p>
      </footer>

      {/* Sticky mobile CTA */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 p-3 bg-white/95 backdrop-blur ring-1 ring-black/5 safe-bottom">
        <button
          onClick={() => navigate('/register')}
          className="w-full tap-shrink bg-primary hover:bg-primary-dark text-white font-extrabold rounded-2xl px-6 py-3.5 text-base shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
        >
          {isFull ? '📝 Masuk Waitlist' : `💰 Klaim Slot · sisa ${slotsLeft}`}
        </button>
      </div>
    </div>
  );
}
