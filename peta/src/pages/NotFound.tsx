import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';

// QA3 FIX 6 — human 404 page instead of silent redirect to home.
// Tenant-aware: straight.ltd visitors get the SaaS CTA, PeTa gets the army CTA.
export function NotFound() {
  const navigate = useNavigate();
  const isStraight = typeof window !== 'undefined' && /(^|\.)straight\.ltd$/i.test(window.location.hostname);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 py-16 text-center bg-gradient-to-br from-primary/10 via-white to-secondary/10">
      <div className="text-6xl mb-4">🧭</div>
      <h1 className="text-3xl font-extrabold text-dark mb-2">Halaman nggak ketemu</h1>
      <p className="text-muted text-sm mb-2 max-w-sm">
        Alamat yang kamu buka salah atau udah dipindah. Tenang, nggak ada yang rusak kok.
      </p>
      <p className="text-[11px] text-muted/70 mb-6">404 · Halaman tidak ditemukan</p>
      <div className="flex flex-col gap-2 w-full max-w-[260px]">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => navigate(isStraight ? '/reddit' : '/')}
        >
          {isStraight ? 'Kembali ke Straight Ltd' : 'Kembali ke Beranda'}
        </Button>
        {!isStraight && (
          <Button variant="outline" size="lg" fullWidth onClick={() => navigate('/help')}>
            Butuh bantuan? Lihat FAQ
          </Button>
        )}
      </div>
    </div>
  );
}
