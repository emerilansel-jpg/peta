import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { getPricePerUpvote } from '../lib/api';
import { toast } from '../../../components/Toast';

const PRICE = getPricePerUpvote();

export function RedditNewOrder() {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const { createOrder, isCreating, error } = useRedditOrders();

  const [threadUrl, setThreadUrl] = useState('');
  const [subreddit, setSubreddit] = useState('');
  const [upvotes, setUpvotes] = useState(1);
  const [notes, setNotes] = useState('');

  const totalCost = upvotes * PRICE;
  const canOrder = balance >= totalCost && threadUrl.trim() !== '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!threadUrl.trim()) {
      toast.error('Masukkan URL thread');
      return;
    }

    createOrder(
      {
        threadUrl: threadUrl.trim(),
        subreddit: subreddit.trim() || null,
        requestedUpvotes: upvotes,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success('Order berhasil dibuat');
          setTimeout(() => navigate('/reddit/orders'), 1500);
        },
        onError: (err: any) => {
          toast.error(err.message || 'Gagal membuat order');
        },
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Buat Order Upvote</h1>
      <p className="text-gray-600 mb-8">Pesan upvote untuk thread Reddit favorit</p>

      {/* Balance Alert */}
      <Card className="p-4 mb-6 border-l-4 border-blue-600 bg-blue-50">
        <div className="text-sm text-gray-600">Saldo Kredit</div>
        <div className="text-2xl font-bold text-gray-900">
          {balance.toLocaleString('id-ID')}
        </div>
      </Card>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Thread URL */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">
            URL Thread
          </label>
          <input
            type="url"
            value={threadUrl}
            onChange={(e) => setThreadUrl(e.target.value)}
            placeholder="https://reddit.com/r/..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            required
          />
        </div>

        {/* Subreddit */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">
            Subreddit (opsional)
          </label>
          <input
            type="text"
            value={subreddit}
            onChange={(e) => setSubreddit(e.target.value)}
            placeholder="contohsubreddit"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        {/* Upvotes */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">
            Jumlah Upvote
          </label>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setUpvotes(Math.max(1, upvotes - 1))}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
            >
              −
            </button>
            <input
              type="number"
              value={upvotes}
              onChange={(e) => setUpvotes(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 text-center border border-gray-300 rounded-lg px-2 py-2"
              min="1"
              max="1000"
            />
            <button
              type="button"
              onClick={() => setUpvotes(upvotes + 1)}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
            >
              +
            </button>
          </div>
        </div>

        {/* Cost Breakdown */}
        <Card className="p-4 bg-gray-50">
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Harga per upvote</span>
            <span className="font-medium">{PRICE} kredit</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-300">
            <span className="font-semibold text-gray-900">Total Biaya</span>
            <span className="text-2xl font-bold text-blue-600">
              {totalCost} kredit
            </span>
          </div>
          {balance < totalCost && (
            <div className="text-sm text-red-600 mt-3">
              ⚠️ Kredit tidak cukup. Kurang {(totalCost - balance)} kredit.
            </div>
          )}
        </Card>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-2">
            Catatan (opsional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Instruksi khusus atau catatan..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none h-24"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-300 rounded text-red-700 text-sm">
            {(error as any).message}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={!canOrder || isCreating}
            className={`flex-1 h-12 text-lg ${
              canOrder && !isCreating
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 text-gray-600 cursor-not-allowed'
            }`}
          >
            {isCreating ? 'Membuat...' : 'Buat Order'}
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
    </div>
  );
}
