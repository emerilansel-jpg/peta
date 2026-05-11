import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { useTopups } from '../hooks/useTopups';
import { toast } from '../../../components/Toast';

const TOPUP_PRESETS = [10000, 25000, 50000, 100000, 250000];

export function RedditTopup() {
  const navigate = useNavigate();
  const { topups, createTopup, isCreating } = useTopups();

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('transfer');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = parseInt(amount);
    if (!parsed || parsed < 1000) {
      toast.error('Minimal top up Rp1.000');
      return;
    }

    if (!paymentMethod) {
      toast.error('Pilih metode pembayaran');
      return;
    }

    createTopup(
      {
        amountRequested: parsed,
        paymentMethod,
        proofUrl: null,
      },
      {
        onSuccess: () => {
          toast.success('Permintaan top up berhasil dikirim');
          setAmount('');
          setPaymentMethod('transfer');
          setNotes('');
        },
      }
    );
  };

  const pendingTopup = topups.find((t: any) => t.status === 'pending');

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Top Up Kredit</h1>
      <p className="text-gray-600 mb-8">Minta kredit dari admin dengan metode pembayaran pilihan kamu</p>

      {pendingTopup && (
        <Card className="p-4 mb-6 border-l-4 border-yellow-500 bg-yellow-50">
          <div className="text-sm font-semibold text-yellow-900 mb-1">
            ⏳ Topup Menunggu Persetujuan
          </div>
          <div className="text-lg font-bold text-yellow-900">
            Rp{pendingTopup.amount_requested.toLocaleString('id-ID')}
          </div>
          <p className="text-xs text-yellow-700 mt-2">
            Admin akan proses dalam beberapa jam
          </p>
        </Card>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-3">
            Jumlah (Rp)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Misal: 50000"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 mb-4"
            min="1000"
          />

          {/* Presets */}
          <div className="grid grid-cols-2 gap-2">
            {TOPUP_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset.toString())}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-sm font-medium text-gray-700"
              >
                Rp{(preset / 1000).toFixed(0)}K
              </button>
            ))}
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">
            Metode Pembayaran
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Pilih metode</option>
            <option value="transfer">Transfer Bank</option>
            <option value="gopay">GoPay</option>
            <option value="ovo">OVO</option>
            <option value="dana">DANA</option>
            <option value="ewallet">E-Wallet Lainnya</option>
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">
            Catatan (opsional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Nomor rekening, akun, dsb..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none h-24"
          />
        </div>

        {/* Info */}
        <Card className="p-4 bg-blue-50 border-l-4 border-blue-600">
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-2">⏱️ Proses:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Ajukan request di sini</li>
              <li>Admin akan kontak kamu via WhatsApp</li>
              <li>Proses ~1-2 jam kerja</li>
              <li>Kredit otomatis masuk setelah verifikasi</li>
            </ul>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={!amount || !paymentMethod || isCreating}
            className={`flex-1 h-12 text-lg ${
              amount && paymentMethod && !isCreating
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-300 text-gray-600 cursor-not-allowed'
            }`}
          >
            {isCreating ? 'Mengirim...' : 'Ajukan Top Up'}
          </Button>
          <Button
            type="button"
            onClick={() => navigate('/reddit/dashboard')}
            className="flex-1 h-12 bg-gray-200 hover:bg-gray-300 text-gray-900"
          >
            Batal
          </Button>
        </div>
      </form>

      {/* History */}
      {topups.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Riwayat Top Up</h2>
          <div className="space-y-3">
            {topups.map((topup: any) => (
              <Card key={topup.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-gray-900">
                      Rp{topup.amount_requested.toLocaleString('id-ID')}
                    </div>
                    <div className="text-sm text-gray-600">
                      {topup.payment_method} • {new Date(topup.created_at).toLocaleDateString('id-ID')}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      topup.status === 'approved'
                        ? 'bg-green-100 text-green-800'
                        : topup.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {topup.status === 'pending' && 'Menunggu'}
                    {topup.status === 'approved' && 'Disetujui'}
                    {topup.status === 'rejected' && 'Ditolak'}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
