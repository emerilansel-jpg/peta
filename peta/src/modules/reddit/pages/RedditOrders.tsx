import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { useRedditOrders } from '../hooks/useRedditOrders';
import { CardSkeleton } from '../../../components/Skeleton';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: 'Menunggu', color: 'yellow' },
  processing: { label: 'Diproses', color: 'blue' },
  completed: { label: 'Selesai', color: 'green' },
  cancelled: { label: 'Dibatalkan', color: 'red' },
};

export function RedditOrders() {
  const navigate = useNavigate();
  const { orders, isLoading } = useRedditOrders();

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      yellow: 'bg-yellow-100 text-yellow-800',
      blue: 'bg-blue-100 text-blue-800',
      green: 'bg-green-100 text-green-800',
      red: 'bg-red-100 text-red-800',
    };
    return colors[STATUS_LABEL[status]?.color || 'blue'] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Riwayat Order</h1>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-600 mb-4">Belum ada order</p>
          <Button
            onClick={() => navigate('/reddit/new-order')}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Buat Order Pertama
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order: any) => (
            <Card key={order.id} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-600 mb-1">URL Thread</div>
                  <a
                    href={order.thread_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    {order.thread_url.substring(0, 60)}...
                  </a>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Subreddit</div>
                  <div className="font-medium text-gray-900">
                    {order.subreddit || '—'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Upvote</div>
                  <div className="text-xl font-bold text-gray-900">
                    {order.requested_upvotes}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Biaya</div>
                  <div className="text-xl font-bold text-blue-600">
                    {order.cost_credits}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Status</div>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(order.status)}`}>
                    {STATUS_LABEL[order.status]?.label || order.status}
                  </span>
                </div>
              </div>

              <div className="text-xs text-gray-500">
                {new Date(order.created_at).toLocaleDateString('id-ID', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Button
        onClick={() => navigate('/reddit/dashboard')}
        className="mt-8 bg-gray-200 hover:bg-gray-300 text-gray-900"
      >
        ◀ Kembali
      </Button>
    </div>
  );
}
