import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Terms() {
  const navigate = useNavigate();
  return (
    <div className="max-w-2xl mx-auto p-4 pb-12">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 mb-4 tap-shrink">
        <ArrowLeft size={18} /> Kembali
      </button>
      <h1 className="text-2xl font-bold mb-4">Syarat & Ketentuan</h1>
      <div className="prose prose-sm max-w-none space-y-4 text-gray-700">
        <p>Terakhir diperbarui: 29 Juli 2026</p>
        <h3 className="font-bold text-base mt-6">1. Akun</h3>
        <p>Kamu bertanggung jawab atas keamanan akun dan aktivitas yang dilakukan. Satu akun per orang.</p>
        <h3 className="font-bold text-base mt-6">2. Task & Reward</h3>
        <p>Reward dibayar setelah task di-approve oleh admin. Keputusan admin bersifat final. Penyalahgunaan sistem (spam, plagiarisme, fake account) menyebabkan banned tanpa kompensasi.</p>
        <h3 className="font-bold text-base mt-6">3. Program Army</h3>
        <p>Peserta Program Army wajib: menggunakan 1 device & 1 IP, memberi notice H-30 sebelum berhenti, tidak melakukan aktivitas yang melanggar kebijakan platform. Pelanggaran menyebabkan hold hangus dan expulsion.</p>
        <h3 className="font-bold text-base mt-6">4. Payout</h3>
        <p>Minimum payout Rp150.000. Payout diproses dalam 24 jam kerja setelah di-mark paid oleh admin. Pembayaran via e-wallet (Dana, OVO, GoPay) atau transfer bank.</p>
        <h3 className="font-bold text-base mt-6">5. Pembatasan Tanggung Jawab</h3>
        <p>PeTa tidak bertanggung jawab atas perubahan kebijakan platform yang memengaruhi ketersediaan task. Kami berhak mengubah ketentuan dengan pemberitahuan via grup WhatsApp.</p>
        <h3 className="font-bold text-base mt-6">6. Hukum yang Berlaku</h3>
        <p>Perjanjian ini diatur oleh hukum Republik Indonesia.</p>
      </div>
    </div>
  );
}
