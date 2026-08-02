import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, MessageCircle } from 'lucide-react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { WHATSAPP_GROUP_URL } from '../lib/config';

const FAQS = [
  {
    q: '📝 Cara dapet duit dari PeTa gimana?',
    a: 'Kamu daftar, selesaiin onboarding, terus ambil task yang tersedia. Tiap task punya reward Rp5.000–Rp20.000. Kerjain → submit bukti → admin approve → saldo naik. Gampang!',
  },
  {
    q: '📋 Cara ambil & kerjain task?',
    a: 'Buka halaman Tugas, klik task yang mau dikerjain. Nanti ada panduan step-by-step: buka link target → komen sesuai instruksi → screenshot → submit. Udah, tinggal tunggu admin approve.',
  },
  {
    q: '⏳ Kok task aku masih "Menunggu Approve"?',
    a: 'Admin review satu-satu, bisa makan waktu beberapa jam sampai 1 hari. Sabar ya, kamu bakal dapet notifikasi kalau udah di-approve atau di-reject.',
  },
  {
    q: '❌ Task di-reject, gimana?',
    a: 'Jangan panik. Biasanya karena screenshot kurang jelas atau komen kurang sesuai. Kamu bisa lihat alasan reject, terus coba lagi dengan perbaikan. Kalau bingung, chat admin aja.',
  },
  {
    q: '💰 Kapan saldo bisa dicairkan?',
    a: 'Minimal saldo Rp150.000 baru bisa cair. Proses payout 24 jam kerja setelah admin mark sebagai paid. Transfer ke e-wallet (Dana, OVO, GoPay) atau bank.',
  },
  {
    q: '📱 Kok saldo ada yang "locked"?',
    a: 'Bonus signup & referral bonus awalnya terkunci. Mereka baru bisa cair kalau kamu udah dapet minimal Rp100.000 dari hasil task. Makin rajin ambil task, makin cepet kebuka.',
  },
  {
    q: '🆔 Bisa ganti password?',
    a: 'Di halaman login, klik "Lupa password?" nanti dikirim link reset ke email kamu.',
  },
  {
    q: '🏆 Apa itu Program Army?',
    a: 'Program khusus buat army yang pengen dapet penghasilan pasif. Kamu aktivasi undangan, kerjain 5 level challenge (min 30 hari warmup), selesai dapet Rp100.000. Setelah itu tiap hari aktif di platform dapet Rp2.500.',
  },
  {
    q: '🎖️ Cara mulai Program Army gimana?',
    a: 'Kamu harus dapat undangan dari admin dulu (ga bisa daftar sendiri). Admin invite → kamu buka /reddit-army → aktivasi undangan → mulai kerjain challenge level 1-5.',
  },
  {
    q: '🛑 Kok level challenge saya masih terkunci?',
    a: 'Wajar! Tiap level ada masa warmup minimal (3-30 hari). Biar akun platform keliatan natural dan ga kena shadowban. Kamu tetap bisa kerjain task, tapi baru bisa naik level setelah warmup selesai.',
  },
  {
    q: '🔥 Fase 2 (bonus harian) mulai kapan?',
    a: 'Setelah kamu selesaiin semua 5 level challenge. Nanti dapet Rp2.500/hari kalau kamu aktif comment/post di platform. 50% cair tiap 2 minggu, 50% ditahan sampe kamu berhenti.',
  },
  {
    q: '🚪 Cara berhenti dari program gimana?',
    a: 'Klik "Mau Berhenti" di halaman Program Army. Kamu masuk masa tunggu 30 hari dan harus tetap aktif minimal 20 hari. Setelah itu, semua tabungan retensi cair ke saldo. Jangan ghosting nanti hold hangus.',
  },
  {
    q: '💬 Cara hubungi admin?',
    a: 'Bisa lewat grup WhatsApp yang udah dikasih pas onboarding, atau chat admin via nomor WhatsApp pribadi yang udah dikasih tau.',
  },
  {
    q: '🔒 Data aku aman ga?',
    a: 'Aman. Password di-enkripsi, data cuma dipake buat verifikasi task & payout. Ga dijual ke pihak ketiga. Baca lengkap di halaman Kebijakan Privasi.',
  },
];

export function Help() {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);

  return (
    <div className="max-w-2xl mx-auto p-4 pb-bottomnav">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 tap-shrink" aria-label="Kembali">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-xl font-bold">📖 Panduan PeTa</h1>
      </div>

      {/* Pinned: Contact */}
      <Card className="mb-4 bg-gradient-to-br from-primary/10 to-secondary/10">
        <div className="flex items-center gap-3">
          <MessageCircle size={28} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">Masih bingung?</p>
            <p className="text-xs text-gray-600 mt-0.5">
              Chat aja lewat grup WhatsApp PeTa Army, admin siap bantu.
            </p>
          </div>
          <a href={WHATSAPP_GROUP_URL} target="_blank" rel="noreferrer">
            <Button size="sm" variant="primary">
              Grup WA <ExternalLink size={14} />
            </Button>
          </a>
        </div>
      </Card>

      {/* Quick links */}
      <Card className="mb-4" padding="sm">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-2">Link Cepat</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate('/tasks')}>📋 Ke Tugas</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/reddit-army')}>🎖️ Program Army</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/earnings')}>💰 Cek Saldo</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/privacy')}>🔒 Privasi</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/terms')}>📜 Syarat</Button>
        </div>
      </Card>

      {/* FAQ */}
      <h2 className="font-bold mb-3 text-sm uppercase tracking-wide text-muted">Pertanyaan Umum</h2>
      <div className="space-y-2">
        {FAQS.map((faq, i) => (
          <Card key={i} padding="sm" onClick={() => toggle(i)}>
            <div className="flex items-start gap-2 cursor-pointer">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{faq.q}</p>
                {openIndex === i && (
                  <p className="text-sm text-gray-600 mt-2 leading-relaxed">{faq.a}</p>
                )}
              </div>
              <button className="shrink-0 mt-0.5 tap-shrink" aria-label="Buka/tutup">
                {openIndex === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
