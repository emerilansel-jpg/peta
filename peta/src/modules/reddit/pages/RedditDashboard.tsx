import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { useRedditCredits } from '../hooks/useRedditCredits';

export function RedditDashboard() {
  const navigate = useNavigate();
  const { balance, isLoading } = useRedditCredits();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Reddit Upvotes Dashboard
      </h1>

      {/* Credit Card */}
      <Card className="p-6 mb-8 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
        <div className="text-sm opacity-90 mb-2">Saldo Kredit</div>
        <div className="text-4xl font-bold mb-4">
          {isLoading ? '...' : balance.toLocaleString('id-ID')}
        </div>
        <p className="text-sm opacity-90">1 kredit = 1 upvote</p>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Button
          onClick={() => navigate('/reddit/new-order')}
          className="bg-green-600 hover:bg-green-700 text-white h-16 text-lg"
          size="lg"
        >
          📋 Buat Order
        </Button>
        <Button
          onClick={() => navigate('/reddit/topup')}
          className="bg-purple-600 hover:bg-purple-700 text-white h-16 text-lg"
          size="lg"
        >
          💰 Top Up
        </Button>
        <Button
          onClick={() => navigate('/reddit/orders')}
          className="bg-blue-600 hover:bg-blue-700 text-white h-16 text-lg"
          size="lg"
        >
          📊 Riwayat Order
        </Button>
        <Button
          onClick={() => navigate('/reddit')}
          className="bg-gray-600 hover:bg-gray-700 text-white h-16 text-lg"
          size="lg"
        >
          ◀ Kembali
        </Button>
      </div>
    </div>
  );
}
