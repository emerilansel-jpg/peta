import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Privacy() {
  const navigate = useNavigate();
  return (
    <div className="max-w-2xl mx-auto p-4 pb-12">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 mb-4 tap-shrink">
        <ArrowLeft size={18} /> Kembali
      </button>
      <h1 className="text-2xl font-bold mb-4">Kebijakan Privasi</h1>
      <div className="prose prose-sm max-w-none space-y-4 text-gray-700">
        <p>Terakhir diperbarui: 29 Juli 2026</p>
        <h3 className="font-bold text-base mt-6">1. Data yang Kami Kumpulkan</h3>
        <p>Kami mengumpulkan data yang kamu berikan saat mendaftar: nama, email, nomor WhatsApp, dan username platform (jika dihubungkan).</p>
        <h3 className="font-bold text-base mt-6">2. Penggunaan Data</h3>
        <p>Data kamu digunakan untuk: (a) mengelola akun dan payout, (b) mengirim notifikasi task dan bonus, (c) verifikasi aktivitas platform, (d) komunikasi via WhatsApp.</p>
        <h3 className="font-bold text-base mt-6">3. Penyimpanan & Keamanan</h3>
        <p>Data disimpan di server Supabase (infrastruktur cloud). Kami tidak menjual data ke pihak ketiga. Password di-hash dan tidak bisa dibaca oleh siapapun termasuk admin.</p>
        <h3 className="font-bold text-base mt-6">4. Hak Kamu</h3>
        <p>Kamu bisa meminta penghapusan akun dan semua data terkait dengan menghubungi admin via WhatsApp. Proses maksimal 3 hari kerja.</p>
        <h3 className="font-bold text-base mt-6">5. Cookie</h3>
        <p>Kami hanya menggunakan cookie esensial untuk sesi login. Tidak ada cookie tracking atau iklan.</p>
        <h3 className="font-bold text-base mt-6">6. Kontak</h3>
        <p>Untuk pertanyaan privasi, hubungi: <strong>admin@penghasilantambahan.com</strong></p>
      </div>
    </div>
  );
}
