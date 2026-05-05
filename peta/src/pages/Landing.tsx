import { useNavigate } from 'react-router-dom';
import { Star, Shield, Zap, Wallet, ArrowRight, Check } from 'lucide-react';

export function Landing() {
  const navigate = useNavigate();

  const levels = [
    { emoji: '🥚', name: 'Pemula',     reward: 'Rp5.000',  cap: 'Baru gabung' },
    { emoji: '🦴', name: 'Bocil',      reward: 'Rp8.000',  cap: 'Konsisten' },
    { emoji: '🔥', name: 'Aktif',      reward: 'Rp11.000', cap: 'Reguler' },
    { emoji: '⚔️', name: 'Pejuang',    reward: 'Rp14.000', cap: 'Top kontributor' },
    { emoji: '🏙️', name: 'Senior',    reward: 'Rp17.000', cap: 'Pro level' },
    { emoji: '👑', name: 'Legend',     reward: 'Rp20.000', cap: 'Top performer' },
  ];

  const testimonials = [
    {
      name: 'Ahmad Rifki',
      city: 'Jakarta',
      text: 'Pertama daftar dapat bonus Rp50K. 2 minggu udah cair Rp250K. Beneran cepet & gampang.',
      earn: 'Rp250K/minggu',
    },
    {
      name: 'Siti Nurhaliza',
      city: 'Surabaya',
      text: 'Cuma komen-komen aja, tapi cair beneran. Transfer 24 jam masuk rekening.',
      earn: 'Rp180K/minggu',
    },
    {
      name: 'Budi Santoso',
      city: 'Bandung',
      text: 'Udah coba banyak app, ini paling fair. Reward sesuai, transparan, ga ribet.',
      earn: 'Rp200K/minggu',
    },
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
          <div className="flex items-center gap-2 text-sm bg-white/15 backdrop-blur w-fit px-3 py-1.5 rounded-full mb-5 ring-1 ring-white/20">
            <span className="flex -space-x-1.5">
              {['🧑‍💻','👩‍🎓','🧑‍🎨'].map((e,i)=>(
                <span key={i} className="w-5 h-5 rounded-full bg-white/30 grid place-items-center text-xs">{e}</span>
              ))}
            </span>
            <span className="font-semibold">2.340+ member aktif</span>
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
            🎁 Daftar sekarang dapat <b className="text-yellow-200 underline decoration-2 underline-offset-2">bonus Rp50.000</b> + <b className="text-yellow-200">Rp20.000</b> tiap teman yang kamu ajak.
          </p>

          {/* social proof strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-7">
            <span className="flex items-center gap-1">
              <Star size={16} className="fill-yellow-300 text-yellow-300" /> 4,8/5 (340 review)
            </span>
            <span>•</span>
            <span>💸 Rp1,2jt dibayar minggu ini</span>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-lg">
            <button
              onClick={() => navigate('/register')}
              className="tap-shrink bg-yellow-300 hover:bg-yellow-200 text-[#1A1D1F] font-extrabold rounded-2xl px-6 py-4 text-lg shadow-xl shadow-black/20 flex items-center justify-center gap-2"
            >
              💰 Klaim Bonus Rp50K <ArrowRight size={20} />
            </button>
            <button
              onClick={() => navigate('/login')}
              className="tap-shrink border-2 border-white/70 text-white font-bold rounded-2xl px-6 py-4 text-lg hover:bg-white/10"
            >
              Sudah punya akun
            </button>
          </div>

          <p className="text-xs opacity-80 mt-4">⏰ Bonus terbatas untuk 100 pendaftar berikutnya</p>
        </div>
      </section>

      {/* TRUST STRIP --------------------------------------------- */}
      <section className="border-y border-border bg-white">
        <div className="container-custom py-4 grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
          <div className="flex flex-col items-center gap-1">
            <Shield size={20} className="text-success" />
            <span className="font-semibold">Aman & Resmi</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Zap size={20} className="text-warning" />
            <span className="font-semibold">Payout 24 jam</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Wallet size={20} className="text-primary" />
            <span className="font-semibold">Min Rp150K cair</span>
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
        <p className="text-muted mb-6 sm:mb-8">Performa naik → reward per task naik. Otomatis.</p>
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

      {/* REFERRAL ------------------------------------------------ */}
      <section className="bg-gradient-to-br from-primary/10 via-yellow-50 to-secondary/10">
        <div className="container-custom py-12 sm:py-16">
          <div className="max-w-2xl">
            <p className="text-primary font-bold text-sm tracking-wide mb-2">AJAK TEMAN</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">
              Tiap teman yang ikut, kamu dapat <span className="text-primary">Rp20.000</span>
            </h2>
            <p className="text-muted text-base sm:text-lg mb-4">
              Bagikan link referral kamu. Tiap teman yang daftar, <b>kamu dapat Rp20K</b> & <b>mereka juga dapat Rp20K</b>.
              Tanpa batas, tiap teman bonus.
            </p>
            <p className="text-sm text-muted">
              Ajak 10 teman = <b className="text-primary money">Rp200.000</b> langsung cair.
            </p>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS -------------------------------------------- */}
      <section className="container-custom py-12 sm:py-16">
        <p className="text-primary font-bold text-sm tracking-wide mb-2">CERITA MEMBER</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-8">Mereka udah cair duluan</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {testimonials.map((t) => (
            <div key={t.name} className="bg-light rounded-2xl p-5 ring-1 ring-black/5">
              <div className="flex gap-0.5 mb-3">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} className="fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="text-sm sm:text-base mb-4 leading-relaxed">"{t.text}"</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">{t.name}</p>
                  <p className="text-xs text-muted">{t.city}</p>
                </div>
                <span className="bg-success/15 text-success text-xs font-bold px-2.5 py-1 rounded-full">
                  {t.earn}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ ----------------------------------------------------- */}
      <section className="bg-light">
        <div className="container-custom py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-6">Pertanyaan singkat</h2>
          <div className="space-y-2 max-w-2xl">
            {[
              ['Beneran dibayar?', 'Ya. Min payout Rp150.000, transfer dalam 24 jam ke rekening kamu.'],
              ['Butuh skill khusus?', 'Tidak. Kalau bisa baca & nulis komentar sopan, kamu udah cukup.'],
              ['Aman buat akun saya?', 'Aman. Kita ga login ke akun kamu, ga post atas nama kamu tanpa izin.'],
              ['Berapa cuan realistis?', 'Member aktif Rp200–500K/minggu. Tergantung level & jumlah task yang diambil.'],
              ['Bonus referral berapa?', 'Rp20.000 untuk kamu DAN Rp20.000 untuk teman yang kamu ajak. Tanpa batas.'],
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
            Siap nambah cuan?
          </h2>
          <p className="text-base sm:text-xl opacity-95 mb-6 max-w-xl mx-auto">
            Daftar gratis. Bonus Rp50K langsung masuk. Cair 24 jam.
          </p>
          <button
            onClick={() => navigate('/register')}
            className="tap-shrink bg-yellow-300 hover:bg-yellow-200 text-[#1A1D1F] font-extrabold rounded-2xl px-7 py-4 text-lg shadow-2xl flex items-center justify-center gap-2 mx-auto"
          >
            💰 Klaim Bonus Rp50K <ArrowRight size={20} />
          </button>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <li className="flex items-center gap-1"><Check size={16}/> Gratis selamanya</li>
            <li className="flex items-center gap-1"><Check size={16}/> Data aman</li>
            <li className="flex items-center gap-1"><Check size={16}/> Payout 24 jam</li>
          </ul>
        </div>
      </section>

      <footer className="bg-dark text-white/70 text-xs py-6 text-center">
        © 2026 PeTa · Penghasilan Tambahan untuk Semua
      </footer>

      {/* Sticky mobile CTA */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 p-3 bg-white/95 backdrop-blur ring-1 ring-black/5 safe-bottom">
        <button
          onClick={() => navigate('/register')}
          className="w-full tap-shrink bg-primary hover:bg-primary-dark text-white font-extrabold rounded-2xl px-6 py-3.5 text-base shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
        >
          💰 Klaim Bonus Rp50K Sekarang
        </button>
      </div>
    </div>
  );
}
