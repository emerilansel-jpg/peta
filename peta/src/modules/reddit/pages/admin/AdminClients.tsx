import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  RefreshCw,
  Plus,
  ArrowLeft,
  ShoppingCart,
  ChevronRight,
  Shield,
  Edit,
  Trash2,
  AlertTriangle,
  Save,
  X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import {
  getAdminAllUsers,
  getAdminUserDetail,
  adminAdjustCredits,
  adminUpdateUser,
  adminDeleteUser,
  formatUSD,
} from '../../lib/api';

export function AdminClients() {
  const { userId } = useParams();
  return userId ? <ClientDetail userId={userId} /> : <ClientsList />;
}

function ClientsList() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'client' | 'admin'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getAdminAllUsers();
      // Straight Ltd admin sees clients + admins only. PeTa army users live in /admin/team.
      setUsers(data.filter((u: any) => u.role === 'client' || u.role === 'admin'));
    } catch {
      toast.error('Failed to load clients');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const matches =
        u.email?.toLowerCase().includes(q) ||
        u.full_name?.toLowerCase().includes(q) ||
        u.id?.includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const totalCredits = users.reduce((sum, u) => sum + (u.credit_balance || 0), 0);

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Clients' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Clients</h1>
            <p className="text-slate-600 mt-1">{users.length} total · {formatUSD(totalCredits)} in active credits</p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        <div className="bg-white rounded-xl ring-1 ring-slate-200 p-2 mb-6 flex flex-col md:flex-row gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {(['all', 'client', 'admin'] as const).map((r) => {
              const count = r === 'all' ? users.length : users.filter((u) => u.role === r).length;
              return (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                    roleFilter === r ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {r === 'client' ? 'Clients' : r === 'admin' ? 'Admins' : 'All'}
                  <span className="ml-1.5 text-xs opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="md:ml-auto relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, email..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full md:w-72 pl-9 pr-3 py-1.5 rounded-lg ring-1 ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-12 text-center text-slate-500">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="p-12 text-center text-slate-500">No clients match</p>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Client</th>
                  <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Credit balance</th>
                  <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Role</th>
                  <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Joined</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <Link to={`/reddit/admin/clients/${u.id}`} className="block">
                        <p className="font-semibold text-slate-900">{u.full_name || '—'}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="font-bold text-slate-900">{formatUSD(u.credit_balance || 0)}</p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {u.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 text-white text-xs font-semibold">
                          <Shield size={10} /> Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                          Client
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-500">
                      {new Date(u.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/reddit/admin/clients/${u.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700"
                      >
                        View <ChevronRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function ClientDetail({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const load = async () => {
    try {
      const result = await getAdminUserDetail(userId);
      setData(result);
    } catch {
      toast.error('Failed to load client');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [userId]);

  if (loading || !data) {
    return (
      <AdminLayout>
        <div className="p-6 md:p-10">
          <p className="text-slate-500">Loading client...</p>
        </div>
      </AdminLayout>
    );
  }

  const { user, orders, topups, transactions } = data;
  const totalSpent = orders.reduce((sum: number, o: any) => sum + o.cost_credits, 0);
  const totalToppedUp = topups
    .filter((t: any) => t.payment_status === 'completed')
    .reduce((sum: number, t: any) => sum + t.amount_cents, 0);

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <AdminBreadcrumb
          items={[
            { label: 'Admin', href: '/reddit/admin' },
            { label: 'Clients', href: '/reddit/admin/clients' },
            { label: user.full_name || user.email },
          ]}
        />

        <button
          onClick={() => navigate('/reddit/admin/clients')}
          className="inline-flex items-center gap-1 text-sm text-slate-600 mb-4"
        >
          <ArrowLeft size={14} /> Back to clients
        </button>

        {/* Profile header */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{user.full_name || user.email}</h1>
              <p className="text-sm text-slate-500 mt-1">
                {user.email} · Joined {new Date(user.created_at).toLocaleDateString('en-US')}
              </p>
              <div className="flex gap-2 mt-3">
                {user.role === 'admin' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold">
                    <Shield size={11} /> Admin
                  </span>
                )}
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                  user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowAdjustModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
              >
                <Plus size={14} />
                Adjust credits
              </button>
              <button
                onClick={() => setShowEditModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
              >
                <Edit size={14} />
                Edit
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg ring-1 ring-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-semibold"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatBox label="Credit balance" value={formatUSD(user.credit_balance || 0)} accent />
          <StatBox label="Total topped up" value={formatUSD(totalToppedUp)} />
          <StatBox label="Total spent" value={formatUSD(totalSpent)} />
          <StatBox label="Total orders" value={orders.length.toString()} />
        </div>

        {/* Orders */}
        <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart size={16} />
              Orders ({orders.length})
            </h2>
          </div>
          {orders.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 text-center">No orders yet</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {orders.slice(0, 10).map((o: any) => (
                <Link
                  key={o.id}
                  to={`/reddit/admin/orders?focus=${o.id}`}
                  className="block px-6 py-3 hover:bg-slate-50 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">#{o.id}</p>
                    <p className="text-xs text-slate-500 truncate">{o.thread_url}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">{o.requested_upvotes} upvotes</p>
                    <p className="text-xs text-slate-500">{formatUSD(o.cost_credits)}</p>
                  </div>
                  <StatusPill status={o.status} />
                  <ChevronRight size={14} className="text-slate-400" />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Topups */}
        <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">Top-ups ({topups.length})</h2>
          </div>
          {topups.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 text-center">No top-ups yet</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {topups.slice(0, 10).map((t: any) => (
                <div key={t.id} className="px-6 py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">{formatUSD(t.amount_cents)}</p>
                    <p className="text-xs text-slate-500">
                      {t.payment_method.toUpperCase()} · {new Date(t.created_at).toLocaleDateString('en-US')}
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    t.payment_status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    t.payment_status === 'failed' ? 'bg-rose-100 text-rose-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {t.payment_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Transactions */}
        <section className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">Credit transactions ({transactions.length})</h2>
          </div>
          {transactions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 text-center">No transactions yet</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {transactions.map((t: any) => (
                <div key={t.id} className="px-6 py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium capitalize">{t.type}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(t.created_at).toLocaleString('en-US')}
                    </p>
                  </div>
                  <p className={`font-bold ${t.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {t.amount > 0 ? '+' : ''}{formatUSD(t.amount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showAdjustModal && (
        <AdjustCreditsModal
          user={user}
          onClose={() => setShowAdjustModal(false)}
          onSaved={() => {
            setShowAdjustModal(false);
            load();
          }}
        />
      )}

      {showEditModal && (
        <EditClientModal
          user={user}
          onClose={() => setShowEditModal(false)}
          onSaved={() => {
            setShowEditModal(false);
            load();
          }}
        />
      )}

      {showDeleteModal && (
        <DeleteClientModal
          user={user}
          orderCount={orders.length}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => navigate('/reddit/admin/clients')}
        />
      )}
    </AdminLayout>
  );
}

function EditClientModal({
  user,
  onClose,
  onSaved,
}: {
  user: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name || '');
  const [role, setRole] = useState<'client' | 'admin'>(user.role === 'admin' ? 'admin' : 'client');
  const [isActive, setIsActive] = useState(user.is_active);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminUpdateUser(user.id, {
        full_name: fullName.trim(),
        role,
        is_active: isActive,
      });
      toast.success('Client updated');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-900">Edit client</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <p className="text-sm text-slate-500">
            Editing <span className="font-semibold text-slate-900">{user.email}</span>
          </p>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {(['client', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                    role === r ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {r === 'client' ? 'Client' : 'Admin'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {role === 'admin' ? '⚠️ Will have full admin access' : 'Standard client access'}
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500"
              />
              <span className="text-sm font-semibold text-slate-700">Active account</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 ml-6">
              Deactivated clients can't login or place orders. Their data is preserved.
            </p>
          </div>

          {/* Note about email */}
          <div className="p-3 rounded-lg bg-slate-50 text-xs text-slate-600">
            <p>📧 Email changes require Supabase Auth — contact dev. Email shown: <span className="font-mono">{user.email}</span></p>
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold inline-flex items-center justify-center gap-2"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteClientModal({
  user,
  orderCount,
  onClose,
  onDeleted,
}: {
  user: any;
  orderCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const expected = `DELETE ${user.email}`;
  const canDelete = confirmText === expected;

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      await adminDeleteUser(user.id);
      toast.success(`${user.email} deleted permanently`);
      onDeleted();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-2 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
            <AlertTriangle size={20} className="text-rose-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">Delete client?</h3>
            <p className="text-sm text-slate-500">This cannot be undone</p>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="p-4 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-sm text-rose-900">
            <p className="font-semibold mb-2">This will permanently delete:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>The user account ({user.email})</li>
              <li>{orderCount} order(s) and all related data</li>
              <li>All credit transactions and history</li>
              <li>All tickets and messages</li>
              <li>Credit balance: {formatUSD(user.credit_balance || 0)}</li>
            </ul>
            <p className="mt-3 text-xs">
              💡 <span className="font-semibold">Recommended instead:</span> use "Edit" to deactivate the account. Preserves data for audit/refund.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Type <code className="px-1 py-0.5 rounded bg-slate-100 font-mono text-xs">{expected}</code> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 font-mono text-sm"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="flex-1 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed text-white font-semibold inline-flex items-center justify-center gap-2"
          >
            <Trash2 size={14} />
            {deleting ? 'Deleting...' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustCreditsModal({
  user,
  onClose,
  onSaved,
}: {
  user: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents === 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!reason.trim()) {
      toast.error('Reason is required');
      return;
    }
    setSaving(true);
    try {
      await adminAdjustCredits(user.id, cents, reason.trim());
      toast.success(`Adjusted ${formatUSD(cents)}`);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Failed to adjust');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="text-xl font-bold text-slate-900 mb-1">Adjust credits</h3>
        <p className="text-sm text-slate-500 mb-1">For {user.email}</p>
        <p className="text-sm text-slate-700 font-semibold mb-5">
          Current balance: {formatUSD(user.credit_balance || 0)}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Amount (USD)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="-50.00 (refund) or 25.00 (credit)"
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
            <p className="text-xs text-slate-500 mt-1">Negative for refunds. Positive for credits.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Reason (required)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="E.g. Refund order #123, manual comp..."
              className="w-full px-3.5 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg ring-1 ring-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !amount || !reason.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold"
          >
            {saving ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-4 rounded-xl ring-1 ${accent ? 'bg-orange-50 ring-orange-200' : 'bg-white ring-slate-200'}`}>
      <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent ? 'text-orange-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    processing: 'bg-blue-50 text-blue-700 ring-blue-200',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    cancelled: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}
