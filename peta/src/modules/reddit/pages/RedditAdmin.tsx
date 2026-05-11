import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { supabase } from '../../../lib/supabase';
import {
  getAdminPendingTopups,
  getAdminPendingOrders,
  adminApproveTopup,
  adminRejectTopup,
  adminUpdateOrderStatus,
} from '../lib/api';
import { toast } from '../../../components/Toast';

export function RedditAdmin() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('topups');
  const [topups, setTopups] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminId, setAdminId] = useState('');

  useEffect(() => {
    // Check if user is admin
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        navigate('/');
        return;
      }
      setAdminId(user.id);

      // Fetch data
      loadData();
    });
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [topupData, orderData] = await Promise.all([
        getAdminPendingTopups(),
        getAdminPendingOrders(),
      ]);
      setTopups(topupData);
      setOrders(orderData);
    } catch (err) {
      toast.error('Gagal memuat data');
    }
    setLoading(false);
  };

  const handleApproveTopup = async (topupId: number) => {
    try {
      await adminApproveTopup(topupId, adminId);
      toast.success('Topup disetujui');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Gagal');
    }
  };

  const handleRejectTopup = async (topupId: number) => {
    const note = prompt('Alasan penolakan?');
    if (!note) return;

    try {
      await adminRejectTopup(topupId, note);
      toast.success('Topup ditolak');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Gagal');
    }
  };

  const handleUpdateOrderStatus = async (orderId: number, status: string) => {
    try {
      await adminUpdateOrderStatus(orderId, status);
      toast.success(`Order status diubah ke ${status}`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Gagal');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Panel - Reddit Upvotes</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-8 border-b border-gray-300">
        <button
          onClick={() => setActiveTab('topups')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'topups'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600'
          }`}
        >
          Top Ups Pending ({topups.length})
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'orders'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600'
          }`}
        >
          Orders Pending ({orders.length})
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Memuat...</p>
        </div>
      ) : activeTab === 'topups' ? (
        <div className="space-y-4">
          {topups.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-600">Tidak ada topup pending</p>
            </Card>
          ) : (
            topups.map((topup: any) => (
              <Card key={topup.id} className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                  <div>
                    <div className="text-sm text-gray-600">User</div>
                    <div className="font-semibold text-gray-900">
                      {topup.users?.full_name} ({topup.users?.email})
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Jumlah</div>
                    <div className="text-2xl font-bold text-green-600">
                      Rp{topup.amount_requested.toLocaleString('id-ID')}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <div className="text-sm text-gray-600">Metode</div>
                    <div className="font-medium">{topup.payment_method}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Tanggal</div>
                    <div className="font-medium">
                      {new Date(topup.created_at).toLocaleDateString('id-ID')}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleApproveTopup(topup.id)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  >
                    ✓ Setujui
                  </Button>
                  <Button
                    onClick={() => handleRejectTopup(topup.id)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    ✗ Tolak
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {orders.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-600">Tidak ada order pending</p>
            </Card>
          ) : (
            orders.map((order: any) => (
              <Card key={order.id} className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
                  <div>
                    <div className="text-sm text-gray-600">User</div>
                    <div className="font-semibold text-gray-900">
                      {order.users?.full_name}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Upvotes</div>
                    <div className="text-xl font-bold text-blue-600">
                      {order.requested_upvotes}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Status</div>
                    <div className="font-medium">{order.status}</div>
                  </div>
                </div>

                <div className="mb-6">
                  <div className="text-sm text-gray-600 mb-1">Thread URL</div>
                  <a
                    href={order.thread_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    {order.thread_url}
                  </a>
                </div>

                <div className="flex gap-3">
                  {order.status === 'pending' && (
                    <Button
                      onClick={() => handleUpdateOrderStatus(order.id, 'processing')}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      ▶ Proses
                    </Button>
                  )}
                  {order.status === 'processing' && (
                    <Button
                      onClick={() => handleUpdateOrderStatus(order.id, 'completed')}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    >
                      ✓ Selesai
                    </Button>
                  )}
                  <Button
                    onClick={() => handleUpdateOrderStatus(order.id, 'cancelled')}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    ✗ Batal
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      <Button
        onClick={() => navigate('/admin')}
        className="mt-8 bg-gray-200 hover:bg-gray-300 text-gray-900"
      >
        ◀ Kembali ke Admin
      </Button>
    </div>
  );
}
